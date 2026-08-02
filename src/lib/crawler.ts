import * as cheerio from "cheerio";
import { fetchWithTimeout } from "./http";
import type { CrawledPage, CrawlResult } from "./types";

/**
 * Focused website crawler (assignment: "crawl important pages, extract meaningful
 * content, avoid duplicates").
 *
 * Design:
 *  1. Fetch the homepage, collect internal links.
 *  2. Score links by path keywords (about/contact/products/services/solutions/pricing...).
 *  3. Skip login/legal/blog/asset URLs, respect robots.txt (best-effort, fail-open).
 *  4. Fetch top pages concurrently with per-page timeouts.
 *  5. Deduplicate by normalized URL AND by content fingerprint (catches /home vs /).
 *  6. Extract readable text plus deterministic signals: tel:/mailto: links, JSON-LD
 *     Organization phone/address, social profiles — these outrank LLM guesses later.
 */

/**
 * Adaptive depth: a first wave of important pages, then — only if key signals are
 * still missing (no contact info, thin content) — a deeper second wave, discovering
 * links from crawled pages as well as the homepage.
 */
const FIRST_WAVE = 6; // + homepage = 7 pages for well-structured sites
const PAGE_LIMIT = 12; // hard cap including the deep-crawl wave
const MIN_TEXT_CHARS = 6_000; // below this the site is "thin" → dig deeper
const CONCURRENCY = 4;
const PER_PAGE_CHARS = 5_000;
const MAX_HTML_BYTES = 1_500_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Pages that are irrelevant or risky to crawl (login, legal, content marketing, files). */
const SKIP_PATH = /login|log-in|signin|sign-in|signup|sign-up|register|auth|password|account|cart|checkout|privacy|terms|legal|cookie|gdpr|career|jobs|press|event|webinar|status|sitemap|search|blog|news|article|podcast|glossary|guides?\b|resources|docs|documentation|support|help-center|faq|investor/i;

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|avif|ico|css|js|mjs|json|xml|txt|zip|gz|rar|mp[34]|webm|mov|woff2?|ttf|eot|map)$/i;

/** Keyword → priority. Higher score = crawled first (assignment lists these pages). */
const PRIORITY: Array<[RegExp, number]> = [
  [/about|who-we-are|our-story|company/i, 100],
  [/contact/i, 95],
  [/product/i, 90],
  [/service/i, 85],
  [/solution/i, 80],
  [/pricing|plans/i, 75],
  [/feature|platform|technology|what-we-do/i, 70],
  [/team|leadership/i, 60],
  [/customer|industries/i, 50],
];

/** Canonical URL form: https, no hash, no tracking params, no trailing slash. */
export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|ref|source)/i.test(p)) u.searchParams.delete(p);
    }
    let href = u.href;
    if (u.pathname !== "/" && href.endsWith("/")) href = href.slice(0, -1);
    return href;
  } catch {
    return null;
  }
}

