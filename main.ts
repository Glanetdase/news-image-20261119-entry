// THE WORLD IN ONE DAY — Thursday 19 November 2026.
// A newspaper front page drawn entirely in code: masthead, a triple lead
// (GTA VI launches, the Shenzhen trilateral, Anthropic's IPO), nine
// secondary stories, world-in-brief, the day in figures, a world map, also
// today and more stories. Re-authored from scratch in this session: own PNG
// encoder, own 5x7 bitmap font, own drawing code. Node stdlib only — no
// network, no randomness, no clock — so two runs write identical bytes.

import { deflateSync } from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";

const W = 1024;
const H = 1024;

type RGB = [number, number, number];

// Palette: paper and ink first, then the accent colours the page uses.
const C = {
  paper: [250, 246, 234] as RGB,
  ink: [26, 26, 26] as RGB,
  red: [185, 28, 28] as RGB,
  grey: [120, 116, 108] as RGB,
  lgrey: [210, 204, 190] as RGB,
  slate: [96, 110, 126] as RGB,
  green: [22, 120, 70] as RGB,
  gold: [176, 132, 32] as RGB,
  box: [232, 228, 216] as RGB,
  mapbg: [238, 240, 236] as RGB,
  gridline: [214, 220, 216] as RGB,
  navy: [14, 34, 51] as RGB,
  navyline: [30, 64, 96] as RGB,
  lime: [74, 222, 128] as RGB,
  chartgreen: [34, 197, 94] as RGB,
  white: [255, 255, 255] as RGB,
  flagblue: [29, 78, 216] as RGB,
  flagred: [185, 28, 28] as RGB,
};

// ---- PNG encoding -------------------------------------------------------
// Minimal encoder: 8-bit RGB, no scanline filtering, a single IDAT chunk.
// CRC32 is the standard polynomial table, built once at startup.

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC = makeCrcTable();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, tail]);
}

