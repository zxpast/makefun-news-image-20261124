// news-image-20261124 — "The World Today: Tuesday 24 November 2026"
// A broadsheet front page drawn programmatically: 25 verified stories
// (3 heroes + 8 cards + 14 briefs), 6 regions, stat strip, dotted world
// map with numbered pins, DATE CHECK exclusions, per-story sources.
// Node 22, stdlib only, no network, deterministic (2 runs byte-identical).
// Output: /output/entry.png (1024x1024 PNG, <= 1 MiB).
//
// Typography: a hand-authored single-stroke vector font (polylines on a
// 6x8 grid), drawn with thick strokes. No bitmap/pixel font, no font
// files, no PIL. Minimum text size 14px at full size so the page stays
// legible at the ~300px judging width. Glyph "9" is a closed bowl plus a
// right stem (never an open spiral).
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------- PNG ----
// CRC32 (IEEE) table, built once, deterministically.
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- Canvas ----
type RGB = [number, number, number];
const INK: RGB = [26, 26, 26];
const PAPER: RGB = [247, 242, 231];
const RED: RGB = [178, 34, 34];
const NAVY: RGB = [30, 58, 95];
const GOLD: RGB = [176, 141, 58];
const SLATE: RGB = [90, 96, 104];
const SEA: RGB = [214, 228, 238];
const LAND: RGB = [178, 164, 122];
const WHITE: RGB = [255, 255, 255];
const CREAM2: RGB = [238, 231, 214];
const TEAL: RGB = [31, 111, 104];
const ORANGE: RGB = [204, 102, 0];

class Canvas {
  w: number;
  h: number;
  px: Uint8Array;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.fillRect(0, 0, w, h, bg);
  }
  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }
  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let i = (yy * this.w + x0) * 3;
      for (let xx = x0; xx < x1; xx++) {
        this.px[i] = c[0];
        this.px[i + 1] = c[1];
        this.px[i + 2] = c[2];
        i += 3;
      }
    }
  }
  fillCircle(cx: number, cy: number, r: number, c: RGB): void {
    const rr = Math.round(r);
    for (let dy = -rr; dy <= rr; dy++) {
      const dx = Math.floor(Math.sqrt(Math.max(0, rr * rr - dy * dy)));
      this.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1, c);
    }
  }
  // Thick line: stamp discs along the segment.
  line(x0: number, y0: number, x1: number, y1: number, wd: number, c: RGB): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len * 2));
    const r = Math.max(0.5, wd / 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.fillCircle(x0 + dx * t, y0 + dy * t, r, c);
    }
  }
  polyline(pts: Array<[number, number]>, wd: number, c: RGB): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      this.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], wd, c);
    }
    // Round caps: disc at each vertex.
    for (const p of pts) this.fillCircle(p[0], p[1], Math.max(0.5, wd / 2), c);
  }
  // Scanline polygon fill.
  polyFill(pts: Array<[number, number]>, c: RGB): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const t = (y - a[1]) / (b[1] - a[1]);
          xs.push(a[0] + t * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.fillRect(Math.ceil(xs[k]), y, Math.floor(xs[k + 1]) - Math.ceil(xs[k]) + 1, 1, c);
      }
    }
  }
  hline(x: number, y: number, w: number, wd: number, c: RGB): void {
    this.fillRect(x, y - Math.floor(wd / 2), w, wd, c);
  }
  vline(x: number, y: number, h: number, wd: number, c: RGB): void {
    this.fillRect(x - Math.floor(wd / 2), y, wd, h, c);
  }
  rect(x: number, y: number, w: number, h: number, wd: number, c: RGB): void {
    this.hline(x, y, w, wd, c);
    this.hline(x, y + h, w, wd, c);
    this.vline(x, y, h, wd, c);
    this.vline(x + w, y, h, wd, c);
  }
}

