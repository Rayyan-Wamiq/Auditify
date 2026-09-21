/**
 * Minimal Groq chat-completions client.
 *
 * The Python backend used the `groq` SDK; the same OpenAI-compatible
 * `POST {base}/chat/completions` call is issued here with `fetch`, so no extra
 * dependency is needed and the request body is byte-for-byte what the SDK sent
 * (`model`, `messages`, `temperature`, `max_tokens`).
 *
 * GGroq hosts inference for `openai/gpt-oss-120b`; no model weights are ever
 * loaded in this process.
 */
import { groqConfigured, settings } from "./config";

export interface GroqChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqChatOptions {
  model: string;
  messages: GroqChatMessage[];
  temperature: number;
  maxTokens: number;
}

/** `true` when `GROQ_API_KEY` is configured (mirrors `settings.GROQ_API_KEY`). */
export function isGroqConfigured(): boolean {
  return groqConfigured;
}

/**
 * Issue one chat completion and return the assistant message content.
 *
 * Errors are thrown with the upstream status/text so callers can reproduce the
 * backend's user-facing error strings (`... \`{exc}\` ...`).
 */
export async function groqChatCompletion(options: GroqChatOptions): Promise<string> {
  const response = await fetch(`${settings.groqApiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    }),
    // Serverless requests have a hard wall-clock budget; fail with a readable
    // error instead of letting the platform kill the invocation.
    signal: AbortSignal.timeout(settings.groqRequestTimeoutSeconds * 1000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const detail = text.trim() || response.statusText;
    throw new Error(`Groq API error ${response.status}: ${detail.slice(0, 500)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Groq API returned an empty completion.");
  }
  return content;
}
