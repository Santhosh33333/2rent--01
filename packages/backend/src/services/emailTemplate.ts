// Branded transactional email layout for Nabri.
//
// Inline styles + table-based structure only (no external CSS) so Gmail,
// Outlook, Apple Mail and Yahoo render it consistently. Every element is
// white-listed email style. No images — the wordmark is pure text, so it
// always renders even with images disabled.
//
// Animation: keyframes live in a <style> block in <head>. Support varies by
// client (Apple Mail and most desktop/web clients run them; Gmail/Outlook
// ignore <style> and render a clean static version). Every animated element
// is also fully styled statically, so clients without animation never break —
// they just skip the entrance/glow effects. prefers-reduced-motion is
// respected for accessibility.

export const WEB_ORIGIN = "https://2rent-01.vercel.app";

// Base animation CSS merged into every email (plus any per-mail extras).
const BASE_EMAIL_CSS = `
@keyframes nabriCardIn { from { opacity: 0; transform: translateY(16px) scale(.995); } to { opacity: 1; transform: none; } }
@keyframes nabriFadeUp { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
@keyframes nabriDotPulse { 0% { box-shadow: 0 0 0 0 rgba(210,245,60,.55); } 70% { box-shadow: 0 0 0 11px rgba(210,245,60,0); } 100% { box-shadow: 0 0 0 0 rgba(210,245,60,0); } }
@keyframes nabriGlow { 0% { box-shadow: 0 0 0 0 rgba(34,160,107,.45); } 70% { box-shadow: 0 0 0 9px rgba(34,160,107,0); } 100% { box-shadow: 0 0 0 0 rgba(34,160,107,0); } }
@keyframes nabriCtaPulse { 0% { box-shadow: 0 0 0 0 rgba(216,61,39,.4); } 70% { box-shadow: 0 0 0 14px rgba(216,61,39,0); } 100% { box-shadow: 0 0 0 0 rgba(216,61,39,0); } }
@keyframes nabriCodePop { 0% { opacity: 0; transform: scale(.96) translateY(6px); } 60% { transform: scale(1.02); } 100% { opacity: 1; transform: none; } }
@keyframes nabriFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes nabriSheet { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
@media screen {
  .nabri-card { animation: nabriCardIn .5s cubic-bezier(.2,.7,.2,1) both; }
  .nabri-fade { animation: nabriFadeUp .55s ease-out both; }
  .nabri-fade.d2 { animation-delay: .09s; }
  .nabri-fade.d3 { animation-delay: .18s; }
  .nabri-fade.d4 { animation-delay: .27s; }
  .nabri-dot { animation: nabriDotPulse 2s ease-in-out infinite; }
  .nabri-pulse { animation: nabriGlow 1.8s ease-out infinite; }
  .nabri-cta { animation: nabriCtaPulse 2.2s ease-in-out infinite; }
  .nabri-code { animation: nabriCodePop .45s cubic-bezier(.2,.8,.2,1) both; }
  .nabri-float { animation: nabriFloat 5s ease-in-out infinite; }
  .nabri-sheen { background-image: linear-gradient(120deg, rgba(255,255,255,0) 30%, rgba(255,255,255,.14) 50%, rgba(255,255,255,0) 70%); background-size: 200% 100%; animation: nabriSheet 4.5s linear infinite; }
  @media (prefers-reduced-motion: reduce) {
    .nabri-card, .nabri-fade, .nabri-dot, .nabri-pulse, .nabri-cta, .nabri-code, .nabri-float, .nabri-sheen { animation: none !important; }
  }
}
`;

export interface RenderEmailOptions {
  title: string;
  /** Raw, already-escaped HTML for the body. Use paragraphHtml() for plain text. */
  bodyHtml: string;
  /** Small uppercase label above the title, e.g. "SECURITY NOTICE". */
  kicker?: string;
  ctaText?: string;
  ctaUrl?: string;
  /** Optional muted footer line, e.g. "This code expires in 10 minutes." */
  note?: string;
  /** Support contact shown in the footer. Defaults to the Nabri support mailbox. */
  supportEmail?: string;
  /** Optional extra <head> CSS (keyframes/classes) appended after the base set. */
  headHtml?: string;
}

