"use client";

import { analyze } from "@/lib/qr/analyze";
import { CategoryId, moduleColor, ROLE_INFO } from "@/lib/qr/roles";
import type { ECLevel, Overlay, QRAnalysis, QRModule } from "@/lib/qr/types";
import { useMemo, useState } from "react";
import Legend from "./Legend";
import QRGrid from "./QRGrid";

const EC_LEVELS: { value: ECLevel; label: string }[] = [
  { value: "L", label: "L · 7%" },
  { value: "M", label: "M · 15%" },
  { value: "Q", label: "Q · 25%" },
  { value: "H", label: "H · 30%" },
];

const OVERLAYS: { value: Overlay; label: string }[] = [
  { value: "chars", label: "Characters" },
  // { value: "direction", label: "Reading order" },
  { value: "bits", label: "Bit numbers" },
  { value: "none", label: "None" },
];

const DEFAULT_TEXT = "https://www.anthropic.com/claude-code";

export default function Analyzer() {
  // `bytes` is the source of truth for the encoded data; `text` mirrors it for
  // the input box. Flipping a bit edits `bytes` directly (the result may not be
  // valid text), so the two can diverge.
  const [text, setText] = useState(DEFAULT_TEXT);
  // undefined = auto-pick the smallest version that fits; a number (1-40)
  // forces that version.
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [bytes, setBytes] = useState<Uint8Array>(() =>
    new TextEncoder().encode(DEFAULT_TEXT),
  );
  const [ecLevel, setEcLevel] = useState<ECLevel>("M");
  // undefined = auto-pick the lowest-penalty mask; a number (0-7) forces that
  // mask, controlled by the Mask dropdown.
  const [mask, setMask] = useState<number | undefined>(undefined);
  // Which overlay to show on top of the symbol (mutually exclusive).
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [highlight, setHighlight] = useState<CategoryId | null>(null);
  const [hovered, setHovered] = useState<QRModule | null>(null);

  const { analysis, error } = useMemo(() => {
    if (bytes.length === 0) {
      return { analysis: null, error: "Type something to encode." };
    }
    try {
      return {
        analysis: analyze(bytes, { errorCorrectionLevel: ecLevel, mask, version }),
        error: null,
      };
    } catch (e) {
      return { analysis: null, error: (e as Error).message };
    }
  }, [bytes, ecLevel, mask, version]);

  const handleText = (value: string) => {
    setText(value);
    setBytes(new TextEncoder().encode(value));
  };

  // Flip a single message bit: edit the byte and recompute (the EC codewords
  // update). With a fixed mask the change stays local; on Auto the mask
  // re-optimises (usually unchanged for a single-bit edit).
  const toggleBit = (m: QRModule) => {
    if (m.role !== "message" || m.byteIndex == null || m.bitOfByte == null) return;
    const next = Uint8Array.from(bytes);
    next[m.byteIndex] ^= 1 << m.bitOfByte;
    setBytes(next);
    setText(new TextDecoder().decode(next));
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          QR Code Analyzer
        </h1>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Type any text and watch it get encoded into a real, scannable QR
          symbol. Hover the grid or the legend to explore,
          and click a message data module to flip its bit and watch the
          error-correction codewords recompute.
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Data
          </span>
          <input
            type="text"
            value={text}
            onChange={(e) => handleText(e.target.value)}
            placeholder="Enter a URL or any text…"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-700"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Version
          </span>
          <select
            value={version ?? "auto"}
            onChange={(e) =>
              setVersion(e.target.value === "auto" ? undefined : Number(e.target.value))
            }
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-700"
          >
            <option value="auto">Auto{analysis ? ` (${analysis.version})` : ""}</option>
            {Array.from({ length: 40 }, (_, i) => i + 1).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Error correction
          </span>
          <select
            value={ecLevel}
            onChange={(e) => setEcLevel(e.target.value as ECLevel)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-700"
          >
            {EC_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Mask
          </span>
          <select
            value={mask ?? "auto"}
            onChange={(e) =>
              setMask(e.target.value === "auto" ? undefined : Number(e.target.value))
            }
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-700"
          >
            <option value="auto">Auto{analysis ? ` (${analysis.maskPattern})` : ""}</option>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Overlay
          </span>
          <select
            value={overlay ?? "none"}
            onChange={(e) =>
              setOverlay(e.target.value as Overlay)
            }
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-700"
          >
            {OVERLAYS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      )}

      {analysis && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* QR + hovered readout */}
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
              <QRGrid
                analysis={analysis}
                showChars={overlay === "chars"}
                showDirection={overlay === "direction"}
                showBits={overlay === "bits"}
                highlight={highlight}
                onHover={setHovered}
                onToggle={toggleBit}
              />
            </div>
            <HoverReadout module={hovered} analysis={analysis} />
          </div>

          {/* Stats + legend */}
          <aside className="flex flex-col gap-6">
            <Stats analysis={analysis} />
            <Legend analysis={analysis} highlight={highlight} onHighlight={setHighlight} />
          </aside>
        </div>
      )}
    </div>
  );
}