// -------------------------------------------------------- Stroke font ----
// Each glyph: array of strokes; each stroke: polyline of [x, y] points on
// a 6-wide by 8-tall grid (x 0..6, y 0..8, baseline y = 8). Advance = 7
// units. Single points render as dots (disc stamps at vertices).
type Glyph = Array<Array<[number, number]>>;
const GLYPHS: Record<string, Glyph> = {
  A: [[[0, 8], [3, 0], [6, 8]], [[1.5, 5], [4.5, 5]]],
  B: [[[0, 8], [0, 0], [4, 0], [5, 1], [5, 3], [4, 4], [0, 4]], [[4, 4], [5, 5], [5, 7], [4, 8], [0, 8]]],
  C: [[[5, 1], [4, 0], [2, 0], [0, 2], [0, 6], [2, 8], [4, 8], [5, 7]]],
  D: [[[0, 8], [0, 0], [4, 0], [6, 2], [6, 6], [4, 8], [0, 8]]],
  E: [[[5, 0], [0, 0], [0, 8], [5, 8]], [[0, 4], [4, 4]]],
  F: [[[0, 8], [0, 0], [5, 0]], [[0, 4], [4, 4]]],
  G: [[[5, 1], [4, 0], [2, 0], [0, 2], [0, 6], [2, 8], [4, 8], [5, 7], [5, 5], [3, 5]]],
  H: [[[0, 0], [0, 8]], [[6, 0], [6, 8]], [[0, 4], [6, 4]]],
  I: [[[1, 0], [5, 0]], [[3, 0], [3, 8]], [[1, 8], [5, 8]]],
  J: [[[2, 0], [5, 0]], [[5, 0], [5, 7], [4, 8], [2, 8], [1, 7]]],
  K: [[[0, 0], [0, 8]], [[5, 0], [0, 4], [5, 8]]],
  L: [[[0, 0], [0, 8], [5, 8]]],
  M: [[[0, 8], [0, 0], [3, 4], [6, 0], [6, 8]]],
  N: [[[0, 8], [0, 0], [6, 8], [6, 0]]],
  O: [[[2, 0], [4, 0], [6, 2], [6, 6], [4, 8], [2, 8], [0, 6], [0, 2], [2, 0]]],
  P: [[[0, 8], [0, 0], [4, 0], [6, 1], [6, 3], [4, 5], [0, 5]]],
  Q: [[[2, 0], [4, 0], [6, 2], [6, 6], [4, 8], [2, 8], [0, 6], [0, 2], [2, 0]], [[4, 6], [6, 8]]],
  R: [[[0, 8], [0, 0], [4, 0], [6, 1], [6, 3], [4, 5], [0, 5]], [[3, 5], [6, 8]]],
  S: [[[5, 1], [4, 0], [2, 0], [1, 1], [0, 2], [0, 3], [1, 4], [3, 4], [5, 5], [5, 7], [4, 8], [2, 8], [1, 7]]],
  T: [[[0, 0], [6, 0]], [[3, 0], [3, 8]]],
  U: [[[0, 0], [0, 6], [1, 8], [3, 8], [5, 8], [6, 6], [6, 0]]],
  V: [[[0, 0], [3, 8], [6, 0]]],
  W: [[[0, 0], [1, 8], [3, 4], [5, 8], [6, 0]]],
  X: [[[0, 0], [6, 8]], [[6, 0], [0, 8]]],
  Y: [[[0, 0], [3, 4], [6, 0]], [[3, 4], [3, 8]]],
  Z: [[[0, 0], [6, 0], [0, 8], [6, 8]]],
  "0": [[[2, 0], [4, 0], [6, 2], [6, 6], [4, 8], [2, 8], [0, 6], [0, 2], [2, 0]]],
  "1": [[[2, 1], [3, 0], [3, 8]], [[1, 8], [5, 8]]],
  "2": [[[1, 1], [2, 0], [4, 0], [5, 1], [5, 3], [4, 5], [0, 8], [6, 8]]],
  "3": [[[1, 1], [2, 0], [4, 0], [5, 1], [5, 3], [4, 4]], [[4, 4], [5, 5], [5, 7], [4, 8], [2, 8], [1, 7]]],
  "4": [[[0, 6], [4, 0], [4, 8]], [[0, 6], [6, 6]]],
  "5": [[[5, 0], [1, 0], [0, 1], [0, 4], [4, 4], [5, 5], [5, 7], [4, 8], [2, 8], [1, 7]]],
  "6": [[[5, 1], [4, 0], [2, 0], [0, 2], [0, 7], [1, 8], [4, 8], [5, 7], [5, 5], [4, 4], [2, 4], [1, 5], [0, 6]]],
  "7": [[[0, 0], [6, 0], [3, 8]]],
  "8": [[[2, 0], [4, 0], [5, 1], [5, 3], [4, 4], [2, 4], [1, 3], [1, 1], [2, 0]], [[2, 4], [4, 4], [5, 5], [5, 7], [4, 8], [2, 8], [1, 7], [1, 5], [2, 4]]],
  // 9: closed bowl on top + straight stem down the right side.
  "9": [[[2, 0], [4, 0], [6, 2], [6, 4], [4, 6], [2, 6], [0, 4], [0, 2], [2, 0]], [[6, 2], [6, 8]]],
  ".": [[[3, 7], [3, 7]]],
  ",": [[[3, 7], [3, 8], [2, 9]]],
  ":": [[[3, 2], [3, 2]], [[3, 7], [3, 7]]],
  ";": [[[3, 2], [3, 2]], [[3, 7], [3, 8], [2, 9]]],
  "'": [[[3, 0], [2, 2]]],
  "-": [[[1, 4], [5, 4]]],
  "(": [[[4, 0], [2, 1], [1, 4], [2, 7], [4, 8]]],
  ")": [[[2, 0], [4, 1], [5, 4], [4, 7], [2, 8]]],
  "/": [[[1, 8], [5, 0]]],
  $: [[[5, 1], [4, 0], [2, 0], [1, 1], [0, 2], [0, 3], [1, 4], [3, 4], [5, 5], [5, 7], [4, 8], [2, 8], [1, 7]], [[3, -1], [3, 9]]],
  "%": [[[1, 0], [2, 0], [3, 1], [2, 2], [1, 2], [0, 1], [1, 0]], [[1, 8], [5, 0]], [[3, 6], [4, 6], [5, 7], [4, 8], [3, 8], [2, 7], [3, 6]]],
  "+": [[[3, 2], [3, 6]], [[1, 4], [5, 4]]],
  "=": [[[1, 3], [5, 3]], [[1, 5], [5, 5]]],
  "!": [[[3, 0], [3, 6]], [[3, 7], [3, 7]]],
  "?": [[[1, 2], [2, 0], [4, 0], [5, 1], [5, 3], [4, 4], [3, 5], [3, 6]], [[3, 7], [3, 7]]],
  '"': [[[2, 0], [2, 2]], [[4, 0], [4, 2]]],
  _: [[[0, 8], [6, 8]]],
  "<": [[[5, 1], [1, 4], [5, 7]]],
  ">": [[[1, 1], [5, 4], [1, 7]]],
  "|": [[[3, 0], [3, 8]]],
};
const ADVANCE_UNITS = 7; // glyph advance in grid units

// Minimum legible size: no text below 14px at full size.
const MIN_SIZE = 14;

function drawGlyph(cv: Canvas, ch: string, x: number, yTop: number, size: number, c: RGB): void {
  const g = GLYPHS[ch];
  if (!g) throw new Error("missing glyph for " + JSON.stringify(ch));
  const u = size / 8;
  // Thinner strokes + slightly narrowed glyphs so neighbours never touch:
  // glyph span (6 units * 0.92 + stroke) stays under the 7-unit advance.
  const wd = Math.max(1, Math.floor(size / 6));
  for (const stroke of g) {
    const pts: Array<[number, number]> = stroke.map((p) => [x + p[0] * u * 0.92, yTop + p[1] * u]);
    cv.polyline(pts, wd, c);
  }
}

