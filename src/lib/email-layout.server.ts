/**
 * Branded transactional email layout (server-only).
 *
 * Email clients have no modern CSS, so everything here is table-based with
 * fully inlined styles, a web-safe font stack, absolute image URLs and a
 * 600px centred body on a light background.
 *
 * Colour rules (our lime is built for dark backgrounds):
 *  - #A2FF00 appears ONLY as the button fill (dark #1A2000 text, #8FE000 border)
 *    and inside the dark header band, where the logo lives.
 *  - text-sized accents and links on white use dark lime #4D7000
 *  - decorative accents on white use #6B9B00
 */

const INK = "#1A1D20";
const MUTED = "#6B7280";
const LINK = "#4D7000";
const ACCENT_SOFT = "#6B9B00";
const PANEL = "#F5F6F4";
const HAIRLINE = "#E4E6E1";
const PAGE_BG = "#F0F1EE";
const FONT = "Helvetica, Arial, sans-serif";

export interface EmailPanelRow {
  label: string;
  /** Right-aligned. Amounts, tracking numbers, dates. */
  value: string;
  /** Renders bold — use for the total or the headline figure. */
  strong?: boolean;
}

export interface EmailContent {
  /** One heading per email. */
  heading: string;
  /** Inbox preview line. Falls back to the first paragraph. */
  preheader?: string;
  /** Body paragraphs, plain text. Rendered in order. */
  paragraphs: string[];
  /** Structured data panel (grey), rendered after the paragraphs. */
  panel?: { title?: string; rows: EmailPanelRow[] };
  /** Bulletproof primary button. */
  button?: { label: string; url: string };
  /** Small muted line under the button. */
  note?: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Portal base URL from the server env (used for deep links and the logo). */
export function appBaseUrl(): string {
  return stripSlash(
    process.env["APP_BASE_URL"]?.trim() ||
      process.env["VITE_APP_BASE_URL"]?.trim() ||
      "https://app.flysales.app",
  );
}

function legalName(): string {
  return (
    process.env["SUPPLIER_LEGAL_NAME"]?.trim() ||
    process.env["VITE_SUPPLIER_LEGAL_NAME"]?.trim() ||
    "BUDIGITAL SCALE MANAGEMENT - FZCO"
  );
}

function supportAddress(): string {
  return (
    process.env["SUPPORT_EMAIL"]?.trim() || "support@flysales.app"
  );
}

/** Absolute deep link into the portal. */
export function portalUrl(path: string): string {
  const base = appBaseUrl();
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

/** Renders the branded HTML plus a matching plain-text part. */
export function renderEmail(content: EmailContent): { html: string; text: string } {
  const base = appBaseUrl();
  const logo = `${base}/email/logo.png`;
  const preheader = content.preheader ?? content.paragraphs[0] ?? "";

  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.65;color:${INK}">${esc(
          p,
        )}</p>`,
    )
    .join("");

  const panel = content.panel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${PANEL};border-radius:10px;margin:0 0 24px">
            <tr><td style="padding:18px 20px">
              ${
                content.panel.title
                  ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:12px;line-height:1.4;letter-spacing:0.06em;text-transform:uppercase;color:${ACCENT_SOFT};font-weight:bold">${esc(
                      content.panel.title,
                    )}</p>`
                  : ""
              }
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${content.panel.rows
                  .map(
                    (row) => `<tr>
                  <td align="left" style="padding:5px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED}">${esc(
                    row.label,
                  )}</td>
                  <td align="right" style="padding:5px 0;font-family:${FONT};font-size:${
                    row.strong ? "16px" : "14px"
                  };line-height:1.5;color:${INK};font-weight:${row.strong ? "bold" : "normal"}">${esc(
                    row.value,
                  )}</td>
                </tr>`,
                  )
                  .join("")}
              </table>
            </td></tr>
          </table>`
    : "";

  const button = content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
            <tr>
              <td align="center" bgcolor="#A2FF00" style="border-radius:999px;border:1px solid #8FE000">
                <a href="${esc(content.button.url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:bold;line-height:1;color:#1A2000;text-decoration:none;border-radius:999px">${esc(
                  content.button.label,
                )}</a>
              </td>
            </tr>
          </table>`
    : "";

  const note = content.note
    ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED}">${esc(
        content.note,
      )}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${PAGE_BG}">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#FFFFFF;border-radius:14px;overflow:hidden">
      <tr>
        <td align="left" bgcolor="#1A1D20" style="background-color:#1A1D20;padding:22px 32px">
          <a href="https://flysales.io" style="text-decoration:none">
            <img src="${esc(logo)}" width="140" alt="FlySales" style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;text-decoration:none">
          </a>
        </td>
      </tr>
      <tr>
        <td align="left" style="padding:32px 32px 8px">
          <h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.35;font-weight:600;color:${INK}">${esc(
            content.heading,
          )}</h1>
          ${paragraphs}
          ${panel}
          ${button}
          ${note}
        </td>
      </tr>
      <tr><td style="padding:8px 32px 0"><div style="height:1px;background-color:${HAIRLINE};line-height:1px;font-size:0">&nbsp;</div></td></tr>
      <tr>
        <td align="left" style="padding:18px 32px 30px">
          <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">FlySales — product sourcing and fulfilment for e-commerce operators</p>
          <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">Operated by ${esc(
            legalName(),
          )}</p>
          <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">
            <a href="${base}/dashboard" style="color:${LINK};text-decoration:underline">Your portal</a> &nbsp;·&nbsp;
            <a href="${base}/terms" style="color:${LINK};text-decoration:underline">Terms</a> &nbsp;·&nbsp;
            <a href="${base}/privacy" style="color:${LINK};text-decoration:underline">Privacy</a>
          </p>
          <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">Questions? Reply to this email or write to <a href="mailto:${esc(
            supportAddress(),
          )}" style="color:${LINK};text-decoration:underline">${esc(supportAddress())}</a>.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const textParts = [content.heading, "", ...content.paragraphs];
  if (content.panel) {
    textParts.push("");
    if (content.panel.title) textParts.push(content.panel.title);
    for (const row of content.panel.rows) textParts.push(`${row.label}: ${row.value}`);
  }
  if (content.button) textParts.push("", `${content.button.label}: ${content.button.url}`);
  if (content.note) textParts.push("", content.note);
  textParts.push(
    "",
    "FlySales — product sourcing and fulfilment for e-commerce operators",
    `Operated by ${legalName()}`,
    `${base}/dashboard · ${base}/terms · ${base}/privacy`,
    `Questions? ${supportAddress()}`,
  );

  return { html, text: textParts.join("\n") };
}