/** Host key treating `www.x.com` and `x.com` as the same site (other subdomains are not). */
function hostKey(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function linkScore(path: string): number {
  for (const [re, score] of PRIORITY) if (re.test(path)) return score;
  const depth = path.split("/").filter(Boolean).length;
  return depth <= 1 ? 20 : 5; // shallow pages are more likely to matter
}

/** Best-effort robots.txt: collect `Disallow` prefixes for `User-agent: *`. Fail-open. */
async function robotsDisallow(origin: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`, { headers: BROWSER_HEADERS }, 4_000);
    if (!res.ok) return [];
    const text = (await res.text()).slice(0, 100_000);
    const out: string[] = [];
    let applies = false;
    for (const line of text.split(/\r?\n/)) {
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*";
      else if (applies && key === "disallow" && value && value !== "/") out.push(value);
    }
    return out;
  } catch {
    return [];
  }
}

interface PageExtract {
  page: CrawledPage;
  links: string[];
  phones: string[];
  emails: string[];
  socials: string[];
  jsonLdPhone: string | null;
  jsonLdAddress: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Walk JSON-LD for Organization/LocalBusiness nodes → telephone + postal address. */
function parseJsonLd($: cheerio.CheerioAPI): { phone: string | null; address: string | null } {
  let phone: string | null = null;
  let address: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (phone && address) return;
    try {
      const queue: unknown[] = [JSON.parse($(el).text())];
      while (queue.length) {
        const node = queue.shift();
        if (Array.isArray(node)) queue.push(...node);
        else if (isRecord(node)) {
          if (Array.isArray(node["@graph"])) queue.push(...node["@graph"]);
          const type = node["@type"];
          const types = (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === "string");
          if (types.some((t) => /organization|localbusiness|corporation/i.test(t))) {
            if (!phone && typeof node.telephone === "string") phone = node.telephone.trim();
            const addr = node.address;
            if (!address && typeof addr === "string") address = addr.trim();
            else if (!address && isRecord(addr)) {
              const parts = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]
                .map((k) => addr[k])
                .filter((v): v is string => typeof v === "string" && v.length > 0);
              if (parts.length) address = parts.join(", ");
            }
          }
          for (const v of Object.values(node)) if (isRecord(v) || Array.isArray(v)) queue.push(v);
        }
      }
    } catch {
      /* malformed JSON-LD is common — ignore */
    }
  });
  return { phone, address };
}

const SOCIAL_RE = /(linkedin\.com\/company|twitter\.com|x\.com\/(?!share)|facebook\.com|instagram\.com|youtube\.com\/(@|channel|user))/i;
const PHONE_RE = /\+?\(?\d[\d\s().-]{6,16}\d/g;

function extractFromHtml(html: string, pageUrl: string): PageExtract {
  const $ = cheerio.load(html);
  const jsonLd = parseJsonLd($); // parse before stripping <script> tags
  $("script, style, noscript, svg, iframe, form, video, canvas").remove();

  const title = $("title").first().text().trim() || $("h1").first().text().trim() || pageUrl;
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() ?? "";

  const links: string[] = [];
  const phones = new Set<string>();
  const emails = new Set<string>();
  const socials = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (href.startsWith("tel:")) {
      const p = decodeURIComponent(href.slice(4)).trim();
      if (p.replace(/\D/g, "").length >= 7) phones.add(p);
    } else if (href.startsWith("mailto:")) {
      const m = href.slice(7).split("?")[0].trim();
      if (m.includes("@")) emails.add(m.toLowerCase());
    } else if (SOCIAL_RE.test(href)) {
      if (socials.size < 6) socials.add(href.split("?")[0]);
    } else {
      const abs = normalizeUrl(href, pageUrl);
      if (abs) links.push(abs);
    }
  });

  const headings = $("h1, h2, h3")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 25)
    .join(" | ");
  const bodyText = ($("main").text() || $("body").text()).replace(/\s+/g, " ").trim();

  // Regex phone fallback only on contact-like pages (kept as low-trust candidates)
  if (/contact/i.test(pageUrl) && phones.size === 0) {
    for (const m of bodyText.match(PHONE_RE)?.slice(0, 5) ?? []) {
      const digits = m.replace(/\D/g, "");
      if (digits.length >= 8 && digits.length <= 15) phones.add(m.trim());
    }
  }

  const text = [metaDesc, headings, bodyText].filter(Boolean).join(" — ").slice(0, PER_PAGE_CHARS);
  return {
    page: { url: pageUrl, title: title.slice(0, 200), text },
    links,
    phones: [...phones],
    emails: [...emails],
    socials: [...socials],
    jsonLdPhone: jsonLd.phone,
    jsonLdAddress: jsonLd.address,
  };
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS, redirect: "follow" }, 10_000);
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text/html") && ctype !== "") return null;
    return (await res.text()).slice(0, MAX_HTML_BYTES);
  } catch {
    return null;
  }
}

/** Crawl a site starting from its homepage. Never throws — degrades to partial results. */
export async function crawlSite(startUrl: string): Promise<CrawlResult> {
  const empty: CrawlResult = {
    pages: [], phones: [], emails: [], socialLinks: [],
    jsonLdPhone: null, jsonLdAddress: null, visited: 0, skipped: 0,
  };

  const normalized = normalizeUrl(startUrl);
  if (!normalized) return { ...empty, warning: "Invalid start URL" };

  // Homepage, with a www./non-www fallback — some sites only answer one of the two.
  let home = normalized;
  let homeHtml = await fetchHtml(home);
  if (!homeHtml) {
    const u = new URL(normalized);
    u.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    const alt = u.href;
    homeHtml = await fetchHtml(alt);
    if (homeHtml) home = alt;
  }
  if (!homeHtml) {
    return { ...empty, warning: "Website could not be fetched (blocked or offline) — analysis will rely on search results." };
  }

  const site = hostKey(home);
  const origin = new URL(home).origin;
  const disallow = await robotsDisallow(origin);

  const homeExtract = extractFromHtml(homeHtml, home);
  const fetched = new Set<string>([home, home + "/"]);
  const fingerprints = new Set<string>([homeExtract.page.text.slice(0, 400)]);
  const candidates = new Map<string, number>();
  let skipped = 0;

  /** Score + queue internal links (used for the homepage AND every crawled page). */
  const addCandidates = (links: string[]) => {
    for (const link of links) {
      if (fetched.has(link) || candidates.has(link)) continue;
      if (hostKey(link) !== site) continue;
      const path = (() => { try { return new URL(link).pathname; } catch { return ""; } })();
      if (SKIP_PATH.test(path) || SKIP_EXT.test(path) || disallow.some((d) => path.startsWith(d))) {
        skipped++;
        continue;
      }
      candidates.set(link, linkScore(path));
    }
  };
  addCandidates(homeExtract.links);

  const extracts: PageExtract[] = [homeExtract];

  /** Fetch the current top-N candidates in concurrent batches, feeding new links back in. */
  const crawlWave = async (count: number) => {
    const targets = [...candidates.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([url]) => url);
    for (const url of targets) { candidates.delete(url); fetched.add(url); }
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const settled = await Promise.allSettled(
        targets.slice(i, i + CONCURRENCY).map(async (url) => {
          const html = await fetchHtml(url);
          return html ? extractFromHtml(html, url) : null;
        })
      );
      for (const s of settled) {
        if (s.status !== "fulfilled" || !s.value) { skipped++; continue; }
        const fp = s.value.page.text.slice(0, 400);
        if (fingerprints.has(fp)) { skipped++; continue; } // duplicate content
        fingerprints.add(fp);
        extracts.push(s.value);
        addCandidates(s.value.links); // discover deeper links beyond the homepage
      }
    }
  };

  await crawlWave(FIRST_WAVE);

  // Deep crawl only when the first wave left gaps: no contact signals or thin content.
  const hasContactSignal = () =>
    extracts.some((e) => e.phones.length || e.emails.length || e.jsonLdPhone || e.jsonLdAddress);
  const totalText = () => extracts.reduce((n, e) => n + e.page.text.length, 0);
  const deepCrawl = candidates.size > 0 && (!hasContactSignal() || totalText() < MIN_TEXT_CHARS);
  if (deepCrawl) {
    await crawlWave(PAGE_LIMIT - extracts.length);
  }

  // Aggregate deterministic signals across pages
  const agg = <K extends "phones" | "emails" | "socials">(key: K) =>
    [...new Set(extracts.flatMap((e) => e[key]))].slice(0, 6);

  return {
    pages: extracts.map((e) => e.page),
    phones: agg("phones"),
    emails: agg("emails"),
    socialLinks: agg("socials"),
    jsonLdPhone: extracts.map((e) => e.jsonLdPhone).find(Boolean) ?? null,
    jsonLdAddress: extracts.map((e) => e.jsonLdAddress).find(Boolean) ?? null,
    visited: extracts.length,
    skipped,
    deepCrawl,
  };
}