function HoverReadout({
  module,
  analysis,
}: {
  module: QRModule | null;
  analysis: QRAnalysis;
}) {
  if (!module) {
    return (
      <p className="px-1 text-sm text-zinc-400">
        Hover over a module to inspect it.
      </p>
    );
  }
  const info = ROLE_INFO[module.role];
  const details: string[] = [`row ${module.row + 1}, col ${module.col + 1}`];
  details.push(module.dark ? "(1)" : "(0)");
  if (module.codewordIndex != null) {
    details.push(`codeword #${module.codewordIndex}`);
    if (analysis.blocks > 1 && module.blockIndex != null) {
      details.push(`block ${module.blockIndex + 1}/${analysis.blocks}`);
    }
    if (module.bitIndex != null) details.push(`bit ${7 - module.bitIndex}`);
  }
  if (module.role === "message" && module.byteIndex != null) {
    const ch = analysis.characters[module.byteIndex];
    if (ch) details.push(`“${ch.char}” (0x${ch.code.toString(16).padStart(2, "0")})`);
    details.push("click to flip");
  }

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <span
        className="mt-0.5 size-3.5 shrink-0 rounded-sm ring-1 ring-black/10"
        style={{ backgroundColor: moduleColor(module.role, true) }}
      />
      <span className="min-w-0">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          {info.label}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400"> — {details.join(" · ")}</span>
      </span>
    </div>
  );
}

function Stats({ analysis }: { analysis: QRAnalysis }) {
  const { ecLevelBits, maskBits, ecBits } = analysis.formatGroups;
  const rows: [string, string][] = [
    ["Version", `${analysis.version}`],
    ["Size", `${analysis.size} × ${analysis.size}`],
    ["EC level", analysis.errorCorrectionLevel],
    ["Mask", `${analysis.maskPattern}`],
    ["Input", `${analysis.byteCount} byte${analysis.byteCount === 1 ? "" : "s"}`],
    ["Data codewords", `${analysis.dataCodewords}`],
    ["EC codewords", `${analysis.ecCodewords}`],
    [
      "Blocks",
      analysis.blocks === 1 ? "1" : `${analysis.blocks} × ${analysis.ecPerBlock} EC`,
    ],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-xs uppercase tracking-wide text-zinc-400">{k}</dt>
          <dd className="text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
            {v}
          </dd>
        </div>
      ))}
      <div className="col-span-2 mt-4 border-t pt-4">
        <dt className="text-xs uppercase tracking-wide text-zinc-400">Format information</dt>
        <div className="flex flex-col gap-2.5">
          <dd className="flex flex-col gap-1">
            <Bits bits={ecLevelBits} />
            <span className="text-xs text-zinc-500">
              Error-correction level ({analysis.errorCorrectionLevel})
            </span>
          </dd>
          <dd className="flex flex-col gap-1">
            <Bits bits={maskBits} />
            <span className="text-xs text-zinc-500">
              Mask pattern ({analysis.maskPattern})
            </span>
          </dd>
          <dd className="flex flex-col gap-1">
            <Bits bits={ecBits} />
            <span className="text-xs text-zinc-500">
              Error-correction format (BCH)
            </span>
          </dd>
        </div>
      </div>
    </dl>
  );
}

function Bits({ bits }: { bits: string }) {
  return (
    <span className="flex gap-0.5">
      {bits.split("").map((b, i) => (
        <span
          key={i}
          className={`flex size-5 items-center justify-center rounded-[3px] font-mono text-xs ${
            b === "1"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700"
          }`}
        >
          {b}
        </span>
      ))}
    </span>
  );
}

function FormatInfo({ analysis }: { analysis: QRAnalysis }) {
  const { ecLevelBits, maskBits, ecBits } = analysis.formatGroups;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Format information
      </h3>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          <Bits bits={ecLevelBits} />
          <span className="text-xs text-zinc-500">
            Error-correction level ({analysis.errorCorrectionLevel})
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <Bits bits={maskBits} />
          <span className="text-xs text-zinc-500">
            Mask pattern ({analysis.maskPattern})
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <Bits bits={ecBits} />
          <span className="text-xs text-zinc-500">
            Error-correction format (BCH)
          </span>
        </div>
      </div>
    </div>
  );
}
