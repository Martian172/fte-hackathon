import { NextResponse } from "next/server";
import { ApiError } from "./http";

/**
 * API keys can come from two places, in priority order:
 *  1. Request headers — the user pasted their own keys in the sidebar (like the sample app),
 *  2. Server environment variables — so the deployed demo works with zero setup.
 * Keys are never logged and never echoed back to the client.
 */
export interface ApiKeys {
  openrouterKey: string | null;
  serperKey: string | null;
}

export function readKeys(req: Request): ApiKeys {
  const h = req.headers;
  return {
    openrouterKey: h.get("x-openrouter-key")?.trim() || process.env.OPENROUTER_API_KEY?.trim() || null,
    serperKey: h.get("x-serper-key")?.trim() || process.env.SERPER_API_KEY?.trim() || null,
  };
}

/** Uniform JSON error shape — the UI shows `error` directly, so keep it human-readable. */
export function errorJson(message: string, status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Convert any thrown error into a friendly JSON response (never leak stack traces). */
export function handleRouteError(err: unknown, fallback: string): NextResponse {
  if (err instanceof ApiError) return errorJson(err.message, err.status);
  console.error(fallback, err);
  return errorJson(fallback, 500);
}
