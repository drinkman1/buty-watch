// Trzy zrodla, kazde czytane zwyklym HTTP - bez przegladarki.
//
// Parsery (parse*) sa czyste i przechodza przez selftest na zapisanych
// odpowiedziach. Funkcje check* tylko pobieraja i oddaja do parsera.
//
// Wynik kazdego zrodla:
//   { source, shop, url, ok, price, available, stock, note, error }
// available = czy rozmiar z config.size jest do kupienia (wysylka),
// price     = cena tego rozmiaru (albo produktu, gdy sklep nie rozroznia).

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

async function get(url, accept = "text/html,application/json") {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9", Accept: accept },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// --- Nike ---------------------------------------------------------------
// Dwa publiczne endpointy, te same, z ktorych korzysta strona:
//  - product_feed: cena PL i lista SKU z rozmiarem EU dla kazdego GTIN,
//  - available_gtins: stan magazynu per GTIN dla grupy EU (level HIGH/MEDIUM/LOW/OOS).
const NIKE_CHANNEL = "d9a5bc42-4b9c-4976-858a-f159cf99c647";

export function parseNike(feedJson, gtinsJson, size) {
  const obj = feedJson && feedJson.objects && feedJson.objects[0];
  const pi = obj && obj.productInfo && obj.productInfo[0];
  if (!pi) throw new Error("Nike: brak productInfo w product_feed");
  const price = num(pi.merchPrice && pi.merchPrice.currentPrice);
  const sku = (pi.skus || []).find((s) =>
    (s.countrySpecifications || []).some((c) => String(c.localizedSize) === size),
  );
  if (!sku) throw new Error(`Nike: brak SKU w rozmiarze ${size}`);
  const g = ((gtinsJson && gtinsJson.objects) || []).find((o) => o.gtin === sku.gtin);
  if (!g) throw new Error(`Nike: brak GTIN ${sku.gtin} w available_gtins`);
  return {
    price,
    available: g.available === true,
    stock: g.level || null,
    note: `GTIN ${sku.gtin}, zmiana stanu ${g.modificationDate || "?"}`,
    productStatus: pi.merchProduct && pi.merchProduct.status,
  };
}

export async function checkNike(cfg, size) {
  const sc = encodeURIComponent(cfg.styleColor);
  const feedUrl =
    `https://api.nike.com/product_feed/threads/v3/?filter=marketplace(PL)&filter=language(pl)` +
    `&filter=channelId(${NIKE_CHANNEL})&filter=productInfo.merchProduct.styleColor(${sc})`;
  const gtinUrl = `https://api.nike.com/deliver/available_gtins/v3?filter=styleColor(${sc})&filter=merchGroup(EU)`;
  const [feed, gtins] = await Promise.all([get(feedUrl, "application/json"), get(gtinUrl, "application/json")]);
  return parseNike(JSON.parse(feed), JSON.parse(gtins), size);
}

// --- JD Sports ----------------------------------------------------------
// Strona niesie stan aplikacji jako URL-encoded JSON. W nim tablica
// "offers": [{label: "43", offer: {stock_shipment, availability: {name}}}].
// Cene bierzemy z JSON-LD produktu.
export function parseJd(html, size) {
  const blobs = html.match(/%7B%22[0-9A-Za-z%._\-~]{2000,}/g) || [];
  const blob = blobs.find((b) => b.includes("%22offers%22%3A%5B%7B%22label%22"));
  if (!blob) throw new Error("JD: brak stanu z offers w HTML");
  const state = decodeURIComponent(blob);
  const i = state.indexOf('"offers":[{"label"');
  const [offers] = rawDecode(state, i + '"offers":'.length);
  const label = size.replace(".", ",");
  const o = offers.find((x) => x.label === label);
  const ld = html.match(/"price"\s*:\s*"([\d.]+)"/);
  const price = ld ? num(ld[1]) : null;
  if (!o) return { price, available: false, stock: 0, note: `rozmiar ${size} nie wystepuje w ofercie` };
  const stock = (o.offer.stock_shipment || 0) + 0;
  const status = o.offer.availability && o.offer.availability.name;
  return { price, available: stock > 0, stock, note: status || null };
}

export async function checkJd(src, size) {
  return parseJd(await get(src.url), size);
}

// --- SneakerShop / Adrenaline (IdoSell) ----------------------------------
// Sklepy na IdoSell oddaja rozmiary i stany pod /ajax/projector.php.
// Adrenaline.pl to ta sama firma i ten sam produkt (49223), ale jego endpoint
// nie pokazuje rozmiarow - czytamy SneakerShop.
export function parseIdo(json, size) {
  const items = (json && json.sizes && json.sizes.items) || {};
  const it = Object.values(items).find((x) => String(x.description || "").split(" - ")[0].trim() === size);
  const anyPrice = Object.values(items).map((x) => num(x.prices && x.prices.price)).find((p) => p != null);
  if (!it) return { price: anyPrice ?? null, available: false, stock: 0, note: `rozmiar ${size} nie wystepuje w ofercie` };
  const amount = num(it.amount) || 0;
  return { price: num(it.prices && it.prices.price), available: amount > 0, stock: amount, note: null };
}

export async function checkSneakershop(src, size) {
  const u = new URL(src.url);
  const api = `${u.origin}/ajax/projector.php?action=get&product=${src.productId}&get=sizes`;
  return parseIdo(JSON.parse(await get(api, "application/json")), size);
}

// JSON.parse od wskazanej pozycji do konca pierwszej wartosci.
function rawDecode(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return [JSON.parse(s.slice(start, j + 1)), j + 1];
    }
  }
  throw new Error("niedomkniety JSON w stronie");
}

