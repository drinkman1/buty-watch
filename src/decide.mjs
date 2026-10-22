// Logika "co wyslac". Czysta: dostaje poprzedni stan, wyniki zrodel i czas,
// oddaje nowy stan i liste wiadomosci. Selftest sprawdza ja bez sieci.
//
// Produkty - alerty tylko na zmiane stanu, zeby skan co 15 minut nie
// powtarzal tego samego:
//   KUPUJ      - rozmiar dostepny i cena <= progu (wejscie w ten stan)
//   TANIEJ     - nadal KUPUJ, a cena spadla
//   DOSTEPNY   - rozmiar wrocil, ale cena powyzej progu
//   PROG       - cena spadla ponizej progu, rozmiaru brak
//   ZNIKNAL    - rozmiar byl dostepny i juz nie jest
// Feedy (Pepper, Lounge) - NOWE: wpis, ktorego id jeszcze nie widzielismy i
// ktory pasuje do wzorca. Pierwszy przebieg feedu tylko zapamietuje, co jest.
// Wspolne: AWARIA po N bledach z rzedu, potem POWROT; RAPORT raz dziennie.

export function warsawParts(now) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export const fmt = (p) => (p == null ? "?" : `${p.toFixed(2).replace(".", ",")} zł`);
const SEEN_MAX = 400;

export function decide(prev, results, config, now) {
  const state = { sources: { ...(prev && prev.sources) }, lastDaily: prev && prev.lastDaily };
  const msgs = [];

  for (const r of results) {
    const p = state.sources[r.source] || { failStreak: 0, errorAlerted: false };
    const n = { ...p };

    if (!r.ok) {
      n.failStreak = (p.failStreak || 0) + 1;
      n.lastError = r.error;
      if (n.failStreak === config.errorAlertAfter) {
        msgs.push({ kind: "AWARIA", r, text: `${n.failStreak} przebiegi z rzędu bez odpowiedzi. Ostatni błąd: ${r.error}` });
        n.errorAlerted = true;
      }
      state.sources[r.source] = n;
      continue;
    }

    if (p.errorAlerted) msgs.push({ kind: "POWROT", r, text: "Znowu odpowiada." });
    n.failStreak = 0;
    n.errorAlerted = false;
    delete n.lastError;

    if (r.kind === "feed") decideFeed(p, n, r, msgs);
    else decideProduct(p, n, r, msgs);
    state.sources[r.source] = n;
  }

  const w = warsawParts(now);
  if (w.hour >= config.dailyReportHourWarsaw && state.lastDaily !== w.date) {
    state.lastDaily = w.date;
    msgs.push({ kind: "RAPORT", text: dailyReport(state, results, config) });
  }
  return { state, msgs };
}

function decideProduct(p, n, r, msgs) {
  const { size, maxPrice: max } = r.product;
  const buy = r.available && r.price != null && r.price <= max;
  if (buy && !p.buy) {
    msgs.push({ kind: "KUPUJ", r, text: `Rozmiar ${size} dostępny za ${fmt(r.price)} (próg ${fmt(max)}).` });
  } else if (buy && p.buy && p.price != null && r.price < p.price) {
    msgs.push({ kind: "TANIEJ", r, text: `Jeszcze taniej: ${fmt(p.price)} → ${fmt(r.price)}, rozmiar ${size} nadal jest.` });
  } else if (r.available && !p.available) {
    msgs.push({ kind: "DOSTEPNY", r, text: `Rozmiar ${size} wrócił, ale cena ${fmt(r.price)} jest powyżej progu ${fmt(max)}.` });
  } else if (!r.available && r.price != null && r.price <= max && (p.price == null || p.price > max)) {
    msgs.push({ kind: "PROG", r, text: `Cena spadła do ${fmt(r.price)}, ale rozmiaru ${size} brak. Pilnuję dalej.` });
  }
  if (!r.available && p.available) {
    msgs.push({ kind: "ZNIKNAL", r, text: `Rozmiar ${size} znowu niedostępny.` });
  }
  Object.assign(n, { available: r.available, buy, price: r.price, stock: r.stock ?? null });
}

function decideFeed(p, n, r, msgs) {
  const re = new RegExp(r.feed.match, "i");
  const hits = r.items.filter((x) => !x.expired && re.test([x.title, ...(x.brands || [])].join(" ")));
  const seen = new Set(p.seen || []);
  if (p.seen) {
    for (const x of hits.filter((h) => !seen.has(h.id))) {
      const bits = [x.title];
      if (x.price != null) bits.push(fmt(x.price));
      if (x.discount != null) bits.push(`do -${x.discount}%`);
      if (x.shop) bits.push(`@ ${x.shop}`);
      if (x.to) bits.push(`do ${x.to.slice(0, 10)}`);
      msgs.push({ kind: "NOWE", r: { ...r, url: x.url }, text: bits.join(" · ") });
    }
  }
  const all = [...r.items.map((x) => x.id), ...(p.seen || [])];
  n.seen = [...new Set(all)].slice(0, SEEN_MAX);
  n.hits = hits.length;
}

function line(r, s) {
  const who = r.kind === "product" ? `${r.product.name} @ ${r.shop}` : r.shop;
  if (!r.ok) return `• ${who}: błąd (${s.failStreak}×) – ${r.error}`;
  if (r.kind === "feed") return `• ${who}: ${r.items.length} wpisów, pasujących ${s.hits ?? 0}`;
  const st = r.available ? `✅ ${r.stock ?? ""}`.trim() : "❌ brak";
  return `• ${who}: ${fmt(r.price)}, r. ${r.product.size} ${st}`;
}

export function dailyReport(state, results, config) {
  return [
    "Stan na dziś:",
    ...results.map((r) => line(r, state.sources[r.source] || {})),
    `Obserwacja do ${config.stopAfter}.`,
  ].join("\n");
}
