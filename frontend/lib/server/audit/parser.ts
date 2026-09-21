/**
 * Document parsing utilities.
 *
 * Port of `backend/app/services/document_parser.py`. Handles extraction of raw
 * text from the two upload categories supported by Auditify:
 *   * Specification / SOP documents: .pdf, .txt
 *   * System execution logs:         .log, .txt, .py
 *
 * The PDF reader (pypdf in Python) is replaced by `unpdf`, a serverless-safe
 * PDF.js build that only reads text - no OCR, no local models.
 */
import { extractText, getDocumentProxy } from "unpdf";

import { HttpError } from "../http";
import { pythonLen, pythonListRepr } from "../python-compat";

export const SPEC_ALLOWED_EXT = new Set([".pdf", ".txt"]);
export const LOG_ALLOWED_EXT = new Set([".log", ".txt", ".py"]);

export interface ParsedDocument {
  filename: string;
  text: string;
  charCount: number;
  lineCount: number;
}

function getExtension(filename: string): string {
  if (!filename.includes(".")) return "";
  return `.${filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()}`;
}

/** `text.count("\n") + 1` for the parsed document. */
function countLines(text: string): number {
  return text.split("\n").length;
}

async function extractPdfText(rawBytes: Uint8Array): Promise<string> {
  let pageTexts: string[];
  try {
    const pdf = await getDocumentProxy(rawBytes);
    const extracted = await extractText(pdf, { mergePages: false });
    pageTexts = extracted.text.map((page) => page ?? "");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(422, `Unable to parse PDF: ${reason}`);
  }

  const text = pageTexts.join("\n").trim();
  if (!text) {
    throw new HttpError(
      422,
      "No extractable text found in the uploaded PDF. " +
        "Scanned/image-only PDFs are not supported."
    );
  }
  return text;
}

/**
 * Decode bytes as text.
 *
 * Mirrors the Python fallback chain `("utf-8", "utf-8-sig", "latin-1")`:
 * strict UTF-8 first (a leading BOM is kept, matching `str.decode("utf-8")`),
 * then UTF-8 with the BOM stripped, then a never-failing single-byte decode.
 */
function extractPlainText(rawBytes: Uint8Array): string {
  const attempts: TextDecoder[] = [
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }),
    new TextDecoder("utf-8", { fatal: true }),
    new TextDecoder("latin1"),
  ];
  for (const decoder of attempts) {
    try {
      return decoder.decode(rawBytes);
    } catch {
      continue;
    }
  }
  throw new HttpError(422, "Unable to decode file as text.");
}

export async function parseSpecFile(file: File, maxBytes: number): Promise<ParsedDocument> {
  const ext = getExtension(file.name || "");
  if (!SPEC_ALLOWED_EXT.has(ext)) {
    throw new HttpError(
      422,
      `Unsupported spec document type '${ext}'. Allowed: ${pythonListRepr(
        [...SPEC_ALLOWED_EXT].sort()
      )}`
    );
  }

  const rawBytes = new Uint8Array(await file.arrayBuffer());
  if (rawBytes.byteLength > maxBytes) {
    throw new HttpError(413, "Spec document exceeds max upload size.");
  }
  if (rawBytes.byteLength === 0) {
    throw new HttpError(422, "Uploaded spec document is empty.");
  }

  const text =
    ext === ".pdf" ? await extractPdfText(rawBytes) : extractPlainText(rawBytes);
  return {
    filename: file.name || "spec_document",
    text,
    charCount: pythonLen(text),
    lineCount: countLines(text),
  };
}

export async function parseLogFile(file: File, maxBytes: number): Promise<ParsedDocument> {
  const ext = getExtension(file.name || "");
  if (!LOG_ALLOWED_EXT.has(ext)) {
    throw new HttpError(
      422,
      `Unsupported log file type '${ext}'. Allowed: ${pythonListRepr(
        [...LOG_ALLOWED_EXT].sort()
      )}`
    );
  }

  const rawBytes = new Uint8Array(await file.arrayBuffer());
  if (rawBytes.byteLength > maxBytes) {
    throw new HttpError(413, "Log file exceeds max upload size.");
  }
  if (rawBytes.byteLength === 0) {
    throw new HttpError(422, "Uploaded log file is empty.");
  }

  const text = extractPlainText(rawBytes);
  return {
    filename: file.name || "execution_log",
    text,
    charCount: pythonLen(text),
    lineCount: countLines(text),
  };
}
