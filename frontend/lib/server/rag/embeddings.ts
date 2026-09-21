/**
 * Embedding providers for the RAG copilot.
 *
 * The Python service relied on ChromaDB's default embedding function, which
 * downloads and executes a local ONNX MiniLM model (~80 MB) on first use - not
 * viable on serverless hosting, where the filesystem is ephemeral and every
 * cold start would re-download it. This module keeps the same interface (embed
 * text -> persist vectors -> rank by distance) with two interchangeable
 * backends:
 *
 *   1. `remote`  - an OpenAI-compatible `/embeddings` endpoint, opt-in via
 *                  EMBEDDING_API_KEY (+ optional EMBEDDING_API_URL /
 *                  EMBEDDING_MODEL). Best retrieval quality, no local inference.
 *   2. `lexical` - the default. A deterministic, dependency-free hashed
 *                  bag-of-words embedder: no network, no weights, no downloads,
 *                  stable across instances, and it preserves the retrieval
 *                  contract (top-k chunks + a similarity score per chunk).
 */
import { settings } from "../config";

export interface EmbeddingProvider {
  /** Stable id persisted with every vector so a provider switch is detectable. */
  id: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Very common English words that carry no retrieval signal. Kept short and
 * static (never corpus-derived) so vectors stay deterministic everywhere.
 */
const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "all", "also", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "can", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from",
  "further", "had", "has", "have", "having", "he", "her", "here", "hers", "him", "his", "how",
  "i", "if", "in", "into", "is", "it", "its", "just", "me", "more", "most", "my", "no", "nor",
  "not", "now", "of", "off", "on", "once", "only", "or", "other", "our", "out", "over", "own",
  "same", "she", "should", "so", "some", "such", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up",
  "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why",
  "will", "with", "would", "you", "your",
]);

/** Lowercased alphanumeric terms (length >= 2) plus adjacent bigrams. */
export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));

  const features = [...words];
  for (let i = 0; i + 1 < words.length; i += 1) {
    features.push(`${words[i]} ${words[i + 1]}`);
  }
  return features;
}

/** FNV-1a (32-bit) - small, fast and stable across runtimes. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Hashed term-frequency vector, L2-normalised.
 *
 * Sub-linear term weighting (`1 + ln(tf)`) stops a repeated word from dominating,
 * and signed hashing keeps unrelated hash collisions from systematically
 * inflating similarity.
 */
function lexicalVector(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const counts = new Map<string, number>();
  for (const feature of tokenize(text)) {
    counts.set(feature, (counts.get(feature) ?? 0) + 1);
  }

  for (const [feature, count] of counts) {
    const hash = fnv1a(feature);
    const index = hash % dimensions;
    const sign = (hash >>> 31) === 1 ? -1 : 1;
    vector[index] += sign * (1 + Math.log(count));
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
  }
  return vector;
}

function createLexicalProvider(dimensions: number): EmbeddingProvider {
  return {
    id: `lexical-fnv1a-${dimensions}`,
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text) => lexicalVector(text, dimensions));
    },
  };
}

function createRemoteProvider(
  apiKey: string,
  apiUrl: string,
  model: string,
  dimensions: number
): EmbeddingProvider {
  return {
    id: `remote-${model}`,
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Embedding API error ${response.status}: ${body.slice(0, 300)}`);
      }
      const payload = (await response.json()) as { data?: { embedding: number[] }[] };
      const vectors = (payload.data ?? []).map((item) => item.embedding);
      if (vectors.length !== texts.length) {
        throw new Error("Embedding API returned an unexpected number of vectors.");
      }
      return vectors;
    },
  };
}

let provider: EmbeddingProvider | undefined;

/** Active provider: remote when configured, otherwise the local lexical one. */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (!provider) {
    const { embeddingApiKey, embeddingApiUrl, embeddingModel, embeddingDimensions } = settings;
    provider =
      embeddingApiKey && embeddingApiUrl
        ? createRemoteProvider(
            embeddingApiKey,
            embeddingApiUrl,
            embeddingModel,
            embeddingDimensions
          )
        : createLexicalProvider(embeddingDimensions);
  }
  return provider;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Squared euclidean distance - the metric ChromaDB reported by default. */
export function squaredL2Distance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let total = 0;
  for (let i = 0; i < length; i += 1) {
    const diff = a[i] - b[i];
    total += diff * diff;
  }
  return total;
}
