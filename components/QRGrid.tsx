"use client";

import { CategoryId, moduleColor, ROLE_CATEGORY } from "@/lib/qr/roles";
import type { QRAnalysis, QRModule } from "@/lib/qr/types";
import { useCallback, useMemo, useRef } from "react";

const QUIET = 4; // quiet-zone width in modules

interface Props {
  analysis: QRAnalysis;
  /** Outline each byte's footprint and draw its character. */
  showChars: boolean;
  /** Draw arrows showing the order data is placed in. */
  showDirection: boolean;
  /** When set, only modules of this category are shown at full strength. */
  highlight: CategoryId | null;
  onHover: (module: QRModule | null) => void;
}

/** Build an SVG path that traces the boundary of a set of unit cells. */
function outlinePath(cells: [number, number][]): string {
  const key = (r: number, c: number) => r * 1000 + c;
  const set = new Set(cells.map(([r, c]) => key(r, c)));
  let d = "";
  for (const [r, c] of cells) {
    if (!set.has(key(r - 1, c))) d += `M${c} ${r}h1`; // top
    if (!set.has(key(r + 1, c))) d += `M${c} ${r + 1}h1`; // bottom
    if (!set.has(key(r, c - 1))) d += `M${c} ${r}v1`; // left
    if (!set.has(key(r, c + 1))) d += `M${c + 1} ${r}v1`; // right
  }
  return d;
}

function centroid(cells: [number, number][]): [number, number] {
  let sr = 0;
  let sc = 0;
  for (const [r, c] of cells) {
    sr += r + 0.5;
    sc += c + 0.5;
  }
  return [sc / cells.length, sr / cells.length];
}

/** Triangle points for an arrowhead whose tip sits at (x2,y2). */
function arrowHead(x1: number, y1: number, x2: number, y2: number, size = 0.7): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x2 - ux * size;
  const by = y2 - uy * size;
  const half = size * 0.42;
  return `${x2},${y2} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`;
}

export default function QRGrid({
  analysis,
  showChars,
  showDirection,
  highlight,
  onHover,
}: Props) {
  const { size, modules, characters } = analysis;
  const dim = size + QUIET * 2;
  const svgRef = useRef<SVGSVGElement>(null);

  // Footprint outlines for each message byte, plus the mode / length regions.
  const overlays = useMemo(() => {
    const modeCells: [number, number][] = [];
    const countCells: [number, number][] = [];
    for (const row of modules) {
      for (const m of row) {
        if (m.role === "mode") modeCells.push([m.row, m.col]);
        else if (m.role === "count") countCells.push([m.row, m.col]);
      }
    }
    const bytes = characters
      .filter((ch) => ch.cells.length > 0)
      .map((ch) => {
        const [cx, cy] = centroid(ch.cells);
        return { char: ch.char, path: outlinePath(ch.cells), cx, cy };
      });
    return {
      bytes,
      mode: modeCells.length
        ? { path: outlinePath(modeCells), c: centroid(modeCells) }
        : null,
      count: countCells.length
        ? { path: outlinePath(countCells), c: centroid(countCells) }
        : null,
    };
  }, [modules, characters]);

  // Centroid of each codeword, in placement order, for the direction arrows.
  const arrows = useMemo(() => {
    const acc = new Map<number, { sr: number; sc: number; n: number }>();
    for (const row of modules) {
      for (const m of row) {
        if (m.codewordIndex == null) continue;
        const a = acc.get(m.codewordIndex) ?? { sr: 0, sc: 0, n: 0 };
        a.sr += m.row + 0.5;
        a.sc += m.col + 0.5;
        a.n += 1;
        acc.set(m.codewordIndex, a);
      }
    }
    const pts = [...acc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, a]) => ({ x: a.sc / a.n, y: a.sr / a.n }));
    const segs: { x1: number; y1: number; x2: number; y2: number; start: boolean }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push({ x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y, start: i === 0 });
    }
    return { segs, first: pts[0] ?? null };
  }, [modules]);

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

      <g transform={`translate(${QUIET} ${QUIET})`}>
        {modules.flat().map((m) => {
          const muted = highlight != null && ROLE_CATEGORY[m.role] !== highlight;
          return (
            <rect
              key={`${m.row}-${m.col}`}
              x={m.col}
              y={m.row}
              width={1.02}
              height={1.02}
              fill={moduleColor(m.role, m.dark)}
              opacity={muted ? 0.08 : 1}
            />
          );
        })}

        {/* Reading-order arrows */}
        {showDirection && (
          <g shapeRendering="geometricPrecision">
            {arrows.first && (
              <circle cx={arrows.first.x} cy={arrows.first.y} r={0.35} fill="#2563eb" />
            )}
            {arrows.segs.map((s, i) => {
              const color = s.start ? "#2563eb" : "#059669";
              return (
                <g key={i}>
                  <line
                    x1={s.x1}
                    y1={s.y1}
                    x2={s.x2}
                    y2={s.y2}
                    stroke={color}
                    strokeWidth={0.16}
                    strokeLinecap="round"
                    opacity={0.85}
                  />
                  <polygon points={arrowHead(s.x1, s.y1, s.x2, s.y2)} fill={color} />
                </g>
              );
            })}
          </g>
        )}

        {/* Byte footprints + characters */}
        {showChars && (
          <g shapeRendering="geometricPrecision">
            {overlays.mode && (
              <path d={overlays.mode.path} fill="none" stroke="#2563eb" strokeWidth={0.18} />
            )}
            {overlays.count && (
              <>
                <path
                  d={overlays.count.path}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={0.18}
                />
                <text
                  x={overlays.count.c[0]}
                  y={overlays.count.c[1]}
                  fontSize={2}
                  fontFamily="var(--font-mono, monospace)"
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#1d4ed8"
                  style={{ paintOrder: "stroke" }}
                  stroke="#ffffff"
                  strokeWidth={0.5}
                >
                  {analysis.byteCount}
                </text>
              </>
            )}
            {overlays.bytes.map((b, i) => (
              <g key={i}>
                <path d={b.path} fill="none" stroke="#059669" strokeWidth={0.18} />
                <text
                  x={b.cx}
                  y={b.cy}
                  fontSize={2.2}
                  fontFamily="var(--font-mono, monospace)"
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#065f46"
                  style={{ paintOrder: "stroke" }}
                  stroke="#ffffff"
                  strokeWidth={0.55}
                >
                  {b.char === " " ? "␣" : b.char}
                </text>
              </g>
            ))}
          </g>
        )}
      </g>
    </svg>
  );
}
