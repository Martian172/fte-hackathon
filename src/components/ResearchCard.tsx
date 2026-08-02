"use client";

import type { DiscordState, ResearchMessage, StepState } from "@/lib/client";

/**
 * The assistant's research message: live pipeline progress while running,
 * then the full report card (info grid, products, pain points, competitors, PDF/Discord).
 */

interface ResearchCardProps {
  msg: ResearchMessage;
  onDownloadPdf: (msg: ResearchMessage) => void;
  onRetry: (query: string) => void;
  onRetryDiscord: (msg: ResearchMessage) => void;
  discordConfigured: boolean;
}

const sectionLabel = "font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500";

function StepIcon({ status }: { status: StepState["status"] }) {
  if (status === "done")
    return <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] text-emerald-400">✓</span>;
  if (status === "active")
    return <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" aria-label="in progress" />;
  if (status === "error")
    return <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500/15 text-[10px] text-red-400">✕</span>;
  return <span className="h-4 w-4 rounded-full border border-zinc-700" />;
}

function DiscordStatus({ state, error, onRetry }: { state: DiscordState; error?: string; onRetry: () => void }) {
  if (state === "idle") return null;
  if (state === "sending")
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        Sending to Discord…
      </span>
    );
  if (state === "sent")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
        ✓ Sent to Discord
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
      Discord failed{error ? `: ${error}` : ""}
      <button onClick={onRetry} className="underline decoration-dotted underline-offset-2 hover:text-red-300">
        retry
      </button>
    </span>
  );
}

export default function ResearchCard({ msg, onDownloadPdf, onRetry, onRetryDiscord, discordConfigured }: ResearchCardProps) {
  const { report } = msg;

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#111113]">
      {/* Pipeline progress */}
      <div className={`space-y-2.5 px-4 py-3.5 ${report ? "border-b border-white/5" : ""}`}>
        {msg.steps.map((s) => (
          <div key={s.id} className="flex items-center gap-2.5">
            <StepIcon status={s.status} />
            <span className={`text-xs ${s.status === "pending" ? "text-zinc-600" : "text-zinc-300"}`}>{s.label}</span>
            {s.detail && <span className="truncate font-mono text-[10px] text-zinc-500">{s.detail}</span>}
          </div>
        ))}
        {msg.error && (
          <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-xs leading-relaxed text-red-300">{msg.error}</p>
            <button
              onClick={() => onRetry(msg.query)}
              className="mt-2 rounded-md border border-red-400/40 px-2.5 py-1 text-[11px] text-red-300 transition hover:bg-red-500/15"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Report */}
      {report && (
        <div className="space-y-5 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-xl font-semibold text-zinc-50 sm:text-2xl">{report.profile.companyName}</h2>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-emerald-400">
              Research complete
            </span>
            <a
              href={report.profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className="basis-full font-mono text-xs text-amber-400 hover:underline"
            >
              {report.profile.website}
            </a>
          </div>

          <p className="text-sm leading-relaxed text-zinc-300">{report.profile.summary}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["Phone", report.profile.phone],
                ["Address", report.profile.address],
                ["Industry", report.profile.industry],
                ["HQ Country", report.profile.hqCountry],
                ["Founded", report.profile.foundedYear],
                ["Founders", report.profile.founders?.join(", ") ?? null],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/10 bg-black/30 px-3.5 py-2.5">
                <p className={sectionLabel}>{k}</p>
                <p className={`mt-1 text-sm ${v ? "text-zinc-200" : "italic text-zinc-600"}`}>
                  {v ?? "Not publicly listed"}
                </p>
              </div>
            ))}
          </div>

          <div>
            <p className={sectionLabel}>Products &amp; Services</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {report.profile.productsServices.map((p) => (
                <span key={p} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200">
                  {p}
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className={sectionLabel}>AI-Generated Pain Points</p>
            <ul className="mt-2 space-y-2">
              {report.profile.painPoints.map((p) => (
                <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-zinc-300">
                  <span className="mt-px select-none text-amber-500">▸</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className={sectionLabel}>Competitors</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {report.competitors.map((c) => (
                <a
                  key={c.name}
                  href={c.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-lg border border-white/10 bg-black/30 p-3 transition hover:border-amber-500/40"
                >
                  <p className="text-sm font-medium text-zinc-100 group-hover:text-amber-400">{c.name}</p>
                  <p className="mt-0.5 truncate font-mono text-[10.5px] text-zinc-500">{c.website}</p>
                  {c.reason && <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{c.reason}</p>}
                </a>
              ))}
            </div>
          </div>

          {report.sources.length > 0 && (
            <details className="group">
              <summary className={`${sectionLabel} cursor-pointer list-none transition hover:text-zinc-300`}>
                Sources ({report.sources.length} pages crawled) ▾
              </summary>
              <ul className="mt-2 space-y-1">
                {report.sources.map((s) => (
                  <li key={s}>
                    <a href={s} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[10.5px] text-zinc-500 hover:text-amber-400">
                      {s}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
            <button
              onClick={() => onDownloadPdf(msg)}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-400"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Download PDF Report
            </button>
            <DiscordStatus state={msg.discord} error={msg.discordError} onRetry={() => onRetryDiscord(msg)} />
            {msg.discord === "idle" && !discordConfigured && (
              <span className="text-[10px] text-zinc-600">Configure Discord in the sidebar to auto-send reports</span>
            )}
            <span className="ml-auto text-right font-mono text-[9.5px] text-zinc-600">
              {report.modelUsed}
              {report.modelUsed !== report.requestedModel && (
                <span className="block text-amber-500/80">requested {report.requestedModel} — was unavailable</span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
