"use client";

import { CategoryId, moduleColor, ROLE_CATEGORY } from "@/lib/qr/roles";
import type { QRAnalysis, QRModule } from "@/lib/qr/types";
import { useCallback, useId, useMemo, useRef } from "react";

const QUIET = 4; // quiet-zone width in modules
const OUTLINE_STROKE = 0.1; // stroke width of the byte / mode / length outlines

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

/**
 * Trace the boundary of a set of unit cells as connected closed loops, drawn
 * exactly on the integer grid lines (so every edge is straight and axis
 * aligned). The result is used both as a stroke and as a clip region; the
 * caller clips the stroke to the cells so it stays inside them.
 */
function outlinePath(cells: [number, number][]): string {
  const cellKey = (r: number, c: number) => r * 1000 + c;
  const filled = new Set(cells.map(([r, c]) => cellKey(r, c)));
  const has = (r: number, c: number) => filled.has(cellKey(r, c));

  // Directed boundary edges, keyed by start vertex (walking a cell's edges
  // TL→TR→BR→BL→TL keeps the interior on a consistent side).
  const out = new Map<string, [number, number][]>();
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const k = `${x1},${y1}`;
    const list = out.get(k);
    if (list) list.push([x2, y2]);
    else out.set(k, [[x2, y2]]);
  };
  for (const [r, c] of cells) {
    if (!has(r - 1, c)) add(c, r, c + 1, r); // top
    if (!has(r, c + 1)) add(c + 1, r, c + 1, r + 1); // right
    if (!has(r + 1, c)) add(c + 1, r + 1, c, r + 1); // bottom
    if (!has(r, c - 1)) add(c, r + 1, c, r); // left
  }

  // Stitch edges into closed loops (every vertex has equal in/out degree, so
  // following unused edges from a start vertex returns to it).
  const loops: [number, number][][] = [];
  for (const startKey of out.keys()) {
    while ((out.get(startKey)?.length ?? 0) > 0) {
      const [sx, sy] = startKey.split(",").map(Number);
      const verts: [number, number][] = [[sx, sy]];
      let curKey = startKey;
      for (;;) {
        const nexts = out.get(curKey);
        if (!nexts || nexts.length === 0) break;
        const [nx, ny] = nexts.shift()!;
        curKey = `${nx},${ny}`;
        if (curKey === startKey) break; // closed — don't repeat the start
        verts.push([nx, ny]);
      }
      loops.push(verts);
    }
  }

  let d = "";
  for (const loop of loops) {
    // Drop collinear vertices so only true corners remain (shorter paths).
    const corners = loop.filter((cur, i) => {
      const prev = loop[(i - 1 + loop.length) % loop.length];
      const next = loop[(i + 1) % loop.length];
      return (
        (cur[0] - prev[0]) * (next[1] - cur[1]) -
          (cur[1] - prev[1]) * (next[0] - cur[0]) !==
        0
      );
    });
    if (corners.length < 3) continue;
    d +=
      `M${corners[0][0]} ${corners[0][1]}` +
      corners
        .slice(1)
        .map((p) => `L${p[0]} ${p[1]}`)
        .join("") +
      "Z";
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
  const uid = useId().replace(/:/g, ""); // unique, selector-safe clip ids

  // Outlines for the message bytes (one shared perimeter + single dividers
  // between adjacent characters, so shared edges aren't drawn twice), the
  // mode / length regions, and the per-character label positions.
  const overlays = useMemo(() => {
    const ck = (r: number, c: number) => r * 1000 + c;
    const modeCells: [number, number][] = [];
    const countCells: [number, number][] = [];
    const msgCells: [number, number][] = [];
    const byteOf = new Map<number, number>();
    for (const row of modules) {
      for (const m of row) {
        if (m.role === "mode") modeCells.push([m.row, m.col]);
        else if (m.role === "count") countCells.push([m.row, m.col]);
        else if (m.role === "message" && m.byteIndex != null) {
          msgCells.push([m.row, m.col]);
          byteOf.set(ck(m.row, m.col), m.byteIndex);
        }
      }
    }
    // Dividers between neighbouring cells of different characters, counted once
    // (look only right + down) and drawn centred on the shared grid line.
    let dividers = "";
    for (const [r, c] of msgCells) {
      const b = byteOf.get(ck(r, c));
      const right = byteOf.get(ck(r, c + 1));
      if (right !== undefined && right !== b) dividers += `M${c + 1} ${r}L${c + 1} ${r + 1}`;
      const down = byteOf.get(ck(r + 1, c));
      if (down !== undefined && down !== b) dividers += `M${c} ${r + 1}L${c + 1} ${r + 1}`;
    }

    const letters = characters
      .filter((ch) => ch.cells.length > 0)
      .map((ch) => {
        const [cx, cy] = centroid(ch.cells);
        return { char: ch.char, cx, cy };
      });

    return {
      msgUnion: outlinePath(msgCells),
      dividers,
      letters,
      modeUnion: modeCells.length ? outlinePath(modeCells) : null,
      countUnion: countCells.length ? outlinePath(countCells) : null,
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
      className="h-auto w-full select-none"
      shapeRendering="crispEdges"
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
    >
      {/* Quiet zone / background */}
      <rect x={0} y={0} width={dim} height={dim} fill="#ffffff" />

      <g transform={`translate(${QUIET} ${QUIET})`}>
        {modules.flat().map((m) => {
          const muted = highlight != null && ROLE_CATEGORY[m.role] !== highlight;
          // Muted modules drop to neutral greys so the highlighted category
          // stands out: dark pixels become #f1f1f1, light pixels #fefefe.
          const fill = muted
            ? m.dark
              ? "#f1f1f1"
              : "#fefefe"
            : moduleColor(m.role, m.dark);
          return (
            <rect
              key={`${m.row}-${m.col}`}
              x={m.col}
              y={m.row}
              width={1.02}
              height={1.02}
              fill={fill}
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

        {/* Byte footprints + characters. Each region's border is drawn on the
            grid lines (always straight) at double width and clipped to that
            region's cells, so only the inner half shows — a clean line sitting
            just inside the cells with no bleed or offset artefacts. */}
        {showChars && (
          <g shapeRendering="geometricPrecision">
            <defs>
              <clipPath id={`m${uid}`}>
                <path d={overlays.msgUnion} />
              </clipPath>
              {overlays.modeUnion && (
                <clipPath id={`o${uid}`}>
                  <path d={overlays.modeUnion} />
                </clipPath>
              )}
              {overlays.countUnion && (
                <clipPath id={`c${uid}`}>
                  <path d={overlays.countUnion} />
                </clipPath>
              )}
            </defs>

            <g clipPath={`url(#m${uid})`}>
              <path
                d={overlays.msgUnion}
                fill="none"
                stroke="#0fb880"
                strokeWidth={OUTLINE_STROKE * 2}
                strokeLinejoin="miter"
              />
              <path
                d={overlays.dividers}
                fill="none"
                stroke="#0fb880"
                strokeWidth={OUTLINE_STROKE}
                strokeLinecap="square"
              />
            </g>

            {overlays.modeUnion && (
              <g clipPath={`url(#o${uid})`}>
                <path
                  d={overlays.modeUnion}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={OUTLINE_STROKE * 2}
                  strokeLinejoin="miter"
                />
              </g>
            )}
            {overlays.countUnion && (
              <g clipPath={`url(#c${uid})`}>
                <path
                  d={overlays.countUnion}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={OUTLINE_STROKE * 2}
                  strokeLinejoin="miter"
                />
              </g>
            )}

            {overlays.letters.map((b, i) => (
              <text
                key={i}
                x={b.cx}
                y={b.cy}
                fontSize={1.5}
                fontFamily="var(--font-mono, monospace)"
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#0fb880"
              >
                {b.char === " " ? "␣" : b.char}
              </text>
            ))}
          </g>
        )}
      </g>
    </svg>
  );
}
