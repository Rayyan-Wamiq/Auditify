# Parity harness (Python ⇄ TypeScript)

The API moved out of `backend/` into Next.js route handlers. These scripts prove
the port did not change behaviour: they run the **original Python engine** and
the **TypeScript engine** over the same fixtures and diff the results.

| Script | What it does |
|---|---|
| `python_engine_dump.py` | Runs `backend/app/services/audit_engine.py` over the built-in fixtures, writing `fixtures.json` + `py_output.json` (Python's ground truth). |
| `compare_engines.js` | Runs `frontend/lib/server/audit/engine.ts` over those fixtures and deep-compares every finding field and the compliance score. Exits non-zero on any difference. |
| `pdf_report_check.js` | Builds reports through `frontend/lib/server/audit/pdf.ts` and asserts the layout contract: 1 page for a small audit, real pagination with a repeated table header for a large one, brand/KPI/metadata strings, numbered footers, and that hostile characters (emoji, CJK) never break the standard-font encoder. |

## Running it

```bash
# 1. ground truth from the Python engine (needs backend/.venv)
backend/.venv/Scripts/python.exe tools/parity/python_engine_dump.py     # Windows
backend/.venv/bin/python          tools/parity/python_engine_dump.py     # macOS/Linux

# 2. compile the two TypeScript modules this harness exercises
cd frontend
npx tsc lib/server/audit/engine.ts lib/server/audit/pdf.ts \
  --outDir ../tools/parity/ts --module commonjs --target es2020 \
  --moduleResolution node --esModuleInterop --skipLibCheck
cd ..

# 3. compare
node tools/parity/compare_engines.js
node tools/parity/pdf_report_check.js
```

Last recorded run:

* `compare_engines.js` → **MATCH: 6 fixtures, 54 findings**, identical scores
  (`mixed-controls=36.8, secret-leakage=0, percent-tie=0, quiet-log=0,
  short-spec-tiny-log=80.6, empty-log=0`). The fixtures deliberately cover every
  rule branch, including the banker's-rounding percentage case
  (`1 of 8 log lines (12%)`) that `Math.round` alone would render as `13%`.
* `pdf_report_check.js` → **17/17 checks pass** (1-page and 8-page reports).

## Generated artefacts (git-ignored)

`fixtures.json`, `py_output.json`, `ts/` and any `*.pdf` written here are local
outputs; only the three scripts above are tracked.

## Keeping the harness useful

Once `backend/` is deleted there is nothing left to compare against, so this
becomes dead weight. Until then it is the cheapest possible regression net for
the audit rules, the scoring formula and the report layout.
