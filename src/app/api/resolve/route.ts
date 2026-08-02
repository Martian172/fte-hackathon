import { NextResponse } from "next/server";
import { z } from "zod";
import { errorJson, handleRouteError, readKeys } from "@/lib/api";
import { normalizeUrl } from "@/lib/crawler";
import { serperSearch } from "@/lib/serper";
import type { ResolveResult } from "@/lib/types";

/**
 * Step 1 — turn user input (company name OR URL) into the official website.
 * URLs pass through directly; names are resolved with a Serper.dev search,
 * preferring the knowledge-graph website over organic results.
 */

const Body = z.object({ query: z.string().trim().min(1).max(200) });

/** Looks like "stripe.com" / "https://tesla.com" rather than a company name. */
const URL_LIKE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

/** Aggregator/press domains that outrank official sites in search results. */
const NOT_OFFICIAL = /wikipedia|linkedin|facebook|instagram|twitter|x\.com|youtube|crunchbase|glassdoor|indeed|bloomberg|reuters|apps\.apple|play\.google|github\.com|medium\.com/i;

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorJson("Please enter a company name or website URL.", 400);
    const query = parsed.data.query;

    // Direct URL input — no search needed
    if (URL_LIKE.test(query) && !query.includes(" ")) {
      const website = normalizeUrl(query.startsWith("http") ? query : `https://${query}`);
      if (!website) return errorJson("That URL doesn't look valid — try e.g. https://stripe.com", 400);
      const host = new URL(website).hostname.replace(/^www\./, "");
      const name = host.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const result: ResolveResult = { website: new URL(website).origin, name, method: "direct-url" };
      return NextResponse.json(result);
    }

    // Company name — resolve via Serper.dev
    const { serperKey } = readKeys(req);
    if (!serperKey) {
      return errorJson("Serper.dev API key missing — add it in the sidebar settings.", 401);
    }
    const res = await serperSearch(`${query} official website`, serperKey, 10);

    const kgSite = res.knowledgeGraph?.website ? normalizeUrl(res.knowledgeGraph.website) : null;
    if (kgSite) {
      const result: ResolveResult = {
        website: new URL(kgSite).origin,
        name: res.knowledgeGraph?.title ?? query,
        method: "serper-knowledge-graph",
        description: res.knowledgeGraph?.description ?? null,
      };
      return NextResponse.json(result);
    }

    const organic = (res.organic ?? []).find((o) => o.link && !NOT_OFFICIAL.test(o.link));
    if (organic) {
      const site = normalizeUrl(organic.link);
      if (site) {
        const result: ResolveResult = {
          website: new URL(site).origin,
          name: organic.title.split(/[|\-–:]/)[0].trim() || query,
          method: "serper-organic",
          description: organic.snippet ?? null,
        };
        return NextResponse.json(result);
      }
    }
    return errorJson(`Couldn't find an official website for "${query}" — try entering the URL directly.`, 404);
  } catch (err) {
    return handleRouteError(err, "Failed to resolve the company website.");
  }
}