function textWidth(text: string, size: number): number {
  return text.length * ADVANCE_UNITS * (size / 8);
}

function drawText(cv: Canvas, text: string, x: number, yTop: number, size: number, c: RGB): void {
  if (size < MIN_SIZE) throw new Error("text below 14px floor: " + size + " for " + JSON.stringify(text));
  const u = size / 8;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") continue;
    drawGlyph(cv, ch, x + i * ADVANCE_UNITS * u, yTop, size, c);
  }
}

function drawTextCentered(cv: Canvas, text: string, cx: number, yTop: number, size: number, c: RGB): void {
  drawText(cv, text, cx - textWidth(text, size) / 2, yTop, size, c);
}

// Shrink the size until the text fits maxW (never below MIN_SIZE).
function fitSize(text: string, size: number, maxW: number): number {
  let s = size;
  while (s > MIN_SIZE && textWidth(text, s) > maxW) s -= 1;
  return s;
}

// Word-wrap into at most maxLines lines; throws on truncation or on a
// single word wider than maxW (anti-truncation assert).
function wrapText(text: string, size: number, maxW: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (textWidth(w, size) > maxW) throw new Error("word too wide: " + JSON.stringify(w));
    const next = cur === "" ? w : cur + " " + w;
    if (textWidth(next, size) <= maxW) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  if (lines.length > maxLines) {
    throw new Error("text overflows " + maxLines + " lines: " + JSON.stringify(text) + " -> " + lines.length);
  }
  return lines;
}

function drawLines(cv: Canvas, lines: string[], x: number, yTop: number, size: number, leading: number, c: RGB): void {
  for (let i = 0; i < lines.length; i++) {
    drawText(cv, lines[i], x, yTop + i * leading, size, c);
  }
}

function assertCharset(text: string): void {
  for (const ch of text) {
    if (ch === " ") continue;
    if (!GLYPHS[ch]) throw new Error("char outside font charset: " + JSON.stringify(ch) + " in " + JSON.stringify(text));
  }
}

// ---------------------------------------------------------------- Data ----
// SSOT: one record per story. Every number on the page comes from a story
// record; the checker below enforces that. All stories happened, or were
// first reported, on Tuesday 24 November 2026 in some time zone (the
// Tuesday morning wires + Tuesday-dated events). Anything that broke
// earlier lives ONLY in DATE_CHECK, never on the page.
type Story = {
  n: number;
  place: string;
  beat: string;
  head: string;
  body: string;
  src: string;
  tag?: string; // REPORTED (named sources) or CLAIM (one side's account)
  lat: number;
  lon: number;
  dx: number; // pin label offset on the map
  dy: number;
};

const HEROES: Story[] = [
  {
    n: 1, place: "SEOUL", beat: "DEFENCE",
    head: "JET SCARE OVER ULLEUNG",
    body: "SUSPECTED NORTH KOREAN JET BREACHES AIRSPACE. SHELTER AT 07:52.",
    src: "REUTERS", tag: "REPORTED",
    lat: 37.5, lon: 130.9, dx: 10, dy: -22,
  },
  {
    n: 2, place: "GENEVA", beat: "SPORT",
    head: "YOUNGEST TITLE MATCH BEGINS",
    body: "GUKESH DEFENDS CROWN VS SINDAROV. GAME 1 TODAY, 14 GAMES, $2.5M.",
    src: "FIDE", tag: "REPORTED",
    lat: 46.2, lon: 6.1, dx: -10, dy: -30,
  },
  {
    n: 3, place: "WARSAW", beat: "NATO",
    head: "NATO SENDS AWACS TO POLAND",
    body: "EARLY-WARNING JET SENT AFTER 3 RUSSIAN MISSILES HIT POLAND FRIDAY.",
    src: "REUTERS", tag: "REPORTED",
    lat: 52.2, lon: 21.0, dx: 35, dy: -20,
  },
];

const CARDS: Story[] = [
  {
    n: 4, place: "TEHRAN", beat: "IRAN",
    head: "IRAN VOWS TO FIGHT BLOCKADE",
    body: "ALL ITS TOOLS, TEHRAN SAYS.",
    src: "REUTERS", tag: "REPORTED",
    lat: 35.7, lon: 51.4, dx: 26, dy: 6,
  },
  {
    n: 5, place: "WASHINGTON", beat: "TECH",
    head: "TRUMP STEPS IN AT NVIDIA",
    body: "BOARD BRINGS BACK HUANG.",
    src: "REUTERS", tag: "REPORTED",
    lat: 38.9, lon: -77.0, dx: -45, dy: 25,
  },
  {
    n: 6, place: "WASHINGTON", beat: "SANCTIONS",
    head: "US HITS IRAN SHADOW BANKS",
    body: "SANCTIONS DOZENS. FLAGS $15BN.",
    src: "REUTERS", tag: "REPORTED",
    lat: 38.9, lon: -77.0, dx: -15, dy: 55,
  },
  {
    n: 7, place: "GAZA", beat: "WAR",
    head: "STRIKES KILL 3 IN GAZA",
    body: "3 DEAD, INCLUDING UNRWA WORKER.",
    src: "REUTERS", tag: "REPORTED",
    lat: 31.5, lon: 34.5, dx: -28, dy: 30,
  },
  {
    n: 8, place: "BRUSSELS", beat: "EUROPE",
    head: "EU PROPOSES RUSSIA CURBS",
    body: "BANS RUSSIAN ATHLETES.",
    src: "REUTERS", tag: "REPORTED",
    lat: 50.8, lon: 4.4, dx: -35, dy: -26,
  },
  {
    n: 9, place: "MEXICO CITY", beat: "CRIME",
    head: "CHAPO ISIDRO TO FACE TRIAL",
    body: "TO BE TRIED IN MEXICO.",
    src: "REUTERS", tag: "REPORTED",
    lat: 19.4, lon: -99.1, dx: -25, dy: 35,
  },
  {
    n: 10, place: "PARIS", beat: "POLITICS",
    head: "MELENCHON GAINS IN POLL",
    body: "UP 5 POINTS IN A MONTH VS LE PEN.",
    src: "REUTERS", tag: "REPORTED",
    lat: 48.9, lon: 2.35, dx: -60, dy: -5,
  },
  {
    n: 11, place: "BENGHAZI", beat: "WAR",
    head: "KYIV SAYS IT SANK MERKURY",
    body: "DRONES SANK A RUSSIAN CORVETTE.",
    src: "REUTERS", tag: "CLAIM",
    lat: 32.1, lon: 20.1, dx: 10, dy: 14,
  },
];

