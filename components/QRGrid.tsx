"use client";

import { CategoryId, moduleColor, ROLE_CATEGORY } from "@/lib/qr/roles";
import type { QRAnalysis, QRModule } from "@/lib/qr/types";
import { useCallback, useId, useMemo, useRef, useState } from "react";

const QUIET = 4; // quiet-zone width in modules
const OUTLINE_STROKE = 0.1; // stroke width of the byte / mode / length outlines

// Segment groups and their colours. "data" = message + padding (green),
// "header" = mode + length indicator (blue), "ec" = error correction (purple).
type SegmentId = "data" | "header" | "ec";
const OUTLINE_COLOR: Record<SegmentId, string> = {
  data: "#0fb880",
  header: "#3b82f6",
  ec: "#7c3aed",
};

interface Props {
  analysis: QRAnalysis;
  /** Outline each byte's footprint and draw its character. */
  showChars: boolean;
  /** Draw arrows showing the order data is placed in. */
  showDirection: boolean;
  /** When set, only modules of this category are shown at full strength. */
  highlight: CategoryId | null;
  onHover: (module: QRModule | null) => void;
  /** Called when a message module is clicked, to flip its bit. */
  onToggle: (module: QRModule) => void;
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

/** Unicode arrow glyph for a cardinal direction (y grows downward). */
function arrowGlyph(dx: number, dy: number): string {
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "▲" : "▼";
  return dx < 0 ? "◄" : "►";
}

export default function QRGrid({
  analysis,
  showChars,
  showDirection,
  highlight,
  onHover,
  onToggle,
}: Props) {
  const { size, modules, characters } = analysis;
  const dim = size + QUIET * 2;
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, ""); // unique, selector-safe clip ids

  // Outlines for each segment group, coloured by category. Each group gets one
  // shared perimeter (clipped to its cells) plus single dividers between its
  // units (message bytes, or individual codewords), so shared edges aren't
  // drawn twice. Also the per-character label positions.
  const overlays = useMemo(() => {
    const ck = (r: number, c: number) => r * 1000 + c;
    const cells: Record<SegmentId, [number, number][]> = { data: [], header: [], ec: [] };
    const unit = new Map<number, string>(); // cellKey -> unit id (for dividers)

    for (const row of modules) {
      for (const m of row) {
        let group: SegmentId | null = null;
        let u = "";
        switch (m.role) {
          case "message":
            group = "data";
            u = `b${m.byteIndex}`;
            break;
          case "padding":
          case "terminator":
          case "remainder":
            group = "data";
            u = `d${m.codewordIndex ?? `${m.row}_${m.col}`}`;
            break;
          case "mode":
            group = "header";
            u = "mode";
            break;
          case "count":
            group = "header";
            u = "count";
            break;
          case "ec":
            group = "ec";
            u = `e${m.codewordIndex}`;
            break;
        }
        if (!group) continue;
        cells[group].push([m.row, m.col]);
        unit.set(ck(m.row, m.col), u);
      }
    }

    const groups = (["data", "header", "ec"] as SegmentId[])
      .map((id) => {
        const cs = cells[id];
        if (cs.length === 0) return null;
        const inGroup = new Set(cs.map(([r, c]) => ck(r, c)));
        // Dividers between adjacent cells of different units within this group.
        let dividers = "";
        for (const [r, c] of cs) {
          const u = unit.get(ck(r, c));
          const rk = ck(r, c + 1);
          if (inGroup.has(rk) && unit.get(rk) !== u) dividers += `M${c + 1} ${r}L${c + 1} ${r + 1}`;
          const dk = ck(r + 1, c);
          if (inGroup.has(dk) && unit.get(dk) !== u) dividers += `M${c} ${r + 1}L${c + 1} ${r + 1}`;
        }
        return { id, union: outlinePath(cs), dividers };
      })
      .filter((g): g is { id: SegmentId; union: string; dividers: string } => g !== null);

    const letters = characters
      .filter((ch) => ch.cells.length > 0)
      .map((ch) => {
        const [cx, cy] = centroid(ch.cells);
        return { char: ch.char, cx, cy };
      });

    return { groups, letters };
  }, [modules, characters]);

