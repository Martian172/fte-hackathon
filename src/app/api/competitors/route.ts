import { NextResponse } from "next/server";
import { z } from "zod";
import { errorJson, handleRouteError, readKeys } from "@/lib/api";
import { askForJson, DEFAULT_MODEL } from "@/lib/openrouter";
import { COMPETITOR_SYSTEM, competitorsUserPrompt } from "@/lib/prompts";
import { formatSnippets, serperSearch } from "@/lib/serper";
import type { Competitor } from "@/lib/types";

/**
 * Step 4 — competitor analysis.
 * Serper search for "<company> competitors" grounds the LLM in real market data;
 * post-processing dedupes, drops the company itself and normalizes websites.
 */

export const maxDuration = 60;

const Body = z.object({
  model: z.string().trim().min(1).max(120).optional(),
  profile: z.object({
    companyName: z.string().min(1),
    website: z.string(),
    industry: z.string().nullable(),
    hqCountry: z.string().nullable(),
    productsServices: z.array(z.string()),
  }),
});

const CompetitorsSchema = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string().min(1),
        website: z.string().min(4),
        reason: z.string().optional(),
      })
    )
    .min(1),
});

/** "example.com" → "https://example.com"; reject values without a plausible domain. */
function normalizeWebsite(raw: string): string | null {
  const s = raw.trim();
  if (!/[\w-]+\.[a-z]{2,}/i.test(s)) return null;
  try {
    return new URL(s.startsWith("http") ? s : `https://${s}`).origin;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorJson("Invalid competitors request.", 400);
    const { profile, model } = parsed.data;

    const { openrouterKey, serperKey } = readKeys(req);
    if (!openrouterKey) {
      return errorJson("OpenRouter API key missing — add it in the sidebar settings.", 401);
    }

    let searchSnippets = "";
    if (serperKey) {
      try {
        const res = await serperSearch(`${profile.companyName} competitors alternatives`, serperKey, 8);
        searchSnippets = formatSnippets(res, 8);
      } catch (err) {
        console.warn("Serper competitors search skipped:", err instanceof Error ? err.message : err);
      }
    }

    const { data, modelUsed } = await askForJson(
      CompetitorsSchema,
      [
        { role: "system", content: COMPETITOR_SYSTEM },
        {
          role: "user",
          content: competitorsUserPrompt({
            name: profile.companyName,
            industry: profile.industry,
            country: profile.hqCountry,
            products: profile.productsServices,
            searchSnippets,
          }),
        },
      ],
      { apiKey: openrouterKey, model: model || DEFAULT_MODEL }
    );

    const selfHost = (() => {
      try { return new URL(profile.website).hostname.replace(/^www\./, ""); } catch { return ""; }
    })();
    const seen = new Set<string>();
    const competitors: Competitor[] = [];
    for (const c of data.competitors) {
      const website = normalizeWebsite(c.website);
      if (!website) continue;
      const host = new URL(website).hostname.replace(/^www\./, "");
      const key = c.name.trim().toLowerCase();
      if (host === selfHost || seen.has(key) || key === profile.companyName.trim().toLowerCase()) continue;
      seen.add(key);
      competitors.push({ name: c.name.trim(), website, reason: c.reason?.trim() });
      if (competitors.length === 6) break;
    }

    if (competitors.length === 0) {
      return errorJson("No competitors could be identified — try a different model.", 502);
    }
    return NextResponse.json({ competitors, modelUsed });
  } catch (err) {
    return handleRouteError(err, "Competitor analysis failed — please try again.");
  }
}
