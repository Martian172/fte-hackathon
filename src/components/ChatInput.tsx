"use client";

import { useRef, useState } from "react";

/**
 * Bottom composer. When a report exists the user can switch between researching a
 * new company and asking follow-up questions about the last one — an explicit toggle
 * beats guessing intent from the text.
 */

export type InputMode = "research" | "chat";

interface ChatInputProps {
  busy: boolean;
  hasReport: boolean;
  companyName: string | null;
  onSubmit: (text: string, mode: InputMode) => void;
}

export default function ChatInput({ busy, hasReport, companyName, onSubmit }: ChatInputProps) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<InputMode>("research");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const effectiveMode: InputMode = hasReport ? mode : "research";

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSubmit(value, effectiveMode);
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  return (
    <div className="border-t border-white/10 bg-[#0a0a0a]/90 px-3 pb-3 pt-2.5 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-3xl">
        {hasReport && (
          <div className="mb-2 flex gap-1">
            {(
              [
                ["research", "New research"],
                ["chat", `Ask about ${companyName ?? "this company"}`],
              ] as const
            ).map(([m, labelText]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
                  effectiveMode === m
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
                    : "border-white/10 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {labelText}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2 rounded-xl border border-white/10 bg-[#141417] p-2 transition focus-within:border-amber-500/50"
        >
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            disabled={busy}
            placeholder={
              effectiveMode === "chat"
                ? `Ask a follow-up about ${companyName ?? "the company"}…`
                : "Enter a company name (e.g. Stripe) or website URL (e.g. https://stripe.com)…"
            }
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="max-h-[120px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none disabled:opacity-50"
            aria-label="Company name or website URL"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition enabled:hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/50 border-t-transparent" />
                Working…
              </span>
            ) : effectiveMode === "chat" ? (
              "Ask →"
            ) : (
              "Research →"
            )}
          </button>
        </form>
        <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.25em] text-zinc-600">
          Enter to {effectiveMode === "chat" ? "ask" : "research"} · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
