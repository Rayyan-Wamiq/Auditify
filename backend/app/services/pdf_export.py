"""
Audit report PDF generation using ReportLab (Platypus).

Structured A4, multi-page layout: brand header, metadata block (spec
document, log file, LLM model, run id, timestamp), a card-style KPI summary
strip (no pipe-separated grid), and an itemized findings table with
percentage-based column widths, word-boundary wrapping, and semantic
status / severity badges.
"""
import io
from datetime import datetime
from typing import Any, Optional, cast

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# --- Palette (mirrors the dashboard's Tailwind slate/emerald tokens) --------
SLATE_900 = colors.HexColor("#0f172a")
SLATE_600 = colors.HexColor("#475569")
SLATE_400 = colors.HexColor("#94a3b8")
SLATE_200 = colors.HexColor("#e2e8f0")
SLATE_50 = colors.HexColor("#f8fafc")
EMERALD_600 = colors.HexColor("#059669")
WHITE = colors.white

PAGE_SIZE = A4
PAGE_MARGIN = 16 * mm

# Findings table column widths as explicit percentages of the usable page
# width. Percentage-based widths keep proportions stable on A4 and stop the
# narrow columns from crushing their content vertically.
FINDINGS_COL_PERCENTS = {
    "check": 16,
    "category": 10,
    "status": 9,
    "severity": 10,
    "source": 9,
    "description": 23,
    "recommendation": 23,
}

# --- Status / severity badge palettes (foreground, background) ---------------
STATUS_BADGE = {
    "PASS": (colors.HexColor("#047857"), colors.HexColor("#d1fae5")),
    "FAIL": (colors.HexColor("#b91c1c"), colors.HexColor("#fee2e2")),
    "WARNING": (colors.HexColor("#b45309"), colors.HexColor("#fef3c7")),
}
SEVERITY_BADGE = {
    "CRITICAL": (colors.HexColor("#b91c1c"), colors.HexColor("#fee2e2")),
    "HIGH": (colors.HexColor("#c2410c"), colors.HexColor("#ffedd5")),
    "MEDIUM": (colors.HexColor("#b45309"), colors.HexColor("#fef3c7")),
    "LOW": (colors.HexColor("#1d4ed8"), colors.HexColor("#dbeafe")),
    "INFO": (colors.HexColor("#475569"), colors.HexColor("#f1f5f9")),
}


def _badge_style(name: str, fg: colors.Color, bg: colors.Color) -> ParagraphStyle:
    return ParagraphStyle(
        name=name,
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9.5,
        alignment=TA_CENTER,
        textColor=fg,
        backColor=bg,
        borderPadding=2.5,
        borderRadius=3,
    )


STATUS_BADGE_STYLES = {
    key: _badge_style(f"Status{key}", fg, bg) for key, (fg, bg) in STATUS_BADGE.items()
}
SEVERITY_BADGE_STYLES = {
    key: _badge_style(f"Sev{key}", fg, bg) for key, (fg, bg) in SEVERITY_BADGE.items()
}


def clean_pdf_text(text: str | None) -> str:
    """
    Sanitize arbitrary source text for PDF rendering.

    Aggressively strips/maps characters that the base PDF fonts (Helvetica
    core fonts) cannot render and which otherwise show up as missing-glyph
    fallback boxes (■) — e.g. an LLM answer containing "rate\u200blimit" or
    "credential\u00adtheft" would previously draw black squares:

    - em/en dashes and non-breaking hyphen -> ASCII hyphen
    - soft hyphen (U+00AD) -> removed entirely (invisible by design)
    - zero-width space (U+200B) -> removed entirely (invisible by design)
    - curly quotes -> ASCII quotes
    - non-breaking space -> regular space
    """
    if not text:
        return ""
    return (
        str(text)
        .replace("—", "-")
        .replace("–", "-")
        .replace("\u2011", "-")  # non-breaking hyphen
        .replace("\u00ad", "")   # soft hyphen
        .replace("“", '"')
        .replace("”", '"')
        .replace("‘", "'")
        .replace("’", "'")
        .replace("\u00a0", " ")
        .replace("\u200b", "")   # zero-width space
    )


