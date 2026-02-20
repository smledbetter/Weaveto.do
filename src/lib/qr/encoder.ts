/**
 * Minimal QR code encoder — byte mode, EC level L, versions 1-6.
 * Zero dependencies. Outputs SVG string.
 *
 * Supports data up to 134 bytes (version 6), sufficient for room URLs.
 */

// --- GF(256) arithmetic for Reed-Solomon ---

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = x << 1;
    if (x & 0x100) x ^= 0x11d; // primitive polynomial for GF(256)
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Reed-Solomon error correction codewords */
function rsEncode(data: number[], ecCount: number): number[] {
  // Build generator polynomial
  const gen = new Uint8Array(ecCount + 1);
  gen[0] = 1;
  for (let i = 0; i < ecCount; i++) {
    for (let j = i + 1; j >= 1; j--) {
      gen[j] = gen[j] ^ gfMul(gen[j - 1], GF_EXP[i]);
    }
  }

  const result = new Uint8Array(ecCount);
  for (const byte of data) {
    const coef = byte ^ result[0];
    for (let i = 0; i < ecCount - 1; i++) {
      result[i] = result[i + 1] ^ gfMul(gen[i + 1], coef);
    }
    result[ecCount - 1] = gfMul(gen[ecCount], coef);
  }
  return Array.from(result);
}

// --- QR version parameters (EC level L only) ---

interface VersionInfo {
  version: number;
  size: number;       // modules per side
  dataBytes: number;  // total data codewords
  ecPerBlock: number; // EC codewords per block
  blocks: number;     // number of blocks
  alignments: number[]; // alignment pattern centers
}

const VERSIONS: VersionInfo[] = [
  { version: 1, size: 21, dataBytes: 19, ecPerBlock: 7,  blocks: 1, alignments: [] },
  { version: 2, size: 25, dataBytes: 34, ecPerBlock: 10, blocks: 1, alignments: [18] },
  { version: 3, size: 29, dataBytes: 55, ecPerBlock: 15, blocks: 1, alignments: [22] },
  { version: 4, size: 33, dataBytes: 80, ecPerBlock: 20, blocks: 1, alignments: [26] },
  { version: 5, size: 37, dataBytes: 108, ecPerBlock: 26, blocks: 1, alignments: [30] },
  { version: 6, size: 41, dataBytes: 136, ecPerBlock: 18, blocks: 2, alignments: [34] },
];

function selectVersion(byteCount: number): VersionInfo {
  // Byte mode overhead: 4 bits mode + 8/16 bits length + data + terminator
  for (const v of VERSIONS) {
    const lengthBits = v.version <= 9 ? 8 : 16;
    const overhead = Math.ceil((4 + lengthBits) / 8);
    if (byteCount + overhead <= v.dataBytes) return v;
  }
  throw new Error(`Data too long for QR versions 1-6 (max ~134 bytes)`);
}

// --- Data encoding ---

function encodeData(data: string, ver: VersionInfo): number[] {
  const bytes = new TextEncoder().encode(data);
  const lengthBits = ver.version <= 9 ? 8 : 16;

  // Build bit stream: mode(4) + length + data + terminator
  const bits: number[] = [];
  const push = (val: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  push(0b0100, 4); // byte mode indicator
  push(bytes.length, lengthBits);
  for (const b of bytes) push(b, 8);

  // Terminator (up to 4 zeros)
  const totalBits = ver.dataBytes * 8;
  const termLen = Math.min(4, totalBits - bits.length);
  push(0, termLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Convert to bytes
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  // Pad to fill data capacity
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (codewords.length < ver.dataBytes) {
    codewords.push(padBytes[padIdx % 2]);
    padIdx++;
  }

  return codewords;
}

// --- Interleave data and EC codewords ---

function interleave(data: number[], ver: VersionInfo): number[] {
  const blockSize = Math.floor(ver.dataBytes / ver.blocks);
  const extraBytes = ver.dataBytes % ver.blocks;

  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;

  for (let b = 0; b < ver.blocks; b++) {
    const size = blockSize + (b >= ver.blocks - extraBytes ? 1 : 0);
    const block = data.slice(offset, offset + size);
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ver.ecPerBlock));
    offset += size;
  }

  // Interleave data codewords
  const result: number[] = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  // Interleave EC codewords
  for (let i = 0; i < ver.ecPerBlock; i++) {
    for (const block of ecBlocks) {
      result.push(block[i]);
    }
  }

  return result;
}