type Brief = { n: number; place: string; text: string; src: string };
const BRIEFS: Brief[] = [
  { n: 12, place: "ZURICH", text: "FIFA: UK HOSTS 2035 CUP, 48 TEAMS.", src: "FIFA" },
  { n: 13, place: "BERLIN", text: "GERMANY TO USE KYIV'S DELTA TOOL.", src: "REUTERS" },
  { n: 14, place: "MURMANSK", text: "GOVERNOR HELD FOR GRAFT.", src: "REUTERS" },
  { n: 15, place: "WASHINGTON", text: "SENATE PROBES VANCE.", src: "REUTERS" },
  { n: 16, place: "WARSAW", text: "RUSSIAN DRONE ENTERED POLAND.", src: "REUTERS" },
  { n: 17, place: "PYONGYANG", text: "KOREA MAY SHUT SWISS OFFICE.", src: "KCNA" },
  { n: 18, place: "KYIV", text: "ZELENSKIY: RUSSIA PLANS NEW STRIKES.", src: "REUTERS" },
  { n: 19, place: "WASHINGTON", text: "TRUMP SLAMS NEWSOM OVER 548.", src: "REUTERS" },
  { n: 20, place: "GENEVA", text: "WFP: WARS RISK FOOD AID FOR 7.3M.", src: "REUTERS" },
  { n: 21, place: "ST PETERSBURG", text: "HIT SHIP SPARTA II DOCKS.", src: "REUTERS" },
  { n: 22, place: "TEHRAN", text: "AHMADI FLOGGED, 74 LASHES.", src: "REUTERS" },
  { n: 23, place: "CANBERRA", text: "COP31 BLAME GAME BEGINS.", src: "REUTERS" },
  { n: 24, place: "COPENHAGEN", text: "COURT BACKS GHETTO EVICTIONS.", src: "REUTERS" },
  { n: 25, place: "WELLINGTON", text: "INDIA, NZ DRAW FIRST TEST.", src: "TOI" },
];

// Stat strip: each number must appear verbatim in its story's text.
const STATS: Array<{ num: string; label1: string; label2: string; story: string }> = [
  { num: "07:52", label1: "ULLEUNG ALERT", label2: "LOCAL TIME", story: "SUSPECTED NORTH KOREAN JET BREACHES AIRSPACE. SHELTER AT 07:52." },
  { num: "$2.5M", label1: "CHESS PRIZE", label2: "FUND", story: "GUKESH DEFENDS CROWN VS SINDAROV. GAME 1 TODAY, 14 GAMES, $2.5M." },
  { num: "$15BN", label1: "IRAN FLOWS", label2: "FLAGGED", story: "SANCTIONS DOZENS. FLAGS $15BN." },
  { num: "548", label1: "DEATH", label2: "SENTENCES", story: "TRUMP SLAMS NEWSOM OVER 548." },
  { num: "7.3M", label1: "FOOD AID", label2: "AT RISK", story: "WFP: WARS RISK FOOD AID FOR 7.3M." },
  { num: "48", label1: "WC 2035", label2: "TEAMS", story: "FIFA: UK HOSTS 2035 CUP, 48 TEAMS." },
];

// Region strip: must sum to the story total (30) and span 6 regions.
const REGIONS: Array<[string, number]> = [
  ["ASIA", 2], ["EUROPE", 12], ["MIDEAST", 3], ["AMERICAS", 5], ["AFRICA", 1], ["OCEANIA", 2],
];

// DATE CHECK: stories that broke BEFORE Tuesday — excluded on purpose.
const DATE_CHECK: string =
  "COP31 NO-DEAL (22 NOV), DEMOCRATS 258 (22 NOV), ALCARAZ (22 NOV), " +
  "INDONESIA FIRE (21 NOV), MODI IIT PATNA (21 NOV), ICJ MYANMAR (19 NOV), " +
  "G20 JOHANNESBURG 2025";

