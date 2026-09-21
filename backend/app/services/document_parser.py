"""
Document parsing utilities.

Handles extraction of raw text from the two upload categories supported by
Auditify:
  * Specification / SOP documents: .pdf, .txt
  * System execution logs:          .log, .txt, .py
"""
import io
from dataclasses import dataclass

from fastapi import HTTPException, UploadFile
from pypdf import PdfReader

SPEC_ALLOWED_EXT = {".pdf", ".txt"}
LOG_ALLOWED_EXT = {".log", ".txt", ".py"}


@dataclass
class ParsedDocument:
    filename: str
    text: str
    char_count: int
    line_count: int


def _get_extension(filename: str) -> str:
    if "." not in filename:
        return ""
    return "." + filename.rsplit(".", 1)[-1].lower()


def _extract_pdf_text(raw_bytes: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(raw_bytes))
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=422, detail=f"Unable to parse PDF: {exc}") from exc

    pages_text = []
    for page in reader.pages:
        try:
            pages_text.append(page.extract_text() or "")
        except Exception:
            pages_text.append("")
    text = "\n".join(pages_text).strip()
    if not text:
        raise HTTPException(
            status_code=422,
            detail="No extractable text found in the uploaded PDF. "
            "Scanned/image-only PDFs are not supported.",
        )
    return text


def _extract_plain_text(raw_bytes: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=422, detail="Unable to decode file as text.")


async def parse_spec_file(file: UploadFile, max_bytes: int) -> ParsedDocument:
    ext = _get_extension(file.filename or "")
    if ext not in SPEC_ALLOWED_EXT:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported spec document type '{ext}'. Allowed: {sorted(SPEC_ALLOWED_EXT)}",
        )
    raw_bytes = await file.read()
    if len(raw_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail="Spec document exceeds max upload size.")
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="Uploaded spec document is empty.")

    text = _extract_pdf_text(raw_bytes) if ext == ".pdf" else _extract_plain_text(raw_bytes)
    return ParsedDocument(
        filename=file.filename or "spec_document",
        text=text,
        char_count=len(text),
        line_count=text.count("\n") + 1,
    )


async def parse_log_file(file: UploadFile, max_bytes: int) -> ParsedDocument:
    ext = _get_extension(file.filename or "")
    if ext not in LOG_ALLOWED_EXT:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported log file type '{ext}'. Allowed: {sorted(LOG_ALLOWED_EXT)}",
        )
    raw_bytes = await file.read()
    if len(raw_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail="Log file exceeds max upload size.")
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="Uploaded log file is empty.")

    text = _extract_plain_text(raw_bytes)
    return ParsedDocument(
        filename=file.filename or "execution_log",
        text=text,
        char_count=len(text),
        line_count=text.count("\n") + 1,
    )
