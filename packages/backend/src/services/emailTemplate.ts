// Branded transactional email layout for Nabri.
//
// Inline styles + table-based structure only (no classes, no external CSS) so
// Gmail, Outlook, Apple Mail and Yahoo render it consistently. Every element
// is white-listed email style. No images — the wordmark is pure text, so it
// always renders even with images disabled.

const WEB_ORIGIN = "https://2rent-01.vercel.app";

export interface RenderEmailOptions {
  title: string;
  /** Raw, already-escaped HTML for the body. Use paragraphHtml() for plain text. */
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  /** Optional muted footer line, e.g. "This code expires in 10 minutes." */
  note?: string;
  /** Optional extra <head> content (keyframes/CSS) appended before printing. */
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
  const cta = opts.ctaText && opts.ctaUrl ? renderCta(opts.ctaText, opts.ctaUrl) : "";
  const note = opts.note ? `<tr><td style="padding:0 34px 30px;background:#FFFFFF"><p style="margin:0;font-size:12px;line-height:1.6;color:#9A9184">${escHtml(opts.note)}</p></td></tr>` : "";
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>${escHtml(opts.title)}</title>
${opts.headHtml ? `<style>${opts.headHtml}</style>` : ""}
</head>
<body style="margin:0;padding:0;background:#F4F0E8;word-spacing:normal">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escHtml(opts.title)} · Nabri</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F0E8">
    <tr>
      <td align="center" style="padding:28px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-collapse:collapse;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(28,25,23,0.08)">
          <!-- Header / brand bar -->
          <tr>
            <td align="center" style="background:#D83D27;padding:26px 24px 22px">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:900;letter-spacing:7px;color:#FBF7EF;margin:0;line-height:1.2">NABRI<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#D2F53C;margin-left:8px;vertical-align:3px"></span></div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2.5px;color:#FCE4DF;margin-top:7px;text-transform:uppercase">Your Partner for Every Side of Life</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background:#FFFFFF;padding:34px 34px 6px">
              <h1 style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:21px;font-weight:800;line-height:1.35;color:#1C1917">${escHtml(opts.title)}</h1>
              <div style="width:44px;height:4px;border-radius:2px;background:#D83D27;margin:0 0 20px"></div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#4B453D">${opts.bodyHtml}</div>
            </td>
          </tr>
          ${cta}
          <tr>
            <td style="background:#FFFFFF;padding:24px 34px 34px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EFE8DC;padding-top:22px">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#9A9184">
                  <strong style="color:#6B6558">Nabri</strong> · Your partner for every side of life.<br/>
                  You're receiving this because you have a Nabri account.
                </p>
              </td></tr></table>
            </td>
          </tr>
          ${note}
          <!-- Footer -->
          <tr>
            <td align="center" style="background:#F4F0E8;padding:18px 24px 22px">
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
            <td align="center" style="background:#FFFFFF;padding:6px 34px 6px">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#D83D27;padding:14px 34px">
                    <a href="${escHtml(url)}" target="_blank" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;letter-spacing:1px;color:#FFFFFF;text-decoration:none">${escHtml(text)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

export { WEB_ORIGIN };