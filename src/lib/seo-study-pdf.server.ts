/**
 * Renders a finished (or partial) SEO study dossier into a branded PDF.
 *
 * Branding follows the transactional email layout: a dark header band with the
 * FlySales wordmark and the lime accent, then a light, readable body. pdf-lib
 * standard fonts are WinAnsi-only, so all text goes through `s()`.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ArtifactSection } from "./jobs.server";
import type {
  BacklinksData,
  CompetitorRow,
  GapRow,
  KeywordRow,
  OnPageData,
  OverviewData,
  StudyDossier,
  SynthesisData,
} from "./seo-study.server";

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 46;
const RIGHT = PAGE_W - MARGIN;
const BAND_H = 96;

const INK = rgb(0.102, 0.114, 0.125); // #1A1D20
const MUTED = rgb(0.42, 0.44, 0.47);
const HAIRLINE = rgb(0.894, 0.902, 0.882); // #E4E6E1
const PANEL = rgb(0.961, 0.965, 0.957); // #F5F6F4
const LIME = rgb(0.635, 1, 0); // #A2FF00
const LIME_DARK = rgb(0.302, 0.439, 0); // #4D7000
const DANGER = rgb(0.72, 0.18, 0.18);

/**
 * The standard PDF fonts only speak WinAnsi, so typographic characters are
 * folded to their closest Latin-1 equivalent before anything is drawn.
 */
const FOLD: Record<string, string> = {
  "\u2022": "\xB7", // bullet -> middle dot
  "\u2013": "-",
  "\u2014": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u2026": "...",
  "\u00A0": " ",
  "\u2192": "->",
  "\u2248": "~",
};

function s(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u2022\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u00A0\u2192\u2248]/g, (c) => FOLD[c]!)
    .replace(/[^\x20-\x7E\xA0-\xFF]|[\x80-\x9F]/g, "?");
}

const nf = new Intl.NumberFormat("en-US");
const n = (v: number | null | undefined): string => (v == null ? "—" : nf.format(Math.round(v)));

function dateLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