export function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape plain text and turn newlines into <br/> for inline rendering. */
export function paragraphHtml(text: string): string {
  return escHtml(text).replace(/\n/g, "<br/>");
}

export function renderEmail(opts: RenderEmailOptions): string {
  const headCss = [BASE_EMAIL_CSS, opts.headHtml || ""].join("\n");
  const cta = opts.ctaText && opts.ctaUrl ? renderCta(opts.ctaText, opts.ctaUrl) : "";
  const note = opts.note ? `<tr><td class="nabri-fade d4" style="padding:0 34px 28px;background:#FFFFFF"><p style="margin:0;font-size:12px;line-height:1.6;color:#9A9184">${escHtml(opts.note)}</p></td></tr>` : "";
  const year = new Date().getFullYear();
  const supportEmail = opts.supportEmail || "nabri.support@gmail.com";
  const kicker = opts.kicker
    ? `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;letter-spacing:2.5px;color:#0D378B;text-transform:uppercase">${escHtml(opts.kicker)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>${escHtml(opts.title)}</title>
<style>${headCss}</style>
</head>
<body style="margin:0;padding:0;background:#F1EBE0;word-spacing:normal">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escHtml(opts.title)} · Nabri</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1EBE0">
    <tr>
      <td align="center" style="padding:30px 16px">
        <table class="nabri-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-collapse:collapse;border-radius:22px;overflow:hidden;box-shadow:0 14px 40px rgba(28,25,23,0.10)">
          <!-- Header / brand bar -->
          <tr>
            <td align="center" class="nabri-fade" style="background:#0D378B;background-image:linear-gradient(135deg,#081F4F 0%,#0D378B 58%,#3B6ED8 100%);padding:30px 24px 26px">
              <img src="${WEB_ORIGIN}/images/logo-mark-3d@2x.png" width="104" height="104" alt="Nabri" style="display:block;border:0;width:104px;height:104px;max-width:104px;border-radius:26px;background:#FFFFFF;padding:8px;box-sizing:border-box" />
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:900;letter-spacing:6px;color:#FBF7EF;margin:14px 0 0;line-height:1.2">NABRI<span class="nabri-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#D2F53C;margin-left:8px;vertical-align:2px"></span></div>
              <div style="width:52px;height:3px;border-radius:2px;background:rgba(210,245,60,.85);margin:11px auto 8px"></div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2.6px;color:#CDE0FF;text-transform:uppercase">Your Partner for Every Side of Life</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td class="nabri-fade d2" style="background:#FFFFFF;padding:36px 36px 8px">
              ${kicker}
              <h1 style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;line-height:1.35;color:#1C1917">${escHtml(opts.title)}</h1>
              <div style="width:46px;height:4px;border-radius:2px;background:linear-gradient(90deg,#0D378B,#3B6ED8);margin:0 0 22px"></div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#4B453D">${opts.bodyHtml}</div>
            </td>
          </tr>
          ${cta}
          <tr>
            <td class="nabri-fade d3" style="background:#FFFFFF;padding:22px 36px 34px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EFE8DC;padding-top:22px">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#9A9184">
                  <strong style="color:#6B6558">Nabri</strong> · Your partner for every side of life. &mdash; Connect. Discover. Experience.<br/>
                  You're receiving this because you have a Nabri account.
                </p>
                <p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9A9184">
                  Need help? <a href="mailto:${escHtml(supportEmail)}" style="color:#0D378B;text-decoration:none;font-weight:700">${escHtml(supportEmail)}</a>
                </p>
              </td></tr></table>
            </td>
          </tr>
          ${note}
          <!-- Footer -->
          <tr>
            <td class="nabri-fade d4" align="center" style="background:#F1EBE0;padding:18px 24px 22px">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#8C8577">
                &copy; ${year} Nabri · Chennai, India
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderCta(text: string, url: string): string {
  return `<tr>
            <td align="center" class="nabri-fade d3" style="background:#FFFFFF;padding:8px 36px 8px">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="nabri-cta" align="center" style="border-radius:13px;background:linear-gradient(135deg,#081F4F,#0D378B 60%,#3B6ED8);padding:15px 36px">
                    <a href="${escHtml(url)}" target="_blank" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;letter-spacing:1px;color:#FFFFFF;text-decoration:none">${escHtml(text)} &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}