"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChatInput, { type InputMode } from "@/components/ChatInput";
import ResearchCard from "@/components/ResearchCard";
import Sidebar from "@/components/Sidebar";
import {
  api,
  DEFAULT_SETTINGS,
  initialSteps,
  loadSettings,
  saveSettings,
  type ChatMsg,
  type ModelOption,
  type ResearchMessage,
  type Settings,
  type StepId,
} from "@/lib/client";
import { blobToBase64, buildPdf, downloadBlob } from "@/lib/pdf";
import type { ResearchReport } from "@/lib/types";

/**
 * Main page: sidebar + ChatGPT-style thread.
 * The research pipeline runs client-side as four sequential API calls so each step
 * paints live progress; Discord auto-send fires after a report completes.
 */

const EXAMPLES = ["Stripe", "Tesla", "Notion", "https://vercel.com"];

export default function Home() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const chatHistoryRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Settings load after mount (localStorage is browser-only — avoids hydration mismatch)
  useEffect(() => {
    setSettings(loadSettings());
    api.models().then(setModels).catch(() => setModels([]));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const patchSettings = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  const updateResearch = useCallback((id: string, updater: (m: ResearchMessage) => ResearchMessage) => {
    setMessages((msgs) => msgs.map((m) => (m.id === id && m.kind === "research" ? updater(m) : m)));
  }, []);

  const setStep = useCallback(
    (id: string, step: StepId, status: "active" | "done" | "error", detail?: string) => {
      updateResearch(id, (m) => ({
        ...m,
        steps: m.steps.map((s) => (s.id === step ? { ...s, status, detail: detail ?? s.detail } : s)),
      }));
    },
    [updateResearch]
  );

  const lastReport =
    [...messages].reverse().find((m): m is ResearchMessage => m.kind === "research" && !!m.report)?.report ?? null;

  /** Discord auto-send: build the same PDF the user downloads and post it via our API. */
  const sendToDiscord = useCallback(
    async (msgId: string, report: ResearchReport) => {
      const s = settingsRef.current;
      if (!s.discordChannelId || !s.applicantName || !s.applicantEmail) return; // not configured
      updateResearch(msgId, (m) => ({ ...m, discord: "sending" }));
      try {
        const { blob, fileName } = buildPdf(report);
        await api.discord(
          {
            botToken: s.discordBotToken || undefined,
            channelId: s.discordChannelId,
            applicantName: s.applicantName,
            applicantEmail: s.applicantEmail,
            companyName: report.profile.companyName,
            companyWebsite: report.profile.website,
            fileName,
            pdfBase64: await blobToBase64(blob),
          },
          s
        );
        updateResearch(msgId, (m) => ({ ...m, discord: "sent", discordError: undefined }));
      } catch (err) {
        updateResearch(msgId, (m) => ({
          ...m,
          discord: "failed",
          discordError: err instanceof Error ? err.message : "unknown error",
        }));
      }
    },
    [updateResearch]
  );

  const runResearch = useCallback(
    async (query: string) => {
      const id = crypto.randomUUID();
      setMessages((msgs) => [
        ...msgs,
        { id: crypto.randomUUID(), kind: "text", role: "user", text: query },
        { id, kind: "research", query, steps: initialSteps(), report: null, error: null, discord: "idle" },
      ]);
      setBusy(true);
      try {
        const s = settingsRef.current;

        // 1. Resolve official website (Serper.dev, unless input is already a URL)
        const resolved = await api.resolve(query, s);
        setStep(id, "resolve", "done", new URL(resolved.website).hostname);

        // 2. Crawl important pages
        setStep(id, "crawl", "active");
        const crawl = await api.crawl(resolved.website, s);
        setStep(id, "crawl", "done", crawl.warning ?? `${crawl.visited} pages analyzed`);

        // 3. AI analysis (OpenRouter) — label transparently if a fallback model ran
        setStep(id, "analyze", "active");
        const { profile, modelUsed } = await api.analyze(resolved.name, resolved.website, crawl, s);
        const modelNote = modelUsed === s.model ? modelUsed : `${modelUsed} (fallback — ${s.model} unavailable)`;
        setStep(id, "analyze", "done", modelNote);

        // 4. Competitor identification
        setStep(id, "competitors", "active");
        const comp = await api.competitors(profile, s);
        setStep(id, "competitors", "done", `${comp.competitors.length} found`);

        const report: ResearchReport = {
          profile,
          competitors: comp.competitors,
          modelUsed,
          requestedModel: s.model,
          generatedAt: new Date().toISOString(),
          sources: crawl.pages.map((p) => p.url),
        };
        updateResearch(id, (m) => ({ ...m, report }));
        chatHistoryRef.current = []; // follow-up chat starts fresh per company
        void sendToDiscord(id, report);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        updateResearch(id, (m) => ({
          ...m,
          error: message,
          steps: m.steps.map((s) => (s.status === "active" ? { ...s, status: "error" } : s)),
        }));
      } finally {
        setBusy(false);
      }
    },
    [sendToDiscord, setStep, updateResearch]
  );

  /** Follow-up Q&A grounded in the latest report. */
  const runChat = useCallback(
    async (question: string) => {
      if (!lastReport) return;
      setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "text", role: "user", text: question }]);
      setBusy(true);
      try {
        const context = JSON.stringify(lastReport).slice(0, 28_000);
        const { answer } = await api.chat(question, context, chatHistoryRef.current.slice(-8), settingsRef.current);
        chatHistoryRef.current.push({ role: "user", content: question }, { role: "assistant", content: answer });
        setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "text", role: "assistant", text: answer }]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Chat failed.";
        setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "text", role: "assistant", text: `⚠ ${message}` }]);
      } finally {
        setBusy(false);
      }
    },
    [lastReport]
  );

  const onSubmit = (text: string, mode: InputMode) => {
    if (mode === "chat") void runChat(text);
    else void runResearch(text);
  };

  const onDownloadPdf = (msg: ResearchMessage) => {
    if (!msg.report) return;
    const { blob, fileName } = buildPdf(msg.report);
    downloadBlob(blob, fileName);
  };

  const discordConfigured = Boolean(settings.discordChannelId && settings.applicantName && settings.applicantEmail);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar — static on desktop, slide-over on mobile */}
      <aside className="hidden w-72 shrink-0 md:block">
        <Sidebar
          settings={settings}
          models={models}
          onChange={patchSettings}
          onSave={() => saveSettings(settingsRef.current)}
          onNewResearch={() => setMessages([])}
        />
      </aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button aria-label="Close settings" className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72">
            <Sidebar
              settings={settings}
              models={models}
              onChange={patchSettings}
              onSave={() => saveSettings(settingsRef.current)}
              onNewResearch={() => {
                setMessages([]);
                setSidebarOpen(false);
              }}
            />
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
          <button
            className="rounded-md border border-white/10 p-1.5 text-zinc-400 transition hover:text-zinc-100 md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>
          <p className="text-sm font-medium text-zinc-200">Company Research</p>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Live
          </span>
        </header>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-amber-500">AI-powered intelligence</p>
              <h1 className="max-w-xl text-4xl font-semibold leading-tight text-zinc-50 sm:text-5xl">
                Know any company <span className="text-amber-500">in minutes.</span>
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-zinc-400">
                Enter a company name or website URL to get AI-powered insights, competitor analysis,
                pain points, and a professional PDF report.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {EXAMPLES.map((e) => (
                  <button
                    key={e}
                    onClick={() => void runResearch(e)}
                    disabled={busy}
                    className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 font-mono text-xs text-zinc-300 transition hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-40"
                  >
                    {e}
                  </button>
                ))}
              </div>
              <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-zinc-600">
                — Configure API keys in the sidebar to get started —
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-5 sm:px-6">
              {messages.map((m) =>
                m.kind === "research" ? (
                  <ResearchCard
                    key={m.id}
                    msg={m}
                    onDownloadPdf={onDownloadPdf}
                    onRetry={(q) => void runResearch(q)}
                    onRetryDiscord={(msg) => msg.report && void sendToDiscord(msg.id, msg.report)}
                    discordConfigured={discordConfigured}
                  />
                ) : (
                  <div
                    key={m.id}
                    className={
                      m.role === "user"
                        ? "self-end rounded-2xl rounded-br-sm border border-white/10 bg-[#1c1c20] px-4 py-2.5 text-sm text-zinc-100 sm:max-w-[80%]"
                        : "self-start whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-white/10 bg-[#111113] px-4 py-3 text-sm leading-relaxed text-zinc-300 sm:max-w-[90%]"
                    }
                  >
                    {m.text}
                  </div>
                )
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <ChatInput
          busy={busy}
          hasReport={!!lastReport}
          companyName={lastReport?.profile.companyName ?? null}
          modelLabel={models.find((m) => m.id === settings.model)?.name ?? settings.model}
          onSubmit={onSubmit}
        />
      </main>
    </div>
  );
}
