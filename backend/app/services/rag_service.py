"""
RAG-powered copilot service.

Uses ChromaDB as a local persistent vector store for chunked specification
documents, and the Groq chat-completions API to answer natural-language
questions grounded in retrieved context.
"""
import re
from typing import List, Optional, Tuple

import chromadb
from groq import Groq

from app.config import get_settings

settings = get_settings()

_chroma_client: Optional[chromadb.ClientAPI] = None
_collection = None

COLLECTION_NAME = "auditify_spec_chunks"

CHAT_SYSTEM_PROMPT = """You are Auditify's AI Copilot, a friendly technical \
compliance assistant embedded in an audit dashboard. Answer the user's \
question using the provided context chunks pulled from their uploaded \
specification/audit documents whenever relevant. If the context does not \
contain the answer, say so plainly and answer from general compliance/\
engineering best-practice knowledge instead.

Language rules:
- Default to simple, clear English that anyone can follow. Keep sentences \
short and avoid heavy academic jargon; if you must use a technical term, \
explain it in plain words.
- If the user writes in Roman English / Hinglish, or explicitly asks for it \
(e.g. "Roman English me batao", "Hinglish me samjhao"), reply fluently in \
Roman English / Hinglish using the same casual, natural tone. Keep technical \
terms, file names, and code in English.
- Match the user's language choice for the whole reply unless they switch.

Response length and style rules:
- Answer ONLY what the user asked, nothing more. Do not add extra sections, \
background, or "next steps" that were not requested.
- Always use this structure: start with a short intro paragraph (1-2 \
sentences max) that directly answers the question, then give the key points \
as bullet points.
- Keep it short. Most replies should be 1 short paragraph + 2 to 5 bullet \
points. Never write long walls of text.
- Simple questions (yes/no, a single fact, "is X good?"): 1 sentence answer \
+ 2 to 3 bullet points. That is enough.
- Only go longer (detailed breakdown, code, tables, examples) if the user \
explicitly asks: "explain more", "detail me samjhao", "step-by-step", \
"example", "in detail".
- Do not repeat the question, do not summarise yourself at the end, and do \
not pad for length. Stop as soon as the question is answered.
- Tone: professional, calm, and direct. No filler openers like "Great \
question!" and no unnecessary disclaimers.

Formatting rules:
- Every answer = one short intro paragraph, then bullet points.
- Use clean Markdown: **bold** key terms and `-` bullet points.
- Use short headings only when the answer has clearly separate parts.
- Use tables or fenced code blocks only when the user asks for them or when \
comparing structured data truly needs it.
- When you reference a specific requirement from the context, mention which \
excerpt it came from (one short mention, not a citation block)."""


def get_client() -> chromadb.ClientAPI:
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIR)
    return _chroma_client


def get_collection():
    global _collection
    if _collection is None:
        _collection = get_client().get_or_create_collection(name=COLLECTION_NAME)
    return _collection


def _chunk_text(text: str, chunk_size: int = 800, overlap: int = 120) -> List[str]:
    """Simple sliding-window chunker on whitespace-normalized text."""
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []
    chunks = []
    start = 0
    while start < len(normalized):
        end = start + chunk_size
        chunks.append(normalized[start:end])
        start += chunk_size - overlap
    return chunks


def ingest_spec_document(run_id: str, filename: str, text: str) -> int:
    """Chunk and embed a spec document into the vector store, tagged with run_id."""
    chunks = _chunk_text(text)
    if not chunks:
        return 0
    collection = get_collection()
    ids = [f"{run_id}::{i}" for i in range(len(chunks))]
    metadatas = [{"run_id": run_id, "filename": filename, "chunk_index": i} for i in range(len(chunks))]
    collection.upsert(ids=ids, documents=chunks, metadatas=metadatas)
    return len(chunks)


def _retrieve_context(query: str, run_id: Optional[str], n_results: int = 5) -> List[Tuple[str, float]]:
    collection = get_collection()
    if collection.count() == 0:
        return []

    where = {"run_id": run_id} if run_id else None
    try:
        results = collection.query(
            query_texts=[query],
            n_results=min(n_results, max(collection.count(), 1)),
            where=where,
        )
    except Exception:
        # Fall back to an unfiltered query if the run_id filter yields no collection matches.
        results = collection.query(query_texts=[query], n_results=min(n_results, collection.count()))

    documents = results.get("documents", [[]])[0]
    distances = results.get("distances", [[]])[0]
    # Chroma returns squared-L2 distance by default; convert to a rough similarity in [0,1].
    pairs = []
    for doc, dist in zip(documents, distances):
        similarity = 1 / (1 + dist) if dist is not None else 0.0
        pairs.append((doc, round(similarity, 3)))
    return pairs


def answer_question(
    message: str,
    run_id: Optional[str],
    model: str,
    history: Optional[List[dict]] = None,
) -> Tuple[str, List[Tuple[str, float]]]:
    context_pairs = _retrieve_context(message, run_id)
    context_block = "\n\n".join(f"[Excerpt {i+1}] {chunk}" for i, (chunk, _) in enumerate(context_pairs))

    if not settings.GROQ_API_KEY:
        fallback = (
            "I can't reach the Groq LLM right now because no `GROQ_API_KEY` is configured "
            "on the server. Once it's set, I'll be able to answer questions grounded in your "
            "uploaded audit documents."
        )
        return fallback, context_pairs

    client = Groq(api_key=settings.GROQ_API_KEY)
    messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]

    for turn in (history or [])[-6:]:
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": str(content)[:2000]})

    user_content = message
    if context_block:
        user_content = f"CONTEXT FROM UPLOADED DOCUMENTS:\n{context_block}\n\nQUESTION: {message}"
    messages.append({"role": "user", "content": user_content})

    try:
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.3,
            max_tokens=1500,
        )
        answer = completion.choices[0].message.content.strip()
    except Exception as exc:  # pragma: no cover - network dependent
        answer = (
            f"I ran into an error calling the language model (`{exc}`). "
            "Please verify the API key and selected model, then try again."
        )

    return answer, context_pairs