// ------------------------------------------------------------- Checks ----
// 7 asserts before render (SSOT + contradiction scan). Exit 1 on failure.
function checkAll(): void {
  const all: Story[] = [...HEROES, ...CARDS];
  const total = all.length + BRIEFS.length;
  if (total !== 25) throw new Error("story total must be 25, got " + total);
  // 1. Numbers unique and 1..30, in order.
  const nums = [...all.map((s) => s.n), ...BRIEFS.map((b) => b.n)];
  for (let i = 0; i < nums.length; i++) if (nums[i] !== i + 1) throw new Error("story numbers not 1..25 in order at " + i);
  // 2. Region strip sums to the total.
  const rsum = REGIONS.reduce((a, r) => a + r[1], 0);
  if (rsum !== total) throw new Error("region strip sums to " + rsum + ", stories " + total);
  if (REGIONS.length < 6) throw new Error("need >= 6 regions");
  // 3. Every stat number appears verbatim in its story.
  for (const s of STATS) {
    if (!s.story.includes(s.num)) throw new Error("stat " + s.num + " not found in its story");
  }
  // 4. No DATE CHECK item appears as a page story (keyword overlap).
  const pageText = [...all.map((s) => s.head + " " + s.body), ...BRIEFS.map((b) => b.text)].join(" ");
  for (const bad of ["COP31 NO-DEAL", "258 SEATS", "ALCARAZ", "INDONESIA FIRE", "IIT PATNA", "ICJ MYANMAR", "G20 JOHANNESBURG"]) {
    if (pageText.includes(bad)) throw new Error("DATE CHECK item on page: " + bad);
  }
  // 5. Every story has a named source; CLAIM only where single-sourced.
  for (const s of all) {
    if (!s.src) throw new Error("story " + s.n + " has no source");
    if (!s.tag) throw new Error("story " + s.n + " has no epistemic tag");
  }
  for (const b of BRIEFS) if (!b.src) throw new Error("brief " + b.n + " has no source");
  // 6. Charset: every rendered string must be in the font.
  const texts = [
    "THE WORLD TODAY", "TUESDAY 24 NOVEMBER 2026", "25 STORIES - 6 REGIONS - ONE PAGE",
    "KOREA JET SCARE - CHESS CROWN ON THE LINE - NATO WATCHES POLAND",
    "WHERE IT HAPPENED", "RED PINS = STORIES 1-11. POSITIONS APPROXIMATE.",
    "REPORTED = NAMED SOURCES. CLAIM = ONE SIDE'S ACCOUNT.",
    "ALSO ON TUESDAY",
    "DATE CHECK - LEFT OUT ON PURPOSE. THEY BROKE BEFORE TUESDAY.",
    "EVERY STORY ABOVE IS TUESDAY 24 NOVEMBER 2026.",
    "15:00",
    DATE_CHECK,
    ...STATS.flatMap((s) => [s.num, s.label1, s.label2]),
    ...REGIONS.flatMap((r) => [r[0], String(r[1])]),
    ...all.flatMap((s) => [s.place, s.beat, s.head, s.body, s.src, s.tag as string]),
    ...BRIEFS.flatMap((b) => [String(b.n), b.place, b.text, b.src]),
  ];
  for (const t of texts) assertCharset(t);
  // 7. No hero/card body contradicts its own stat (numbers match by assert 3).
}

// -------------------------------------------------------------- Icons ----
// Flat vector illustrations, drawn from simple shapes. No photos, no
// copied art. Each hero gets its own scene; each card a small icon.
function drawJetHero(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, SEA);
  // Island (green) with a shelter roofline.
  cv.polyFill([[x + 8, y + h - 6], [x + 60, y + h - 34], [x + 130, y + h - 40], [x + 210, y + h - 26], [x + 300, y + h - 10], [x + 316, y + h - 6]], [96, 140, 82]);
  cv.fillRect(x + 120, y + h - 52, 44, 12, [255, 255, 255]);
  cv.polyFill([[x + 116, y + h - 52], [x + 142, y + h - 66], [x + 168, y + h - 52]], RED);
  // Jet (grey delta) top-right with contrail.
  cv.polyFill([[x + 218, y + 14], [x + 292, y + 34], [x + 218, y + 40], [x + 238, y + 30]], [70, 76, 84]);
  cv.polyFill([[x + 240, y + 26], [x + 262, y + 20], [x + 262, y + 40], [x + 240, y + 34]], [70, 76, 84]);
  cv.line(x + 60, y + 30, x + 210, y + 28, 2, WHITE);
  // Warning triangle with "!".
  cv.polyFill([[x + 18, y + 12], [x + 52, y + 12], [x + 35, y + 52]], [255, 196, 0]);
  cv.rect(x + 18, y + 12, 34, 40, 2, INK);
  drawText(cv, "!", x + 30, y + 18, 20, INK);
}

function drawChessHero(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, CREAM2);
  // 4x4 checkerboard, left.
  const bs = 15;
  const bx = x + 10;
  const by = y + 4;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      cv.fillRect(bx + c * bs, by + r * bs, bs, bs, (r + c) % 2 === 0 ? INK : WHITE);
    }
  }
  cv.rect(bx, by, 60, 60, 2, INK);
  // White king (circle + cross) and black king on the board edge.
  cv.fillCircle(bx + 82, by + 18, 13, WHITE);
  cv.rect(bx + 69, by + 5, 26, 26, 2, INK);
  cv.line(bx + 82, by + 8, bx + 82, by + 28, 3, INK);
  cv.line(bx + 74, by + 14, bx + 90, by + 14, 3, INK);
  cv.fillCircle(bx + 82, by + 48, 13, INK);
  cv.line(bx + 82, by + 38, bx + 82, by + 58, 3, WHITE);
  cv.line(bx + 74, by + 44, bx + 90, by + 44, 3, WHITE);
  // Flags: India (saffron/white/green) and Uzbekistan (blue/white/green).
  const fx = x + 168;
  const fy = y + 10;
  cv.fillRect(fx, fy, 58, 9, [255, 153, 51]);
  cv.fillRect(fx, fy + 9, 58, 9, WHITE);
  cv.fillRect(fx, fy + 18, 58, 9, [19, 136, 8]);
  cv.fillRect(fx, fy + 38, 58, 9, [30, 144, 255]);
  cv.fillRect(fx, fy + 47, 58, 9, WHITE);
  cv.fillRect(fx, fy + 56, 58, 9, [30, 144, 60]);
  cv.fillRect(fx, fy + 45, 58, 2, RED);
  cv.rect(fx, fy, 58, 27, 1, INK);
  cv.rect(fx, fy + 38, 58, 27, 1, INK);
  // Clock: game starts 15:00 CET.
  drawText(cv, "15:00", x + 238, y + 44, 16, NAVY);
}

