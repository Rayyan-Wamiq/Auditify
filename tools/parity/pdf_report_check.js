/**
 * PDF port check (temporary, not committed).
 *
 * Builds reports through the TypeScript port of `pdf_export.py`, then proves:
 *   * the output is a loadable PDF,
 *   * content grows to multiple pages with the table header repeated,
 *   * the exact brand strings/KPI values/footers are present,
 *   * hostile characters (em dash, curly quotes, tab, emoji, CJK) never break
 *     the standard-font encoder.
 */
const fs = require("fs");
const path = require("path");

const { buildAuditPdf } = require("./ts/audit/pdf.js");
const { PDFDocument } = require("pdf-lib");

const OUT = __dirname;

const run = {
  id: "abcdef12-3456-7890-abcd-ef1234567890",
  spec_filename: "compliance_spec.pdf",
  log_filename: "app.log",
  model_used: "openai/gpt-oss-120b",
  compliance_score: 72.5,
  total_checks: 12,
  passed_checks: 5,
  failed_checks: 4,
  warning_checks: 3,
  critical_violations: 1,
  created_at: "2026-09-21T10:15:00",
};

const description =
  "The SOP requires a 'rate limiting' control, but no supporting evidence was " +
  "found anywhere in the submitted execution log \u2014 see \u201cgateway.log\u201d " +
  "tab\there \uD83D\uDE00 and CJK \u4E2D\u6587 mixed in.";

const makeCheck = (index) => ({
  name: `Finding ${index}`,
  category: index % 2 ? "System Health" : "Control Coverage",
  status: ["PASS", "FAIL", "WARNING"][index % 3],
  severity: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"][index % 5],
  source: index % 2 ? "AI_DRIVEN" : "RULE_BASED",
  description,
  recommendation: "Rotate the exposed credential and re-run the audit.",
});

(async () => {
  const small = await buildAuditPdf(run, [makeCheck(1), makeCheck(2)]);
  const big = await buildAuditPdf(
    { ...run, total_checks: 60 },
    Array.from({ length: 60 }, (_, index) => makeCheck(index))
  );

  fs.writeFileSync(path.join(OUT, "report_small.pdf"), small);
  fs.writeFileSync(path.join(OUT, "report_big.pdf"), big);

  const smallDoc = await PDFDocument.load(small);
  const bigDoc = await PDFDocument.load(big);

  const { getDocumentProxy, extractText } = require("unpdf");
  const proxy = await getDocumentProxy(new Uint8Array(big));
  const extracted = await extractText(proxy, { mergePages: false });
  const joined = extracted.text.join("\n");
  // Cells wrap like ReportLab did ("SPEC" / "DOCUMENT"), so multi-word checks
  // compare against a whitespace-normalised view of the extracted text.
  const flat = joined.replace(/\s+/g, " ");

  const checks = {
    "header is a PDF": Buffer.from(big.slice(0, 5)).toString() === "%PDF-",
    "small report 1 page": smallDoc.getPageCount() === 1,
    "large report paginates": bigDoc.getPageCount() > 1,
    "title present": joined.includes("Auditify Compliance Audit Report"),
    "brand line present": joined.includes("AI Technical Audit & Compliance Engine"),
    "summary section present": joined.includes("Summary"),
    "findings section present": joined.includes("Itemized Audit Findings"),
    "kpi score formatted": joined.includes("72.5%"),
    "metadata labels present": flat.includes("SPEC DOCUMENT") && flat.includes("LLM MODEL") && flat.includes("RUN ID"),
    "metadata values present": flat.includes("compliance_spec.pdf") && flat.includes("app.log"),
    "timestamp formatted": flat.includes("2026-09-21 10:15 UTC"),
    "severity badge rendered": joined.includes("CRITICAL"),
    "source label title-cased": flat.includes("Rule Based"),
    "emoji/cjk sanitised": !joined.includes("\u4E2D\u6587") && joined.includes("?"),
    "footer page numbers": joined.includes("Page 1") && joined.includes(`Page ${extracted.totalPages}`),
    "table header repeated": (joined.match(/Recommendation/g) || []).length > 1,
    "row count preserved": (joined.match(/Finding \d+/g) || []).length >= 60,
  };

  let failed = 0;
  for (const [label, ok] of Object.entries(checks)) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  }
  console.log(
    `pages: small=${smallDoc.getPageCount()} (${small.length}B), ` +
      `large=${bigDoc.getPageCount()} (${big.length}B), extracted pages=${extracted.totalPages}`
  );
  process.exit(failed === 0 ? 0 : 1);
})();
