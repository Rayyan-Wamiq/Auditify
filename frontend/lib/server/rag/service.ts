/**
 * RAG-powered copilot service.
 *
 * Port of `backend/app/services/rag_service.py`. The chunking, retrieval
 * contract and prompt assembly are identical; only the storage layer changed,
 * from a machine-local ChromaDB collection to the `spec_chunks` table plus a
 * pluggable embedding provider (see `embeddings.ts` for the reasoning).
 *
 * Retrieval contract preserved from the Python implementation:
 *   * no indexed chunks at all            -> no sources
 *   * `run_id` given                      -> only that run's chunks are searched
 *   * chunk lookup raises                 -> retried without the run filter
 *   * similarity = `1 / (1 + distance)`, rounded to 3 decimals (top 5).
 */
import { isGroqConfigured, groqChatCompletion } from "../groq";
import { pythonLen, pythonRound, pythonSlice, pythonStr } from "../python-compat";
import { getEmbeddingProvider, squaredL2Distance } from "./embeddings";
import { CHAT_SYSTEM_PROMPT } from "./prompt";
import { countChunks, fetchChunks, replaceChunks } from "./store";

export interface ChatSource {
  chunk: string;
  similarity: number;
}

export interface ChatTurn {
  role?: string;
  content?: unknown;
}

const NO_API_KEY_ANSWER =
  "I can't reach the Groq LLM right now because no `GROQ_API_KEY` is configured " +
  "on the server. Once it's set, I'll be able to answer questions grounded in your " +
  "uploaded audit documents.";

/** Sliding-window chunker on whitespace-normalized text (800 chars / 120 overlap). */
export function chunkText(text: string, chunkSize = 800, overlap = 120): string[] {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  const length = pythonLen(normalized);
  let start = 0;
  while (start < length) {
    chunks.push(pythonSlice(normalized, start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
}

/** Chunk, embed and persist a spec document, tagged with the run id. */
export async function ingestSpecDocument(
  runId: string,
  filename: string,
  text: string
): Promise<number> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;

  const provider = getEmbeddingProvider();
  const embeddings = await provider.embed(chunks);
  return replaceChunks(runId, filename, chunks, embeddings, provider.id);
}

/** Nearest chunks for `query`, optionally scoped to a single run. */
export async function retrieveContext(
  query: string,
  runId: string | null,
  nResults = 5
): Promise<ChatSource[]> {
  const total = await countChunks();
  if (total === 0) return [];

  let rows;
  try {
    rows = await fetchChunks(runId);
  } catch {
    // Mirrors the Python fallback: if the run-scoped lookup fails (e.g. an
    // invalid filter), retry without the filter rather than failing the chat.
    rows = await fetchChunks(null);
  }

  const provider = getEmbeddingProvider();
  const [queryVector] = await provider.embed([query]);

  const scored: { chunk: string; similarity: number; index: number }[] = [];
  for (const row of rows) {
    const stored =
      row.embedding && row.embedding_provider === provider.id ? row.embedding : null;
    // A provider switch (or a legacy row) is handled by re-embedding on the fly.
    const vector = stored ?? (await provider.embed([row.content]))[0];
    const distance = squaredL2Distance(queryVector, vector);
    scored.push({
      chunk: row.content,
      similarity: pythonRound(1 / (1 + distance), 3),
      index: row.chunk_index,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity || a.index - b.index);
  const limit = Math.min(nResults, Math.max(total, 1));
  return scored.slice(0, limit).map(({ chunk, similarity }) => ({ chunk, similarity }));
}

/** Answer a copilot question from retrieved context, via Groq chat completions. */
export async function answerQuestion(
  message: string,
  runId: string | null,
  model: string,
  history?: ChatTurn[]
): Promise<{ answer: string; sources: ChatSource[] }> {
  const sources = await retrieveContext(message, runId);
  const contextBlock = sources
    .map((source, index) => `[Excerpt ${index + 1}] ${source.chunk}`)
    .join("\n\n");

  if (!isGroqConfigured()) {
    return { answer: NO_API_KEY_ANSWER, sources };
  }

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
  ];

  for (const turn of (history ?? []).slice(-6)) {
    const role = turn?.role;
    const content = turn?.content;
    if ((role === "user" || role === "assistant") && content) {
      messages.push({ role, content: pythonSlice(pythonStr(content), 0, 2000) });
    }
  }

  const userContent = contextBlock
    ? `CONTEXT FROM UPLOADED DOCUMENTS:\n${contextBlock}\n\nQUESTION: ${message}`
    : message;
  messages.push({ role: "user", content: userContent });

  let answer: string;
  try {
    answer = (
      await groqChatCompletion({ model, messages, temperature: 0.3, maxTokens: 1500 })
    ).trim();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    answer =
      `I ran into an error calling the language model (\`${reason}\`). ` +
      "Please verify the API key and selected model, then try again.";
  }

  return { answer, sources };
}
