/**
 * Audit report PDF generation.
 *
 * Port of `backend/app/services/pdf_export.py` (ReportLab/Platypus -> pdf-lib),
 * reproducing the same A4 layout: brand header, metadata block, six-card KPI
 * strip, and an itemized findings table with percentage-based column widths,
 * semantic status/severity badges and a per-page footer.
 *
 * Like ReportLab before it, this module only performs PDF layout: it embeds no
 * fonts beyond the PDF standard 14 and loads no local model/weight files.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { pythonTitle } from "../python-compat";

type Color = ReturnType<typeof rgb>;

// --- Palette (mirrors the dashboard's Tailwind slate/emerald tokens) --------
const SLATE_900 = rgb(0x0f / 255, 0x17 / 255, 0x2a / 255);
const SLATE_600 = rgb(0x47 / 255, 0x55 / 255, 0x69 / 255);
const SLATE_400 = rgb(0x94 / 255, 0xa3 / 255, 0xb8 / 255);
const SLATE_200 = rgb(0xe2 / 255, 0xe8 / 255, 0xf0 / 255);
const SLATE_100 = rgb(0xf1 / 255, 0xf5 / 255, 0xf9 / 255);
const SLATE_50 = rgb(0xf8 / 255, 0xfa / 255, 0xfc / 255);
const EMERALD_600 = rgb(0x05 / 255, 0x96 / 255, 0x69 / 255);
const GREEN_700 = rgb(0x04 / 255, 0x78 / 255, 0x57 / 255);
const AMBER_700 = rgb(0xb4 / 255, 0x53 / 255, 0x09 / 255);
const RED_700 = rgb(0xb9 / 255, 0x1c / 255, 0x1c / 255);
const WHITE = rgb(1, 1, 1);

// A4 in PDF points with the same 16 mm margin the ReportLab report used.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
export const PAGE_MARGIN = 16 * (72 / 25.4);
const USABLE_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN;

/** Findings table column widths as percentages of the usable page width. */
const FINDINGS_COL_PERCENTS: Record<string, number> = {
  check: 16,
  category: 10,
  status: 9,
  severity: 10,
  source: 9,
  description: 23,
  recommendation: 23,
};

/** Status / severity badge palettes (foreground, background). */
const STATUS_BADGE: Record<string, [Color, Color]> = {
  PASS: [GREEN_700, rgb(0xd1 / 255, 0xfa / 255, 0xe5 / 255)],
  FAIL: [RED_700, rgb(0xfe / 255, 0xe2 / 255, 0xe2 / 255)],
  WARNING: [AMBER_700, rgb(0xfe / 255, 0xf3 / 255, 0xc7 / 255)],
};

const SEVERITY_BADGE: Record<string, [Color, Color]> = {
  CRITICAL: [RED_700, rgb(0xfe / 255, 0xe2 / 255, 0xe2 / 255)],
  HIGH: [rgb(0xc2 / 255, 0x41 / 255, 0x0c / 255), rgb(0xff / 255, 0xed / 255, 0xd5 / 255)],
  MEDIUM: [AMBER_700, rgb(0xfe / 255, 0xf3 / 255, 0xc7 / 255)],
  LOW: [rgb(0x1d / 255, 0x4e / 255, 0xd8 / 255), rgb(0xdb / 255, 0xe4 / 255, 0xff / 255)],
  INFO: [SLATE_600, SLATE_100],
};

// Font sizes / leading, matching the ReportLab paragraph styles.
const SIZE_BADGE = 7.5;
const SIZE_CELL = 8;
const LEADING_CELL = 10.5;
const SIZE_META_LABEL = 7.5;
const SIZE_META_VALUE = 8.5;
const LEADING_META = 11;
const SIZE_TABLE_HEAD = 7.5;
const SIZE_KPI_VALUE = 14;
const SIZE_KPI_LABEL = 6.5;
const LEADING_KPI_LABEL = 8.5;
const SIZE_SECTION = 12;
const SIZE_TITLE = 20;
const SIZE_BRAND = 8.5;
const SIZE_FOOTNOTE = 8;

/** Padding, in points (`borderPadding=2.5`, 5-6 pt cell padding). */
const BADGE_PADDING = 2.5;
const CELL_PADDING = 5;
const FOOTER_BASELINE = 9 * (72 / 25.4);

