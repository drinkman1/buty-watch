# buty-watch

Watches one sneaker in one size and pings Telegram when it can be bought under the price cap.
Pattern copied from gen-watch / ups-watch, cut down to what this job needs.

Current target (`config.json`): Nike Air Max 90 Smoke Grey/Light Photo Blue, style **DO6706-002**,
EU **43**, cap **460 zł**, watch until 2026-12-31.

## Sources

| Source | How it is read | Size-level stock |
|---|---|---|
| Nike.com PL | public `api.nike.com` endpoints the product page itself calls: `product_feed` (PL price, GTIN per size) and `available_gtins` (EU stock level per GTIN) | yes, HIGH / MEDIUM / LOW / OOS |
| JD Sports PL | URL-encoded app state embedded in the product HTML (`offers[].offer.stock_shipment`), price from JSON-LD | yes, unit count |
| SneakerShop.pl | IdoSell endpoint `/ajax/projector.php?action=get&product=49223&get=sizes`. Adrenaline.pl is the same company and product, its endpoint hides sizes | yes, unit count |

All three answer a plain `fetch` with a browser User-Agent, so the bot needs no browser.
Left out on purpose: Runova.pl (299 zł, but per its terms it is an intermediary and the
seller is a company in Shanghai), Zalando, Answear, Allegro, OLX (bot protection, and the
model was not listed there on 22.10.2026).

## Alerts

Sent only when the state changes, so a 15-minute schedule does not repeat itself.

- **KUPUJ**: size in stock and price at or under the cap (loud)
- **TANIEJ**: still KUPUJ, price dropped further
- **DOSTEPNY**: size back in stock, price above the cap
- **PROG**: price fell under the cap, size still missing
- **ZNIKNAL**: size went out of stock again (silent)
- **AWARIA / POWROT**: a source failed `errorAlertAfter` runs in a row / recovered
- **RAPORT**: once a day after 8:00 Warsaw time (silent), proves the bot is alive

## Running

```bash
node test/selftest.mjs          # offline tests on saved responses
node src/run.mjs --dry-run      # live check, prints messages, sends nothing
node src/run.mjs --test         # sends a test message (needs TELEGRAM_* env)
```

On GitHub: Actions → buty-watch → Run workflow, mode `scan` / `dry-run` / `test`.
Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

Stop early: `gh workflow disable buty-watch -R drinkman1/buty-watch`.
After `stopAfter` the bot sends a last message and disables its own workflow.

## If a source starts returning 403 on Actions

Order of fixes, cheapest first: different headers → read the same JSON from a real Chrome
with `nodriver` (headless passes Cloudflare's JS check) → run that source from the home
laptop. Stealth Browser MCP itself does not fit a scheduled bot: every step goes through
the model.