function encodePng(rgb: Uint8Array, w: number, h: number): Buffer {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: none
  ihdr[12] = 0; // interlace: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- canvas -------------------------------------------------------------
// One RGB framebuffer behind a small class. Every write goes through set(),
// which honours the current clip rectangle, so an illustration can never
// spill into a neighbouring text band.

class Canvas {
  buf = new Uint8Array(W * H * 3);
  private cx0 = 0;
  private cy0 = 0;
  private cx1 = W;
  private cy1 = H;

  clip(x0: number, y0: number, x1: number, y1: number): void {
    this.cx0 = x0;
    this.cy0 = y0;
    this.cx1 = x1;
    this.cy1 = y1;
  }

  unclip(): void {
    this.clip(0, 0, W, H);
  }

  set(x: number, y: number, c: RGB): void {
    if (x < this.cx0 || x >= this.cx1 || y < this.cy0 || y >= this.cy1) return;
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 3;
    this.buf[i] = c[0];
    this.buf[i + 1] = c[1];
    this.buf[i + 2] = c[2];
  }

  fill(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  hline(x: number, y: number, w: number, c: RGB, t = 1): void {
    for (let k = 0; k < t; k++) this.fill(x, y + k, w, 1, c);
  }

  vline(x: number, y: number, h: number, c: RGB, t = 1): void {
    for (let k = 0; k < t; k++) this.fill(x + k, y, 1, h, c);
  }

  outline(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
    this.hline(x, y, w, c, t);
    this.hline(x, y + h - t, w, c, t);
    this.vline(x, y, h, c, t);
    this.vline(x + w - t, y, h, c, t);
  }

  // Bresenham segment, optionally thick.
  seg(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
      if (t === 1) this.set(x, y, c);
      else this.fill(x - ((t / 2) | 0), y - ((t / 2) | 0), t, t, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  disc(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) this.set(x, y, c);
  }

  // Scanline-filled polygon.
  poly(pts: [number, number][], c: RGB): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.set(x, y, c);
    }
  }
}

const cv = new Canvas();

// ---- 5x7 bitmap font ----------------------------------------------------
// One glyph = 7 rows of 5 cells; '#' is ink, '.' is blank. Uppercase ASCII
// plus digits and punctuation. Every string is upper-cased before drawing,
// so a lowercase letter can never vanish silently from the page.

const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#..##", "#.#.#", "##..#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", "..#.."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "..#.."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "'": ["..#..", "..#..", "..#..", ".....", ".....", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".#.#.", ".....", ".....", ".....", "....."],
  "(": ["..##.", "..#..", ".#...", ".#...", ".#...", "..#..", "..##."],
  ")": [".##..", "..#..", "...#.", "...#.", "...#.", "..#..", ".##.."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", "#.##.", "#..##"],
  $: ["..#..", ".####", "#.#.#", ".###.", "..#.#", "####.", "..#.."],
  "&": [".##..", "#...#", "#...#", ".#.#.", "#.#.#", "#...#", ".##.#"],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "*": [".....", ".#.#.", ".###.", "#####", ".###.", ".#.#.", "....."],
  "[": [".###.", ".#...", ".#...", ".#...", ".#...", ".#...", ".###."],
  "]": [".###.", "...#.", "...#.", "...#.", "...#.", "...#.", ".###."],
  _: [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
};

function textWidth(s: string, scale: number): number {
  return s.length === 0 ? 0 : s.length * 6 * scale - scale;
}

function drawText(x: number, y: number, s: string, scale: number, c: RGB): void {
  s = s.toUpperCase();
  let cx = x;
  for (const ch of s) {
    const g = GLYPHS[ch];
    if (g) {
      for (let r = 0; r < 7; r++)
        for (let col = 0; col < 5; col++)
          if (g[r][col] === "#") cv.fill(cx + col * scale, y + r * scale, scale, scale, c);
    }
    cx += 6 * scale;
  }
}

function centerText(cx: number, y: number, s: string, scale: number, c: RGB): void {
  drawText(cx - Math.floor(textWidth(s, scale) / 2), y, s, scale, c);
}

// Greedy word wrap: lines that fit maxW pixels at the given scale.
function wrap(s: string, maxW: number, scale: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of s.split(" ")) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxW) cur = trial;
    else {
      if (cur !== "") lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// ---- masthead -----------------------------------------------------------
// Outer frame, big title, date line with the story counts on the flanks.

function masthead(): void {
  cv.outline(10, 10, 1004, 1004, C.ink, 2);
  centerText(512, 18, "THE WORLD IN ONE DAY", 7, C.ink);
  cv.hline(24, 74, 976, C.ink, 2);
  drawText(24, 82, "36 STORIES", 2, C.red);
  centerText(512, 82, "THURSDAY 19 NOVEMBER 2026", 3, C.red);
  const right = "6 CONTINENTS";
  drawText(1000 - textWidth(right, 2), 82, right, 2, C.red);
  cv.hline(24, 108, 976, C.ink, 2);
  cv.hline(24, 112, 976, C.ink, 1);
}

// ---- leads --------------------------------------------------------------
// Three columns. Each column owns a strict zone: illustration box
// y 118..272, headline band y 284..344, summary y 350..398. The 12 px gap
// between illustration and headline is never crossed: every illustration
// draw is clipped to its own box.

const COLUMNS = [
  { x0: 24, x1: 336 },
  { x0: 356, x1: 668 },
  { x0: 688, x1: 1000 },
];
const ART_TOP = 118;
const ART_BOTTOM = 272;

// Lead 1: neon Vice City street at sunset.
function viceCityArt(): void {
  const b = COLUMNS[0];
  cv.clip(b.x0, ART_TOP, b.x1, ART_BOTTOM);
  cv.fill(b.x0, 118, b.x1 - b.x0, 38, [109, 40, 217]);
  cv.fill(b.x0, 156, b.x1 - b.x0, 40, [219, 39, 119]);
  cv.fill(b.x0, 196, b.x1 - b.x0, 34, [249, 115, 22]);
  cv.fill(b.x0, 230, b.x1 - b.x0, 42, [253, 186, 116]);
  cv.disc(268, 196, 24, [253, 230, 138]);
  // Skyline silhouettes with a few lit windows.
  const sky: RGB = [31, 41, 55];
  const tops = [206, 196, 214, 188, 204, 192, 210, 198, 216, 190, 206, 200];
  let bx = b.x0 + 4;
  for (const top of tops) {
    cv.fill(bx, top, 24, 262 - top, sky);
    for (let wy = top + 8; wy < 256; wy += 12)
      for (let wx = bx + 5; wx < bx + 20; wx += 9)
        if ((wx + wy) % 23 < 6) cv.fill(wx, wy, 3, 4, [253, 224, 71]);
    bx += 26;
  }
  // Palm trees at the two ends.
  for (const tx of [52, 306]) {
    cv.seg(tx, 262, tx, 212, [20, 60, 30], 3);
    for (let f = 0; f < 5; f++) {
      const a = (-160 + f * 35) * (Math.PI / 180);
      cv.seg(tx, 212, Math.round(tx + 22 * Math.cos(a)), Math.round(212 + 16 * Math.sin(a)), [20, 60, 30], 2);
    }
  }
  // Road with a dashed centre line.
  cv.fill(b.x0, 262, b.x1 - b.x0, 10, [17, 24, 39]);
  for (let dx = b.x0 + 6; dx < b.x1 - 10; dx += 22) cv.fill(dx, 266, 12, 2, [253, 224, 71]);
  cv.unclip();
}

// Lead 2: three leaders at one table, flags on the wall behind them.
function leadersArt(): void {
  const b = COLUMNS[1];
  cv.clip(b.x0, ART_TOP, b.x1, ART_BOTTOM);
  cv.fill(b.x0, ART_TOP, b.x1 - b.x0, ART_BOTTOM - ART_TOP, [237, 224, 200]);
  // US flag: stripes plus the blue corner with stars.
  for (let s = 0; s < 7; s++)
    cv.fill(380, 126 + s * 7, 60, 7, s % 2 === 0 ? C.flagred : C.paper);
  cv.fill(380, 126, 26, 21, C.flagblue);
  for (let sy = 130; sy < 144; sy += 6)
    for (let sx = 384; sx < 402; sx += 7) cv.fill(sx, sy, 2, 2, C.white);
  // China flag: red field, yellow stars.
  cv.fill(478, 126, 60, 49, [222, 0, 0]);
  cv.disc(492, 138, 5, [255, 215, 0]);
  cv.disc(512, 134, 3, [255, 215, 0]);
  cv.disc(520, 146, 3, [255, 215, 0]);
  cv.disc(508, 156, 3, [255, 215, 0]);
  // Russia flag: white / blue / red bands.
  cv.fill(576, 126, 60, 16, C.paper);
  cv.fill(576, 142, 60, 17, C.flagblue);
  cv.fill(576, 159, 60, 16, C.flagred);
  // Three figures behind the table.
  const skin: RGB = [232, 185, 138];
  const suit: RGB = [30, 41, 59];
  const heads = [410, 512, 614];
  const ties: RGB[] = [C.flagblue, C.flagred, [96, 165, 250]];
  for (let i = 0; i < 3; i++) {
    const hx = heads[i];
    cv.disc(hx, 196, 14, skin);
    cv.fill(hx - 14, 182, 28, 6, i === 1 ? [20, 20, 20] : [180, 160, 120]);
    cv.poly(
      [
        [hx - 26, 224],
        [hx - 18, 206],
        [hx + 18, 206],
        [hx + 26, 224],
      ],
      suit
    );
    cv.poly(
      [
        [hx - 4, 208],
        [hx + 4, 208],
        [hx, 222],
      ],
      ties[i]
    );
  }
  // Table with a lighter top edge and small flags standing on it.
  cv.fill(b.x0 + 16, 224, b.x1 - b.x0 - 32, 48, [124, 74, 33]);
  cv.fill(b.x0 + 16, 224, b.x1 - b.x0 - 32, 4, [160, 100, 48]);
  cv.fill(420, 210, 14, 10, C.flagred);
  cv.fill(505, 210, 14, 10, [222, 0, 0]);
  cv.fill(590, 210, 14, 10, C.flagblue);
  cv.unclip();
}

// Lead 3: Nasdaq chart panel, ANT climbing, $83 marked.
function nasdaqArt(): void {
  const b = COLUMNS[2];
  cv.clip(b.x0, ART_TOP, b.x1, ART_BOTTOM);
  cv.fill(b.x0, ART_TOP, b.x1 - b.x0, ART_BOTTOM - ART_TOP, C.navy);
  for (let gx = b.x0 + 40; gx < b.x1; gx += 44) cv.vline(gx, ART_TOP + 8, ART_BOTTOM - ART_TOP - 16, C.navyline, 1);
  for (let gy = ART_TOP + 28; gy < ART_BOTTOM; gy += 30) cv.hline(b.x0 + 8, gy, b.x1 - b.x0 - 16, C.navyline, 1);
  const pts: [number, number][] = [
    [700, 250],
    [736, 242],
    [768, 246],
    [806, 222],
    [844, 228],
    [878, 198],
    [916, 184],
    [950, 162],
    [988, 140],
  ];
  for (let i = 0; i + 1 < pts.length; i++)
    cv.seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], C.chartgreen, 3);
  for (const p of pts) cv.disc(p[0], p[1], 4, C.lime);
  cv.poly(
    [
      [988, 140],
      [972, 138],
      [982, 154],
    ],
    C.chartgreen
  );
  drawText(706, 128, "$83", 5, C.lime);
  drawText(706, 168, "ANT", 3, C.white);
  drawText(924, 236, "NASDAQ", 2, [148, 163, 184]);
  cv.unclip();
}

