/**
 * Python-semantics helpers.
 *
 * The audit pipeline is a *scored* rule engine, so the TypeScript port has to
 * reproduce Python's exact string/number semantics rather than JavaScript's
 * near-misses. Each helper below documents the CPython behaviour it mirrors:
 *
 *   * `len(s)`            counts code points (JS `.length` counts UTF-16 units)
 *   * `s[:n]`             slices by code points
 *   * `str(x)`            renders `None` / `True` / `False`
 *   * `"{:.0%}"`          rounds half-to-even
 *   * `round(x, n)`       rounds half-to-even on the exact binary value
 *   * `str.title()`       capitalises after every non-letter
 *   * `s.split()`         splits on whitespace runs, ignoring empties
 */

/** `len(value)` for a `str` argument. */
export function pythonLen(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/** `value[start:end]` for a `str` argument (code-point aware). */
export function pythonSlice(value: string, start?: number, end?: number): string {
  const codePoints = Array.from(value);
  return codePoints.slice(start, end).join("");
}

/** `str(value)` - including Python's `None` / `True` / `False` spellings. */
export function pythonStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Round half-to-even, the tie-breaking rule CPython's formatter uses. */
export function halfEvenRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** `round(value, ndigits)` - half-to-even, like CPython's `round()`. */
export function pythonRound(value: number, ndigits = 0): number {
  if (!Number.isFinite(value)) return value;
  const factor = Math.pow(10, ndigits);
  return halfEvenRound(value * factor) / factor;
}

/** `f"{value:.{digits}f}"`. */
export function pythonFixed(value: number, digits: number): string {
  return pythonRound(value, digits).toFixed(digits);
}

/** `f"{ratio:.0%}"` - e.g. `0.184` -> `"18%"`. */
export function pythonPercent0(value: number): string {
  return `${halfEvenRound(value * 100)}%`;
}

/** `str.title()` - uppercase the first letter of every letter run. */
export function pythonTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_match, prefix: string, letter: string) => prefix + letter.toUpperCase());
}

/** `len(value.split())` - whitespace-separated token count. */
export function pythonSplitCount(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** Subset of CPython's `list` repr, for `f"Allowed: {sorted({...})}"` messages. */
export function pythonListRepr(values: Iterable<string>): string {
  return `[${[...values].map((v) => `'${v}'`).join(", ")}]`;
}
