"use client";

import { ROLE_STYLES } from "@/lib/qr/roles";
import type { ModuleRole, QRAnalysis, QRModule } from "@/lib/qr/types";
import { useCallback, useRef } from "react";

const QUIET = 4; // quiet-zone width in modules

interface Props {
  analysis: QRAnalysis;
  showChars: boolean;
  /** When set, only modules of this role are shown at full strength. */
  highlightRole: ModuleRole | null;
  onHover: (module: QRModule | null) => void;
}

export default function QRGrid({
  analysis,
  showChars,
  highlightRole,
  onHover,
}: Props) {
  const { size, modules, characters } = analysis;
  const dim = size + QUIET * 2;
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const col = Math.floor(((e.clientX - rect.left) / rect.width) * dim - QUIET);
      const row = Math.floor(((e.clientY - rect.top) / rect.height) * dim - QUIET);
      if (row < 0 || col < 0 || row >= size || col >= size) {
        onHover(null);
        return;
      }
      onHover(modules[row][col]);
    },
    [dim, size, modules, onHover],
  );

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${dim} ${dim}`}
      className="h-auto w-full select-none rounded-xl"
      shapeRendering="crispEdges"
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
    >
      {/* Quiet zone / background */}
      <rect x={0} y={0} width={dim} height={dim} fill="#ffffff" />

      {modules.flat().map((m) => {
        const style = ROLE_STYLES[m.role];
        const fill = m.dark ? style.dark : style.light;
        const muted = highlightRole != null && m.role !== highlightRole;
        return (
          <rect
            key={`${m.row}-${m.col}`}
            x={m.col + QUIET}
            y={m.row + QUIET}
            width={1.02}
            height={1.02}
            fill={fill}
            opacity={muted ? 0.08 : 1}
          />
        );
      })}

      {showChars &&
        characters.map((ch) => {
          if (ch.cells.length === 0) return null;
          let sr = 0;
          let sc = 0;
          for (const [r, c] of ch.cells) {
            sr += r;
            sc += c;
          }
          const cx = sc / ch.cells.length + QUIET + 0.5;
          const cy = sr / ch.cells.length + QUIET + 0.5;
          const muted = highlightRole != null && highlightRole !== "message";
          return (
            <text
              key={`ch-${ch.index}`}
              x={cx}
              y={cy}
              fontSize={2.4}
              fontFamily="var(--font-mono, monospace)"
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#064e3b"
              opacity={muted ? 0.15 : 1}
              style={{ paintOrder: "stroke" }}
              stroke="#ffffff"
              strokeWidth={0.5}
            >
              {ch.char === " " ? "␣" : ch.char}
            </text>
          );
        })}
    </svg>
  );
}
