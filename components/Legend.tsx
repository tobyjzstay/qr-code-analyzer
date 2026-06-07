"use client";

import { CATEGORIES, CategoryId, ROLE_CATEGORY } from "@/lib/qr/roles";
import type { QRAnalysis } from "@/lib/qr/types";

interface Props {
  analysis: QRAnalysis;
  highlight: CategoryId | null;
  onHighlight: (id: CategoryId | null) => void;
}

export default function Legend({ analysis, highlight, onHighlight }: Props) {
  // Count modules per category so we can omit categories that don't appear
  // (e.g. no alignment pattern on a version 1 symbol).
  const counts = new Map<CategoryId, number>();
  for (const row of analysis.modules) {
    for (const m of row) {
      const id = ROLE_CATEGORY[m.role];
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return (
    <ul className="flex flex-col gap-1">
      {CATEGORIES.filter((c) => counts.get(c.id)).map((c) => {
        const active = highlight === c.id;
        return (
          <li key={c.id}>
            <button
              type="button"
              onMouseEnter={() => onHighlight(c.id)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => onHighlight(c.id)}
              onBlur={() => onHighlight(null)}
              className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                active
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
              }`}
            >
              <span
                className="mt-1 size-3 shrink-0 rounded-full"
                style={{ backgroundColor: c.dark }}
              />
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {c.label}
                  </span>
                  <span className="text-xs tabular-nums text-zinc-400">
                    {counts.get(c.id)}
                  </span>
                </span>
                <span className="block text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                  {c.description}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
