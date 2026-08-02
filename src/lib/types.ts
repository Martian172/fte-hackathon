/** Shared domain types used across API routes and the UI. */

/** A single crawled page with extracted readable content. */
export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

/** Deterministic signals harvested by the crawler (higher trust than LLM output). */
export interface CrawlResult {
  pages: CrawledPage[];
  /** Phone candidates from tel: links and regex fallback. */
  phones: string[];
  emails: string[];
  socialLinks: string[];
  /** Phone/address parsed from schema.org JSON-LD — the most reliable source. */
  jsonLdPhone: string | null;
  jsonLdAddress: string | null;
  visited: number;
  skipped: number;
  warning?: string;
}

/** Result of turning user input (name or URL) into an official website. */
export interface ResolveResult {
  website: string;
  name: string;
  method: "direct-url" | "serper-knowledge-graph" | "serper-organic";
  description?: string | null;
}

/** Structured company profile produced by the AI analysis step. */
export interface CompanyProfile {
  companyName: string;
  website: string;
  phone: string | null;
  address: string | null;
  summary: string;
  productsServices: string[];
  painPoints: string[];
  industry: string | null;
  hqCountry: string | null;
  foundedYear: string | null;
  founders: string[] | null;
}

export interface Competitor {
  name: string;
  website: string;
  reason?: string;
}

/** Full research output rendered in the chat and exported to PDF. */
export interface ResearchReport {
  profile: CompanyProfile;
  competitors: Competitor[];
  /** Model that actually produced the analysis (may be a fallback). */
  modelUsed: string;
  /** Model the user had selected when the research started. */
  requestedModel: string;
  generatedAt: string;
  sources: string[];
}