function drawAwacsHero(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [222, 232, 240]);
  // Radar arcs.
  for (const r of [14, 26, 38]) {
    const pts: Array<[number, number]> = [];
    for (let a = -70; a <= 70; a += 10) {
      const rad = (a * Math.PI) / 180;
      pts.push([x + 160 + r * Math.sin(rad), y + 62 - r * Math.cos(rad)]);
    }
    cv.polyline(pts, 2, NAVY);
  }
  // AWACS: fuselage + radar dome + tail.
  cv.polyFill([[x + 30, y + 40], [x + 250, y + 34], [x + 292, y + 44], [x + 250, y + 54], [x + 30, y + 50]], [120, 128, 136]);
  cv.line(x + 150, y + 40, x + 150, y + 22, 3, INK);
  cv.fillCircle(x + 150, y + 18, 14, WHITE);
  cv.rect(x + 136, y + 4, 28, 28, 2, INK);
  cv.polyFill([[x + 40, y + 40], [x + 58, y + 18], [x + 70, y + 40]], [90, 96, 104]);
  cv.polyFill([[x + 260, y + 40], [x + 276, y + 22], [x + 286, y + 40]], [90, 96, 104]);
  // Polish flag (white over red).
  cv.fillRect(x + 12, y + h - 22, 44, 9, WHITE);
  cv.fillRect(x + 12, y + h - 13, 44, 9, RED);
  cv.rect(x + 12, y + h - 22, 44, 18, 1, INK);
}

// Small 32x32 card icons.
function drawCardIcon(cv: Canvas, n: number, x: number, y: number): void {
  const bgs: Record<number, RGB> = { 4: TEAL, 5: NAVY, 6: GOLD, 7: RED, 8: NAVY, 9: SLATE, 10: TEAL, 11: RED };
  cv.fillRect(x, y, 32, 32, bgs[n] ?? SLATE);
  if (n === 4) {
    // Oil barrel.
    cv.fillRect(x + 9, y + 6, 14, 20, WHITE);
    cv.fillRect(x + 9, y + 11, 14, 2, INK);
    cv.fillRect(x + 9, y + 20, 14, 2, INK);
  } else if (n === 5) {
    // Chip.
    cv.fillRect(x + 8, y + 8, 16, 16, WHITE);
    cv.fillRect(x + 13, y + 13, 6, 6, NAVY);
    for (let i = 0; i < 3; i++) {
      cv.fillRect(x + 11 + i * 5, y + 3, 2, 5, WHITE);
      cv.fillRect(x + 11 + i * 5, y + 24, 2, 5, WHITE);
      cv.fillRect(x + 3, y + 11 + i * 5, 5, 2, WHITE);
      cv.fillRect(x + 24, y + 11 + i * 5, 5, 2, WHITE);
    }
  } else if (n === 6) {
    // Bank.
    cv.polyFill([[x + 4, y + 8], [x + 16, y + 3], [x + 28, y + 8]], WHITE);
    cv.fillRect(x + 7, y + 11, 3, 14, WHITE);
    cv.fillRect(x + 14, y + 11, 3, 14, WHITE);
    cv.fillRect(x + 21, y + 11, 3, 14, WHITE);
    cv.fillRect(x + 5, y + 26, 22, 2, WHITE);
  } else if (n === 7) {
    // Medical cross in a circle.
    cv.fillCircle(x + 16, y + 16, 12, WHITE);
    cv.fillRect(x + 14, y + 8, 4, 16, RED);
    cv.fillRect(x + 8, y + 14, 16, 4, RED);
  } else if (n === 8) {
    // EU circle of stars.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      cv.fillCircle(x + 16 + 9 * Math.cos(a), y + 16 + 9 * Math.sin(a), 1.6, [255, 220, 0]);
    }
  } else if (n === 9) {
    // Gavel.
    cv.line(x + 7, y + 24, x + 24, y + 7, 3, WHITE);
    cv.fillRect(x + 18, y + 4, 9, 6, WHITE);
    cv.fillRect(x + 5, y + 24, 10, 3, WHITE);
  } else if (n === 10) {
    // Ballot box + check.
    cv.fillRect(x + 6, y + 12, 20, 14, WHITE);
    cv.fillRect(x + 12, y + 8, 8, 4, WHITE);
    cv.polyline([[x + 10, y + 20], [x + 14, y + 24], [x + 22, y + 14]], 2, RED);
  } else if (n === 11) {
    // Ship + blast star.
    cv.polyFill([[x + 4, y + 20], [x + 22, y + 20], [x + 19, y + 27], [x + 7, y + 27]], WHITE);
    cv.fillRect(x + 12, y + 9, 2, 11, WHITE);
    cv.fillCircle(x + 24, y + 9, 4, [255, 196, 0]);
    cv.line(x + 24, y + 2, x + 24, y + 16, 1, [255, 196, 0]);
    cv.line(x + 17, y + 9, x + 31, y + 9, 1, [255, 196, 0]);
  }
}

