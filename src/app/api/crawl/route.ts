import { NextResponse } from "next/server";
import { z } from "zod";
import { errorJson, handleRouteError } from "@/lib/api";
import { crawlSite } from "@/lib/crawler";

/**
 * Step 2 — crawl the official website.
 * Returns partial results with a `warning` instead of failing when a site blocks bots,
 * so the research flow can continue on search data alone.
 */

export const maxDuration = 60; // crawling several pages can exceed the default budget

const Body = z.object({ website: z.string().url() });

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorJson("A valid website URL is required.", 400);

    const result = await crawlSite(parsed.data.website);
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err, "Website crawl failed.");
  }
}