const LEADS = [
  {
    head: ["GTA VI", "IS HERE"],
    sum: "Vice City opens after 13 years - 99 on Metacritic, 2.3M watch on Twitch",
  },
  {
    head: ["THREE LEADERS", "ONE TABLE"],
    sum: "Trump, Xi, Putin meet in Shenzhen - nuclear arms, Ukraine, Iran on agenda",
  },
  {
    head: ["ANTHROPIC", "GOES PUBLIC"],
    sum: "ANT starts trading on Nasdaq at $83 - $81.3BN raised, largest IPO ever",
  },
];

function leads(): void {
  viceCityArt();
  leadersArt();
  nasdaqArt();
  cv.vline(346, 118, 292, C.lgrey, 1);
  cv.vline(678, 118, 292, C.lgrey, 1);
  for (let i = 0; i < 3; i++) {
    const col = COLUMNS[i];
    const mid = (col.x0 + col.x1) / 2;
    centerText(mid, 284, LEADS[i].head[0], 4, C.ink);
    centerText(mid, 316, LEADS[i].head[1], 4, C.ink);
    const lines = wrap(LEADS[i].sum, col.x1 - col.x0, 2).slice(0, 3);
    lines.forEach((ln, k) => drawText(col.x0, 350 + k * 16, ln, 2, C.ink));
  }
  cv.hline(24, 408, 976, C.ink, 2);
}

