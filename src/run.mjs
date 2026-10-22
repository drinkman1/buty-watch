// Jeden przebieg: sprawdz zrodla, porownaj ze stanem, wyslij, zapisz.
//
//   node src/run.mjs              # normalny przebieg (Actions)
//   node src/run.mjs --dry-run    # tylko wypisz wyniki i wiadomosci
//   node src/run.mjs --test       # wiadomosc testowa z aktualnym stanem na Telegram
//
// Stan (data/state.json) i historia zmian (data/history.jsonl) zyja na galezi
// data; workflow je pobiera przed przebiegiem i commituje, gdy sie zmienily.
// Awaria Telegrama nie przewraca przebiegu - stan i tak sie zapisze.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAll } from "./sources.mjs";
import { decide, dailyReport, warsawParts } from "./decide.mjs";
import { formatMessage, sendTelegram } from "./telegram.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA = path.join(ROOT, "data");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const DRY = process.argv.includes("--dry-run");
const TEST = process.argv.includes("--test");
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const output = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

async function send(m, silent) {
  const text = formatMessage(m, config);
  if (DRY || !token || !chatId) { console.log(`[telegram${DRY ? " dry" : " brak sekretow"}]\n${text}\n`); return true; }
  const r = await sendTelegram(text, { token, chatId, silent });
  console.log(r.ok ? `Telegram: ${m.kind} wyslany.` : `Telegram: ${m.kind} nieudany - ${r.error}`);
  return r.ok;
}

const now = Date.now();
const today = warsawParts(now).date;

if (today > config.stopAfter && !TEST) {
  await send({ kind: "RAPORT", text: `Minął termin obserwacji (${config.stopAfter}). Bot wyłącza swój workflow; historia zostaje na gałęzi data.` });
  output("stopped", "true");
  process.exit(0);
}

const results = await checkAll(config);
for (const r of results) {
  console.log(r.ok
    ? `${r.shop}: cena ${r.price}, rozmiar ${config.size} ${r.available ? "DOSTEPNY" : "brak"} (stock ${r.stock}) ${r.note || ""}`
    : `${r.shop}: BLAD ${r.error}`);
}

const stateFile = path.join(DATA, "state.json");
const prev = readJson(stateFile, null);

if (TEST) {
  const ok = await send({ kind: "TEST", text: dailyReport(prev || { sources: {} }, results, config) });
  process.exit(ok ? 0 : 1);
}

const { state, msgs } = decide(prev, results, config, now);
const QUIET = new Set(["RAPORT", "ZNIKNAL", "POWROT"]);
for (const m of msgs) await send(m, QUIET.has(m.kind));

if (DRY) process.exit(0);

fs.mkdirSync(DATA, { recursive: true });
const snap = (s) => JSON.stringify(Object.fromEntries(Object.entries((s && s.sources) || {}).map(([k, v]) => [k, [v.available, v.price, v.failStreak > 0]])));
if (snap(prev) !== snap(state) || msgs.some((m) => m.kind !== "RAPORT")) {
  const rec = { t: new Date(now).toISOString(), r: results.map((r) => ({ s: r.source, ok: r.ok, p: r.price ?? null, a: r.available ?? null, n: r.stock ?? null, e: r.ok ? undefined : r.error })), m: msgs.map((m) => m.kind) };
  fs.appendFileSync(path.join(DATA, "history.jsonl"), JSON.stringify(rec) + "\n");
}
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");
