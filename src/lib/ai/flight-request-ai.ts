// Calls the Anthropic API to read one flight request. SERVER ONLY: the key is read from
// ANTHROPIC_API_KEY (no NEXT_PUBLIC_ prefix, so Next.js never puts it in the browser bundle). It lives
// only in the hosting provider's environment variables and is never committed or logged.
// The text passed in has already been checked for personal data (src/lib/flight-request.ts and the
// database, migration 25). The AI only extracts search details; it has no fares or availability.
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, EXTRACTION_SCHEMA, SYSTEM_PROMPT, userMessage } from "@/lib/flight-request";

export type AiReading =
  | { ok: true; raw: unknown; model: string; inputTokens: number; outputTokens: number }
  | { ok: false; reason: "not-configured" | "refused" | "incomplete" | "unreadable" | "unavailable"; model?: string; inputTokens?: number; outputTokens?: number };

/** True when the server has an Anthropic key configured (the value itself is never exposed). */
export function aiConfigured() {
  return typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.trim().length > 0;
}

export async function readFlightRequestWithAi(text: string, today: string): Promise<AiReading> {
  if (typeof window !== "undefined") throw new Error("The AI client can only be used on the server.");
  if (!aiConfigured()) return { ok: false, reason: "not-configured" };

  const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });
  try {
    const response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 2_000,
      // A declined request is retried server-side on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: userMessage(text, today) }],
    });
    const usage = { model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    if (response.stop_reason === "refusal") return { ok: false, reason: "refused", ...usage };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "incomplete", ...usage };
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return { ok: false, reason: "unreadable", ...usage };
    try {
      return { ok: true, raw: JSON.parse(textBlock.text), ...usage };
    } catch {
      return { ok: false, reason: "unreadable", ...usage };
    }
  } catch (error) {
    // Typed SDK errors (auth, rate limit, server, connection): logged by class name only, never the key.
    console.error("AI flight-request reading failed:", error instanceof Anthropic.APIError ? `${error.constructor.name} ${error.status ?? ""}` : String((error as Error)?.name));
    return { ok: false, reason: "unavailable" };
  }
}
