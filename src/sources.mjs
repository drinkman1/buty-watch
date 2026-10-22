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
  throw new Error("JD: niedomkniety JSON");
}

export async function checkAll(config) {
  const size = config.size;
  const S = config.sources;
  const jobs = [
    ["nike", () => checkNike(config.product, size)],
    ["jd", () => checkJd(S.jd, size)],
    ["sneakershop", () => checkSneakershop(S.sneakershop, size)],
  ];
  return Promise.all(
    jobs.map(async ([id, fn]) => {
      const base = { source: id, shop: S[id].label, url: S[id].url };
      try {
        return { ...base, ok: true, ...(await fn()) };
      } catch (e) {
        return { ...base, ok: false, error: String((e && e.message) || e) };
      }
    }),
  );
}
