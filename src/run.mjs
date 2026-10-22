// Jeden przebieg: sprawdz zrodla toru, porownaj ze stanem, wyslij, zapisz.
//
//   node src/run.mjs --track a          # Actions: Nike, SneakerShop, Pepper
//   node src/run.mjs --track b          # laptop: Zalando, Lounge, JD (blokuja IP GitHuba)
//   node src/run.mjs --track b --dry-run    # tylko wypisz wyniki i wiadomosci
//   node src/run.mjs --track a --test       # wiadomosc testowa na Telegram
//
// Stan toru a: data/state.json (galaz data, workflow pobiera i commituje).
// Stan toru b: data-local/state.json (tylko na laptopie).
// Telegram: ZAKUPY_TELEGRAM_BOT_TOKEN / ZAKUPY_TELEGRAM_CHAT_ID (bot zakupy_bot).
// Bez nich przebieg nie zapisuje stanu - alert nie przepadnie, poleci, gdy
// sekrety sie pojawia.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAll } from "./sources.mjs";
import { decide, dailyReport, warsawParts } from "./decide.mjs";
import { formatMessage, sendTelegram } from "./telegram.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const TRACK = arg("--track") || "a";
const DRY = process.argv.includes("--dry-run");
const TEST = process.argv.includes("--test");
const DATA = path.join(ROOT, TRACK === "a" ? "data" : "data-local");
const token = process.env.ZAKUPY_TELEGRAM_BOT_TOKEN;
const chatId = process.env.ZAKUPY_TELEGRAM_CHAT_ID;
const canSend = Boolean(token && chatId);

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const output = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

async function send(m, silent) {
  const text = formatMessage({ ...m, track: TRACK }, config);
  if (DRY || !canSend) { console.log(`[telegram${DRY ? " dry" : " brak ZAKUPY_TELEGRAM_*"}]\n${text}\n`); return !DRY ? false : true; }
  const r = await sendTelegram(text, { token, chatId, silent });
  console.log(r.ok ? `Telegram: ${m.kind} wyslany.` : `Telegram: ${m.kind} nieudany - ${r.error}`);
  return r.ok;
}

const now = Date.now();
if (warsawParts(now).date > config.stopAfter && !TEST) {
  await send({ kind: "RAPORT", text: `Minął termin obserwacji (${config.stopAfter}). Tor ${TRACK} kończy pracę.` });
  output("stopped", "true");
  process.exit(0);
}

const results = await checkAll(config, TRACK);
for (const r of results) {
  const who = r.kind === "product" ? `${r.product.id} @ ${r.shop}` : r.shop;
  if (!r.ok) console.log(`${who}: BLAD ${r.error}`);
  else if (r.kind === "feed") console.log(`${who}: ${r.items.length} wpisow`);
  else console.log(`${who}: cena ${r.price}, rozmiar ${r.product.size} ${r.available ? "DOSTEPNY" : "brak"} (stock ${r.stock}) ${r.note || ""}`);
}

const stateFile = path.join(DATA, "state.json");
const prev = readJson(stateFile, null);

if (TEST) {
  const ok = await send({ kind: "TEST", text: dailyReport(prev || { sources: {} }, results, config) });
  process.exit(ok ? 0 : 1);
}

const { state, msgs } = decide(prev, results, config, now);
const QUIET = new Set(["RAPORT", "ZNIKNAL", "POWROT"]);
let sentAll = true;
for (const m of msgs) sentAll = (await send(m, QUIET.has(m.kind))) && sentAll;

if (DRY) process.exit(0);
if (!canSend && msgs.length) {
  console.log("Brak ZAKUPY_TELEGRAM_* - stan NIE zapisany, wiadomosci poleca w pierwszym przebiegu z sekretami.");
  process.exit(0);
}

fs.mkdirSync(DATA, { recursive: true });
const snap = (s) => JSON.stringify(Object.fromEntries(Object.entries((s && s.sources) || {}).map(([k, v]) => [k, [v.available, v.price, v.failStreak > 0, (v.seen || [])[0]]])));
if (snap(prev) !== snap(state) || msgs.some((m) => m.kind !== "RAPORT")) {
  const rec = {
    t: new Date(now).toISOString(),
    r: results.map((r) => r.kind === "feed"
      ? { s: r.source, ok: r.ok, n: r.ok ? r.items.length : null, e: r.ok ? undefined : r.error }
      : { s: r.source, ok: r.ok, p: r.price ?? null, a: r.available ?? null, n: r.stock ?? null, e: r.ok ? undefined : r.error }),
    m: msgs.map((m) => m.kind),
  };
  fs.appendFileSync(path.join(DATA, "history.jsonl"), JSON.stringify(rec) + "\n");
}
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");
if (!sentAll) console.log("Uwaga: czesc wiadomosci nie doszla (szczegoly wyzej).");