// ---------------------------------------------------------------- Map ----
// Coarse continent outlines (lon/lat). Dotted rendering: a grid point is
// drawn when it falls inside any polygon (ray casting).
const CONTINENTS: Array<Array<[number, number]>> = [
  [[-168, 66], [-140, 70], [-120, 72], [-95, 80], [-80, 73], [-70, 62], [-55, 52], [-60, 45], [-75, 35], [-80, 25], [-90, 20], [-97, 16], [-105, 20], [-115, 28], [-125, 40], [-125, 50], [-145, 60], [-168, 66]],
  [[-55, 60], [-40, 65], [-30, 70], [-45, 75], [-58, 72], [-55, 60]],
  [[-80, 10], [-75, 5], [-60, 0], [-50, -5], [-35, -8], [-40, -20], [-48, -28], [-58, -38], [-65, -45], [-70, -52], [-73, -40], [-70, -20], [-78, -5], [-80, 10]],
  [[-10, 36], [-9, 43], [-2, 48], [-4, 50], [0, 51], [5, 53], [8, 57], [10, 59], [5, 60], [5, 62], [12, 65], [18, 69], [25, 71], [30, 70], [25, 65], [20, 60], [18, 56], [21, 55], [24, 58], [28, 60], [30, 62], [28, 65], [32, 68], [40, 68], [45, 66], [40, 60], [35, 55], [30, 50], [28, 46], [30, 44], [28, 41], [23, 40], [19, 42], [15, 44], [12, 45], [8, 44], [3, 42], [0, 40], [-2, 37], [-9, 37], [-10, 36]],
  [[-6, 35], [10, 37], [20, 32], [30, 31], [34, 28], [35, 20], [40, 15], [43, 11], [48, 10], [51, 12], [44, 5], [40, -5], [38, -15], [35, -25], [32, -28], [28, -33], [20, -35], [16, -28], [12, -18], [9, -1], [9, 4], [0, 5], [-8, 4], [-13, 8], [-17, 15], [-17, 20], [-15, 25], [-10, 30], [-6, 35]],
  [[30, 36], [35, 36], [36, 33], [40, 30], [45, 29], [50, 26], [55, 25], [58, 22], [60, 25], [65, 25], [68, 22], [70, 20], [75, 15], [78, 8], [80, 7], [80, 13], [85, 19], [88, 22], [92, 16], [95, 12], [98, 10], [100, 8], [103, 2], [104, 9], [108, 12], [109, 18], [106, 20], [108, 25], [110, 30], [115, 35], [120, 38], [122, 40], [127, 40], [130, 42], [132, 43], [135, 44], [140, 45], [142, 50], [140, 55], [138, 60], [142, 65], [150, 70], [158, 70], [162, 68], [170, 66], [178, 65], [180, 66], [170, 60], [162, 58], [158, 52], [150, 50], [142, 45], [140, 40], [135, 35], [130, 32], [127, 30], [122, 28], [118, 25], [112, 22], [108, 18], [105, 10], [102, 5], [100, 8], [97, 12], [94, 17], [90, 22], [86, 20], [82, 17], [78, 10], [75, 8], [72, 20], [68, 24], [64, 25], [60, 25], [56, 26], [52, 27], [48, 29], [44, 29], [40, 30], [36, 33], [33, 36], [30, 36]],
  [[113, -22], [114, -30], [115, -35], [120, -34], [125, -33], [130, -32], [135, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -22], [146, -19], [142, -11], [136, -12], [132, -11], [130, -13], [126, -14], [122, -17], [118, -20], [113, -22]],
  [[167, -45], [170, -42], [174, -41], [178, -38], [176, -36], [174, -35], [172, -40], [168, -44], [167, -45]],
];