// --- Matrix construction ---

type Matrix = (boolean | null)[][];

function createMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

function setModule(m: Matrix, row: number, col: number, dark: boolean): void {
  if (row >= 0 && row < m.length && col >= 0 && col < m.length) {
    m[row][col] = dark;
  }
}

function placeFinderPattern(m: Matrix, row: number, col: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= m.length || cc < 0 || cc >= m.length) continue;
      const dark =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      m[rr][cc] = dark;
    }
  }
}

function placeAlignmentPattern(m: Matrix, row: number, col: number): void {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      if (m[row + r][col + c] !== null) return; // skip if overlapping finder
    }
  }
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark =
        Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
      m[row + r][col + c] = dark;
    }
  }
}

function placeTimingPatterns(m: Matrix): void {
  const size = m.length;
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    if (m[6][i] === null) m[6][i] = dark;
    if (m[i][6] === null) m[i][6] = dark;
  }
}

function reserveFormatArea(m: Matrix): void {
  const size = m.length;
  // Around top-left finder
  for (let i = 0; i <= 8; i++) {
    if (m[8][i] === null) m[8][i] = false;
    if (m[i][8] === null) m[i][8] = false;
  }
  // Around top-right finder
  for (let i = 0; i <= 7; i++) {
    if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = false;
  }
  // Around bottom-left finder
  for (let i = 0; i <= 7; i++) {
    if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = false;
  }
  // Dark module
  m[size - 8][8] = true;
}

function placeData(m: Matrix, bits: number[]): void {
  const size = m.length;
  let bitIdx = 0;
  let upward = true;

  for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col = 5; // skip timing column

    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const row of rows) {
      for (let c = 0; c <= 1; c++) {
        const cc = col - c;
        if (m[row][cc] === null) {
          m[row][cc] = bitIdx < bits.length ? bits[bitIdx] === 1 : false;
          bitIdx++;
        }
      }
    }
    upward = !upward;
  }
}

// --- Masking ---

const MASK_FNS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function isDataModule(m: Matrix, row: number, col: number, alignments: number[]): boolean {
  // A module is "data" if it was null before data placement
  // We detect this by checking if it's not in a reserved area
  const size = m.length;

  // Finder patterns + separators
  if (row <= 8 && col <= 8) return false; // top-left
  if (row <= 8 && col >= size - 8) return false; // top-right
  if (row >= size - 8 && col <= 8) return false; // bottom-left

  // Timing patterns
  if (row === 6 || col === 6) return false;

  // Alignment patterns
  for (const pos of alignments) {
    if (Math.abs(row - pos) <= 2 && Math.abs(col - pos) <= 2) return false;
  }

  return true;
}

function applyMask(m: Matrix, maskIdx: number, alignments: number[]): Matrix {
  const size = m.length;
  const result = m.map((row) => [...row]);
  const fn = MASK_FNS[maskIdx];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isDataModule(result, r, c, alignments) && result[r][c] !== null) {
        if (fn(r, c)) {
          result[r][c] = !result[r][c];
        }
      }
    }
  }
  return result;
}

function penaltyScore(m: Matrix): number {
  const size = m.length;
  let score = 0;

  // Rule 1: runs of same color in rows/cols
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (m[r][c] === m[r][c - 1]) {
        run++;
      } else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (m[r][c] === m[r - 1][c]) {
        run++;
      } else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 4: proportion of dark modules
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (m[r][c]) dark++;
    }
  }
  const percent = (dark / (size * size)) * 100;
  const prev5 = Math.floor(percent / 5) * 5;
  const next5 = prev5 + 5;
  score +=
    Math.min(Math.abs(prev5 - 50) / 5, Math.abs(next5 - 50) / 5) * 10;

  return score;
}

// --- Format information ---

