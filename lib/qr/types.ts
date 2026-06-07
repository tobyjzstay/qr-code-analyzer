// Types for the QR code analyzer.

/** Error correction level. L = 7%, M = 15%, Q = 25%, H = 30% recovery. */
export type ECLevel = "L" | "M" | "Q" | "H";

/**
 * The semantic role of a single module (cell) in the QR matrix. Every module
 * in the symbol falls into exactly one of these categories. The data region is
 * broken down further than a normal encoder would bother with, so the analyzer
 * can colour each part of the message independently.
 */
export type ModuleRole =
  // Function patterns (fixed, never carry message data)
  | "finder" // the three large positioning squares in the corners
  | "separator" // the one-module white border around each finder
  | "timing" // the dashed row/column that calibrates the module grid
  | "alignment" // smaller squares that correct for distortion (v2+)
  | "format" // error-correction level + mask pattern (BCH protected)
  | "version" // version number, present only on v7+
  | "darkModule" // the single module that is always dark
  // Encoding region (the zig-zag filled with codewords)
  | "mode" // 4-bit mode indicator
  | "count" // character-count indicator
  | "message" // the actual encoded bytes of the input
  | "terminator" // terminator + bit padding up to a byte boundary
  | "padding" // pad codewords (0xEC / 0x11) that fill spare capacity
  | "ec" // Reed-Solomon error-correction codewords
  | "remainder"; // leftover bits that don't form a full codeword

/** A single module of the QR symbol with its analysis metadata. */
export interface QRModule {
  row: number;
  col: number;
  /** Whether the module is dark (true) or light (false) in the final symbol. */
  dark: boolean;
  role: ModuleRole;
  /** Index of the final (interleaved) codeword this module belongs to. */
  codewordIndex?: number;
  /** Which error-correction block the codeword came from. */
  blockIndex?: number;
  /** Bit position within the codeword (7 = MSB placed first … 0 = LSB). */
  bitIndex?: number;
  /** For `message` modules: index of the input byte this bit belongs to. */
  byteIndex?: number;
}

/** One decoded character (byte) of the message and the cells that encode it. */
export interface MessageChar {
  index: number;
  /** Printable representation of the byte. */
  char: string;
  /** Raw byte value. */
  code: number;
  /** [row, col] of every module that carries a bit of this byte. */
  cells: [number, number][];
}

/** The complete analysis of an encoded QR symbol. */
export interface QRAnalysis {
  text: string;
  size: number;
  version: number;
  errorCorrectionLevel: ECLevel;
  maskPattern: number;
  /** modules[row][col] */
  modules: QRModule[][];
  byteCount: number;
  totalCodewords: number;
  dataCodewords: number;
  ecCodewords: number;
  /** Number of error-correction blocks the data is split across. */
  blocks: number;
  /** EC codewords per block. */
  ecPerBlock: number;
  /** Mode indicator bits as a string, e.g. "0100". */
  modeBits: string;
  /** Character-count indicator bits as a string. */
  countBits: string;
  characters: MessageChar[];
}

export interface AnalyzeOptions {
  errorCorrectionLevel?: ECLevel;
  /** Force a specific version (1-40). Defaults to the smallest that fits. */
  version?: number;
  /** Force a specific mask pattern (0-7). Defaults to the lowest-penalty one. */
  mask?: number;
}