/**
 * Sanitize arbitrary source text for PDF rendering.
 *
 * Identical character mapping to the Python `clean_pdf_text` (dashes and curly
 * quotes to ASCII, invisible soft-hyphen/zero-width/space characters removed),
 * plus one addition: characters the standard PDF fonts cannot encode are
 * replaced with "?" so a stray emoji can never break report generation.
 */
export function cleanPdfText(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2011/g, "-")
    .replace(/\u00ad/g, "")
    .replace(/\u201c/g, '"')
    .replace(/\u201d/g, '"')
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "");
}

/** Characters the PDF standard fonts (WinAnsi) can encode beyond ASCII/Latin-1. */
const WINANSI_EXTRA =
  "\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152" +
  "\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178";

const UNSAFE_CHARS = new RegExp(`[^\\u0020-\\u007e\\u00a1-\\u00ff\\n${WINANSI_EXTRA}]`, "g");

/** `_esc()` - sanitized text that is always safe to hand to a standard font. */
export function pdfSafeText(text: string | null | undefined): string {
  return cleanPdfText(text).replace(UNSAFE_CHARS, "?");
}

/**
 * Greedy word wrap at `maxWidth`, hard-splitting over-long tokens the way
 * ReportLab's `splitLongWords` does so nothing ever overflows its cell.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafeText(text).split(/\r\n|\r|\n/)) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);

      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
        continue;
      }
      let piece = "";
      for (const char of word) {
        if (piece && font.widthOfTextAtSize(piece + char, size) > maxWidth) {
          lines.push(piece);
          piece = char;
        } else {
          piece += char;
        }
      }
      current = piece;
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

/** Draw a wrapped text block; returns the y position just below the block. */
function drawBlock(
  page: PDFPage,
  text: string,
  x: number,
  top: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  lineHeight: number,
  color: Color
): number {
  const lines = wrapText(text, font, size, maxWidth);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: top - size - index * lineHeight,
      size,
      font,
      color,
    });
  });
  return top - lines.length * lineHeight;
}

/** Draw a single-line text (badge labels, KPI values, table headers). */
function drawLine(
  page: PDFPage,
  text: string,
  x: number,
  baseline: number,
  font: PDFFont,
  size: number,
  color: Color
): number {
  const label = pdfSafeText(text);
  page.drawText(label, { x, y: baseline, size, font, color });
  return font.widthOfTextAtSize(label, size);
}

/** Draw a badge: centred label on a tinted, rounded-ish background box. */
function drawBadge(
  page: PDFPage,
  text: string,
  x: number,
  top: number,
  width: number,
  font: PDFFont,
  palette: [Color, Color]
): void {
  const [foreground, background] = palette;
  const label = pdfSafeText(text);
  const textWidth = font.widthOfTextAtSize(label, SIZE_BADGE);
  const boxWidth = Math.min(width, textWidth + BADGE_PADDING * 2 + 4);
  const boxHeight = SIZE_BADGE + BADGE_PADDING * 2;
  const boxX = x + Math.max(0, (width - boxWidth) / 2);

  page.drawRectangle({
    x: boxX,
    y: top - boxHeight,
    width: boxWidth,
    height: boxHeight,
    color: background,
    borderColor: background,
    borderWidth: 0.5,
  });
  page.drawText(label, {
    x: boxX + (boxWidth - textWidth) / 2,
    y: top - boxHeight + BADGE_PADDING + 0.6,
    size: SIZE_BADGE,
    font,
    color: foreground,
  });
}

/** `_score_color`: green >= 80, amber >= 50, red below. */
function scoreColor(score: number): Color {
  if (score >= 80) return GREEN_700;
  if (score >= 50) return AMBER_700;
  return RED_700;
}

export interface PdfCheckItem {
  name: string;
  category: string;
  status: string;
  severity: string;
  source: string;
  description: string;
  recommendation: string;
}

export interface PdfAuditRun {
  id: string;
  spec_filename: string;
  log_filename: string;
  model_used: string;
  compliance_score: number;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  warning_checks: number;
  critical_violations: number;
  created_at: string | null;
}

