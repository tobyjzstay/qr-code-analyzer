// Verifies our QR encoder bit-for-bit against the battle-tested `qrcode`
// library. We force the same version / EC level / mask on both sides so the
// matrices must be identical. Also checks that our automatic mask selection
// agrees with the library's. Run with: node scripts/verify-qr.mjs
//
// Uses tsx-free execution by importing the compiled-on-the-fly TS through a
// tiny loader: we instead just import the .ts via Node's strip-types support.

import QRCode from "qrcode";
import { analyze } from "../lib/qr/analyze.ts";

const levels = ["L", "M", "Q", "H"];

const inputs = [
  "https://click.example.com/laptops:/home/",
  "HELLO WORLD",
  "hello",
  "a",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "https://www.anthropic.com/claude-code",
  "1234567890",
  "The quick brown fox jumps over the lazy dog. " .repeat(3),
  "Ünïcödé tëst — émojis are multibyte",
  "x".repeat(200),
];

function libMatrix(text, level, version, mask) {
  // Force byte mode so segmentation matches our encoder.
  const qr = QRCode.create([{ data: text, mode: "byte" }], {
    errorCorrectionLevel: level,
    version,
    maskPattern: mask,
  });
  return qr;
}

let total = 0;
let failures = 0;

function compare(text, level, forceMask) {
  total++;
  let ours;
  try {
    ours = analyze(text, {
      errorCorrectionLevel: level,
      mask: forceMask,
    });
  } catch (e) {
    failures++;
    console.error(`✗ analyze threw for ${JSON.stringify(text.slice(0, 20))} [${level}]: ${e.message}`);
    return;
  }

  const qr = libMatrix(text, level, ours.version, forceMask);
  const libSize = qr.modules.size;

  // mask agreement (when not forced)
  if (forceMask === undefined && qr.maskPattern !== ours.maskPattern) {
    failures++;
    console.error(
      `✗ mask mismatch for ${JSON.stringify(text.slice(0, 20))} [${level}]: ours=${ours.maskPattern} lib=${qr.maskPattern}`,
    );
    return;
  }
  if (libSize !== ours.size) {
    failures++;
    console.error(`✗ size mismatch: ours=${ours.size} lib=${libSize}`);
    return;
  }

  let diff = 0;
  for (let r = 0; r < libSize; r++) {
    for (let c = 0; c < libSize; c++) {
      const libDark = qr.modules.get(r, c) ? 1 : 0;
      const ourDark = ours.modules[r][c].dark ? 1 : 0;
      if (libDark !== ourDark) diff++;
    }
  }
  if (diff !== 0) {
    failures++;
    console.error(
      `✗ ${diff} module(s) differ for ${JSON.stringify(text.slice(0, 24))} [${level}] v${ours.version} mask=${ours.maskPattern}`,
    );
  }
}

for (const text of inputs) {
  for (const level of levels) {
    // automatic mask (verifies penalty logic too)
    compare(text, level, undefined);
    // every forced mask (verifies placement + EC + format)
    for (let m = 0; m < 8; m++) compare(text, level, m);
  }
}

console.log(`\n${total - failures}/${total} checks passed.`);
process.exit(failures ? 1 : 0);
