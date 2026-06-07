// GF(256) arithmetic for Reed-Solomon error correction, using the QR code
// primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D) with generator 2.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  // Double the exp table so we never have to mod 255 when multiplying.
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

export function exp(n: number): number {
  return EXP[n];
}

export function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Multiply two polynomials (coefficients high-degree first) over GF(256). */
export function polyMul(p1: Uint8Array, p2: Uint8Array): Uint8Array {
  const out = new Uint8Array(p1.length + p2.length - 1);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      out[i + j] ^= mul(p1[i], p2[j]);
    }
  }
  return out;
}

/** The generator polynomial of the given degree for Reed-Solomon encoding. */
export function generatorPoly(degree: number): Uint8Array {
  let poly: Uint8Array = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    poly = polyMul(poly, new Uint8Array([1, exp(i)]));
  }
  return poly;
}

/**
 * Compute the `degree` Reed-Solomon error-correction codewords for a block of
 * data codewords. This is the remainder of dividing the data (shifted up by
 * `degree`) by the generator polynomial.
 */
export function reedSolomon(data: Uint8Array, degree: number): Uint8Array {
  const gen = generatorPoly(degree);
  let result: Uint8Array = new Uint8Array(data.length + degree);
  result.set(data);

  while (result.length - gen.length >= 0) {
    const coeff = result[0];
    if (coeff !== 0) {
      for (let i = 0; i < gen.length; i++) {
        result[i] ^= mul(gen[i], coeff);
      }
    }
    // Drop leading zeros.
    let offset = 0;
    while (offset < result.length && result[offset] === 0) offset++;
    result = result.slice(offset);
  }

  // Left-pad to `degree` coefficients.
  if (result.length < degree) {
    const padded = new Uint8Array(degree);
    padded.set(result, degree - result.length);
    return padded;
  }
  return result;
}