/**
 * `created_at.strftime("%Y-%m-%d %H:%M UTC")`.
 *
 * The timestamp is a naive UTC value, so it is reformatted textually - never
 * parsed into a local-time `Date`, which would shift it by the server's offset.
 */
function formatCreatedAt(createdAt: string | null): string {
  if (!createdAt) return "-";
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(createdAt);
  if (!match) return createdAt;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]} UTC`;
}

/** Height of a wrapped cell: `padding*2 + lines * leading`. */
function cellHeight(lines: string[], leading: number): number {
  return lines.length * leading + CELL_PADDING * 2;
}

/**
 * Build the audit report PDF (the direct equivalent of `build_audit_pdf`).
 *
 * `run` and `checks` accept plain objects, so the same function renders rows
 * coming from PostgreSQL, from the legacy FastAPI service, or from a test.
 */
export async function buildAuditPdf(
  run: PdfAuditRun,
  checks: PdfCheckItem[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Auditify Report - ${run.id}`);
  doc.setAuthor("Auditify");
  doc.setCreator("Auditify");
  doc.setProducer("Auditify");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pages: PDFPage[] = [];
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  let y = PAGE_HEIGHT - PAGE_MARGIN;

  const addPage = (): void => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - PAGE_MARGIN;
  };

  // ================= Header =================
  y -= SIZE_TITLE;
  drawLine(page, "Auditify Compliance Audit Report", PAGE_MARGIN, y, bold, SIZE_TITLE, SLATE_900);
  y -= SIZE_BRAND + 3;
  drawLine(page, "AI Technical Audit & Compliance Engine", PAGE_MARGIN, y, regular, SIZE_BRAND, EMERALD_600);
  y -= 8;
  page.drawLine({
    start: { x: PAGE_MARGIN, y },
    end: { x: PAGE_WIDTH - PAGE_MARGIN, y },
    thickness: 1,
    color: SLATE_200,
  });
  y -= 10;

  // ============ Metadata block (4 columns) ============
  const metaCols = [0.14, 0.36, 0.14, 0.36].map((percent) => USABLE_WIDTH * percent);
  const metaRows: string[][] = [
    [
      "SPEC DOCUMENT",
      run.spec_filename,
      "LOG FILE",
      run.log_filename,
    ],
    [
      "LLM MODEL",
      run.model_used,
      "RUN ID",
      run.id,
    ],
    [
      "AUDIT TIMESTAMP",
      formatCreatedAt(run.created_at),
      "FINDINGS",
      `${checks.length} itemized checks`,
    ],
  ];

  for (const row of metaRows) {
    const linesPerCell = row.map((cell, index) => {
      const isLabel = index % 2 === 0;
      const font = isLabel ? bold : regular;
      const size = isLabel ? SIZE_META_LABEL : SIZE_META_VALUE;
      return wrapText(cell, font, size, metaCols[index] - CELL_PADDING * 2);
    });
    const rowHeight = Math.max(...linesPerCell.map((lines) => cellHeight(lines, LEADING_META)));

    // Row background, then the tinted label columns.
    page.drawRectangle({
      x: PAGE_MARGIN,
      y: y - rowHeight,
      width: USABLE_WIDTH,
      height: rowHeight,
      color: SLATE_50,
      borderColor: SLATE_200,
      borderWidth: 0.5,
    });
    // Tinted label columns (0 and 2), mirroring the ReportLab table style.
    for (const column of [0, 2]) {
      const x = PAGE_MARGIN + (column === 0 ? 0 : metaCols[0] + metaCols[1]);
      const width = metaCols[column];
      page.drawRectangle({
        x,
        y: y - rowHeight,
        width,
        height: rowHeight,
        color: SLATE_100,
        borderColor: SLATE_200,
        borderWidth: 0.5,
      });
    }

    let x = PAGE_MARGIN;
    row.forEach((cell, index) => {
      const isLabel = index % 2 === 0;
      const font = isLabel ? bold : regular;
      const size = isLabel ? SIZE_META_LABEL : SIZE_META_VALUE;
      drawBlock(
        page,
        cell,
        x + CELL_PADDING,
        y - CELL_PADDING,
        metaCols[index] - CELL_PADDING * 2,
        font,
        size,
        LEADING_META,
        isLabel ? SLATE_600 : SLATE_900
      );
      x += metaCols[index];
      // Column separator between the metadata columns.
      if (index < row.length - 1) {
        page.drawLine({
          start: { x, y },
          end: { x, y: y - rowHeight },
          thickness: 0.5,
          color: SLATE_200,
        });
      }
    });

    y -= rowHeight;
  }

  // ===== KPI summary strip: 6 visual cards (no pipe-separated grid) =====
  y -= SIZE_SECTION + 6;
  drawLine(page, "Summary", PAGE_MARGIN, y, bold, SIZE_SECTION, SLATE_900);

  const kpiDefs: [string, string, Color][] = [
    ["COMPLIANCE SCORE", `${run.compliance_score.toFixed(1)}%`, scoreColor(run.compliance_score)],
    ["TOTAL CHECKS", String(run.total_checks), SLATE_900],
    ["PASSED", String(run.passed_checks), GREEN_700],
    ["FAILED", String(run.failed_checks), RED_700],
    ["WARNINGS", String(run.warning_checks), AMBER_700],
    ["CRITICAL", String(run.critical_violations), RED_700],
  ];

  const kpiWidth = USABLE_WIDTH / 6;
  const kpiLabelLines = kpiDefs.map(([label]) =>
    wrapText(label, regular, SIZE_KPI_LABEL, kpiWidth - 8)
  );
  const kpiLabelCount = Math.max(...kpiLabelLines.map((lines) => lines.length));
  const kpiHeight = 8 + SIZE_KPI_VALUE + 2 + kpiLabelCount * LEADING_KPI_LABEL + 8;
  y -= kpiHeight;

  page.drawRectangle({
    x: PAGE_MARGIN,
    y,
    width: USABLE_WIDTH,
    height: kpiHeight,
    color: SLATE_50,
    borderColor: SLATE_200,
    borderWidth: 0.5,
  });

  kpiDefs.forEach(([, value, color], index) => {
    const x = PAGE_MARGIN + index * kpiWidth;
    if (index > 0) {
      page.drawLine({
        start: { x, y },
        end: { x, y: y + kpiHeight },
        thickness: 0.5,
        color: SLATE_200,
      });
    }

    const valueText = pdfSafeText(value);
    const valueWidth = bold.widthOfTextAtSize(valueText, SIZE_KPI_VALUE);
    page.drawText(valueText, {
      x: x + Math.max(0, (kpiWidth - valueWidth) / 2),
      y: y + kpiHeight - 8 - SIZE_KPI_VALUE,
      size: SIZE_KPI_VALUE,
      font: bold,
      color,
    });

    kpiLabelLines[index].forEach((line, lineIndex) => {
      const lineWidth = regular.widthOfTextAtSize(line, SIZE_KPI_LABEL);
      page.drawText(line, {
        x: x + Math.max(0, (kpiWidth - lineWidth) / 2),
        y: y + kpiHeight - 8 - SIZE_KPI_VALUE - 2 - (lineIndex + 1) * LEADING_KPI_LABEL + 3,
        size: SIZE_KPI_LABEL,
        font: regular,
        color: SLATE_600,
      });
    });
  });

  // ================= Itemized findings table =================
  y -= SIZE_SECTION + 6;
  drawLine(page, "Itemized Audit Findings", PAGE_MARGIN, y, bold, SIZE_SECTION, SLATE_900);
  y -= 6;

  const headerLabels = [
    "Check",
    "Category",
    "Status",
    "Severity",
    "Source",
    "Description",
    "Recommendation",
  ];
  const colWidths = headerLabels.map((label) => {
    const percent = FINDINGS_COL_PERCENTS[label.toLowerCase()];
    return (USABLE_WIDTH * percent) / 100;
  });
  const badgeRowHeight = SIZE_BADGE + BADGE_PADDING * 2 + CELL_PADDING * 2;

  /** Header row, repeated at the top of every continuation page (`repeatRows=1`). */
  const drawTableHeader = (): void => {
    const headerLines = headerLabels.map((label, index) =>
      wrapText(label, bold, SIZE_TABLE_HEAD, colWidths[index] - CELL_PADDING * 2)
    );
    const height = Math.max(
      ...headerLines.map((lines) => cellHeight(lines, SIZE_TABLE_HEAD + 2))
    );
    y -= height;
    page.drawRectangle({ x: PAGE_MARGIN, y, width: USABLE_WIDTH, height, color: SLATE_900 });

    let x = PAGE_MARGIN;
    headerLines.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: x + CELL_PADDING,
          y: y + height - CELL_PADDING - SIZE_TABLE_HEAD - lineIndex * (SIZE_TABLE_HEAD + 2),
          size: SIZE_TABLE_HEAD,
          font: bold,
          color: WHITE,
        });
      });
      x += colWidths[index];
    });
  };

  drawTableHeader();

  const bottomLimit = PAGE_MARGIN + SIZE_FOOTNOTE + 14;

  checks.forEach((check, index) => {
    // `source.value.replace("_", " ").title()` -> "Rule Based" / "Ai Driven".
    const source = pythonTitle(String(check.source).replace(/_/g, " "));
    const cells = [
      check.name,
      check.category,
      check.status,
      check.severity,
      source,
      check.description,
      check.recommendation,
    ];

    const cellLines: string[][] = cells.map((cell, column) =>
      column === 2 || column === 3
        ? [pdfSafeText(cell)]
        : wrapText(
            cell,
            column === 0 ? bold : regular,
            SIZE_CELL,
            colWidths[column] - CELL_PADDING * 2
          )
    );

    const rowHeight = Math.max(
      badgeRowHeight,
      ...cellLines.map((lines) => cellHeight(lines, LEADING_CELL))
    );

    if (y - rowHeight < bottomLimit) {
      addPage();
      drawTableHeader();
    }

    y -= rowHeight;
    page.drawRectangle({
      x: PAGE_MARGIN,
      y,
      width: USABLE_WIDTH,
      height: rowHeight,
      color: index % 2 === 0 ? WHITE : SLATE_50,
      borderColor: SLATE_200,
      borderWidth: 0.4,
    });

    let x = PAGE_MARGIN;
    cells.forEach((_cell, column) => {
      const innerWidth = colWidths[column] - CELL_PADDING * 2;
      const cellTop = y + rowHeight - CELL_PADDING;

      if (column === 2) {
        drawBadge(
          page,
          cellLines[column][0],
          x + CELL_PADDING,
          cellTop,
          innerWidth,
          bold,
          STATUS_BADGE[cellLines[column][0]] ?? [SLATE_900, SLATE_100]
        );
      } else if (column === 3) {
        drawBadge(
          page,
          cellLines[column][0],
          x + CELL_PADDING,
          cellTop,
          innerWidth,
          bold,
          SEVERITY_BADGE[cellLines[column][0]] ?? [SLATE_900, SLATE_100]
        );
      } else {
        drawBlock(
          page,
          cellLines[column].join("\n"),
          x + CELL_PADDING,
          cellTop,
          innerWidth,
          column === 0 ? bold : regular,
          SIZE_CELL,
          LEADING_CELL,
          SLATE_900
        );
      }

      if (column < cells.length - 1) {
        const separatorX = x + colWidths[column];
        page.drawLine({
          start: { x: separatorX, y },
          end: { x: separatorX, y: y + rowHeight },
          thickness: 0.4,
          color: SLATE_200,
        });
      }
      x += colWidths[column];
    });
  });

  // ================= Footer note =================
  y -= 16;
  drawBlock(
    page,
    "Generated automatically by Auditify \u2014 AI Technical Audit & Compliance Engine.",
    PAGE_MARGIN,
    y,
    USABLE_WIDTH,
    regular,
    SIZE_FOOTNOTE,
    SIZE_FOOTNOTE + 3,
    SLATE_400
  );

  // ================= Page footers =================
  pages.forEach((each, index) => {
    drawLine(
      each,
      "Auditify - AI Technical Audit & Compliance Engine",
      PAGE_MARGIN,
      FOOTER_BASELINE,
      regular,
      SIZE_BADGE,
      SLATE_400
    );
    const pageLabel = `Page ${index + 1}`;
    const labelWidth = regular.widthOfTextAtSize(pageLabel, SIZE_BADGE);
    drawLine(
      each,
      pageLabel,
      PAGE_WIDTH - PAGE_MARGIN - labelWidth,
      FOOTER_BASELINE,
      regular,
      SIZE_BADGE,
      SLATE_400
    );
  });

  return await doc.save();
}