// ---- grid ---------------------------------------------------------------
// Nine secondary stories, 3 rows x 3 columns. Each cell: a 56x56 pictogram
// on the left, headline (max 2 lines) and summary (max 2 lines) on the right.

type Icon = "missile" | "parliament" | "rain" | "bridge" | "spacecraft" | "scales" | "painting" | "pin" | "factory";

function icon(x: number, y: number, kind: Icon): void {
  cv.clip(x, y, x + 56, y + 56);
  cv.fill(x, y, 56, 56, C.box);
  cv.outline(x, y, 56, 56, C.ink, 1);
  const cx = x + 28;
  const cy = y + 28;
  switch (kind) {
    case "missile": {
      cv.seg(x + 12, y + 44, x + 40, y + 16, C.ink, 3);
      cv.poly(
        [
          [x + 40, y + 16],
          [x + 48, y + 14],
          [x + 44, y + 24],
        ],
        C.red
      );
      for (let i = 0; i < 5; i++) {
        const a = (i * 72 * Math.PI) / 180;
        cv.seg(x + 14, y + 42, Math.round(x + 14 + 8 * Math.cos(a)), Math.round(y + 42 + 8 * Math.sin(a)), C.gold, 2);
      }
      break;
    }
    case "parliament": {
      cv.fill(x + 10, y + 14, 36, 6, C.ink);
      cv.poly(
        [
          [x + 8, y + 14],
          [cx, y + 6],
          [x + 48, y + 14],
        ],
        C.ink
      );
      for (const px0 of [12, 25, 38]) cv.fill(x + px0, y + 22, 6, 24, C.ink);
      cv.fill(x + 8, y + 46, 40, 4, C.ink);
      break;
    }
    case "rain": {
      cv.disc(cx - 8, y + 20, 9, C.slate);
      cv.disc(cx + 8, y + 20, 9, C.slate);
      cv.fill(cx - 16, y + 20, 32, 6, C.slate);
      for (const dx of [-12, -2, 8]) cv.seg(cx + dx, y + 34, cx + dx - 3, y + 46, C.flagblue, 2);
      break;
    }
    case "bridge": {
      cv.seg(x + 6, y + 40, x + 50, y + 40, C.ink, 3);
      cv.seg(x + 10, y + 40, cx, y + 22, C.ink, 2);
      cv.seg(cx, y + 22, x + 46, y + 40, C.ink, 2);
      cv.seg(x + 30, y + 40, x + 38, y + 48, C.red, 3);
      cv.seg(x + 38, y + 48, x + 48, y + 50, C.red, 2);
      break;
    }
    case "spacecraft": {
      cv.poly(
        [
          [cx, y + 10],
          [cx + 8, y + 26],
          [cx, y + 42],
          [cx - 8, y + 26],
        ],
        C.ink
      );
      cv.seg(cx - 8, y + 26, cx - 20, y + 18, C.ink, 2);
      cv.seg(cx + 8, y + 26, cx + 20, y + 18, C.ink, 2);
      cv.disc(x + 14, y + 12, 2, C.gold);
      cv.disc(x + 44, y + 10, 2, C.gold);
      cv.disc(x + 48, y + 44, 2, C.gold);
      break;
    }
    case "scales": {
      cv.vline(cx, y + 10, 34, C.ink, 2);
      cv.hline(cx - 16, y + 14, 32, C.ink, 2);
      cv.seg(cx - 16, y + 14, cx - 20, y + 28, C.ink, 2);
      cv.seg(cx - 16, y + 14, cx - 12, y + 28, C.ink, 2);
      cv.seg(cx - 20, y + 28, cx - 12, y + 28, C.ink, 2);
      cv.seg(cx + 16, y + 14, cx + 20, y + 28, C.ink, 2);
      cv.seg(cx + 16, y + 14, cx + 12, y + 28, C.ink, 2);
      cv.seg(cx + 12, y + 28, cx + 20, y + 28, C.ink, 2);
      cv.fill(cx - 4, y + 44, 8, 4, C.ink);
      break;
    }
    case "painting": {
      cv.outline(x + 10, y + 10, 36, 36, C.gold, 3);
      cv.fill(x + 13, y + 13, 30, 30, [253, 224, 71]);
      cv.disc(x + 28, y + 26, 7, [249, 115, 22]);
      cv.fill(x + 13, y + 36, 30, 7, [34, 120, 70]);
      break;
    }
    case "pin": {
      cv.disc(cx, y + 20, 11, C.red);
      cv.disc(cx, y + 20, 4, C.paper);
      cv.poly(
        [
          [cx - 8, y + 28],
          [cx + 8, y + 28],
          [cx, y + 46],
        ],
        C.red
      );
      break;
    }
    case "factory": {
      cv.fill(x + 10, y + 26, 20, 20, C.ink);
      cv.fill(x + 32, y + 32, 14, 14, C.ink);
      cv.fill(x + 38, y + 14, 5, 20, C.ink);
      cv.disc(x + 40, y + 10, 4, C.grey);
      cv.disc(x + 46, y + 8, 3, C.grey);
      break;
    }
  }
  cv.unclip();
}

