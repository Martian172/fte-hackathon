import { NextResponse } from "next/server";
import { z } from "zod";
import { errorJson, handleRouteError, readKeys } from "@/lib/api";
import { askForJson, DEFAULT_MODEL } from "@/lib/openrouter";
import { ANALYST_SYSTEM, analyzeUserPrompt } from "@/lib/prompts";
import { formatSnippets, serperSearch } from "@/lib/serper";
import type { CompanyProfile, CrawlResult } from "@/lib/types";

/**
 * Step 3 — AI analysis (OpenRouter).
 * Combines crawled content + a Serper enrichment search into one structured profile.
 * Deterministic crawler signals (JSON-LD phone/address, tel: links) override LLM output —
 * generative models must never be the source of truth for contact details.
 */

export const maxDuration = 60;

const DIGEST_BUDGET = 22_000; // chars of crawled content sent to the model

const Body = z.object({
  name: z.string().trim().min(1),
  website: z.string().url(),
  model: z.string().trim().min(1).max(120).optional(),
  crawl: z.object({
    pages: z.array(z.object({ url: z.string(), title: z.string(), text: z.string() })),
    phones: z.array(z.string()),
    emails: z.array(z.string()),
    socialLinks: z.array(z.string()),
    jsonLdPhone: z.string().nullable(),
    jsonLdAddress: z.string().nullable(),
    visited: z.number(),
    skipped: z.number(),
    warning: z.string().optional(),
  }),
});

/** Lenient on optionals (models drop nulls), strict on the fields the report needs. */
const ProfileSchema = z.object({
  companyName: z.string().min(1),
  website: z.string(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  summary: z.string().min(20),
  productsServices: z.array(z.string()).min(1),
  painPoints: z.array(z.string()).min(2),
  industry: z.string().nullable().optional(),
  hqCountry: z.string().nullable().optional(),
  foundedYear: z.union([z.string(), z.number()]).nullable().optional(),
  founders: z.array(z.string()).nullable().optional(),
});

const nullish = (v: string | null | undefined): string | null => {
  const s = v?.trim();
  return !s || /^(null|unknown|n\/a|none|not (publicly )?(available|listed|found))$/i.test(s) ? null : s;
};

function buildDigest(crawl: CrawlResult): string {
  let budget = DIGEST_BUDGET;
  const parts: string[] = [];
  for (const p of crawl.pages) {
    if (budget <= 500) break;
    const chunk = `## ${p.title} (${p.url})\n${p.text.slice(0, Math.min(p.text.length, budget))}`;
    parts.push(chunk);
    budget -= chunk.length;
  }
  return parts.join("\n\n");
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorJson("Invalid analyze request.", 400);
    const { name, website, model, crawl } = parsed.data;

    const { openrouterKey, serperKey } = readKeys(req);
    if (!openrouterKey) {
      return errorJson("OpenRouter API key missing — add it in the sidebar settings.", 401);
    }

    // Serper enrichment is best-effort: if it fails we analyze crawl data alone.
    let searchSnippets = "";
    if (serperKey) {
      try {
        const res = await serperSearch(`"${name}" company founded founders phone address headquarters`, serperKey, 6);
        searchSnippets = formatSnippets(res);
      } catch (err) {
        console.warn("Serper enrichment skipped:", err instanceof Error ? err.message : err);
      }
    }

    const signals = [
      crawl.jsonLdPhone && `JSON-LD phone (authoritative): ${crawl.jsonLdPhone}`,
      crawl.jsonLdAddress && `JSON-LD address (authoritative): ${crawl.jsonLdAddress}`,
      crawl.phones.length && `Phone candidates on site: ${crawl.phones.join(", ")}`,
      crawl.emails.length && `Emails on site: ${crawl.emails.join(", ")}`,
      crawl.socialLinks.length && `Social profiles: ${crawl.socialLinks.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");

    const { data, modelUsed } = await askForJson(
      ProfileSchema,
      [
        { role: "system", content: ANALYST_SYSTEM },
        {
          role: "user",
          content: analyzeUserPrompt({ name, website, digest: buildDigest(crawl as CrawlResult), searchSnippets, signals }),
        },
      ],
      { apiKey: openrouterKey, model: model || DEFAULT_MODEL }
    );

    // Merge: deterministic signals beat generative output for contact fields.
    const profile: CompanyProfile = {
      companyName: data.companyName,
      website,
      phone: crawl.jsonLdPhone ?? crawl.phones[0] ?? nullish(data.phone),
      address: crawl.jsonLdAddress ?? nullish(data.address),
      summary: data.summary,
      productsServices: data.productsServices.slice(0, 12),
      painPoints: data.painPoints.slice(0, 6),
      industry: nullish(data.industry),
      hqCountry: nullish(data.hqCountry),
      foundedYear: data.foundedYear != null ? nullish(String(data.foundedYear)) : null,
      founders: (() => {
        const list = (data.founders ?? []).map((f) => f.trim()).filter((f) => f && !/^(null|unknown|n\/a)$/i.test(f));
        return list.length ? list.slice(0, 6) : null;
      })(),
    };

    return NextResponse.json({ profile, modelUsed });
  } catch (err) {
    return handleRouteError(err, "AI analysis failed — please try again.");
  }
}
