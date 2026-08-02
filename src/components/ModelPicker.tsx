"use client";

import { useMemo, useState } from "react";
import type { ModelOption } from "@/lib/client";

/**
 * Custom model picker (replaces the ugly native <select>):
 * trigger button → dark dropdown panel with a Free/All toggle bar, search box and
 * a scrollable list. The chosen model id drives every AI call in the app.
 */

interface ModelPickerProps {
  models: ModelOption[];
  value: string;
  onSelect: (id: string) => void;
}

export default function ModelPicker({ models, value, onSelect }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [freeOnly, setFreeOnly] = useState(true);
  const [query, setQuery] = useState("");

  const current = models.find((m) => m.id === value);
  const currentLabel = current?.name ?? value;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(
      (m) =>
        (!freeOnly || m.free) &&
        (!q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
    );
  }, [models, freeOnly, query]);

  const pick = (id: string) => {
    onSelect(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-left text-xs text-zinc-200 transition hover:border-amber-500/40"
      >
        <span className="flex-1 truncate">{currentLabel}</span>
        {current?.free && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-amber-400">
            free
          </span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          {/* Click-outside catcher */}
          <button aria-label="Close model list" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-lg border border-white/15 bg-[#141417] shadow-2xl shadow-black/60">
            {/* Free / All toggle bar */}
            <div className="grid grid-cols-2 gap-1 border-b border-white/10 p-1.5">
              {(
                [
                  [true, `Free tier (${models.filter((m) => m.free).length})`],
                  [false, "All models"],
                ] as const
              ).map(([isFree, labelText]) => (
                <button
                  key={labelText}
                  type="button"
                  onClick={() => setFreeOnly(isFree)}
                  className={`rounded-md py-1.5 font-mono text-[9.5px] uppercase tracking-widest transition ${
                    freeOnly === isFree ? "bg-amber-500 text-black" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {labelText}
                </button>
              ))}
            </div>
            <div className="border-b border-white/10 p-1.5">
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                aria-label="Search models"
                className="w-full rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-amber-500/50"
              />
            </div>
            <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
              {shown.length === 0 && (
                <li className="px-3 py-3 text-center text-[11px] text-zinc-600">No models match “{query}”</li>
              )}
              {shown.slice(0, 200).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={m.id === value}
                    onClick={() => pick(m.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-white/5 ${
                      m.id === value ? "bg-amber-500/10" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs ${m.id === value ? "text-amber-400" : "text-zinc-200"}`}>
                        {m.name}
                      </span>
                      <span className="block truncate font-mono text-[9px] text-zinc-600">{m.id}</span>
                    </span>
                    {m.free && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-amber-400">
                        free
                      </span>
                    )}
                    {m.id === value && <span className="text-xs text-amber-400">✓</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