const GRID: { icon: Icon; head: string; sum: string }[] = [
  { icon: "missile", head: "GULF ON EDGE", sum: "US, Iran trade strikes; tanker hit" },
  { icon: "parliament", head: "KAHANA TAKES THE CHAIR", sum: "Knesset elects speaker by 66 votes" },
  { icon: "rain", head: "GAZA DROWNS IN RAIN", sum: "46,000 households displaced" },
  { icon: "bridge", head: "KERCH HIT AGAIN", sum: "Russia says bridge attacked again" },
  { icon: "spacecraft", head: "VOYAGER, ONE LIGHT-DAY", sum: "NASA panel today; signal takes 24h" },
  { icon: "scales", head: "MYANMAR VERDICT", sum: "UN court rules on Rohingya genocide" },
  { icon: "painting", head: "VAN GOGH $190.4M", sum: "Record sale after Nazi-history row" },
  { icon: "pin", head: "HORN ON EDGE", sum: "Ethiopia, Eritrea in border standoff" },
  { icon: "factory", head: "DHAKA STRIKE, WEEK 3", sum: "Garment workers want 30,000 taka" },
];

function grid(): void {
  const rows = [416, 484, 552];
  for (let i = 0; i < 9; i++) {
    const col = COLUMNS[i % 3];
    const y = rows[(i / 3) | 0];
    const g = GRID[i];
    icon(col.x0, y, g.icon);
    const tx = col.x0 + 64;
    const tw = col.x1 - tx;
    wrap(g.head, tw, 2)
      .slice(0, 2)
      .forEach((ln, k) => drawText(tx, y + k * 17, ln, 2, C.ink));
    wrap(g.sum, tw, 2)
      .slice(0, 2)
      .forEach((ln, k) => drawText(tx, y + 34 + k * 17, ln, 2, C.grey));
  }
  cv.hline(24, 622, 976, C.lgrey, 1);
}

