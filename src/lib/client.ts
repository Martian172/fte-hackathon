import { DEFAULT_MODEL } from "./openrouter";
import type { CompanyProfile, Competitor, CrawlResult, ResearchReport, ResolveResult } from "./types";

/**
 * Browser-side API client + UI state types.
 * The client orchestrates the research pipeline as four small API calls
 * (resolve → crawl → analyze → competitors) so the UI can show real progress
 * and no single serverless invocation risks a timeout.
 */

export interface Settings {
  openrouterKey: string;
  serperKey: string;
  model: string;
  discordBotToken: string;
  discordChannelId: string;
  applicantName: string;
  applicantEmail: string;
}

export const DEFAULT_SETTINGS: Settings = {
  openrouterKey: "",
  serperKey: "",
  model: DEFAULT_MODEL,
  discordBotToken: "",
  discordChannelId: "",
  applicantName: "",
  applicantEmail: "",
};

const SETTINGS_KEY = "cra-settings-v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/** Keys travel as headers to our own API routes only (never to third parties directly). */
function headers(s: Settings): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (s.openrouterKey) h["x-openrouter-key"] = s.openrouterKey;
  if (s.serperKey) h["x-serper-key"] = s.serperKey;
  return h;
}

async function postJson<T>(url: string, body: unknown, s: Settings): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: headers(s), body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

export interface ModelOption {
  id: string;
  name: string;
  free: boolean;
}

export const api = {
  resolve: (query: string, s: Settings) => postJson<ResolveResult>("/api/resolve", { query }, s),
  crawl: (website: string, s: Settings) => postJson<CrawlResult>("/api/crawl", { website }, s),
  analyze: (name: string, website: string, crawl: CrawlResult, s: Settings) =>
    postJson<{ profile: CompanyProfile; modelUsed: string }>(
      "/api/analyze",
      { name, website, crawl, model: s.model },
      s
    ),
  competitors: (profile: CompanyProfile, s: Settings) =>
    postJson<{ competitors: Competitor[]; modelUsed: string }>(
      "/api/competitors",
      {
        model: s.model,
        profile: {
          companyName: profile.companyName,
          website: profile.website,
          industry: profile.industry,
          hqCountry: profile.hqCountry,
          productsServices: profile.productsServices,
        },
      },
      s
    ),
  chat: (
    question: string,
    context: string,
    history: { role: "user" | "assistant"; content: string }[],
    s: Settings
  ) => postJson<{ answer: string }>("/api/chat", { question, context, history, model: s.model }, s),
  discord: (
    payload: {
      botToken?: string;
      channelId: string;
      applicantName: string;
      applicantEmail: string;
      companyName: string;
      companyWebsite: string;
      fileName: string;
      pdfBase64: string;
    },
    s: Settings
  ) => postJson<{ ok: boolean }>("/api/discord", payload, s),
  models: async (): Promise<ModelOption[]> => {
    const res = await fetch("/api/models");
    const data = (await res.json()) as { models?: ModelOption[] };
    return data.models ?? [];
  },
};

/* ---------- Chat message state ---------- */

export type StepId = "resolve" | "crawl" | "analyze" | "competitors";
export type StepStatus = "pending" | "active" | "done" | "error";

export interface StepState {
  id: StepId;
  label: string;
  status: StepStatus;
  detail?: string;
}

export type DiscordState = "idle" | "sending" | "sent" | "failed";

export interface ResearchMessage {
  id: string;
  kind: "research";
  query: string;
  steps: StepState[];
  report: ResearchReport | null;
  error: string | null;
  discord: DiscordState;
  discordError?: string;
}

export interface TextMessage {
  id: string;
  kind: "text";
  role: "user" | "assistant";
  text: string;
}

export type ChatMsg = ResearchMessage | TextMessage;

export function initialSteps(): StepState[] {
  return [
    { id: "resolve", label: "Finding official website", status: "active" },
    { id: "crawl", label: "Crawling website pages", status: "pending" },
    { id: "analyze", label: "AI analysis (OpenRouter)", status: "pending" },
    { id: "competitors", label: "Identifying competitors", status: "pending" },
  ];
}
