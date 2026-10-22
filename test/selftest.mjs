// Testy offline: parsery na prawdziwych odpowiedziach z 22.10.2026 i logika
// alertow na zmyslonych przejsciach stanu. Uruchamiane przed kazdym skanem.

import fs from "node:fs";
import assert from "node:assert/strict";
import { parseNike, parseJd, parseIdo } from "../src/sources.mjs";
import { decide } from "../src/decide.mjs";
import { formatMessage } from "../src/telegram.mjs";

const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const config = JSON.parse(fs.readFileSync(new URL("../config.json", import.meta.url), "utf8"));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

t("Nike: 43 OOS, 42 HIGH, cena 454,99", () => {
  const feed = JSON.parse(fx("nike-feed.json")), g = JSON.parse(fx("nike-gtins.json"));
  const r43 = parseNike(feed, g, "43");
  assert.equal(r43.price, 454.99);
  assert.equal(r43.available, false);
  assert.equal(r43.stock, "OOS");
  const r42 = parseNike(feed, g, "42");
  assert.equal(r42.available, true);
  assert.equal(r42.stock, "HIGH");
});

t("JD: 43 niedostepny, 42 dostepny, cena 649,99", () => {
  const html = fx("jd.html");
  const r = parseJd(html, "43");
  assert.equal(r.price, 649.99);
  assert.equal(r.available, false);
  assert.equal(parseJd(html, "42").available, true);
  assert.equal(parseJd(html, "42.5").stock, 2);
});

t("SneakerShop: 43 brak, cena 519,99", () => {
  const r = parseIdo(JSON.parse(fx("sneakershop.json")), "43");
  assert.equal(r.price, 519.99);
  assert.equal(r.available, false);
});

const R = (o) => ({ source: "nike", shop: "Nike.com PL", url: "https://x", ok: true, stock: null, ...o });
const NIGHT = Date.parse("2026-10-22T01:00:00Z"); // 03:00 w Warszawie - bez raportu
const kinds = (out) => out.msgs.map((m) => m.kind);

t("pierwszy przebieg: cena pod progiem, rozmiaru brak -> PROG", () => {
  const out = decide(null, [R({ price: 454.99, available: false })], config, NIGHT);
  assert.deepEqual(kinds(out), ["PROG"]);
});

t("rozmiar wraca pod progiem -> KUPUJ, kolejny przebieg cisza", () => {
  const a = decide(null, [R({ price: 454.99, available: false })], config, NIGHT);
  const b = decide(a.state, [R({ price: 454.99, available: true })], config, NIGHT);
  assert.deepEqual(kinds(b), ["KUPUJ"]);
  const c = decide(b.state, [R({ price: 454.99, available: true })], config, NIGHT);
  assert.deepEqual(kinds(c), []);
  const d = decide(c.state, [R({ price: 429.99, available: true })], config, NIGHT);
  assert.deepEqual(kinds(d), ["TANIEJ"]);
  const e = decide(d.state, [R({ price: 429.99, available: false })], config, NIGHT);
  assert.deepEqual(kinds(e), ["ZNIKNAL"]);
});

t("rozmiar wraca nad progiem -> DOSTEPNY, potem spadek ceny -> KUPUJ", () => {
  const a = decide(null, [R({ price: 649.99, available: true })], config, NIGHT);
  assert.deepEqual(kinds(a), ["DOSTEPNY"]);
  const b = decide(a.state, [R({ price: 449, available: true })], config, NIGHT);
  assert.deepEqual(kinds(b), ["KUPUJ"]);
});

t("awaria: alert dopiero po N bledach, potem POWROT; stan sprzed awarii zostaje", () => {
  let s = decide(null, [R({ price: 649.99, available: false })], config, NIGHT).state;
  const all = [];
  for (let i = 0; i < config.errorAlertAfter + 2; i++) {
    const o = decide(s, [{ source: "nike", shop: "Nike.com PL", ok: false, error: "HTTP 403" }], config, NIGHT);
    all.push(...kinds(o));
    s = o.state;
  }
  assert.deepEqual(all, ["AWARIA"]);
  assert.equal(s.sources.nike.price, 649.99);
  const back = decide(s, [R({ price: 649.99, available: false })], config, NIGHT);
  assert.deepEqual(kinds(back), ["POWROT"]);
});

t("raport dzienny raz dziennie po 8:00 czasu PL", () => {
  const morning = Date.parse("2026-10-22T06:30:00Z"); // 8:30 CEST
  const a = decide(null, [R({ price: 649.99, available: false })], config, morning);
  assert.deepEqual(kinds(a), ["RAPORT"]);
  const b = decide(a.state, [R({ price: 649.99, available: false })], config, morning + 3600e3);
  assert.deepEqual(kinds(b), []);
});

t("wiadomosc escapuje HTML i ma link", () => {
  const m = formatMessage({ kind: "KUPUJ", r: R({ shop: "A<B", url: "https://s?a=1&b=2" }), text: "x" }, config);
  assert.match(m, /A&lt;B/);
  assert.match(m, /a=1&amp;b=2/);
});

console.log(`\n${n} testow OK`);