// ---- brief strip --------------------------------------------------------
// Eight one-liners, two columns x four rows.

const BRIEF = [
  "Estonia to shut Russia crossings Dec 1",
  "Yemen govt pulls back to defend Aden",
  "Zelenskyy: lift Starshield limits",
  "APEC family photo in Shenzhen today",
  "Ras Al Khaimah named top expat city",
  "Take-Two shares up 6.5% on GTA VI",
  "GTA VI story runs about 50 hours",
  "New START arms treaty ends Feb 2026",
];

function brief(): void {
  drawText(24, 630, "WORLD IN BRIEF", 2, C.red);
  BRIEF.forEach((line, i) => {
    drawText(i % 2 === 0 ? 24 : 512, 648 + ((i / 2) | 0) * 17, line, 2, C.ink);
  });
  cv.hline(24, 716, 976, C.ink, 2);
}

// ---- figures ------------------------------------------------------------
// Six big numbers with short labels.

const FIGURES: [string, string][] = [
  ["99", "METACRITIC"],
  ["2.3M", "TWITCH"],
  ["$83", "ANT PRICE"],
  ["$81.3BN", "IPO RAISED"],
  ["16BN MI", "VOYAGER 1"],
  ["66", "KNESSET"],
];

function figures(): void {
  centerText(512, 722, "THE DAY IN FIGURES", 2, C.red);
  FIGURES.forEach(([n, label], i) => {
    const cx = 105 + i * 163;
    centerText(cx, 742, n, 3, C.ink);
    centerText(cx, 766, label, 2, C.grey);
  });
  cv.hline(24, 786, 976, C.ink, 2);
}

// ---- bottom -------------------------------------------------------------
// Left: hand-drawn world map with six numbered markers. Right: ALSO TODAY
// (four items) and MORE STORIES (twelve one-liners).

function lonX(lon: number): number {
  return Math.round(24 + ((lon + 170) * 348) / 360);
}

function latY(lat: number): number {
  return Math.round(810 + ((75 - lat) * 160) / 130);
}

const CONTINENTS: [number, number][][] = [
  [
    [-168, 66], [-140, 70], [-120, 72], [-95, 80], [-75, 73], [-60, 62], [-55, 47],
    [-70, 42], [-75, 35], [-80, 26], [-90, 21], [-97, 16], [-105, 20], [-115, 28],
    [-125, 40], [-125, 49], [-140, 60], [-165, 60],
  ],
  [
    [-80, 10], [-60, 10], [-50, 0], [-35, -8], [-40, -20], [-50, -30], [-60, -40],
    [-70, -50], [-75, -30], [-80, -15],
  ],
  [
    [-10, 36], [-5, 44], [0, 50], [10, 58], [20, 60], [30, 70], [40, 68],
    [30, 60], [25, 45], [20, 40], [10, 38], [0, 36],
  ],
  [
    [-17, 15], [-10, 30], [10, 37], [30, 32], [35, 28], [43, 12], [50, 10],
    [40, -5], [35, -20], [30, -35], [20, -35], [15, -17], [12, -5], [9, 4], [-8, 5],
  ],
  [
    [40, 70], [60, 75], [90, 75], [120, 72], [150, 70], [170, 66], [180, 60],
    [160, 55], [140, 45], [130, 35], [120, 25], [110, 20], [105, 10], [100, 8],
    [95, 15], [90, 22], [80, 15], [75, 8], [70, 20], [60, 25], [50, 30], [45, 40], [40, 50],
  ],
  [
    [113, -22], [125, -12], [135, -12], [145, -15], [150, -22], [150, -37],
    [140, -38], [130, -32], [120, -35], [113, -30],
  ],
];