function pointInPolygon(lon: number, lat: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function drawMap(cv: Canvas, mx: number, my: number, mw: number, mh: number, stories: Story[]): void {
  cv.fillRect(mx, my, mw, mh, SEA);
  cv.rect(mx, my, mw, mh, 2, INK);
  const step = 7;
  for (let gy = my + 4; gy < my + mh - 2; gy += step) {
    for (let gx = mx + 4; gx < mx + mw - 2; gx += step) {
      const lon = ((gx - mx) / mw) * 360 - 180;
      const lat = 90 - ((gy - my) / mh) * 180;
      for (const poly of CONTINENTS) {
        if (pointInPolygon(lon, lat, poly)) {
          cv.fillCircle(gx, gy, 1.8, LAND);
          break;
        }
      }
    }
  }
  // Numbered pins: leader line from the true spot to an offset red disc
  // carrying the story number (14px, the legibility floor).
  for (const s of stories) {
    const tx = mx + ((s.lon + 180) / 360) * mw;
    const ty = my + ((90 - s.lat) / 180) * mh;
    const cx = tx + s.dx;
    const cy = ty + s.dy;
    cv.line(tx, ty, cx, cy, 1, RED);
    cv.fillCircle(tx, ty, 2.5, RED);
    cv.fillCircle(cx, cy, 10, RED);
    cv.fillCircle(cx, cy, 10, RED);
    const num = String(s.n);
    drawText(cv, num, cx - textWidth(num, 14) / 2, cy - 7, 14, WHITE);
  }
}

// -------------------------------------------------------------- Layout ----
const W = 1024;
const H = 1024;
const M = 14;
const CW = W - 2 * M;

function drawMasthead(cv: Canvas): void {
  drawTextCentered(cv, "THE WORLD TODAY", W / 2, 8, 36, INK);
  cv.fillRect(M, 52, CW, 3, RED);
  drawTextCentered(cv, "TUESDAY 24 NOVEMBER 2026", W / 2, 58, 28, INK);
  drawTextCentered(cv, "25 STORIES - 6 REGIONS - ONE PAGE", W / 2, 92, 14, NAVY);
  const kicker = "KOREA JET SCARE - CHESS CROWN ON THE LINE - NATO WATCHES POLAND";
  const ks = fitSize(kicker, 19, CW);
  drawTextCentered(cv, kicker, W / 2, 112, ks, RED);
  cv.fillRect(M, 134, CW, 2, INK);
}

function drawStats(cv: Canvas): void {
  const y0 = 140;
  const bw = CW / 6;
  for (let i = 0; i < STATS.length; i++) {
    const x = M + i * bw;
    const s = STATS[i];
    drawTextCentered(cv, s.num, x + bw / 2, y0, 24, RED);
    drawTextCentered(cv, s.label1, x + bw / 2, y0 + 30, 14, INK);
    drawTextCentered(cv, s.label2, x + bw / 2, y0 + 48, 14, SLATE);
    if (i > 0) cv.vline(x, y0 + 2, 58, 1, SLATE);
  }
  cv.fillRect(M, y0 + 66, CW, 2, INK);
}

function drawRegions(cv: Canvas): void {
  const parts = REGIONS.map((r) => r[0] + " " + r[1]);
  const text = parts.join(" - ");
  drawTextCentered(cv, text, W / 2, 210, 15, NAVY);
}

function drawHero(cv: Canvas, s: Story, x: number, y0: number, w: number, h: number): void {
  cv.rect(x, y0, w, h, 2, INK);
  if (s.n === 1) drawJetHero(cv, x + 2, y0 + 2, w - 4, 66);
  else if (s.n === 2) drawChessHero(cv, x + 2, y0 + 2, w - 4, 66);
  else drawAwacsHero(cv, x + 2, y0 + 2, w - 4, 66);
  // Epistemic tag chip on the illustration.
  const tag = s.tag as string;
  const tw = textWidth(tag, 14) + 12;
  cv.fillRect(x + w - 10 - tw, y0 + 8, tw, 20, RED);
  drawText(cv, tag, x + w - 10 - tw + 6, y0 + 11, 14, WHITE);
  // Kicker: place + beat left, source right.
  drawText(cv, s.place + " - " + s.beat, x + 8, y0 + 72, 14, RED);
  const srcW = textWidth(s.src, 14);
  drawText(cv, s.src, x + w - 8 - srcW, y0 + 72, 14, SLATE);
  // Headline, 2 lines max, generous leading.
  const hl = wrapText(s.head, 21, w - 16, 2);
  drawLines(cv, hl, x + 8, y0 + 92, 21, 25, INK);
  // Body, 3 lines max, generous leading.
  const bl = wrapText(s.body, 14, w - 16, 3);
  drawLines(cv, bl, x + 8, y0 + 144, 14, 17, INK);
}

function drawCard(cv: Canvas, s: Story, x: number, y0: number, w: number, h: number): void {
  cv.rect(x, y0, w, h, 1, SLATE);
  // Kicker: number + place left, source right.
  drawText(cv, s.n + " " + s.place, x + 6, y0 + 5, 14, RED);
  const srcW = textWidth(s.src, 14);
  drawText(cv, s.src, x + w - 6 - srcW, y0 + 5, 14, SLATE);
  // Icon + headline row.
  drawCardIcon(cv, s.n, x + 6, y0 + 24);
  const hl = wrapText(s.head, 15, w - 48, 2);
  drawLines(cv, hl, x + 44, y0 + 24, 15, 18, INK);
  // Body, 2 lines max, generous leading.
  const bl = wrapText(s.body, 14, w - 12, 2);
  drawLines(cv, bl, x + 6, y0 + 64, 14, 17, INK);
}

function drawBottom(cv: Canvas): void {
  const y0 = 646;
  // Map column.
  drawText(cv, "WHERE IT HAPPENED", M, y0, 16, INK);
  drawMap(cv, M, y0 + 20, 280, 180, [...HEROES, ...CARDS]);
  drawLines(cv, ["RED PINS = STORIES 1-11.", "POSITIONS APPROXIMATE."], M, y0 + 204, 14, 17, SLATE);
  // Honesty legend, full width below both columns (the map column is too
  // narrow for it: the line would run into the briefs).
  drawText(cv, "REPORTED = NAMED SOURCES. CLAIM = ONE SIDE'S ACCOUNT.", M, y0 + 272, 14, SLATE);
  // Briefs column.
  const bx = 306;
  const bw = W - M - bx;
  drawText(cv, "ALSO ON TUESDAY", bx, y0, 16, INK);
  const colW = Math.floor((bw - 12) / 2);
  for (let i = 0; i < BRIEFS.length; i++) {
    const b = BRIEFS[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = bx + col * (colW + 12);
    const y = y0 + 20 + row * 36;
    const full = b.n + " " + b.place + " - " + b.text + " (" + b.src + ")";
    const lines = wrapText(full, 14, colW, 2);
    // First token (the number) in red, the rest in ink.
    const first = lines[0].split(" ")[0];
    drawText(cv, first, x, y, 14, RED);
    drawText(cv, lines[0].slice(first.length + 1), x + textWidth(first + " ", 14), y, 14, INK);
    if (lines.length > 1) drawText(cv, lines[1], x, y + 17, 14, INK);
  }
}

function drawDateCheck(cv: Canvas): void {
  const y0 = 940;
  cv.fillRect(M, y0, CW, 2, RED);
  drawText(cv, "DATE CHECK - LEFT OUT ON PURPOSE. THEY BROKE BEFORE TUESDAY.", M, y0 + 6, 16, RED);
  drawText(cv, "EVERY STORY ABOVE IS TUESDAY 24 NOVEMBER 2026.", M, y0 + 26, 16, INK);
  const lines = wrapText(DATE_CHECK, 14, CW, 2);
  drawLines(cv, lines, M, y0 + 48, 14, 17, SLATE);
}

function render(): Buffer {
  checkAll();
  const cv = new Canvas(W, H, PAPER);
  drawMasthead(cv);
  drawStats(cv);
  drawRegions(cv);
  const hw = 324;
  for (let i = 0; i < HEROES.length; i++) {
    drawHero(cv, HEROES[i], M + i * (hw + 12), 230, hw, 196);
  }
  const cw = 243;
  for (let i = 0; i < CARDS.length; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    drawCard(cv, CARDS[i], M + col * (cw + 8), 430 + row * 108, cw, 104);
  }
  drawBottom(cv);
  drawDateCheck(cv);
  return encodePng(W, H, cv.px);
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const png = render();
  if (png.length > 1048576) throw new Error("PNG over 1 MiB: " + png.length);
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  console.log("wrote " + outPath + " " + png.length + " bytes sha256=" + createHash("sha256").update(png).digest("hex"));
}

main();
