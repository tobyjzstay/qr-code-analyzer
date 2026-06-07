// Encodes a string into a QR symbol (byte mode) and records the semantic role
// of every module, so the result can be visualised and explained.
//
// The placement, masking and error-correction logic mirrors the ISO/IEC 18004
// reference algorithm exactly (verified bit-for-bit against the `qrcode`
// library) — the only addition is the per-module metadata.

import { reedSolomon } from "./galois";
import {
  TOTAL_CODEWORDS,
  alignmentPositions,
  byteCapacity,
  charCountBits,
  dataCodewords,
  ecBlocks,
  ecTotalCodewords,
  formatBits,
  formatInfoGroups,
  maskAt,
  symbolSize,
  versionBits,
} from "./tables";
import type {
  AnalyzeOptions,
  ECLevel,
  MessageChar,
  ModuleRole,
  QRAnalysis,
  QRModule,
} from "./types";

type CWMeta =
  | { kind: "data"; block: number; indexInBlock: number; originalIndex: number }
  | { kind: "ec"; block: number; indexInBlock: number };

export function analyze(
  input: string | Uint8Array,
  opts: AnalyzeOptions = {},
): QRAnalysis {
  const level: ECLevel = opts.errorCorrectionLevel ?? "M";
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const text =
    typeof input === "string" ? input : new TextDecoder().decode(input);

  // --- Choose the version (symbol size) ---
  let version = opts.version ?? 0;
  if (!version) {
    version = 1;
    while (version <= 40 && bytes.length > byteCapacity(version, level)) version++;
    if (version > 40) {
      throw new Error("Too much data to fit in a QR code at this EC level.");
    }
  } else if (bytes.length > byteCapacity(version, level)) {
    throw new Error(`Data is too large for version ${version} at level ${level}.`);
  }

  const size = symbolSize(version);
  const ccBits = charCountBits(version);
  const dataCW = dataCodewords(version, level);
  const dataBits = dataCW * 8;
  const totalCW = TOTAL_CODEWORDS[version];
  const ecTotal = ecTotalCodewords(version, level);

  // --- 1. Build the data bit stream, tagging each bit with its role ---
  const bits: number[] = [];
  const bitRole: ModuleRole[] = [];
  const bitByte: number[] = []; // input byte index per bit (-1 if not message)
  const bitPos: number[] = []; // bit position within the value (0 = LSB … 7)

  const push = (value: number, len: number, role: ModuleRole, byteIdx = -1) => {
    for (let b = len - 1; b >= 0; b--) {
      bits.push((value >>> b) & 1);
      bitRole.push(role);
      bitByte.push(byteIdx);
      bitPos.push(b);
    }
  };

  push(0b0100, 4, "mode"); // byte-mode indicator
  push(bytes.length, ccBits, "count");
  for (let i = 0; i < bytes.length; i++) push(bytes[i], 8, "message", i);

  const modeBits = "0100";
  const countBits = bits.slice(4, 4 + ccBits).join("");

  // Terminator (up to four 0s), then pad to a byte boundary.
  if (bits.length + 4 <= dataBits) push(0, 4, "terminator");
  while (bits.length % 8 !== 0) {
    bits.push(0);
    bitRole.push("terminator");
    bitByte.push(-1);
    bitPos.push(0);
  }
  // Pad codewords (0xEC / 0x11 alternating) fill the remaining capacity.
  const remainingBytes = (dataBits - bits.length) / 8;
  for (let i = 0; i < remainingBytes; i++) push(i % 2 ? 0x11 : 0xec, 8, "padding");

  // Pack the bit stream into data codeword bytes.
  const dataCodewordBytes = new Uint8Array(dataCW);
  for (let i = 0; i < dataCW; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
    dataCodewordBytes[i] = v;
  }

  // --- 2. Split into EC blocks, compute Reed-Solomon, then interleave ---
  const blocks = ecBlocks(version, level);
  const blocksInGroup2 = totalCW % blocks;
  const blocksInGroup1 = blocks - blocksInGroup2;
  const totalPerG1 = Math.floor(totalCW / blocks);
  const dataPerG1 = Math.floor(dataCW / blocks);
  const dataPerG2 = dataPerG1 + 1;
  const ecPerBlock = totalPerG1 - dataPerG1;

  const dc: Uint8Array[] = [];
  const ec: Uint8Array[] = [];
  const blockDataOffset: number[] = [];
  let offset = 0;
  let maxData = 0;
  for (let b = 0; b < blocks; b++) {
    const dataSize = b < blocksInGroup1 ? dataPerG1 : dataPerG2;
    blockDataOffset[b] = offset;
    const block = dataCodewordBytes.slice(offset, offset + dataSize);
    dc[b] = block;
    ec[b] = reedSolomon(block, ecPerBlock);
    offset += dataSize;
    maxData = Math.max(maxData, dataSize);
  }

  const finalCodewords = new Uint8Array(totalCW);
  const finalMeta: CWMeta[] = new Array(totalCW);
  let idx = 0;
  for (let i = 0; i < maxData; i++) {
    for (let b = 0; b < blocks; b++) {
      if (i < dc[b].length) {
        finalCodewords[idx] = dc[b][i];
        finalMeta[idx] = {
          kind: "data",
          block: b,
          indexInBlock: i,
          originalIndex: blockDataOffset[b] + i,
        };
        idx++;
      }
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < blocks; b++) {
      finalCodewords[idx] = ec[b][i];
      finalMeta[idx] = { kind: "ec", block: b, indexInBlock: i };
      idx++;
    }
  }

  // --- 3. Lay out the matrix ---
  const modules: QRModule[][] = [];
  for (let r = 0; r < size; r++) {
    modules[r] = [];
    for (let c = 0; c < size; c++) {
      modules[r][c] = { row: r, col: c, dark: false, role: "remainder" };
    }
  }
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );

  const setFn = (r: number, c: number, dark: boolean, role: ModuleRole) => {
    modules[r][c].dark = dark;
    modules[r][c].role = role;
    reserved[r][c] = true;
  };

  // Finder patterns (with their surrounding separators).
  const finderPos: [number, number][] = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ];
  for (const [fr, fc] of finderPos) {
    for (let r = -1; r <= 7; r++) {
      if (fr + r < 0 || fr + r >= size) continue;
      for (let c = -1; c <= 7; c++) {
        if (fc + c < 0 || fc + c >= size) continue;
        const inFinder = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark =
          inFinder &&
          (r === 0 ||
            r === 6 ||
            c === 0 ||
            c === 6 ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setFn(fr + r, fc + c, dark, inFinder ? "finder" : "separator");
      }
    }
  }

  // Timing patterns (must come before alignment so alignment can overwrite).
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setFn(i, 6, dark, "timing");
    setFn(6, i, dark, "timing");
  }

  // Alignment patterns.
  for (const [ar, ac] of alignmentPositions(version)) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const dark =
          r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
        setFn(ar + r, ac + c, dark, "alignment");
      }
    }
  }

  // Writes the 15 format-info modules (and the fixed dark module). Called
  // repeatedly: once to reserve the cells, again per mask candidate, and once
  // with the final value.
  const placeFormat = (value: number) => {
    for (let i = 0; i < 15; i++) {
      const bit = ((value >> i) & 1) === 1;
      const vr = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
      setFn(vr, 8, bit, "format");
      const hc = i < 8 ? size - i - 1 : i < 9 ? 15 - i : 14 - i;
      setFn(8, hc, bit, "format");
    }
    setFn(size - 8, 8, true, "darkModule");
  };
  placeFormat(0); // reserve with placeholder bits

  // Version information (v7+).
  if (version >= 7) {
    const vbits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = (i % 3) + size - 8 - 3;
      const bit = ((vbits >> i) & 1) === 1;
      setFn(r, c, bit, "version");
      setFn(c, r, bit, "version");
    }
  }

  // --- 4. Place the data/EC codewords in the zig-zag pattern ---
  let inc = -1;
  let row = size - 1;
  let bitIndex = 7;
  let byteIndex = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing column
    for (;;) {
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row][cc]) continue;
        const m = modules[row][cc];
        let dark = false;
        if (byteIndex < totalCW) {
          dark = ((finalCodewords[byteIndex] >>> bitIndex) & 1) === 1;
          const meta = finalMeta[byteIndex];
          m.codewordIndex = byteIndex;
          m.blockIndex = meta.block;
          m.bitIndex = bitIndex;
          if (meta.kind === "ec") {
            m.role = "ec";
          } else {
            const origBit = meta.originalIndex * 8 + (7 - bitIndex);
            m.role = bitRole[origBit];
            if (m.role === "message") {
              m.byteIndex = bitByte[origBit];
              m.bitOfByte = bitPos[origBit];
            }
          }
        } else {
          m.role = "remainder";
        }
        m.dark = dark;
        bitIndex--;
        if (bitIndex === -1) {
          byteIndex++;
          bitIndex = 7;
        }
      }
      row += inc;
      if (row < 0 || row >= size) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }

  // --- 5. Masking ---
  const get = (r: number, c: number) => (modules[r][c].dark ? 1 : 0);

  const applyMask = (p: number) => {
    for (let c = 0; c < size; c++) {
      for (let r = 0; r < size; r++) {
        if (reserved[r][c]) continue;
        if (maskAt(p, r, c)) modules[r][c].dark = !modules[r][c].dark;
      }
    }
  };

  const penalty = (): number => {
    let points = 0;
    // N1: runs of 5+ same-colour modules in a row/column.
    for (let r = 0; r < size; r++) {
      let sameCol = 0;
      let sameRow = 0;
      let lastCol: number | null = null;
      let lastRow: number | null = null;
      for (let c = 0; c < size; c++) {
        let mod = get(r, c);
        if (mod === lastCol) sameCol++;
        else {
          if (sameCol >= 5) points += 3 + (sameCol - 5);
          lastCol = mod;
          sameCol = 1;
        }
        mod = get(c, r);
        if (mod === lastRow) sameRow++;
        else {
          if (sameRow >= 5) points += 3 + (sameRow - 5);
          lastRow = mod;
          sameRow = 1;
        }
      }
      if (sameCol >= 5) points += 3 + (sameCol - 5);
      if (sameRow >= 5) points += 3 + (sameRow - 5);
    }
    // N2: 2x2 blocks of one colour.
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const sum =
          get(r, c) + get(r, c + 1) + get(r + 1, c) + get(r + 1, c + 1);
        if (sum === 4 || sum === 0) points += 3;
      }
    }
    // N3: finder-like 1:1:3:1:1 patterns.
    for (let r = 0; r < size; r++) {
      let bitsCol = 0;
      let bitsRow = 0;
      for (let c = 0; c < size; c++) {
        bitsCol = ((bitsCol << 1) & 0x7ff) | get(r, c);
        if (c >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) points += 40;
        bitsRow = ((bitsRow << 1) & 0x7ff) | get(c, r);
        if (c >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) points += 40;
      }
    }
    // N4: deviation of dark proportion from 50%.
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += get(r, c);
    const k = Math.abs(Math.ceil(((dark * 100) / (size * size)) / 5) - 10);
    points += k * 10;
    return points;
  };

  let mask = opts.mask;
  if (mask == null) {
    let best = 0;
    let lowest = Infinity;
    for (let p = 0; p < 8; p++) {
      placeFormat(formatBits(level, p));
      applyMask(p);
      const pen = penalty();
      applyMask(p); // undo
      if (pen < lowest) {
        lowest = pen;
        best = p;
      }
    }
    mask = best;
  }

  applyMask(mask);
  placeFormat(formatBits(level, mask));

  // --- 6. Group message modules into characters for the overlay ---
  const charCells = new Map<number, [number, number][]>();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const m = modules[r][c];
      if (m.role === "message" && m.byteIndex != null) {
        const arr = charCells.get(m.byteIndex) ?? [];
        arr.push([r, c]);
        charCells.set(m.byteIndex, arr);
      }
    }
  }
  const characters: MessageChar[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i];
    const char = code >= 32 && code < 127 ? String.fromCharCode(code) : "·";
    characters.push({ index: i, char, code, cells: charCells.get(i) ?? [] });
  }

  return {
    text,
    size,
    version,
    errorCorrectionLevel: level,
    maskPattern: mask,
    modules,
    byteCount: bytes.length,
    totalCodewords: totalCW,
    dataCodewords: dataCW,
    ecCodewords: ecTotal,
    blocks,
    ecPerBlock,
    modeBits,
    countBits,
    formatGroups: formatInfoGroups(level, mask),
    characters,
  };
}
