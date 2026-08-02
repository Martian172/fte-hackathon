"use client";

import { useState } from "react";
import ModelPicker from "@/components/ModelPicker";
import type { ModelOption, Settings } from "@/lib/client";

/**
 * Settings sidebar — API keys + model selection and the Discord (bonus) configuration,
 * mirroring the reference layout: two tabs, explicit Save buttons, "how it works" steps.
 * Keys persist in localStorage only (browser-side), never in the repo.
 */

interface SidebarProps {
  settings: Settings;
  models: ModelOption[];
  onChange: (patch: Partial<Settings>) => void;
  onSave: () => void;
  onNewResearch: () => void;
}

const label = "font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500";
const input =
  "w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none transition focus:border-amber-500/60";

export default function Sidebar({ settings, models, onChange, onSave, onNewResearch }: SidebarProps) {
  const [tab, setTab] = useState<"api" | "discord">("api");
  const [saved, setSaved] = useState(false);

  const save = () => {
    onSave();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };


  return (
    <div className="flex h-full flex-col overflow-y-auto border-r border-white/10 bg-[#0d0d0f]">
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 font-bold text-black">
          ⌕
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-100">Research AI</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
            Company Intelligence
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <button
          onClick={onNewResearch}
          className="w-full rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-medium text-zinc-200 transition hover:border-amber-500/40 hover:bg-white/10"
        >
          + New Research
        </button>

        {/* Tab switcher */}
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/30 p-1">
          {(["api", "discord"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md py-1.5 font-mono text-[10px] uppercase tracking-widest transition ${
                tab === t ? "bg-amber-500 text-black" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t === "api" ? "API" : "Discord"}
            </button>
          ))}
        </div>

        {tab === "api" ? (
          <div className="flex flex-col gap-3.5">
            <div className="space-y-1.5">
              <label htmlFor="or-key" className={label}>OpenRouter API key</label>
              <input
                id="or-key"
                type="password"
                autoComplete="off"
                placeholder="sk-or-v1-…"
                value={settings.openrouterKey}
                onChange={(e) => onChange({ openrouterKey: e.target.value })}
                className={input}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="serper-key" className={label}>Serper.dev API key</label>
              <input
                id="serper-key"
                type="password"
                autoComplete="off"
                placeholder="Your Serper key…"
                value={settings.serperKey}
                onChange={(e) => onChange({ serperKey: e.target.value })}
                className={input}
              />
            </div>
            <div className="space-y-1.5">
              <label className={label}>AI model</label>
              <ModelPicker models={models} value={settings.model} onSelect={(id) => onChange({ model: id })} />
              <p className="text-[10px] leading-relaxed text-zinc-600">
                Every research runs on the selected model. If it&apos;s rate-limited, the app
                falls back to the next free model and clearly labels the result.
              </p>
            </div>
            <button
              onClick={save}
              className="w-full rounded-lg bg-amber-500 py-2 text-xs font-semibold text-black transition hover:bg-amber-400"
            >
              {saved ? "Saved ✓" : "Save Configuration"}
            </button>
            <p className="text-[10px] leading-relaxed text-zinc-600">
              Keys are stored in your browser only and sent solely to this app&apos;s own API.
              Leave blank to use the server&apos;s configured keys.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            <div className="rounded-lg border border-indigo-400/25 bg-indigo-500/10 p-3">
              <p className="text-[11px] font-medium text-indigo-300">Discord Bot Integration</p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">
                After research completes, the report auto-sends to your configured channel.
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="bot-token" className={label}>Bot token</label>
              <input
                id="bot-token"
                type="password"
                autoComplete="off"
                placeholder="Bot token…"
                value={settings.discordBotToken}
                onChange={(e) => onChange({ discordBotToken: e.target.value })}
                className={input}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="channel-id" className={label}>Channel ID</label>
              <input
                id="channel-id"
                inputMode="numeric"
                placeholder="000000000000000000"
                value={settings.discordChannelId}
                onChange={(e) => onChange({ discordChannelId: e.target.value })}
                className={input}
              />
            </div>
            <p className={label}>Applicant details</p>
            <div className="space-y-1.5">
              <label htmlFor="app-name" className="text-[11px] text-zinc-400">Full name</label>
              <input
                id="app-name"
                placeholder="Your full name"
                value={settings.applicantName}
                onChange={(e) => onChange({ applicantName: e.target.value })}
                className={input}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="app-email" className="text-[11px] text-zinc-400">Email address</label>
              <input
                id="app-email"
                type="email"
                placeholder="email@example.com"
                value={settings.applicantEmail}
                onChange={(e) => onChange({ applicantEmail: e.target.value })}
                className={input}
              />
            </div>
            <button
              onClick={save}
              className="w-full rounded-lg bg-indigo-500 py-2 text-xs font-semibold text-white transition hover:bg-indigo-400"
            >
              {saved ? "Saved ✓" : "Save Discord Config"}
            </button>
          </div>
        )}

        {/* How it works */}
        <div className="mt-auto space-y-2 pt-4">
          <p className={label}>How it works</p>
          {[
            "Enter a company name or URL",
            "Serper.dev searches and crawls it",
            "OpenRouter AI generates insights",
            "Download a professional PDF report",
          ].map((step, i) => (
            <div key={step} className="flex items-start gap-2">
              <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded bg-amber-500/15 font-mono text-[9px] text-amber-400">
                {i + 1}
              </span>
              <p className="text-[10.5px] leading-relaxed text-zinc-400">{step}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="border-t border-white/10 px-4 py-3 text-center font-mono text-[9px] uppercase tracking-[0.25em] text-zinc-600">
        OpenRouter · Serper · jsPDF
      </p>
    </div>
  );
}
