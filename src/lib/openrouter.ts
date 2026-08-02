import { z } from "zod";
import { ApiError, fetchWithTimeout } from "./http";

/**
 * OpenRouter client — mandated AI provider.
 * Strategy: try the user-selected model first; on rate-limit/availability failures walk a
 * chain of known-good free models so research never dies on a single model outage.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

export const FALLBACK_MODELS = [
  DEFAULT_MODEL,
  "openrouter/free", // OpenRouter's router over all currently-available free models
  "openai/gpt-oss-20b:free",
  "google/gemma-4-31b-it:free",
];

/** Widest chain we will walk in one request — bounds worst-case latency. */
const MAX_CHAIN = 8;

/**
 * Sentinel status for "this API key's daily free-model quota is gone".
 * Distinct from 429 because switching models cannot help — only a different key can,
 * so the fallback chain must stop immediately instead of burning time.
 */
export const QUOTA_EXHAUSTED = 460;

interface OpenRouterModelInfo {
  id: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { output_modalities?: string[] };
}

let freeModelCache: { at: number; ids: string[] } | null = null;
const FREE_CACHE_TTL = 15 * 60 * 1000;

/**
 * Live list of free text models, newest snapshot cached for 15 min.
 * Free-tier capacity on OpenRouter is a *shared upstream pool* — when it is busy,
 * several models 429 at once, so the fallback chain has to be wide, not a fixed few.
 */
async function freeModelIds(): Promise<string[]> {
  if (freeModelCache && Date.now() - freeModelCache.at < FREE_CACHE_TTL) return freeModelCache.ids;
  try {
    const res = await fetchWithTimeout("https://openrouter.ai/api/v1/models", {}, 8_000);
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { data?: OpenRouterModelInfo[] };
    const ids = (body.data ?? [])
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          (!m.architecture?.output_modalities || m.architecture.output_modalities.includes("text"))
      )
      .map((m) => m.id);
    if (ids.length) freeModelCache = { at: Date.now(), ids };
    return ids;
  } catch {
    return []; // fall back to the hardcoded chain
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

async function chatCompletion(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const res = await fetchWithTimeout(
    OPENROUTER_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        // Attribution headers recommended by OpenRouter
        "HTTP-Referer": "https://company-research-ai.vercel.app",
        "X-Title": "Company Research AI",
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 1800,
      }),
    },
    45_000
  );

  if (res.status === 401) throw new ApiError("OpenRouter rejected the API key — check it in Settings.", 401);
  if (res.status === 402) throw new ApiError("OpenRouter: out of credits for this model.", 402);
  if (res.status === 429) {
    // Two very different 429s: an account-wide daily cap (no model switch can help —
    // the user must supply their own key) vs. one busy model (fallback will help).
    const raw = await res.text().catch(() => "");
    if (/free-models-per-day|openrouter_free_tier_daily/i.test(raw)) {
      throw new ApiError(
        "The configured OpenRouter key has used up its free daily quota (50 requests/day). " +
          "Paste your own free OpenRouter key in the sidebar to keep researching — it takes a minute to create one at openrouter.ai.",
        QUOTA_EXHAUSTED
      );
    }
    throw new ApiError(`Model ${opts.model} is rate-limited.`, 429);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(`OpenRouter error (HTTP ${res.status}) ${detail}`.trim(), res.status >= 500 ? 502 : res.status);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new ApiError("OpenRouter returned an empty response.", 502);
  return content;
}

/** Errors where switching model can help (vs. a bad key or spent quota, where it cannot). */
function isModelLevelFailure(err: unknown): boolean {
  return err instanceof ApiError && [402, 404, 408, 429, 502, 504].includes(err.status);
}

export async function chatWithFallback(
  messages: ChatMessage[],
  opts: ChatOptions
): Promise<{ content: string; modelUsed: string }> {
  // Chain = user's choice → known-good models → whatever else is free right now.
  const tried = new Set<string>();
  const chain = [opts.model, ...FALLBACK_MODELS, ...(await freeModelIds())]
    .filter((m) => {
      if (tried.has(m)) return false;
      tried.add(m);
      return true;
    })
    .slice(0, MAX_CHAIN);

  let lastErr: unknown;
  let sawRateLimit = false;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    // Fight for the user's explicitly chosen model: one extra retry on 429
    // (shared free pools often free up within seconds) before falling back.
    const attempts = i === 0 ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const content = await chatCompletion(messages, { ...opts, model });
        return { content, modelUsed: model };
      } catch (err) {
        lastErr = err;
        if (!isModelLevelFailure(err)) throw err; // e.g. invalid key — no point trying other models
        const rateLimited = err instanceof ApiError && err.status === 429;
        sawRateLimit ||= rateLimited;
        if (attempt < attempts - 1 && rateLimited) {
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        break;
      }
    }
  }
  // Every model in the chain failed. A pool-wide rate limit is the common case and
  // needs a different message than a genuine outage — tell the user what to actually do.
  if (sawRateLimit) {
    throw new ApiError(
      `OpenRouter's free-tier pool is busy right now — ${chain.length} free models were tried and all are rate-limited. ` +
        "Wait ~30 seconds and press Try again, or pick a paid model in the sidebar if your key has credits.",
      429
    );
  }
  throw lastErr instanceof ApiError
    ? lastErr
    : new ApiError("All AI models failed — please try again shortly.", 502);
}

/** Pull a JSON payload out of an LLM reply that may be wrapped in prose/code fences. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to bracket slicing */
  }
  const start = cleaned.search(/[{[]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start === -1 || end <= start) throw new ApiError("AI reply contained no JSON.", 502);
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Ask for JSON validated against a zod schema.
 * On invalid output: one corrective retry quoting the validation error, then fail loudly —
 * the route turns that into a friendly message instead of rendering garbage.
 */
export async function askForJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts: ChatOptions
): Promise<{ data: T; modelUsed: string }> {
  const first = await chatWithFallback(messages, opts);
  const attempt = tryParse(schema, first.content);
  if (attempt.ok) return { data: attempt.data, modelUsed: first.modelUsed };

  const second = await chatWithFallback(
    [
      ...messages,
      { role: "assistant", content: first.content.slice(0, 4000) },
      {
        role: "user",
        content: `Your previous reply was not valid (${attempt.error}). Respond again with ONLY a valid JSON object matching the requested schema — no markdown, no commentary.`,
      },
    ],
    { ...opts, model: first.modelUsed }
  );
  const retry = tryParse(schema, second.content);
  if (retry.ok) return { data: retry.data, modelUsed: second.modelUsed };
  throw new ApiError("The AI could not produce valid structured output. Try another model.", 502);
}

function tryParse<T>(
  schema: z.ZodType<T>,
  raw: string
): { ok: true; data: T } | { ok: false; error: string } {
  try {
    const parsed = schema.safeParse(extractJson(raw));
    if (parsed.success) return { ok: true, data: parsed.data };
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "unparseable JSON" };
  }
}