function map(): void {
  drawText(24, 792, "WHERE THE NEWS HAPPENED", 2, C.red);
  cv.clip(24, 810, 372, 970);
  cv.fill(24, 810, 348, 160, C.mapbg);
  for (let lon = -150; lon <= 180; lon += 30) cv.vline(lonX(lon), 810, 160, C.gridline, 1);
  for (let lat = 60; lat >= -45; lat -= 30) cv.hline(24, latY(lat), 348, C.gridline, 1);
  for (const poly of CONTINENTS) {
    cv.poly(
      poly.map(([lo, la]): [number, number] => [lonX(lo), latY(la)]),
      C.slate
    );
  }
  // Numbered markers: 1 Shenzhen, 2 Vice City, 3 Hormuz, 4 Gaza, 5 Kerch, 6 Myanmar.
  const marks: [number, number, string][] = [
    [114, 22.5, "1"],
    [-80, 26, "2"],
    [56.5, 26.5, "3"],
    [34.5, 31.5, "4"],
    [36.5, 45.3, "5"],
    [96, 21, "6"],
  ];
  for (const [lo, la, num] of marks) {
    const mx = lonX(lo);
    const my = latY(la);
    cv.disc(mx, my, 8, C.red);
    drawText(mx - 5, my - 7, num, 2, C.white);
  }
  cv.unclip();
  cv.outline(24, 810, 348, 160, C.ink, 1);
  drawText(24, 974, "1 SHENZHEN  2 VICE CITY  3 HORMUZ", 1, C.grey);
  drawText(24, 984, "4 GAZA  5 KERCH  6 MYANMAR", 1, C.grey);
}

const ALSO: [string, string][] = [
  ["Cyclone Akvan nears", "Odisha coast"],
  ["India vs NZ first", "Test today"],
  ["F1 Las Vegas GP", "begins today"],
  ["UAE economy seen", "up 7.3%"],
];

const MORE = [
  "GTA VI delayed twice",
  "Xbox NZ trick works",
  "Firms give staff day off",
  "Trump, Xi shake hands",
  "Takaichi, Lee at APEC",
  "Voyager launched in 1977",
  "2 Voyager tools still on",
  "Signal takes 24 hours",
  "Bangladesh police use gas",
  "Eritrea denies clashes",
  "US carriers in the Gulf",
  "Gaza op beyond Yellow Line",
];

function bottomRight(): void {
  cv.vline(380, 792, 208, C.lgrey, 1);
  drawText(388, 792, "ALSO TODAY", 2, C.red);
  ALSO.forEach((pair, i) => {
    const x = i % 2 === 0 ? 388 : 698;
    const y = i < 2 ? 810 : 844;
    drawText(x, y, pair[0], 2, C.ink);
    drawText(x, y + 17, pair[1], 2, C.ink);
  });
  drawText(388, 878, "MORE STORIES", 2, C.red);
  MORE.forEach((line, i) => {
    drawText(i % 2 === 0 ? 388 : 698, 898 + ((i / 2) | 0) * 16, line, 2, C.ink);
  });
}

// ---- main ---------------------------------------------------------------

function main(): void {
  cv.fill(0, 0, W, H, C.paper);
  masthead();
  leads();
  grid();
  brief();
  figures();
  map();
  bottomRight();
  centerText(512, 1006, "THE WORLD IN ONE DAY - THURSDAY 19 NOVEMBER 2026", 1, C.grey);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "out";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), encodePng(cv.buf, W, H));
}

main();
