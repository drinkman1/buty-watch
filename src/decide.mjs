// Logika "co wyslac". Czysta: dostaje poprzedni stan, wyniki zrodel i czas,
// oddaje nowy stan i liste wiadomosci. Selftest sprawdza ja bez sieci.
//
// Alerty leca tylko na zmiane stanu, zeby bot co 15 minut nie powtarzal tego
// samego:
//   KUPUJ      - rozmiar dostepny i cena <= progu (wejscie w ten stan)
//   TANIEJ     - nadal KUPUJ, a cena spadla
//   DOSTEPNY   - rozmiar wrocil, ale cena powyzej progu
//   PROG       - cena spadla ponizej progu, rozmiaru brak
//   ZNIKNAL    - rozmiar byl dostepny i juz nie jest
//   AWARIA     - zrodlo nie odpowiada N przebiegow z rzedu; potem POWROT
// Plus raport dzienny, zeby bylo widac, ze bot zyje.

export function warsawParts(now) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export const fmt = (p) => (p == null ? "?" : `${p.toFixed(2).replace(".", ",")} zł`);

export function decide(prev, results, config, now) {
  const state = { sources: { ...(prev && prev.sources) }, lastDaily: prev && prev.lastDaily };
  const msgs = [];
  const max = config.maxPrice;
  const size = config.size;

  for (const r of results) {
    const p = state.sources[r.source] || { available: false, buy: false, price: null, failStreak: 0, errorAlerted: false };
    const n = { ...p };

    if (!r.ok) {
      n.failStreak = (p.failStreak || 0) + 1;
      n.lastError = r.error;
      if (n.failStreak === config.errorAlertAfter) {
        msgs.push({ kind: "AWARIA", r, text: `${r.shop}: ${n.failStreak} przebiegi z rzędu bez odpowiedzi. Ostatni błąd: ${r.error}` });
        n.errorAlerted = true;
      }
      state.sources[r.source] = n;
      continue;
    }

    if (p.errorAlerted) msgs.push({ kind: "POWROT", r, text: `${r.shop}: znowu odpowiada.` });
    n.failStreak = 0;
    n.errorAlerted = false;
    delete n.lastError;

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
    state.sources[r.source] = n;
  }

  const w = warsawParts(now);
  if (w.hour >= config.dailyReportHourWarsaw && state.lastDaily !== w.date) {
    state.lastDaily = w.date;
    msgs.push({ kind: "RAPORT", text: dailyReport(state, results, config) });
  }
  return { state, msgs };
}

function line(r, s) {
  if (!r.ok) return `• ${r.shop}: błąd (${s.failStreak}×) – ${r.error}`;
  const st = r.available ? `✅ ${r.stock ?? ""}`.trim() : "❌ brak";
  return `• ${r.shop}: ${fmt(r.price)}, ${st}`;
}

export function dailyReport(state, results, config) {
  return [
    `Stan na dziś, rozmiar ${config.size}, próg ${fmt(config.maxPrice)}:`,
    ...results.map((r) => line(r, state.sources[r.source] || {})),
    `Obserwacja do ${config.stopAfter}.`,
  ].join("\n");
}