// Pre-computed format info bits for EC level L (00) and mask patterns 0-7
// Format: 15-bit BCH-encoded value
const FORMAT_INFO: number[] = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
];

function placeFormatInfo(m: Matrix, maskIdx: number): void {
  const size = m.length;
  const info = FORMAT_INFO[maskIdx];

  // Copy 1 horizontal (row 8): F14 at col 0 through F7 at col 8
  const c1hCols = [0, 1, 2, 3, 4, 5, 7, 8];
  for (let i = 0; i < 8; i++) m[8][c1hCols[i]] = ((info >> (14 - i)) & 1) === 1;

  // Copy 1 vertical (col 8): F6 at row 7 through F0 at row 0
  const c1vRows = [7, 5, 4, 3, 2, 1, 0];
  for (let i = 0; i < 7; i++) m[c1vRows[i]][8] = ((info >> (6 - i)) & 1) === 1;

  // Copy 2 horizontal (row 8): F7 at col size-8 through F0 at col size-1
  for (let i = 0; i < 8; i++) m[8][size - 8 + i] = ((info >> (7 - i)) & 1) === 1;

  // Copy 2 vertical (col 8): F14 at row size-7 through F8 at row size-1
  for (let i = 0; i < 7; i++) m[size - 7 + i][8] = ((info >> (14 - i)) & 1) === 1;
}

// --- Public API ---

export interface QrOptions {
  size?: number;  // SVG size in pixels (default 200)
  fg?: string;    // foreground color (default '#000')
  bg?: string;    // background color (default '#fff')
}

/**
 * Generate a QR code as an SVG string.
 * Supports byte-mode encoding, EC level L, versions 1-6.
 */
export function qrSvg(data: string, opts?: QrOptions): string {
  const svgSize = opts?.size ?? 200;
  const fg = opts?.fg ?? '#000';
  const bg = opts?.bg ?? '#fff';

  const ver = selectVersion(new TextEncoder().encode(data).length);
  const codewords = encodeData(data, ver);
  const allWords = interleave(codewords, ver);

  // Convert to bits
  const bits: number[] = [];
  for (const w of allWords) {
    for (let i = 7; i >= 0; i--) {
      bits.push((w >> i) & 1);
    }
  }

  // Build base matrix
  const m = createMatrix(ver.size);

  // Place finder patterns
  placeFinderPattern(m, 0, 0);
  placeFinderPattern(m, 0, ver.size - 7);
  placeFinderPattern(m, ver.size - 7, 0);

  // Place alignment patterns
  for (const pos of ver.alignments) {
    placeAlignmentPattern(m, pos, pos);
    if (ver.alignments.length > 1) {
      placeAlignmentPattern(m, 6, pos);
      placeAlignmentPattern(m, pos, 6);
    }
  }

  // Timing patterns
  placeTimingPatterns(m);

  // Reserve format area
  reserveFormatArea(m);

  // Place data
  placeData(m, bits);

  // Find best mask
  let bestMask = 0;
  let bestScore = Infinity;
  for (let i = 0; i < 8; i++) {
    const masked = applyMask(m, i, ver.alignments);
    placeFormatInfo(masked, i);
    const score = penaltyScore(masked);
    if (score < bestScore) {
      bestScore = score;
      bestMask = i;
    }
  }

  // Apply best mask
  const final = applyMask(m, bestMask, ver.alignments);
  placeFormatInfo(final, bestMask);

  // Render SVG with integer coordinates to avoid subpixel rendering issues on mobile.
  // Each module = 1 unit in viewBox; the quiet zone adds 4 modules on each side.
  const totalModules = ver.size + 8;
  const quietZone = 4;
  let path = '';

  for (let r = 0; r < ver.size; r++) {
    for (let c = 0; c < ver.size; c++) {
      if (final[r][c]) {
        const x = quietZone + c;
        const y = quietZone + r;
        path += `M${x},${y}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${totalModules}" width="${svgSize}" height="${svgSize}" shape-rendering="crispEdges"><rect width="${totalModules}" height="${totalModules}" fill="${bg}"/><path d="${path}" fill="${fg}"/></svg>`;
}

/** Exported for testing */
export { selectVersion, encodeData, rsEncode, interleave };
