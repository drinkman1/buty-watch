// Wysylka w jedna strone, jak w ups-watch: parse_mode=HTML, bo w HTML
// escapuje sie tylko < > &, a w cenach sa przecinki i strzalki.

const ICON = { KUPUJ: "🟢", TANIEJ: "🟢", DOSTEPNY: "🟡", PROG: "🔵", ZNIKNAL: "⚪", AWARIA: "🔴", POWROT: "🔧", RAPORT: "📋", TEST: "🧪", NOWE: "🔔" };

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatMessage(m, config) {
  const head = `${ICON[m.kind] || ""} <b>${escapeHtml(m.kind)}</b>${m.track ? ` · tor ${escapeHtml(m.track)}` : ""}`;
  const body = [head];
  const p = m.r && m.r.product;
  if (p) body.push(`<b>${escapeHtml(p.name)}</b> (${escapeHtml(p.styleColor)}), r. ${escapeHtml(p.size)}`);
  if (m.r) body.push(`${escapeHtml(m.r.shop)}: ${escapeHtml(m.text)}`);
  else body.push(escapeHtml(m.text));
  if (m.r && m.r.url && m.kind !== "AWARIA") body.push(`👉 <a href="${escapeHtml(m.r.url)}">otwórz w sklepie</a>`);
  return body.join("\n");
}

export async function sendTelegram(text, { token, chatId, silent = false, fetchImpl = globalThis.fetch }) {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: silent }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${await res.text().catch(() => "")}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