  // Reading order: one arrow glyph per codeword at its centroid, pointing in
  // its cardinal direction of travel and coloured by segment.
  const arrows = useMemo(() => {
    const acc = new Map<
      number,
      { sr: number; sc: number; n: number; ec: boolean; msg: boolean; hdr: boolean }
    >();
    for (const row of modules) {
      for (const m of row) {
        if (m.codewordIndex == null) continue;
        const a =
          acc.get(m.codewordIndex) ??
          { sr: 0, sc: 0, n: 0, ec: false, msg: false, hdr: false };
        a.sr += m.row + 0.5;
        a.sc += m.col + 0.5;
        a.n += 1;
        if (m.role === "ec") a.ec = true;
        else if (m.role === "message") a.msg = true;
        else if (m.role === "mode" || m.role === "count") a.hdr = true;
        acc.set(m.codewordIndex, a);
      }
    }
    const pts = [...acc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, a]) => ({
        x: a.sc / a.n,
        y: a.sr / a.n,
        color: (a.ec ? "ec" : a.msg ? "data" : a.hdr ? "header" : "data") as SegmentId,
      }));

    return pts.map((p, i) => {
      const next = pts[i + 1] ?? p;
      const prev = pts[i - 1] ?? p;
      // direction of travel: toward the next codeword (or from the previous one
      // for the final codeword)
      const dx = i < pts.length - 1 ? next.x - p.x : p.x - prev.x;
      const dy = i < pts.length - 1 ? next.y - p.y : p.y - prev.y;
      return { x: p.x, y: p.y, glyph: arrowGlyph(dx, dy), color: p.color };
    });
  }, [modules]);

  const [clickable, setClickable] = useState(false);

  const moduleAt = useCallback(
    (e: React.MouseEvent<SVGSVGElement>): QRModule | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const col = Math.floor(((e.clientX - rect.left) / rect.width) * dim - QUIET);
      const row = Math.floor(((e.clientY - rect.top) / rect.height) * dim - QUIET);
      if (row < 0 || col < 0 || row >= size || col >= size) return null;
      return modules[row][col];
    },
    [dim, size, modules],
  );

  const handleMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const m = moduleAt(e);
      onHover(m);
      setClickable(m?.role === "message");
    },
    [moduleAt, onHover],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const m = moduleAt(e);
      if (m && m.role === "message") onToggle(m);
    },
    [moduleAt, onToggle],
  );

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${dim} ${dim}`}
      className="h-auto w-full select-none"
      style={{ cursor: clickable ? "pointer" : "default" }}
      shapeRendering="crispEdges"
      onMouseMove={handleMove}
      onMouseLeave={() => {
        onHover(null);
        setClickable(false);
      }}
      onClick={handleClick}
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

        {/* Segment overlays. Each group's border is drawn on the grid lines at
            double width and clipped to its own cells, so only the inner half
            shows — a straight line sitting just inside the cells. Shown for
            either toggle; direction adds the rounded flow arrows, characters
            adds the letters. */}
        {(showChars || showDirection) && (
          <g shapeRendering="geometricPrecision">
            <defs>
              {overlays.groups.map((g) => (
                <clipPath key={g.id} id={`${g.id}${uid}`}>
                  <path d={g.union} />
                </clipPath>
              ))}
            </defs>

            {overlays.groups.map((g) => (
              <g key={g.id} clipPath={`url(#${g.id}${uid})`}>
                <path
                  d={g.union}
                  fill="none"
                  stroke={OUTLINE_COLOR[g.id]}
                  strokeWidth={OUTLINE_STROKE * 2}
                  strokeLinejoin="miter"
                />
                {g.dividers && (
                  <path
                    d={g.dividers}
                    fill="none"
                    stroke={OUTLINE_COLOR[g.id]}
                    strokeWidth={OUTLINE_STROKE}
                    strokeLinecap="square"
                  />
                )}
              </g>
            ))}

            {showDirection &&
              arrows.map((a, i) => (
                <text
                  key={`arrow${i}`}
                  x={a.x}
                  y={a.y}
                  fontSize={1}
                  fontFamily="var(--font-mono, monospace)"
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={OUTLINE_COLOR[a.color]}
                >
                  {a.glyph}
                </text>
              ))}

            {showChars &&
              overlays.letters.map((b, i) => (
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
