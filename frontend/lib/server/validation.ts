/**
 * Request-body validation.
 *
 * Reproduces Pydantic v2's `RequestValidationError` envelope (the `422` body
 * shape) closely enough that the dashboard's API layer behaves identically:
 * `detail` is an array of `{ type, loc, msg, input, ctx }` items, one per
 * failed constraint, in field-declaration order - exactly what FastAPI's
 * exception handler emitted.
 */
import { HttpError, type ValidationErrorItem } from "./http";

/** Pragmatic email check (identical to `_EMAIL_RE` in `app/schemas.py`). */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

/** bcrypt hashes at most 72 bytes (`MAX_PASSWORD_BYTES`). */
export const MAX_PASSWORD_BYTES = 72;

export type JsonObject = Record<string, unknown>;

/** `true` for JSON objects that are not arrays/null. */
export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collects Pydantic-shaped errors while validating a payload. */
export class BodyValidator {
  private readonly errors: ValidationErrorItem[] = [];

  constructor(private readonly body: unknown) {}

  get field(): JsonObject {
    return isObject(this.body) ? this.body : {};
  }

  /** Mirrors `Field(...)` with an optional `max_length` / `min_length`. */
  requiredString(
    field: string,
    options: { minLength?: number; maxLength?: number } = {}
  ): string | undefined {
    const value = this.field[field];
    if (value === undefined) {
      this.errors.push({ type: "missing", loc: ["body", field], msg: "Field required", input: {} });
      return undefined;
    }
    if (typeof value !== "string") {
      this.errors.push({
        type: "string_type",
        loc: ["body", field],
        msg: "Input should be a valid string",
        input: value,
      });
      return undefined;
    }
    if (options.minLength !== undefined && value.length < options.minLength) {
      this.errors.push({
        type: "string_too_short",
        loc: ["body", field],
        msg: `String should have at least ${options.minLength} characters`,
        input: value,
        ctx: { min_length: options.minLength },
      });
      return undefined;
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      this.errors.push({
        type: "string_too_long",
        loc: ["body", field],
        msg: `String should have at most ${options.maxLength} characters`,
        input: value,
        ctx: { max_length: options.maxLength },
      });
      return undefined;
    }
    return value;
  }

  /** Mirrors `Optional[str] = Field(default=None, max_length=...)`. */
  optionalString(field: string, options: { maxLength?: number } = {}): string | null | undefined {
    const value = this.field[field];
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      this.errors.push({
        type: "string_type",
        loc: ["body", field],
        msg: "Input should be a valid string",
        input: value,
      });
      return undefined;
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      this.errors.push({
        type: "string_too_long",
        loc: ["body", field],
        msg: `String should have at most ${options.maxLength} characters`,
        input: value,
        ctx: { max_length: options.maxLength },
      });
      return undefined;
    }
    return value;
  }

  /** Mirrors `Optional[float]` query/body parameters. */
  optionalNumber(field: string): number | undefined {
    const value = this.field[field];
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    this.errors.push({
      type: "float_parsing",
      loc: ["body", field],
      msg: "Input should be a valid number",
      input: value,
    });
    return undefined;
  }

  /** Mirrors `List[dict] = Field(default_factory=list)`. */
  listOfObjects(field: string): JsonObject[] {
    const value = this.field[field];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.errors.push({
        type: "list_type",
        loc: ["body", field],
        msg: "Input should be a valid list",
        input: value,
      });
      return [];
    }
    return value.filter(isObject);
  }

  /** Record a custom validator failure (Pydantic's `value_error`). */
  addValueError(field: string, msg: string, input: unknown): void {
    this.errors.push({
      type: "value_error",
      loc: ["body", field],
      msg: `Value error, ${msg}`,
      input,
      ctx: { error: msg },
    });
  }

  add(error: ValidationErrorItem): void {
    this.errors.push(error);
  }

  /** Throw a 422 when anything failed, otherwise return the parsed body. */
  throwIfInvalid(): void {
    if (this.errors.length > 0) {
      throw new HttpError(422, this.errors);
    }
  }
}

/**
 * `SignupRequest` validation, including both custom validators:
 * email is stripped/lowercased and regex-checked, password is byte-limited.
 */
export function validateEmail(value: string): string | null {
  const normalised = value.trim().toLowerCase();
  return EMAIL_RE.test(normalised) ? normalised : null;
}