def _esc(value: Any) -> str:
    """Sanitize + escape text for ReportLab's mini-HTML paragraph markup.

    Every piece of rendered text flows through here, so clean_pdf_text is
    applied uniformly before escaping.

    NOTE on wrapping: ReportLab's Paragraph wraps at spaces; we deliberately do
    NOT insert zero-width spaces (U+200B) into long tokens — the standard
    Helvetica font has no glyph for it and it renders as a visible missing
    glyph box (black square). Tokens that are physically wider than their
    column (rare, e.g. huge filenames) are split by ReportLab's built-in
    `splitLongWords` so they never overflow the cell.
    """
    text = value if (isinstance(value, str) or value is None) else str(value)
    return (
        clean_pdf_text(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


# --- Paragraph styles --------------------------------------------------------
_META_LABEL = ParagraphStyle(
    "MetaLabel", fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=SLATE_600
)
_META_VALUE = ParagraphStyle("MetaValue", fontSize=8.5, leading=11, textColor=SLATE_900)
_CELL = ParagraphStyle("Cell", fontSize=8, leading=10.5, textColor=SLATE_900)
_CELL_BOLD = ParagraphStyle(
    "CellBold", fontName="Helvetica-Bold", fontSize=8, leading=10.5, textColor=SLATE_900
)
_TABLE_HEAD = ParagraphStyle(
    "TableHead", fontName="Helvetica-Bold", fontSize=7.5, leading=9.5, textColor=WHITE
)
_KPI_VALUE = ParagraphStyle(
    "KpiValue", fontName="Helvetica-Bold", fontSize=14, leading=17, alignment=TA_CENTER, textColor=SLATE_900
)
_KPI_LABEL = ParagraphStyle("KpiLabel", fontSize=6.5, leading=8.5, alignment=TA_CENTER, textColor=SLATE_600)
_SECTION = ParagraphStyle(
    "Section", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=SLATE_900, spaceBefore=14, spaceAfter=6
)
_TITLE = ParagraphStyle("Title", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=SLATE_900)
_SUBTITLE = ParagraphStyle("Subtitle", fontSize=9, leading=12, textColor=SLATE_600, spaceAfter=4)
_FOOTNOTE = ParagraphStyle("Footnote", fontSize=8, leading=11, textColor=SLATE_400)


def _page_footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(SLATE_400)
    canvas.drawString(PAGE_MARGIN, 9 * mm, "Auditify - AI Technical Audit & Compliance Engine")
    canvas.drawRightString(PAGE_SIZE[0] - PAGE_MARGIN, 9 * mm, f"Page {doc.page}")
    canvas.restoreState()


def _score_color(score: float) -> colors.Color:
    if score >= 80:
        return colors.HexColor("#047857")
    if score >= 50:
        return colors.HexColor("#b45309")
    return colors.HexColor("#b91c1c")


def build_audit_pdf(run, checks) -> bytes:
    """
    run: an AuditRun ORM instance (or object exposing the same attributes)
    checks: iterable of AuditCheckItem ORM instances
    Returns raw PDF bytes.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=PAGE_SIZE,
        topMargin=PAGE_MARGIN,
        bottomMargin=PAGE_MARGIN,
        leftMargin=PAGE_MARGIN,
        rightMargin=PAGE_MARGIN,
        title=f"Auditify Report - {run.id}",
        author="Auditify",
    )
    usable = PAGE_SIZE[0] - 2 * PAGE_MARGIN

    # `Column[datetime]` truthiness is a Pylance type error (stubbed __bool__
    # returns NoReturn), so cast first — behaviour is unchanged.
    created_at = cast(Optional[datetime], run.created_at)
    created_str = created_at.strftime("%Y-%m-%d %H:%M UTC") if created_at else "-"
    checks_list = list(checks)

    # ================= Header =================
    story: list[Any] = [
        Paragraph("Auditify Compliance Audit Report", _TITLE),
        Paragraph(
            "AI Technical Audit &amp; Compliance Engine",
            ParagraphStyle("Brand", fontSize=8.5, leading=11, textColor=EMERALD_600),
        ),
        Spacer(1, 6),
        HRFlowable(width="100%", thickness=1, color=SLATE_200),
        Spacer(1, 10),
    ]

    meta_rows = [
        [
            Paragraph("SPEC DOCUMENT", _META_LABEL),
            Paragraph("LOG FILE", _META_LABEL),
            Paragraph("LLM MODEL", _META_LABEL),
            Paragraph("RUN ID", _META_LABEL),
        ],
        [
            Paragraph(_esc(run.spec_filename), _META_VALUE),
            Paragraph(_esc(run.log_filename), _META_VALUE),
            Paragraph(_esc(run.model_used), _META_VALUE),
            Paragraph(_esc(run.id), _META_VALUE),
        ],
        [
            Paragraph("AUDIT TIMESTAMP", _META_LABEL),
            Paragraph(_esc(created_str), _META_VALUE),
            Paragraph("FINDINGS", _META_LABEL),
            Paragraph(f"{len(checks_list)} itemized checks", _META_VALUE),
        ],
    ]
    meta_table = Table(meta_rows, colWidths=[usable * 0.14, usable * 0.36, usable * 0.14, usable * 0.36])
    meta_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SLATE_50),
                ("BOX", (0, 0), (-1, -1), 0.5, SLATE_200),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, SLATE_200),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f1f5f9")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(meta_table)

    # ===== KPI summary strip: 6 visual cards, no pipe-separated grid =====
    story.append(Paragraph("Summary", _SECTION))
    score_color = _score_color(run.compliance_score)
    kpi_defs = [
        ("COMPLIANCE SCORE", f"{run.compliance_score:.1f}%", score_color),
        ("TOTAL CHECKS", str(run.total_checks), SLATE_900),
        ("PASSED", str(run.passed_checks), colors.HexColor("#047857")),
        ("FAILED", str(run.failed_checks), colors.HexColor("#b91c1c")),
        ("WARNINGS", str(run.warning_checks), colors.HexColor("#b45309")),
        ("CRITICAL", str(run.critical_violations), colors.HexColor("#b91c1c")),
    ]
    kpi_cells = [
        [
            Paragraph(v, ParagraphStyle(f"kv{i}", parent=_KPI_VALUE, textColor=c))
            for i, (label, v, c) in enumerate(kpi_defs)
        ],
        [Paragraph(label, _KPI_LABEL) for (label, v, c) in kpi_defs],
    ]
    kpi_table = Table(kpi_cells, colWidths=[usable / 6.0] * 6)
    kpi_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SLATE_50),
                ("BOX", (0, 0), (-1, -1), 0.5, SLATE_200),
                ("LINEBEFORE", (1, 0), (-1, -1), 0.5, SLATE_200),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
                ("TOPPADDING", (0, 1), (-1, 1), 0),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]
        )
    )
    story.append(kpi_table)

    # ========= Itemized findings table =========
    story.append(Paragraph("Itemized Audit Findings", _SECTION))
    header = ["Check", "Category", "Status", "Severity", "Source", "Description", "Recommendation"]
    table_data: list[list[Any]] = [[Paragraph(_esc(h), _TABLE_HEAD) for h in header]]
    for c in checks_list:
        status = c.status.value if hasattr(c.status, "value") else str(c.status)
        severity = c.severity.value if hasattr(c.severity, "value") else str(c.severity)
        source = (c.source.value if hasattr(c.source, "value") else str(c.source)).replace("_", " ").title()
        table_data.append(
            [
                Paragraph(_esc(c.name), _CELL_BOLD),
                Paragraph(_esc(c.category), _CELL),
                Paragraph(_esc(status), STATUS_BADGE_STYLES.get(status, _CELL)),
                Paragraph(_esc(severity), SEVERITY_BADGE_STYLES.get(severity, _CELL)),
                Paragraph(_esc(source), _CELL),
                Paragraph(_esc(c.description), _CELL),
                Paragraph(_esc(c.recommendation), _CELL),
            ]
        )

    percents = FINDINGS_COL_PERCENTS
    findings_table = Table(
        table_data,
        colWidths=[usable * p / 100 for p in percents.values()],
        repeatRows=1,
    )
    findings_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), SLATE_900),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.4, SLATE_200),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, SLATE_50]),
            ]
        )
    )
    story.append(findings_table)

    # ================= Footer note =================
    story.append(Spacer(1, 18))
    story.append(
        Paragraph(
            _esc("Generated automatically by Auditify — AI Technical Audit & Compliance Engine."),
            _FOOTNOTE,
        )
    )

    doc.build(story, onFirstPage=_page_footer, onLaterPages=_page_footer)
    return buffer.getvalue()
