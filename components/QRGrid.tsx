"use client";

import { category, CategoryId, moduleColor, ROLE_CATEGORY } from "@/lib/qr/roles";
import type { QRAnalysis, QRModule } from "@/lib/qr/types";
import { useCallback, useId, useMemo, useRef, useState } from "react";

const QUIET = 4; // quiet-zone width in modules
const OUTLINE_STROKE = 0.1; // stroke width of the overlay outlines

// The two segments that carry an overlay: the message/header/padding "data"
// (green) and "ec" error correction (purple). Their colours come straight from
// the module categories so the overlay always matches the module fill.
type OverlayCat = "data" | "ec";
const OVERLAY_CATS: OverlayCat[] = ["data", "ec"];
const overlayColor = (cat: OverlayCat) => category(cat).dark;

interface Props {
  analysis: QRAnalysis;
  /** Outline each byte's footprint and draw its character. */
  showChars: boolean;
  /** Draw arrows showing the order data is placed in. */
  showDirection: boolean;
  /** Label each data/EC module with its bit position within its codeword,
   * numbered in reading order (1 = first bit read / MSB … 8 = last / LSB),
   * matching the standard QR diagram. */
  showBits: boolean;
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

/**
 * Centre point for a glyph inside a footprint. Only cells that belong to a
 * fully-present 2×2 block are considered, so thin 1-wide spurs (which a glyph
 * would overflow) don't drag the centre out of the body of the shape. Falls
 * back to the full centroid when the footprint is everywhere thinner than 2×2.
 */
function coreCentroid(cells: [number, number][]): [number, number] {
  if (cells.length === 0) return [0, 0];
  const key = (r: number, c: number) => r * 1000 + c;
  const set = new Set(cells.map(([r, c]) => key(r, c)));
  const has = (r: number, c: number) => set.has(key(r, c));
  const core = new Set<number>();
  for (const [r, c] of cells) {
    // Every 2×2 block that could contain this cell (it as TL/TR/BL/BR).
    for (const [tr, tc] of [
      [r, c],
      [r - 1, c],
      [r, c - 1],
      [r - 1, c - 1],
    ]) {
      if (has(tr, tc) && has(tr + 1, tc) && has(tr, tc + 1) && has(tr + 1, tc + 1)) {
        core.add(key(tr, tc));
        core.add(key(tr + 1, tc));
        core.add(key(tr, tc + 1));
        core.add(key(tr + 1, tc + 1));
      }
    }
  }
  if (core.size === 0) return centroid(cells);
  return centroid([...core].map((k) => [Math.floor(k / 1000), k % 1000]));
}

/** Whether a cell set contains a full 2×2 block (i.e. a glyph fits inside it). */
function hasCore(cells: [number, number][]): boolean {
  const key = (r: number, c: number) => r * 1000 + c;
  const set = new Set(cells.map(([r, c]) => key(r, c)));
  return cells.some(
    ([r, c]) =>
      set.has(key(r + 1, c)) && set.has(key(r, c + 1)) && set.has(key(r + 1, c + 1)),
  );
}

/**
 * Split a cell set into its 4-connected components. A unit (codeword or byte)
 * can be split into separate chunks — by interleaving, or by the zig-zag
 * wrapping a function pattern — so we label each chunk and link them.
 */
function connectedComponents(cells: [number, number][]): [number, number][][] {
  const key = (r: number, c: number) => r * 1000 + c;
  const set = new Set(cells.map(([r, c]) => key(r, c)));
  const seen = new Set<number>();
  const out: [number, number][][] = [];
  for (const [sr, sc] of cells) {
    if (seen.has(key(sr, sc))) continue;
    const comp: [number, number][] = [];
    const stack: [number, number][] = [[sr, sc]];
    seen.add(key(sr, sc));
    while (stack.length) {
      const [r, c] = stack.pop()!;
      comp.push([r, c]);
      for (const [nr, nc] of [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ]) {
        if (set.has(key(nr, nc)) && !seen.has(key(nr, nc))) {
          seen.add(key(nr, nc));
          stack.push([nr, nc]);
        }
      }
    }
    out.push(comp);
  }
  return out;
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
  showBits,
  highlight,
  onHover,
  onToggle,
}: Props) {
  const { size, modules, characters, byteCount, blocks } = analysis;
  const dim = size + QUIET * 2;
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, ""); // unique, selector-safe clip ids

  // Overlay geometry. On single-block symbols the data reads in order, so the
  // "characters" overlay shows the message letters (plus mode / length / end
  // markers). On interleaved symbols (multiple EC blocks) the bytes are
  // scattered, so instead each data codeword is numbered D1, D2… in reading
  // order — like the EC codewords E1, E2…. A codeword/byte split into separate
  // chunks gets its label on each chunk, joined by a link line.
  const overlays = useMemo(() => {
    const ck = (r: number, c: number) => r * 1000 + c;
    const interleaved = blocks > 1;
    const cells: Record<OverlayCat, [number, number][]> = { data: [], ec: [] };
    const unit = new Map<number, string>(); // cellKey -> unit id (for dividers)
    const readPos = new Map<number, number>(); // cellKey -> data-flow order
    const dataCw = new Map<number, [number, number][]>(); // data codeword cells
    const ecCw = new Map<number, [number, number][]>(); // ec codeword cells
    const modeCells: [number, number][] = [];
    const countCells: [number, number][] = [];
    const termCells: [number, number][] = [];

    for (const row of modules) {
      for (const m of row) {
        const cat = ROLE_CATEGORY[m.role];
        if (cat !== "data" && cat !== "ec") continue;
        cells[cat].push([m.row, m.col]);
        if (m.codewordIndex != null && m.bitIndex != null) {
          readPos.set(ck(m.row, m.col), m.codewordIndex * 8 + (7 - m.bitIndex));
        }

        // Collect cells per codeword (and per header/end region for labels).
        if (m.role === "ec") {
          const arr = ecCw.get(m.codewordIndex!) ?? [];
          arr.push([m.row, m.col]);
          ecCw.set(m.codewordIndex!, arr);
        } else if (m.codewordIndex != null) {
          const arr = dataCw.get(m.codewordIndex) ?? [];
          arr.push([m.row, m.col]);
          dataCw.set(m.codewordIndex, arr);
        }
        if (m.role === "mode") modeCells.push([m.row, m.col]);
        else if (m.role === "count") countCells.push([m.row, m.col]);
        else if (m.role === "terminator") termCells.push([m.row, m.col]);

        // Divider unit: per codeword when interleaved (matches the D/E labels),
        // otherwise per byte / header region (matches the character labels).
        let u: string;
        if (interleaved) {
          u = `${cat}${m.codewordIndex ?? `x${m.row}_${m.col}`}`;
        } else if (m.role === "message") u = `b${m.byteIndex}`;
        else if (m.role === "mode") u = "mode";
        else if (m.role === "count") u = "count";
        else if (m.role === "terminator") u = "term";
        else if (m.role === "ec") u = `e${m.codewordIndex}`;
        else u = `d${m.codewordIndex ?? `${m.row}_${m.col}`}`;
        unit.set(ck(m.row, m.col), u);
      }
    }

    const groups = OVERLAY_CATS.map((id) => {
      const cs = cells[id];
      if (cs.length === 0) return null;
      const inGroup = new Set(cs.map(([r, c]) => ck(r, c)));
      let dividers = "";
      for (const [r, c] of cs) {
        const u = unit.get(ck(r, c));
        const rk = ck(r, c + 1);
        if (inGroup.has(rk) && unit.get(rk) !== u) dividers += `M${c + 1} ${r}L${c + 1} ${r + 1}`;
        const dk = ck(r + 1, c);
        if (inGroup.has(dk) && unit.get(dk) !== u) dividers += `M${c} ${r + 1}L${c + 1} ${r + 1}`;
      }
      return { id, union: outlinePath(cs), dividers };
    }).filter(
      (g): g is { id: OverlayCat; union: string; dividers: string } => g !== null,
    );

    // One label per unit, placed in the best box that holds the glyph:
    // a 2×2 block, else a 2-wide pair, else a 2-tall pair, else a single cell
    // (the text is shrunk to fit `w`×`h`). No duplicate labels, no links.
    const labels: {
      cx: number;
      cy: number;
      text: string;
      cat: OverlayCat;
      w: number;
      h: number;
    }[] = [];
    const minPos = (comp: [number, number][]) =>
      Math.min(...comp.map(([r, c]) => readPos.get(ck(r, c)) ?? Infinity));
    const place = (cs: [number, number][]) => {
      // Prefer a chunk with a 2×2 core (earliest in data flow), centred on it.
      const cored = connectedComponents(cs).filter(hasCore);
      if (cored.length > 0) {
        const best = cored.reduce((a, b) => (minPos(b) < minPos(a) ? b : a));
        const [cx, cy] = coreCentroid(best);
        return { cx, cy, w: 2, h: 2 };
      }
      const set = new Set(cs.map(([r, c]) => ck(r, c)));
      const sorted = [...cs].sort(
        (a, b) => (readPos.get(ck(a[0], a[1])) ?? Infinity) - (readPos.get(ck(b[0], b[1])) ?? Infinity),
      );
      for (const [r, c] of sorted) {
        if (set.has(ck(r, c + 1))) return { cx: c + 1, cy: r + 0.5, w: 2, h: 1 };
        if (set.has(ck(r, c - 1))) return { cx: c, cy: r + 0.5, w: 2, h: 1 };
      }
      for (const [r, c] of sorted) {
        if (set.has(ck(r + 1, c))) return { cx: c + 0.5, cy: r + 1, w: 1, h: 2 };
        if (set.has(ck(r - 1, c))) return { cx: c + 0.5, cy: r, w: 1, h: 2 };
      }
      const [r, c] = sorted[0];
      return { cx: c + 0.5, cy: r + 0.5, w: 1, h: 1 };
    };
    const add = (cs: [number, number][], text: string, cat: OverlayCat) => {
      if (cs.length === 0) return;
      labels.push({ ...place(cs), text, cat });
    };

    if (interleaved) {
      [...dataCw.entries()]
        .sort((a, b) => a[0] - b[0])
        .forEach(([, cs], i) => add(cs, `D${i + 1}`, "data"));
    } else {
      for (const ch of characters) {
        add(ch.cells, ch.char === " " ? "␣" : ch.char, "data");
      }
      add(modeCells, "Mode", "data");
      add(countCells, `${byteCount}`, "data");
      add(termCells, "End", "data");
    }
    [...ecCw.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([, cs], i) => add(cs, `E${i + 1}`, "ec"));

    return { groups, labels };
  }, [modules, characters, byteCount, blocks]);

  // Reading order: one arrow glyph per codeword at its centroid, pointing in
  // its cardinal direction of travel and coloured by segment.
  const arrows = useMemo(() => {
    const acc = new Map<number, { cells: [number, number][]; ec: boolean }>();
    for (const row of modules) {
      for (const m of row) {
        if (m.codewordIndex == null) continue;
        const a = acc.get(m.codewordIndex) ?? { cells: [], ec: false };
        a.cells.push([m.row, m.col]);
        if (m.role === "ec") a.ec = true;
        acc.set(m.codewordIndex, a);
      }
    }
    const pts = [...acc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, a]) => {
        const [x, y] = coreCentroid(a.cells);
        return { x, y, color: (a.ec ? "ec" : "data") as OverlayCat };
      });

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

  // Bit number for each data/EC module, numbered within its *logical field*
  // (mode = 4 bits, length = 8/16, each character = 8, each codeword = 8…), in
  // reading order: 1 = first bit read (MSB) … N = last (LSB).
  const bitNumbers = useMemo(() => {
    const ck = (r: number, c: number) => r * 1000 + c;
    const fields = new Map<string, { k: number; rp: number }[]>();
    for (const row of modules) {
      for (const m of row) {
        const cat = ROLE_CATEGORY[m.role];
        if ((cat !== "data" && cat !== "ec") || m.bitIndex == null || m.codewordIndex == null) {
          continue;
        }
        let unit: string;
        switch (m.role) {
          case "mode":
            unit = "mode";
            break;
          case "count":
            unit = "count";
            break;
          case "terminator":
            unit = "term";
            break;
          case "message":
            unit = `b${m.byteIndex}`;
            break;
          case "ec":
            unit = `e${m.codewordIndex}`;
            break;
          default: // padding
            unit = `p${m.codewordIndex}`;
        }
        const rp = m.codewordIndex * 8 + (7 - m.bitIndex); // global reading order
        const arr = fields.get(unit) ?? [];
        arr.push({ k: ck(m.row, m.col), rp });
        fields.set(unit, arr);
      }
    }
    const num = new Map<number, number>();
    for (const arr of fields.values()) {
      arr.sort((a, b) => a.rp - b.rp);
      arr.forEach((cell, i) => num.set(cell.k, i + 1));
    }
    return num;
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
            : moduleColor(m.role, m.dark, showChars || showDirection || showBits);
          return (
            <rect
              key={`${m.row}-${m.col}`}
              x={m.col}
              y={m.row}
              width={1}
              height={1}
              fill={fill}
            />
          );
        })}

        {/* Segment overlays. Each group's border is drawn on the grid lines at
            double width and clipped to its own cells, so only the inner half
            shows — a straight line sitting just inside the cells. Shown for
            either toggle; direction adds the rounded flow arrows, characters
            adds the letters. */}
        {(showChars || showDirection || showBits) && (
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
                  stroke={overlayColor(g.id)}
                  strokeWidth={OUTLINE_STROKE * 2}
                  strokeLinejoin="miter"
                />
                {g.dividers && (
                  <path
                    d={g.dividers}
                    fill="none"
                    stroke={overlayColor(g.id)}
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
                  fontSize={1.4}
                  fontFamily="var(--font-mono, monospace)"
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={overlayColor(a.color)}
                >
                  {a.glyph}
                </text>
              ))}

            {showChars &&
              overlays.labels.map((b, i) => (
                <text
                  key={i}
                  x={b.cx}
                  y={b.cy}
                  // Fit the glyph to its box: limited by height and by width
                  // per character (≈0.62em advance in the mono font).
                  fontSize={Math.min(b.h * 0.5, b.w / (b.text.length * 0.75))}
                  fontFamily="var(--font-mono, monospace)"
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={overlayColor(b.cat)}
                >
                  {b.text}
                </text>
              ))}

            {showBits &&
              modules.flat().map((m) => {
                const cat = ROLE_CATEGORY[m.role];
                const n = bitNumbers.get(m.row * 1000 + m.col);
                if ((cat !== "data" && cat !== "ec") || n == null) return null;
                return (
                  <text
                    key={`bit-${m.row}-${m.col}`}
                    x={m.col + 0.5}
                    y={m.row + 0.5}
                    fontSize={0.7}
                    fontFamily="var(--font-mono, monospace)"
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={overlayColor(cat)}
                  >
                    {n}
                  </text>
                );
              })}
          </g>
        )}
      </g>
    </svg>
  );
}