export async function renderStudyPdf(dossier: StudyDossier): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = 0;
  let pageNumber = 0;

  const fit = (text: string, font: PDFFont, size: number, maxWidth: number): string => {
    const t = s(text);
    if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
    let out = t;
    while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}...`;
  };

  const drawRight = (
    p: PDFPage,
    text: string,
    rightX: number,
    yy: number,
    font: PDFFont,
    size: number,
    color = INK,
  ) => {
    const t = s(text);
    page.drawText(t, { x: rightX - font.widthOfTextAtSize(t, size), y: yy, size, font, color });
  };

  const footer = () => {
    page.drawLine({
      start: { x: MARGIN, y: 52 },
      end: { x: RIGHT, y: 52 },
      thickness: 0.5,
      color: HAIRLINE,
    });
    page.drawText(
      s(`FlySales SEO study · ${dossier.job.target} · ${dossier.job.market}`),
      { x: MARGIN, y: 38, size: 8, font: regular, color: MUTED },
    );
    drawRight(page, `Page ${pageNumber}`, RIGHT, 38, regular, 8, MUTED);
  };

  const newPage = (withBand: boolean) => {
    if (pageNumber > 0) footer();
    page = pageNumber === 0 ? page : doc.addPage([PAGE_W, PAGE_H]);
    pageNumber += 1;
    if (withBand) {
      page.drawRectangle({ x: 0, y: PAGE_H - BAND_H, width: PAGE_W, height: BAND_H, color: INK });
      page.drawText("FlySales", {
        x: MARGIN,
        y: PAGE_H - 52,
        size: 22,
        font: bold,
        color: LIME,
      });
      page.drawText("SEO STUDY", {
        x: MARGIN,
        y: PAGE_H - 72,
        size: 9,
        font: bold,
        color: rgb(0.75, 0.78, 0.72),
      });
      drawRight(page, dossier.job.target, RIGHT, PAGE_H - 52, bold, 14, rgb(1, 1, 1));
      drawRight(
        page,
        `${dossier.job.market} · ${dateLabel(dossier.job.createdAt)}`,
        RIGHT,
        PAGE_H - 70,
        regular,
        8.5,
        rgb(0.75, 0.78, 0.72),
      );
      y = PAGE_H - BAND_H - 34;
    } else {
      y = PAGE_H - MARGIN;
    }
  };

  const space = (needed: number) => {
    if (y - needed < 76) newPage(false);
  };

  const heading = (text: string, section: ArtifactSection | undefined) => {
    space(52);
    y -= 6;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: 3, height: 14, color: LIME_DARK });
    page.drawText(s(text.toUpperCase()), {
      x: MARGIN + 10,
      y,
      size: 11,
      font: bold,
      color: INK,
    });
    const state =
      section == null
        ? "not collected"
        : section.status === "ok"
          ? `collected at "${section.phase}" · ${dateLabel(section.collectedAt)}`
          : section.status === "pending"
            ? "still collecting"
            : `skipped — ${section.error ?? "phase failed"}`;
    drawRight(
      page,
      state,
      RIGHT,
      y,
      regular,
      7.5,
      section?.status === "skipped" ? DANGER : MUTED,
    );
    y -= 10;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: RIGHT, y },
      thickness: 0.5,
      color: HAIRLINE,
    });
    y -= 18;
  };

  const paragraph = (text: string, size = 9.5) => {
    const maxWidth = RIGHT - MARGIN;
    const words = s(text).split(/\s+/);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (regular.widthOfTextAtSize(next, size) > maxWidth) {
        space(size + 5);
        page.drawText(line, { x: MARGIN, y, size, font: regular, color: INK });
        y -= size + 4;
        line = word;
      } else {
        line = next;
      }
    }
    if (line) {
      space(size + 5);
      page.drawText(line, { x: MARGIN, y, size, font: regular, color: INK });
      y -= size + 4;
    }
  };

  const kpis = (items: Array<[string, string]>) => {
    const perRow = 4;
    const boxW = (RIGHT - MARGIN - 8 * (perRow - 1)) / perRow;
    for (let i = 0; i < items.length; i += perRow) {
      const row = items.slice(i, i + perRow);
      space(52);
      row.forEach(([label, value], idx) => {
        const x = MARGIN + idx * (boxW + 8);
        page.drawRectangle({ x, y: y - 34, width: boxW, height: 44, color: PANEL });
        page.drawText(fit(label.toUpperCase(), bold, 6.5, boxW - 12), {
          x: x + 8,
          y: y - 2,
          size: 6.5,
          font: bold,
          color: MUTED,
        });
        page.drawText(fit(value, bold, 14, boxW - 12), {
          x: x + 8,
          y: y - 24,
          size: 14,
          font: bold,
          color: INK,
        });
      });
      y -= 54;
    }
  };

  const table = (
    columns: Array<{ label: string; width: number; align?: "right" }>,
    rows: string[][],
    maxRows = 25,
  ) => {
    const drawHead = () => {
      space(26);
      page.drawRectangle({
        x: MARGIN,
        y: y - 6,
        width: RIGHT - MARGIN,
        height: 18,
        color: PANEL,
      });
      let x = MARGIN + 6;
      for (const col of columns) {
        if (col.align === "right") {
          drawRight(page, col.label, x + col.width - 6, y, bold, 7.5, MUTED);
        } else {
          page.drawText(fit(col.label, bold, 7.5, col.width - 8), {
            x,
            y,
            size: 7.5,
            font: bold,
            color: MUTED,
          });
        }
        x += col.width;
      }
      y -= 22;
    };
    drawHead();
    for (const row of rows.slice(0, maxRows)) {
      if (y < 84) {
        newPage(false);
        drawHead();
      }
      let x = MARGIN + 6;
      row.forEach((cell, i) => {
        const col = columns[i]!;
        if (col.align === "right") {
          drawRight(page, cell, x + col.width - 6, y, regular, 8.5);
        } else {
          page.drawText(fit(cell, regular, 8.5, col.width - 8), {
            x,
            y,
            size: 8.5,
            font: regular,
            color: INK,
          });
        }
        x += col.width;
      });
      y -= 14;
    }
    if (rows.length > maxRows) {
      page.drawText(s(`+ ${rows.length - maxRows} more rows — see the dossier in the portal`), {
        x: MARGIN + 6,
        y,
        size: 7.5,
        font: regular,
        color: MUTED,
      });
      y -= 14;
    }
    y -= 8;
  };

  // ---------------------------------------------------------------- cover
  newPage(true);

  const sec = dossier.sections;
  const statusLabel =
    dossier.job.status === "partial"
      ? "PARTIAL — some phases were skipped"
      : dossier.job.status === "done"
        ? "COMPLETE"
        : dossier.job.status.toUpperCase();
  page.drawText(s(statusLabel), { x: MARGIN, y, size: 9, font: bold, color: LIME_DARK });
  drawRight(page, `API cost: $${dossier.job.totalCost.toFixed(4)}`, RIGHT, y, bold, 9, MUTED);
  y -= 22;

  // ---------------------------------------------------------------- synthesis
  const synthesis = sec["synthesis"]?.data as SynthesisData | undefined;
  heading("Synthesis", sec["synthesis"]);
  if (synthesis?.headline?.length) {
    for (const line of synthesis.headline) paragraph(`•  ${line}`);
    y -= 6;
  } else {
    paragraph("Not available yet.", 9);
  }

  // ---------------------------------------------------------------- overview
  const overview = sec["overview"]?.data as OverviewData | undefined;
  heading("Overview", sec["overview"]);
  if (overview) {
    kpis([
      ["Organic keywords", n(overview.organicKeywords)],
      ["Est. traffic / month", n(overview.organicEtv)],
      ["Positions 1-3", n(overview.pos1_3)],
      ["Positions 4-10", n(overview.pos4_10)],
      ["Positions 11-100", n(overview.pos11_100)],
      ["Paid keywords", n(overview.paidKeywords)],
    ]);
  } else {
    paragraph("Not available.", 9);
  }

  // ---------------------------------------------------------------- keywords
  const keywords = rec(sec["keywords"]?.data)["rows"] as KeywordRow[] | undefined;
  heading("Top ranked keywords", sec["keywords"]);
  if (keywords?.length) {
    table(
      [
        { label: "Keyword", width: 190 },
        { label: "Pos", width: 40, align: "right" },
        { label: "Volume", width: 60, align: "right" },
        { label: "Est. visits", width: 60, align: "right" },
        { label: "URL", width: RIGHT - MARGIN - 350 },
      ],
      keywords.map((k) => [
        k.keyword,
        k.position == null ? "—" : String(k.position),
        n(k.volume),
        n(k.etv),
        (k.url ?? "").replace(/^https?:\/\//, ""),
      ]),
      30,
    );
  } else {
    paragraph("Not available.", 9);
  }

  // ---------------------------------------------------------------- competitors
  const competitors = rec(sec["competitors"]?.data)["rows"] as CompetitorRow[] | undefined;
  heading("Competitors", sec["competitors"]);
  if (competitors?.length) {
    table(
      [
        { label: "Domain", width: 200 },
        { label: "Shared keywords", width: 90, align: "right" },
        { label: "Avg position", width: 80, align: "right" },
        { label: "Their keywords", width: 90, align: "right" },
        { label: "Their traffic", width: RIGHT - MARGIN - 460, align: "right" },
      ],
      competitors.map((c) => [
        c.domain,
        n(c.intersections),
        c.avgPosition == null ? "—" : c.avgPosition.toFixed(1),
        n(c.keywords),
        n(c.etv),
      ]),
      15,
    );
  } else {
    paragraph("Not available.", 9);
  }

  // ---------------------------------------------------------------- gap
  const gap = rec(sec["gap"]?.data)["rows"] as GapRow[] | undefined;
  heading("Gap opportunities", sec["gap"]);
  if (gap?.length) {
    const open = gap.filter((g) => g.yourPosition == null);
    paragraph(
      `${open.length} keywords with monthly volume above 50 that a competitor ranks for and ${dossier.job.target} does not.`,
      9,
    );
    y -= 4;
    table(
      [
        { label: "Keyword", width: 220 },
        { label: "Volume", width: 60, align: "right" },
        { label: "CPC", width: 50, align: "right" },
        { label: "Their pos", width: 60, align: "right" },
        { label: "Competitor", width: RIGHT - MARGIN - 390 },
      ],
      open.map((g) => [
        g.keyword,
        n(g.volume),
        g.cpc == null ? "—" : `$${g.cpc.toFixed(2)}`,
        g.competitorPosition == null ? "—" : String(g.competitorPosition),
        g.competitor,
      ]),
      35,
    );
  } else {
    paragraph("Not available.", 9);
  }

  // ---------------------------------------------------------------- backlinks
  const backlinks = sec["backlinks"]?.data as BacklinksData | undefined;
  heading("Backlinks", sec["backlinks"]);
  if (backlinks) {
    kpis([
      ["Backlinks", n(backlinks.backlinks)],
      ["Referring domains", n(backlinks.referringDomains)],
      ["Main domains", n(backlinks.referringMainDomains)],
      ["Domain rank", n(backlinks.rank)],
      ["Broken backlinks", n(backlinks.brokenBacklinks)],
      ["Spam score", n(backlinks.spamScore)],
    ]);
  } else {
    paragraph("Not available.", 9);
  }

  // ---------------------------------------------------------------- onpage
  const onpage = sec["onpage"]?.data as OnPageData | undefined;
  heading("Technical / on-page", sec["onpage"]);
  if (onpage) {
    kpis([
      ["Pages crawled", n(onpage.pagesCrawled)],
      ["On-page score", onpage.onPageScore == null ? "—" : onpage.onPageScore.toFixed(1)],
      ["Broken pages", n(onpage.brokenPages)],
      ["Broken resources", n(onpage.brokenResources)],
    ]);
    if (onpage.issues.length) {
      table(
        [
          { label: "Issue", width: 300 },
          { label: "Severity", width: 80 },
          { label: "Pages affected", width: RIGHT - MARGIN - 380, align: "right" },
        ],
        onpage.issues.map((i) => [i.label, i.severity, n(i.pages)]),
        20,
      );
    }
  } else {
    paragraph("Not available.", 9);
  }

  // ---------------------------------------------------------------- pages
  if (synthesis && (synthesis.strongestPages.length || synthesis.weakestPages.length)) {
    heading("Strongest and weakest pages", sec["synthesis"]);
    for (const p of synthesis.strongestPages) {
      paragraph(`+  ${p.url.replace(/^https?:\/\//, "")} — ${p.note}`, 8.5);
    }
    for (const p of synthesis.weakestPages) {
      paragraph(`-  ${p.url.replace(/^https?:\/\//, "")} — ${p.note}`, 8.5);
    }
  }

  footer();
  return doc.save();
}
