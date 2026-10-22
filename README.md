# buty-watch

Watches one sneaker in one size and pings Telegram when it can be bought under the price cap.
Pattern copied from gen-watch / ups-watch, cut down to what this job needs.

Telegram bot: **zakupy_bot** (its own chat, separate from car-watch). Watch until 2026-12-31.

| Product | Size | Cap |
|---|---|---|
| Nike Air Max 90 Smoke Grey/Light Photo Blue, style DO6706-002 | 43 | 460 zł |
| Nike Air Max 90 PRM TRK3 Flax/Wheat/Light Brown (Zalando NI115O05T-O11) | 43 | 460 zł |

## Two tracks

Zalando, Zalando Lounge and JD Sports block GitHub's IP ranges (Akamai: Zalando and JD hold the
connection until timeout, Lounge returns 403; JD gives "Access Denied" even to real Chrome).
From a home connection all three answer a plain `fetch`. So:

- **Track a**: GitHub Actions every 15 min (`watch.yml`), state on branch `data`.
- **Track b**: home laptop every 15 min via Task Scheduler (`scripts/scan-local.cmd`),
  state in `data-local/`. Runs only while the laptop is on.

| Source | Track | How it is read |
|---|---|---|
| Nike.com PL | a | public `api.nike.com`: `product_feed` (PL price, GTIN per size) + `available_gtins` (EU stock level per GTIN) |
| SneakerShop.pl | a | IdoSell `/ajax/projector.php?action=get&product=49223&get=sizes`. Adrenaline.pl is the same company and product |
| Pepper.pl | a | search page `?q=air max 90`, each thread is JSON in `data-vue3`. Alerts on new threads matching `air max 90` |
| JD Sports PL | b | URL-encoded app state in the product HTML (`offers[].offer.stock_shipment`), price from JSON-LD |
| Zalando | b | JSON-LD `ProductGroup.hasVariant[]` (size, price, availability). Matches the size picker (checked 22.10) |
| Zalando Lounge | b | products need a login, so the bot watches the public campaign carousel on `/nike-outlet/` (~12 newest campaigns) for Nike / sneaker campaigns |

Left out on purpose: Runova.pl (299 zł, but per its terms it is an intermediary and the
seller is a company in Shanghai), Answear, Allegro, OLX (bot protection). DO6706-002 is not
in Zalando's catalogue (search for the style code returns nothing, 22.10.2026).

## Alerts

Sent only when the state changes, so a 15-minute schedule does not repeat itself.

- **KUPUJ**: size in stock and price at or under the cap (loud)
- **TANIEJ**: still KUPUJ, price dropped further
- **DOSTEPNY**: size back in stock, price above the cap
- **PROG**: price fell under the cap, size still missing
- **ZNIKNAL**: size went out of stock again (silent)
- **NOWE**: new Pepper thread or Lounge campaign matching the pattern (first run of a feed only records what is there)
- **AWARIA / POWROT**: a source failed `errorAlertAfter` runs in a row / recovered
- **RAPORT**: once a day after 8:00 Warsaw time (silent), proves the bot is alive

## Running

```bash
node test/selftest.mjs                   # offline tests on saved responses
node src/run.mjs --track a --dry-run     # live check, prints messages, sends nothing
node src/run.mjs --track b --test        # sends a test message
```

Telegram credentials: `ZAKUPY_TELEGRAM_BOT_TOKEN`, `ZAKUPY_TELEGRAM_CHAT_ID`, as repo secrets
(track a) and Windows user environment variables (track b). Without them a run sends nothing
and does not save state, so no alert is lost before the bot is wired up.

On GitHub: Actions → buty-watch → Run workflow, mode `scan` / `dry-run` / `test`.

Stop early: `gh workflow disable buty-watch -R drinkman1/buty-watch` and
`schtasks /Delete /TN "buty-watch tor b" /F`.

## If a source starts returning 403 on Actions

Order of fixes, cheapest first: different headers → read the same JSON from a real Chrome
with `nodriver` (headless passes Cloudflare's JS check) → run that source from the home
laptop. Stealth Browser MCP itself does not fit a scheduled bot: every step goes through
the model.
