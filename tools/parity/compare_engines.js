/**
 * Differential drift harness: compares both engines.
 *
 * Runs the *TypeScript* audit engine over the fixtures produced by
 * `python_engine_dump.py` and deep-compares every finding field and the
 * compliance score against the Python output. Any difference is printed and the
 * process exits non-zero.
 *
 * Usage (from the repository root, after compiling both modules):
 *
 *   cd frontend
 *   npx tsc lib/server/audit/engine.ts lib/server/audit/pdf.ts \
 *     --outDir ../tools/parity/ts --module commonjs --target es2020 \
 *     --moduleResolution node --esModuleInterop --skipLibCheck
 *   cd ..
 *   node tools/parity/compare_engines.js
 *   node tools/parity/pdf_report_check.js
 */
const fs = require("fs");
const path = require("path");

const { runRuleBasedChecks, computeScore } = require("./ts/audit/engine.js");

const dir = __dirname;
const fixtures = JSON.parse(fs.readFileSync(path.join(dir, "fixtures.json"), "utf8"));
const expected = JSON.parse(fs.readFileSync(path.join(dir, "py_output.json"), "utf8"));

const actual = fixtures.map((fixture) => {
  const findings = runRuleBasedChecks(fixture.spec, fixture.log).map((finding) => ({
    name: finding.name,
    category: finding.category,
    status: finding.status,
    severity: finding.severity,
    source: finding.source,
    description: finding.description,
    recommendation: finding.recommendation,
    evidence: finding.evidence ?? "",
  }));
  return { name: fixture.name, findings, score: computeScore(findings) };
});

const differences = [];

function compare(prefix, a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    differences.push(`${prefix}: python=${JSON.stringify(a)} ts=${JSON.stringify(b)}`);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    compare(`${prefix}.${key}`, a[key], b[key]);
  }
}

for (let i = 0; i < Math.max(expected.length, actual.length); i += 1) {
  compare(`[${i}]`, expected[i], actual[i]);
}

const findingCount = actual.reduce((total, run) => total + run.findings.length, 0);

if (differences.length > 0) {
  console.log(`DRIFT DETECTED (${differences.length} difference(s)):`);
  for (const line of differences.slice(0, 40)) console.log(`  ${line}`);
  process.exit(1);
}

console.log(
  `MATCH: ${actual.length} fixtures, ${findingCount} findings, ` +
    `scores=${actual.map((run) => `${run.name}=${run.score}`).join(", ")}`
);
