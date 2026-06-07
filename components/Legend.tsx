"use client";

import { ROLE_ORDER, ROLE_STYLES } from "@/lib/qr/roles";
import type { ModuleRole, QRAnalysis } from "@/lib/qr/types";

interface Props {
  analysis: QRAnalysis;
  highlightRole: ModuleRole | null;
  onHighlight: (role: ModuleRole | null) => void;
}

export default function Legend({ analysis, highlightRole, onHighlight }: Props) {
  // Count modules per role so we can hide roles that don't appear (e.g. no
  // version info below v7, no alignment on v1) and show how much space each uses.
  const counts = new Map<ModuleRole, number>();
  for (const row of analysis.modules) {
    for (const m of row) counts.set(m.role, (counts.get(m.role) ?? 0) + 1);
  }

  const groups: { title: string; key: "function" | "encoding" }[] = [
    { title: "Function patterns", key: "function" },
    { title: "Encoding region", key: "encoding" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.key}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {group.title}
          </h3>
          <ul className="flex flex-col gap-0.5">
            {ROLE_ORDER.filter(
              (role) => ROLE_STYLES[role].group === group.key && counts.get(role),
            ).map((role) => {
              const style = ROLE_STYLES[role];
              const active = highlightRole === role;
              return (
                <li key={role}>
                  <button
                    type="button"
                    onMouseEnter={() => onHighlight(role)}
                    onMouseLeave={() => onHighlight(null)}
                    onFocus={() => onHighlight(role)}
                    onBlur={() => onHighlight(null)}
                    className={`flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                      active ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span
                      className="mt-0.5 size-3.5 shrink-0 rounded-sm ring-1 ring-black/10"
                      style={{ backgroundColor: style.dark }}
                    />
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {style.label}
                        </span>
                        <span className="text-xs tabular-nums text-zinc-400">
                          {counts.get(role)}
                        </span>
                      </span>
                      <span className="block text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                        {style.description}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
