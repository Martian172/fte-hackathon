import { NextResponse } from "next/server";
import { FALLBACK_MODELS } from "@/lib/openrouter";
import { fetchWithTimeout } from "@/lib/http";

/**
 * Model picker data — live list from OpenRouter (no key required), free models first.
 * Cached in module scope for 30 min; on failure returns the fallback chain so the
 * dropdown always works.
 */

interface ModelOption {
  id: string;
  name: string;
  free: boolean;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
}

let cache: { at: number; models: ModelOption[] } | null = null;
const TTL_MS = 30 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ models: cache.models });
  }
  try {
    const res = await fetchWithTimeout("https://openrouter.ai/api/v1/models", {}, 10_000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: OpenRouterModel[] };
    const models: ModelOption[] = (body.data ?? [])
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        free: m.pricing?.prompt === "0" && m.pricing?.completion === "0",
      }))
      .sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
    if (models.length > 0) cache = { at: Date.now(), models };
    return NextResponse.json({ models });
  } catch {
    // Degrade to the known-good free chain — never break the settings UI.
    const models = FALLBACK_MODELS.map((id) => ({ id, name: id, free: true }));
    return NextResponse.json({ models });
  }
}
