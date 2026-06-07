// Lookup tables and small helpers from the QR Code specification (ISO/IEC
// 18004). The large tables are transcribed from the MIT-licensed `qrcode`
// library and verified bit-for-bit against it (see scripts/verify-qr.mjs).

import type { ECLevel } from "./types";

/** Total codewords (data + EC) per version, indexed by version (1-40). */
export const TOTAL_CODEWORDS = [
  0, // version 0 unused
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733,
  815, 901, 991, 1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051,
  2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
];

// Number of EC blocks, rows are versions 1-40, columns are L, M, Q, H.
const EC_BLOCKS = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 2, 2, 4, 1, 2, 4, 4, 2, 4, 4, 4, 2, 4,
  6, 5, 2, 4, 6, 6, 2, 5, 8, 8, 4, 5, 8, 8, 4, 5, 8, 11, 4, 8, 10, 11, 4, 9, 12,
  16, 4, 9, 16, 16, 6, 10, 12, 18, 6, 10, 17, 16, 6, 11, 16, 19, 6, 13, 18, 21,
  7, 14, 21, 25, 8, 16, 20, 25, 8, 17, 23, 25, 9, 17, 23, 34, 9, 18, 25, 30, 10,
  20, 27, 32, 12, 21, 29, 35, 12, 23, 34, 37, 12, 25, 34, 40, 13, 26, 35, 42,
  14, 28, 38, 45, 15, 29, 40, 48, 16, 31, 43, 51, 17, 33, 45, 54, 18, 35, 48,
  57, 19, 37, 51, 60, 19, 38, 53, 63, 20, 40, 56, 66, 21, 43, 59, 70, 22, 45,
  62, 74, 24, 47, 65, 77, 25, 49, 68, 81,
];

// Total EC codewords, rows are versions 1-40, columns are L, M, Q, H.
const EC_CODEWORDS = [
  7, 10, 13, 17, 10, 16, 22, 28, 15, 26, 36, 44, 20, 36, 52, 64, 26, 48, 72, 88,
  36, 64, 96, 112, 40, 72, 108, 130, 48, 88, 132, 156, 60, 110, 160, 192, 72,
  130, 192, 224, 80, 150, 224, 264, 96, 176, 260, 308, 104, 198, 288, 352, 120,
  216, 320, 384, 132, 240, 360, 432, 144, 280, 408, 480, 168, 308, 448, 532,
  180, 338, 504, 588, 196, 364, 546, 650, 224, 416, 600, 700, 224, 442, 644,
  750, 252, 476, 690, 816, 270, 504, 750, 900, 300, 560, 810, 960, 312, 588,
  870, 1050, 336, 644, 952, 1110, 360, 700, 1020, 1200, 390, 728, 1050, 1260,
  420, 784, 1140, 1350, 450, 812, 1200, 1440, 480, 868, 1290, 1530, 510, 924,
  1350, 1620, 540, 980, 1440, 1710, 570, 1036, 1530, 1800, 570, 1064, 1590,
  1890, 600, 1120, 1680, 1980, 630, 1204, 1770, 2100, 660, 1260, 1860, 2220,
  720, 1316, 1950, 2310, 750, 1372, 2040, 2430,
];

const EC_COLUMN: Record<ECLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

/** Bit value used in the format information for each EC level. */
export const EC_FORMAT_BIT: Record<ECLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

export function symbolSize(version: number): number {
  return version * 4 + 17;
}

export function ecBlocks(version: number, level: ECLevel): number {
  return EC_BLOCKS[(version - 1) * 4 + EC_COLUMN[level]];
}

export function ecTotalCodewords(version: number, level: ECLevel): number {
  return EC_CODEWORDS[(version - 1) * 4 + EC_COLUMN[level]];
}

export function dataCodewords(version: number, level: ECLevel): number {
  return TOTAL_CODEWORDS[version] - ecTotalCodewords(version, level);
}

/** Number of bits in the character-count indicator for byte mode. */
export function charCountBits(version: number): number {
  return version < 10 ? 8 : 16;
}

/** Max number of bytes encodable in byte mode for a version + EC level. */
export function byteCapacity(version: number, level: ECLevel): number {
  const usableBits = dataCodewords(version, level) * 8 - (4 + charCountBits(version));
  return Math.floor(usableBits / 8);
}

/**
 * Center coordinates of alignment patterns for a version, along one axis.
 * The full set of centers is the cartesian product of these, minus the three
 * that collide with finder patterns.
 */
export function alignmentCoords(version: number): number[] {
  if (version === 1) return [];
  const posCount = Math.floor(version / 7) + 2;
  const size = symbolSize(version);
  const intervals =
    size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
  const positions = [size - 7];
  for (let i = 1; i < posCount - 1; i++) {
    positions[i] = positions[i - 1] - intervals;
  }
  positions.push(6);
  return positions.reverse();
}

/** Alignment pattern centers as [row, col], excluding finder collisions. */
export function alignmentPositions(version: number): [number, number][] {
  const coords = alignmentCoords(version);
  const n = coords.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === n - 1) ||
        (i === n - 1 && j === 0)
      ) {
        continue;
      }
      out.push([coords[i], coords[j]]);
    }
  }
  return out;
}

function bchDigit(data: number): number {
  let digit = 0;
  while (data !== 0) {
    digit++;
    data >>>= 1;
  }
  return digit;
}

const G15 =
  (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
const G15_BCH = bchDigit(G15);

/** 15-bit BCH-encoded format information for an EC level + mask pattern. */
export function formatBits(level: ECLevel, mask: number): number {
  const data = (EC_FORMAT_BIT[level] << 3) | mask;
  let d = data << 10;
  while (bchDigit(d) - G15_BCH >= 0) {
    d ^= G15 << (bchDigit(d) - G15_BCH);
  }
  return ((data << 10) | d) ^ G15_MASK;
}

/**
 * The format information decoded into its three parts, as bit strings:
 * the 2-bit error-correction level, the 3-bit mask pattern, and the 10
 * BCH error-correction bits that protect them.
 */
export function formatInfoGroups(level: ECLevel, mask: number) {
  const ecLevel = EC_FORMAT_BIT[level];
  let d = ((ecLevel << 3) | mask) << 10;
  while (bchDigit(d) - G15_BCH >= 0) {
    d ^= G15 << (bchDigit(d) - G15_BCH);
  }
  return {
    ecLevelBits: ecLevel.toString(2).padStart(2, "0"),
    maskBits: mask.toString(2).padStart(3, "0"),
    ecBits: (d & 0x3ff).toString(2).padStart(10, "0"),
  };
}

const G18 =
  (1 << 12) |
  (1 << 11) |
  (1 << 10) |
  (1 << 9) |
  (1 << 8) |
  (1 << 5) |
  (1 << 2) |
  (1 << 0);
const G18_BCH = bchDigit(G18);

/** 18-bit BCH-encoded version information (only used on version 7+). */
export function versionBits(version: number): number {
  let d = version << 12;
  while (bchDigit(d) - G18_BCH >= 0) {
    d ^= G18 << (bchDigit(d) - G18_BCH);
  }
  return (version << 12) | d;
}

/** The mask predicate: true means the module is flipped. */
export function maskAt(pattern: number, row: number, col: number): boolean {
  switch (pattern) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row * col) % 3) + ((row + col) % 2)) % 2 === 0;
    default:
      throw new Error("bad mask pattern: " + pattern);
  }
}
