/**
 * Persistence for RAG chunks (`spec_chunks`).
 *
 * Replaces ChromaDB's local persistent collection: chunks and their vectors
 * live in PostgreSQL, so retrieval works on stateless serverless instances and
 * follows the deployment instead of a machine-local `chroma_store/` directory.
 */
import { newUuid, query, utcNowNaive, withTransaction } from "../db";

export interface SpecChunkRow {
  id: string;
  run_id: string;
  filename: string;
  chunk_index: number;
  content: string;
  embedding: number[] | null;
  embedding_provider: string | null;
}

/** Total number of indexed chunks (`collection.count()`). */
export async function countChunks(): Promise<number> {
  const rows = await query<{ total: string }>("SELECT COUNT(*) AS total FROM spec_chunks");
  return Number.parseInt(rows[0]?.total ?? "0", 10);
}

/**
 * Replace every chunk for a run (Chroma's `collection.upsert` by id, scoped to
 * the run) and return how many chunks were stored.
 */
export async function replaceChunks(
  runId: string,
  filename: string,
  chunks: string[],
  embeddings: number[][],
  providerId: string
): Promise<number> {
  if (chunks.length === 0) return 0;
  const createdAt = utcNowNaive();

  await withTransaction(async (client) => {
    await client.query("DELETE FROM spec_chunks WHERE run_id = $1", [runId]);
    for (let index = 0; index < chunks.length; index += 1) {
      await client.query(
        `INSERT INTO spec_chunks
           (id, run_id, filename, chunk_index, content, embedding, embedding_provider, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          newUuid(),
          runId,
          filename,
          index,
          chunks[index],
          JSON.stringify(embeddings[index] ?? []),
          providerId,
          createdAt,
        ]
      );
    }
  });

  return chunks.length;
}

/** Fetch chunks, optionally narrowed to one run (`where={"run_id": ...}`). */
export async function fetchChunks(runId: string | null): Promise<SpecChunkRow[]> {
  const sql = runId
    ? "SELECT * FROM spec_chunks WHERE run_id = $1 ORDER BY chunk_index"
    : "SELECT * FROM spec_chunks ORDER BY run_id, chunk_index";
  return query<SpecChunkRow>(sql, runId ? [runId] : []);
}
