import { ApiError, fetchWithTimeout, isTransient, withRetry } from "./http";

/** Thin typed client for Serper.dev (Google Search API) — mandated by the assignment. */

const SERPER_URL = "https://google.serper.dev/search";

export interface SerperOrganic {
  title: string;
  link: string;
  snippet?: string;
}

export interface SerperKnowledgeGraph {
  title?: string;
  type?: string;
  website?: string;
  description?: string;
  attributes?: Record<string, string>;
}

export interface SerperResponse {
  organic?: SerperOrganic[];
  knowledgeGraph?: SerperKnowledgeGraph;
}

export async function serperSearch(
  query: string,
  apiKey: string,
  num = 10
): Promise<SerperResponse> {
  return withRetry(
    async () => {
      const res = await fetchWithTimeout(
        SERPER_URL,
        {
          method: "POST",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, num, gl: "us", hl: "en" }),
        },
        10_000
      );
      if (res.status === 401 || res.status === 403) {
        throw new ApiError("Serper.dev rejected the API key — check it in Settings.", 401);
      }
      if (res.status === 429) {
        throw new ApiError("Serper.dev rate limit reached — try again in a moment.", 429);
      }
      if (!res.ok) {
        throw new ApiError(`Serper.dev error (HTTP ${res.status})`, res.status >= 500 ? 502 : res.status);
      }
      return (await res.json()) as SerperResponse;
    },
    { retries: 2, shouldRetry: isTransient }
  );
}

/** Render organic results as compact bullet lines for LLM context. */
export function formatSnippets(res: SerperResponse, max = 6): string {
  const lines: string[] = [];
  const kg = res.knowledgeGraph;
  if (kg) {
    const attrs = kg.attributes
      ? Object.entries(kg.attributes).map(([k, v]) => `${k}: ${v}`).join("; ")
      : "";
    lines.push(`[Knowledge graph] ${kg.title ?? ""} (${kg.type ?? ""}) ${kg.website ?? ""} — ${kg.description ?? ""} ${attrs}`.trim());
  }
  for (const o of (res.organic ?? []).slice(0, max)) {
    lines.push(`- ${o.title} — ${o.snippet ?? ""} (${o.link})`);
  }
  return lines.join("\n");
}