// --- Zalando ------------------------------------------------------------
// JSON-LD ProductGroup: hasVariant[] = {size, offers: {price, availability}}.
// Sprawdzone 22.10 w przegladarce: dostepnosc w JSON-LD zgadza sie z lista
// rozmiarow na stronie. Z IP GitHuba Akamai trzyma polaczenie do timeoutu -> tor b.
export function parseZalando(html, size) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let d;
    try { d = JSON.parse(m[1]); } catch { continue; }
    const g = (Array.isArray(d) ? d : [d]).find((x) => x && x["@type"] === "ProductGroup");
    if (!g) continue;
    const v = (g.hasVariant || []).find((x) => String(x.size) === size);
    const anyPrice = (g.hasVariant || []).map((x) => num(x.offers && x.offers.price)).find((p) => p != null) ?? null;
    if (!v) return { price: anyPrice, available: false, stock: 0, note: `rozmiar ${size} nie wystepuje w ofercie` };
    const avail = /InStock|LimitedAvailability/.test(String(v.offers && v.offers.availability));
    return { price: num(v.offers && v.offers.price), available: avail, stock: avail ? "InStock" : "OOS", note: v.sku };
  }
  throw new Error("Zalando: brak ProductGroup w JSON-LD (blokada albo zmiana strony)");
}

// --- Pepper (feed) --------------------------------------------------------
// Wyniki wyszukiwania niosa kazdy watek jako JSON w atrybucie data-vue3.
export function parsePepper(html) {
  const out = [];
  for (const m of html.matchAll(/data-vue3='(\{"name":"ThreadMainListItemNormalizer"[\s\S]*?)'/g)) {
    let th;
    try { th = JSON.parse(unescapeHtml(m[1])).props.thread; } catch { continue; }
    if (!th || !th.threadId) continue;
    out.push({
      id: String(th.threadId),
      title: th.title,
      price: num(th.price),
      shop: th.merchant && th.merchant.merchantName,
      expired: th.isExpired === true,
      url: `https://www.pepper.pl/promocje/${th.titleSlug || "x"}-${th.threadId}`,
      at: th.publishedAt ? new Date(th.publishedAt * 1000).toISOString() : null,
    });
  }
  if (!out.length && !/Szukaj/.test(html)) throw new Error("Pepper: brak watkow i brak strony wyszukiwania");
  return out;
}

// --- Zalando Lounge (feed) -----------------------------------------------
// Produkty widac tylko po zalogowaniu. Publiczna strona outletu pokazuje
// karuzele biezacych kampanii (ok. 12 najnowszych) - pilnujemy, czy startuje
// kampania pasujaca do wzorca (Nike, sneakersy). Z IP GitHuba 403 -> tor b.
export function parseLounge(html) {
  const i = html.indexOf('"campaigns":[');
  if (i < 0) throw new Error("Lounge: brak listy kampanii na stronie");
  const [arr] = rawDecode(html, i + '"campaigns":'.length);
  return arr.map((c) => ({
    id: c.id,
    title: c.name,
    brands: c.brands || [],
    discount: c.discount,
    url: c.url,
    from: c.date_from,
    to: c.date_to,
  }));
}

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const PRODUCT_CHECKS = {
  nike: (src, p) => checkNike({ styleColor: p.styleColor }, p.size),
  idosell: (src, p) => checkSneakershop(src, p.size),
  jd: (src, p) => checkJd(src, p.size),
  zalando: async (src, p) => parseZalando(await get(src.url), p.size),
};
const FEED_CHECKS = {
  pepper: async (f) => parsePepper(await get(f.url)),
  lounge: async (f) => parseLounge(await get(f.url)),
};

// track: "a" (Actions) albo "b" (laptop). Sklepy z track "b" blokuja IP GitHuba.
export async function checkAll(config, track) {
  const jobs = [];
  for (const p of config.products) {
    for (const src of p.sources.filter((s) => s.track === track)) {
      const base = { kind: "product", source: `${p.id}:${src.type}`, product: p, shop: src.shop, url: src.url };
      jobs.push(PRODUCT_CHECKS[src.type](src, p).then(
        (r) => ({ ...base, ok: true, ...r }),
        (e) => ({ ...base, ok: false, error: String((e && e.message) || e) }),
      ));
    }
  }
  for (const f of (config.feeds || []).filter((x) => x.track === track)) {
    const base = { kind: "feed", source: f.id, feed: f, shop: f.shop, url: f.url };
    jobs.push(FEED_CHECKS[f.type](f).then(
      (items) => ({ ...base, ok: true, items }),
      (e) => ({ ...base, ok: false, error: String((e && e.message) || e) }),
    ));
  }
  return Promise.all(jobs);
}
