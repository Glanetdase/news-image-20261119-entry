// THE WORLD IN ONE DAY — Thursday 19 November 2026.
// A dense newspaper front page drawn entirely in code: masthead, a triple
// lead (GTA VI launches, the Shenzhen trilateral, Anthropic's IPO), nine
// secondary stories, a world-in-brief strip, the day in figures, a world
// map, also-today and more stories. Written by hand in this session.
// No image assets, no network, no randomness: two runs write byte-identical PNGs.

import { deflateSync } from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- PNG writer
// Minimal PNG encoder: 8-bit RGB, no scanline filtering, one IDAT chunk.
// CRC32 uses the standard polynomial table, built once at startup.

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
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
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- canvas
// One RGB framebuffer. All drawing goes through px(), which honours the
// current clip rectangle, so illustrations can never spill into text bands.

const pxbuf = new Uint8Array(W * H * 3);
let clip = { x0: 0, y0: 0, x1: W, y1: H };

function setClip(x0: number, y0: number, x1: number, y1: number): void {
  clip = { x0, y0, x1, y1 };
}

function clearClip(): void {
  clip = { x0: 0, y0: 0, x1: W, y1: H };
}

type RGB = [number, number, number];

const PAPER: RGB = [250, 246, 234];
const INK: RGB = [26, 26, 26];
const RED: RGB = [185, 28, 28];
const GREY: RGB = [120, 116, 108];
const LGREY: RGB = [210, 204, 190];
const SLATE: RGB = [96, 110, 126];
const GREEN: RGB = [22, 120, 70];
const GOLD: RGB = [176, 132, 32];

function px(x: number, y: number, c: RGB): void {
  if (x < clip.x0 || x >= clip.x1 || y < clip.y0 || y >= clip.y1) return;
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  pxbuf[i] = c[0];
  pxbuf[i + 1] = c[1];
  pxbuf[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) px(xx, yy, c);
}

function hline(x: number, y: number, w: number, c: RGB, t = 1): void {
  for (let k = 0; k < t; k++) fillRect(x, y + k, w, 1, c);
}

function vline(x: number, y: number, h: number, c: RGB, t = 1): void {
  for (let k = 0; k < t; k++) fillRect(x + k, y, 1, h, c);
}

function rect(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
  hline(x, y, w, c, t);
  hline(x, y + h - t, w, c, t);
  vline(x, y, h, c, t);
  vline(x + w - t, y, h, c, t);
}

function line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (t === 1) px(x, y, c);
    else fillRect(x - ((t / 2) | 0), y - ((t / 2) | 0), t, t, c);
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

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) px(x, y, c);
}

function circle(cx: number, cy: number, r: number, c: RGB, t = 1): void {
  for (let a = 0; a < 360; a += 2) {
    const rad = (a * Math.PI) / 180;
    const x = Math.round(cx + r * Math.cos(rad));
    const y = Math.round(cy + r * Math.sin(rad));
    if (t === 1) px(x, y, c);
    else fillRect(x - 1, y - 1, t, t, c);
  }
}

// Filled polygon from a list of [x, y] vertices (scanline fill).
function fillPoly(pts: [number, number][], c: RGB): void {
  let minY = 1e9;
  let maxY = -1e9;
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
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) px(x, y, c);
    }
  }
}

// ---------------------------------------------------------------- 5x7 font
// Each glyph is 7 rows of 5 bits, stored as numbers (bit 4 = leftmost pixel).
// Only the characters the page uses are defined; all page text is uppercase
// ASCII plus digits and common punctuation.

const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [15, 16, 16, 16, 16, 16, 15],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [15, 16, 16, 23, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [31, 4, 4, 4, 4, 4, 31],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 25, 21, 19, 19, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 19, 21, 25, 17, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [30, 1, 1, 14, 1, 1, 30],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [14, 16, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 4, 4, 4],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 1, 14],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 12, 8],
  ":": [0, 12, 12, 0, 12, 12, 0],
  ";": [0, 12, 12, 0, 12, 12, 8],
  "-": [0, 0, 0, 31, 0, 0, 0],
  "'": [4, 4, 4, 0, 0, 0, 0],
  '"': [10, 10, 10, 0, 0, 0, 0],
  "(": [6, 4, 8, 8, 8, 4, 6],
  ")": [12, 4, 2, 2, 2, 4, 12],
  "/": [1, 1, 2, 4, 8, 16, 16],
  "%": [25, 26, 2, 4, 8, 22, 19],
  "$": [4, 15, 21, 14, 5, 30, 4],
  "&": [12, 17, 17, 10, 21, 17, 13],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "+": [0, 4, 4, 31, 4, 4, 0],
  "=": [0, 0, 31, 0, 31, 0, 0],
  "*": [0, 10, 14, 31, 14, 10, 0],
  "[": [14, 8, 8, 8, 8, 8, 14],
  "]": [14, 2, 2, 2, 2, 2, 14],
  _: [0, 0, 0, 0, 0, 0, 31],
  "#": [10, 10, 31, 10, 31, 10, 10],
};

function charWidth(scale: number): number {
  return 6 * scale;
}

function textWidth(text: string, scale: number): number {
  if (text.length === 0) return 0;
  return text.length * 6 * scale - scale;
}

function drawChar(x: number, y: number, ch: string, scale: number, c: RGB): void {
  const g = FONT[ch];
  if (!g) return;
  for (let r = 0; r < 7; r++) {
    const row = g[r];
    for (let col = 0; col < 5; col++) {
      if (row & (16 >> col)) {
        fillRect(x + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}

function drawText(x: number, y: number, text: string, scale: number, c: RGB): void {
  // The bitmap font covers uppercase ASCII only; normalise here so no
  // lowercase letter is ever silently dropped from the page.
  text = text.toUpperCase();
  let cx = x;
  for (const ch of text) {
    drawChar(cx, y, ch, scale, c);
    cx += 6 * scale;
  }
}

function drawTextCenter(cx: number, y: number, text: string, scale: number, c: RGB): void {
  drawText(cx - Math.floor(textWidth(text, scale) / 2), y, text, scale, c);
}

// Word-wrap: split text into lines that fit maxW pixels at the given scale.
function wrapText(text: string, maxW: number, scale: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxW) {
      cur = trial;
    } else {
      if (cur !== "") lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------- masthead
// Outer frame, big title, date line with story counts on the flanks.

function drawMasthead(): void {
  rect(10, 10, 1004, 1004, INK, 2);
  drawTextCenter(512, 18, "THE WORLD IN ONE DAY", 7, INK);
  hline(24, 74, 976, INK, 2);
  drawText(24, 82, "36 STORIES", 2, RED);
  drawTextCenter(512, 82, "THURSDAY 19 NOVEMBER 2026", 3, RED);
  const right = "6 CONTINENTS";
  drawText(1000 - textWidth(right, 2), 82, right, 2, RED);
  hline(24, 108, 976, INK, 2);
  hline(24, 112, 976, INK, 1);
}

// ---------------------------------------------------------------- leads
// Three columns. Each column owns a strict zone: illustration box
// y 118..272, headline band y 284..344, summary y 350..398. The 12 px gap
// between illustration and headline is never crossed: every illustration
// draw is clipped to its own box.

const COLS = [
  { x0: 24, x1: 336 },
  { x0: 356, x1: 668 },
  { x0: 688, x1: 1000 },
];

// Lead 1: neon Vice City street at sunset.
function drawLead1Art(): void {
  const x0 = 24;
  const x1 = 336;
  const y0 = 118;
  const y1 = 272;
  setClip(x0, y0, x1, y1);
  // Sunset bands, purple high, pink mid, orange low.
  fillRect(x0, y0, x1 - x0, 40, [109, 40, 217]);
  fillRect(x0, y0 + 40, x1 - x0, 40, [219, 39, 119]);
  fillRect(x0, y0 + 80, x1 - x0, 34, [249, 115, 22]);
  fillRect(x0, y0 + 114, x1 - x0, 40, [253, 186, 116]);
  // Sun.
  fillCircle(268, 196, 24, [253, 230, 138]);
  // Skyline silhouettes.
  const sky: RGB = [31, 41, 55];
  const tops = [206, 196, 214, 188, 204, 192, 210, 198, 216, 190, 206, 200];
  let bx = x0 + 4;
  for (let i = 0; i < tops.length; i++) {
    const bw = 24;
    fillRect(bx, tops[i], bw, 262 - tops[i], sky);
    // A few lit windows.
    for (let wy = tops[i] + 8; wy < 256; wy += 12) {
      for (let wx = bx + 5; wx < bx + bw - 4; wx += 9) {
        if ((wx + wy) % 23 < 6) fillRect(wx, wy, 3, 4, [253, 224, 71]);
      }
    }
    bx += bw + 2;
  }
  // Palm trees.
  const palm: RGB = [20, 60, 30];
  for (const tx of [52, 306]) {
    line(tx, 262, tx, 212, palm, 3);
    for (let f = 0; f < 5; f++) {
      const a = (-160 + f * 35) * (Math.PI / 180);
      line(tx, 212, Math.round(tx + 22 * Math.cos(a)), Math.round(212 + 16 * Math.sin(a)), palm, 2);
    }
  }
  // Road with dashed centre line.
  fillRect(x0, 262, x1 - x0, 10, [17, 24, 39]);
  for (let dx = x0 + 6; dx < x1 - 10; dx += 22) fillRect(dx, 266, 12, 2, [253, 224, 71]);
  clearClip();
}

// Lead 2: three leaders at one table, flags on the wall behind them.
function drawLead2Art(): void {
  const x0 = 356;
  const x1 = 668;
  const y0 = 118;
  const y1 = 272;
  setClip(x0, y0, x1, y1);
  fillRect(x0, y0, x1 - x0, y1 - y0, [237, 224, 200]);
  // Wall flags: US, China, Russia.
  // US: stripes + blue corner.
  const usX = 380;
  for (let s = 0; s < 7; s++) fillRect(usX, 126 + s * 7, 60, 7, s % 2 === 0 ? [185, 28, 28] : [250, 246, 234]);
  fillRect(usX, 126, 26, 21, [29, 78, 216]);
  for (let sy = 130; sy < 144; sy += 6)
    for (let sx = usX + 4; sx < usX + 22; sx += 7) fillRect(sx, sy, 2, 2, [255, 255, 255]);
  // China: red field, yellow stars.
  fillRect(478, 126, 60, 49, [222, 0, 0]);
  fillCircle(492, 138, 5, [255, 215, 0]);
  fillCircle(512, 134, 3, [255, 215, 0]);
  fillCircle(520, 146, 3, [255, 215, 0]);
  fillCircle(508, 156, 3, [255, 215, 0]);
  // Russia: white / blue / red bands.
  fillRect(576, 126, 60, 16, [250, 246, 234]);
  fillRect(576, 142, 60, 17, [29, 78, 216]);
  fillRect(576, 159, 60, 16, [185, 28, 28]);
  // Three figures behind the table.
  const skin: RGB = [232, 185, 138];
  const suit: RGB = [30, 41, 59];
  const heads = [410, 512, 614];
  const ties: RGB[] = [[29, 78, 216], [185, 28, 28], [96, 165, 250]];
  for (let i = 0; i < 3; i++) {
    const hx = heads[i];
    fillCircle(hx, 196, 14, skin);
    // Hair.
    fillRect(hx - 14, 182, 28, 6, i === 1 ? [20, 20, 20] : [180, 160, 120]);
    // Suit shoulders.
    fillPoly(
      [
        [hx - 26, 224],
        [hx - 18, 206],
        [hx + 18, 206],
        [hx + 26, 224],
      ],
      suit
    );
    // Tie.
    fillPoly(
      [
        [hx - 4, 208],
        [hx + 4, 208],
        [hx, 222],
      ],
      ties[i]
    );
  }
  // Table.
  fillRect(x0 + 16, 224, x1 - x0 - 32, 48, [124, 74, 33]);
  fillRect(x0 + 16, 224, x1 - x0 - 32, 4, [160, 100, 48]);
  // Small flags on the table.
  fillRect(420, 210, 14, 10, [185, 28, 28]);
  fillRect(505, 210, 14, 10, [222, 0, 0]);
  fillRect(590, 210, 14, 10, [29, 78, 216]);
  clearClip();
}

// Lead 3: Nasdaq chart panel, ANT climbing, $83 marked.
function drawLead3Art(): void {
  const x0 = 688;
  const x1 = 1000;
  const y0 = 118;
  const y1 = 272;
  setClip(x0, y0, x1, y1);
  fillRect(x0, y0, x1 - x0, y1 - y0, [14, 34, 51]);
  // Faint grid.
  for (let gx = x0 + 40; gx < x1; gx += 44) vline(gx, y0 + 8, y1 - y0 - 16, [30, 64, 96], 1);
  for (let gy = y0 + 28; gy < y1; gy += 30) hline(x0 + 8, gy, x1 - x0 - 16, [30, 64, 96], 1);
  // Rising line.
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
  for (let i = 0; i + 1 < pts.length; i++) {
    line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], [34, 197, 94], 3);
  }
  for (const p of pts) fillCircle(p[0], p[1], 4, [74, 222, 128]);
  // Arrowhead at the end.
  fillPoly(
    [
      [988, 140],
      [972, 138],
      [982, 154],
    ],
    [34, 197, 94]
  );
  // Big price inside the panel.
  drawText(706, 128, "$83", 5, [74, 222, 128]);
  drawText(706, 168, "ANT", 3, [250, 246, 234]);
  drawText(924, 236, "NASDAQ", 2, [148, 163, 184]);
  clearClip();
}

function drawLead(col: number, lines: string[], summary: string): void {
  const c = COLS[col];
  const mid = (c.x0 + c.x1) / 2;
  drawTextCenter(mid, 284, lines[0], 4, INK);
  drawTextCenter(mid, 316, lines[1], 4, INK);
  const wrapped = wrapText(summary, c.x1 - c.x0, 2);
  let y = 350;
  for (const ln of wrapped.slice(0, 3)) {
    drawText(c.x0, y, ln, 2, INK);
    y += 16;
  }
}

function drawLeads(): void {
  drawLead1Art();
  drawLead2Art();
  drawLead3Art();
  // Column rules.
  vline(346, 118, 292, LGREY, 1);
  vline(678, 118, 292, LGREY, 1);
  drawLead(0, ["GTA VI", "IS HERE"], "Vice City opens after 13 years - 99 on Metacritic, 2.3M watch on Twitch");
  drawLead(1, ["THREE LEADERS", "ONE TABLE"], "Trump, Xi, Putin meet in Shenzhen - nuclear arms, Ukraine, Iran on agenda");
  drawLead(2, ["ANTHROPIC", "GOES PUBLIC"], "ANT starts trading on Nasdaq at $83 - $81.3BN raised, largest IPO ever");
  hline(24, 408, 976, INK, 2);
}

// ---------------------------------------------------------------- grid
// Nine secondary stories, 3 rows x 3 columns. Each cell: a 56x56 pictogram
// on the left, headline (max 2 lines) and summary (max 2 lines) on the right.

type IconKind =
  | "missile"
  | "parliament"
  | "rain"
  | "bridge"
  | "spacecraft"
  | "scales"
  | "painting"
  | "pin"
  | "factory";

function drawIcon(x: number, y: number, kind: IconKind): void {
  setClip(x, y, x + 56, y + 56);
  fillRect(x, y, 56, 56, [232, 228, 216]);
  rect(x, y, 56, 56, INK, 1);
  const cx = x + 28;
  const cy = y + 28;
  if (kind === "missile") {
    line(x + 12, y + 44, x + 40, y + 16, INK, 3);
    fillPoly(
      [
        [x + 40, y + 16],
        [x + 48, y + 14],
        [x + 44, y + 24],
      ],
      RED
    );
    for (let i = 0; i < 5; i++) {
      const a = (i * 72 * Math.PI) / 180;
      line(x + 14, y + 42, Math.round(x + 14 + 8 * Math.cos(a)), Math.round(y + 42 + 8 * Math.sin(a)), GOLD, 2);
    }
  } else if (kind === "parliament") {
    fillRect(x + 10, y + 14, 36, 6, INK);
    fillPoly(
      [
        [x + 8, y + 14],
        [cx, y + 6],
        [x + 48, y + 14],
      ],
      INK
    );
    for (const px0 of [12, 25, 38]) fillRect(x + px0, y + 22, 6, 24, INK);
    fillRect(x + 8, y + 46, 40, 4, INK);
  } else if (kind === "rain") {
    fillCircle(cx - 8, y + 20, 9, SLATE);
    fillCircle(cx + 8, y + 20, 9, SLATE);
    fillRect(cx - 16, y + 20, 32, 6, SLATE);
    for (const dx of [-12, -2, 8]) line(cx + dx, y + 34, cx + dx - 3, y + 46, [29, 78, 216], 2);
  } else if (kind === "bridge") {
    line(x + 6, y + 40, x + 50, y + 40, INK, 3);
    line(x + 10, y + 40, cx, y + 22, INK, 2);
    line(cx, y + 22, x + 46, y + 40, INK, 2);
    line(x + 30, y + 40, x + 38, y + 48, RED, 3);
    line(x + 38, y + 48, x + 48, y + 50, RED, 2);
  } else if (kind === "spacecraft") {
    fillPoly(
      [
        [cx, y + 10],
        [cx + 8, y + 26],
        [cx, y + 42],
        [cx - 8, y + 26],
      ],
      INK
    );
    line(cx - 8, y + 26, cx - 20, y + 18, INK, 2);
    line(cx + 8, y + 26, cx + 20, y + 18, INK, 2);
    fillCircle(x + 14, y + 12, 2, GOLD);
    fillCircle(x + 44, y + 10, 2, GOLD);
    fillCircle(x + 48, y + 44, 2, GOLD);
  } else if (kind === "scales") {
    vline(cx, y + 10, 34, INK, 2);
    hline(cx - 16, y + 14, 32, INK, 2);
    line(cx - 16, y + 14, cx - 20, y + 28, INK, 2);
    line(cx - 16, y + 14, cx - 12, y + 28, INK, 2);
    line(cx - 20, y + 28, cx - 12, y + 28, INK, 2);
    line(cx + 16, y + 14, cx + 20, y + 28, INK, 2);
    line(cx + 16, y + 14, cx + 12, y + 28, INK, 2);
    line(cx + 12, y + 28, cx + 20, y + 28, INK, 2);
    fillRect(cx - 4, y + 44, 8, 4, INK);
  } else if (kind === "painting") {
    rect(x + 10, y + 10, 36, 36, GOLD, 3);
    fillRect(x + 13, y + 13, 30, 30, [253, 224, 71]);
    fillCircle(x + 28, y + 26, 7, [249, 115, 22]);
    fillRect(x + 13, y + 36, 30, 7, [34, 120, 70]);
  } else if (kind === "pin") {
    fillCircle(cx, y + 20, 11, RED);
    fillCircle(cx, y + 20, 4, PAPER);
    fillPoly(
      [
        [cx - 8, y + 28],
        [cx + 8, y + 28],
        [cx, y + 46],
      ],
      RED
    );
  } else if (kind === "factory") {
    fillRect(x + 10, y + 26, 20, 20, INK);
    fillRect(x + 32, y + 32, 14, 14, INK);
    fillRect(x + 38, y + 14, 5, 20, INK);
    fillCircle(x + 40, y + 10, 4, GREY);
    fillCircle(x + 46, y + 8, 3, GREY);
  }
  clearClip();
}

const GRID: { icon: IconKind; head: string; sum: string }[] = [
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

function drawGrid(): void {
  const rows = [416, 484, 552];
  for (let i = 0; i < 9; i++) {
    const col = i % 3;
    const row = (i / 3) | 0;
    const c = COLS[col];
    const y = rows[row];
    const g = GRID[i];
    drawIcon(c.x0, y, g.icon);
    const tx = c.x0 + 64;
    const tw = c.x1 - tx;
    const headLines = wrapText(g.head, tw, 2).slice(0, 2);
    let ly = y;
    for (const ln of headLines) {
      drawText(tx, ly, ln, 2, INK);
      ly += 17;
    }
    const sumLines = wrapText(g.sum, tw, 2).slice(0, 2);
    ly = y + 34;
    for (const ln of sumLines) {
      drawText(tx, ly, ln, 2, GREY);
      ly += 17;
    }
  }
  hline(24, 622, 976, LGREY, 1);
}

// ---------------------------------------------------------------- brief strip
// Eight one-liners, two columns x four rows.

const BRIEF: string[] = [
  "Estonia to shut Russia crossings Dec 1",
  "Yemen govt pulls back to defend Aden",
  "Zelenskyy: lift Starshield limits",
  "APEC family photo in Shenzhen today",
  "Ras Al Khaimah named top expat city",
  "Take-Two shares up 6.5% on GTA VI",
  "GTA VI story runs about 50 hours",
  "New START arms treaty ends Feb 2026",
];

function drawBrief(): void {
  drawText(24, 630, "WORLD IN BRIEF", 2, RED);
  for (let i = 0; i < 8; i++) {
    const col = i % 2;
    const row = (i / 2) | 0;
    const x = col === 0 ? 24 : 512;
    drawText(x, 648 + row * 17, BRIEF[i], 2, INK);
  }
  hline(24, 716, 976, INK, 2);
}

// ---------------------------------------------------------------- figures
// Six big numbers with short labels.

const FIGURES: { n: string; label: string }[] = [
  { n: "99", label: "METACRITIC" },
  { n: "2.3M", label: "TWITCH" },
  { n: "$83", label: "ANT PRICE" },
  { n: "$81.3BN", label: "IPO RAISED" },
  { n: "16BN MI", label: "VOYAGER 1" },
  { n: "66", label: "KNESSET" },
];

function drawFigures(): void {
  drawTextCenter(512, 722, "THE DAY IN FIGURES", 2, RED);
  for (let i = 0; i < 6; i++) {
    const cx = 24 + 81 + i * 163;
    drawTextCenter(cx, 742, FIGURES[i].n, 3, INK);
    drawTextCenter(cx, 766, FIGURES[i].label, 2, GREY);
  }
  hline(24, 786, 976, INK, 2);
}

// ---------------------------------------------------------------- bottom
// Left: hand-drawn world map with six numbered markers. Right: ALSO TODAY
// (four items) and MORE STORIES (sixteen one-liners).

function lonToX(lon: number): number {
  return Math.round(24 + (lon + 170) * (348 / 360));
}

function latToY(lat: number): number {
  return Math.round(810 + (75 - lat) * (160 / 130));
}

function drawMap(): void {
  drawText(24, 792, "WHERE THE NEWS HAPPENED", 2, RED);
  setClip(24, 810, 372, 970);
  fillRect(24, 810, 348, 160, [238, 240, 236]);
  // Graticule.
  for (let lon = -150; lon <= 180; lon += 30) vline(lonToX(lon), 810, 160, [214, 220, 216], 1);
  for (let lat = 60; lat >= -45; lat -= 30) hline(24, latToY(lat), 348, [214, 220, 216], 1);
  // Continents as rough lon/lat polygons.
  const land: RGB = [96, 110, 126];
  const polys: [number, number][][] = [
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
  for (const poly of polys) {
    fillPoly(
      poly.map(([lo, la]): [number, number] => [lonToX(lo), latToY(la)]),
      land
    );
  }
  // Numbered markers.
  const marks: [number, number, string][] = [
    [114, 22.5, "1"], // Shenzhen
    [-80, 26, "2"], // Vice City / Miami
    [56.5, 26.5, "3"], // Hormuz
    [34.5, 31.5, "4"], // Gaza
    [36.5, 45.3, "5"], // Kerch
    [96, 21, "6"], // Myanmar
  ];
  for (const [lo, la, num] of marks) {
    const mx = lonToX(lo);
    const my = latToY(la);
    fillCircle(mx, my, 8, RED);
    drawText(mx - 5, my - 7, num, 2, [255, 255, 255]);
  }
  clearClip();
  rect(24, 810, 348, 160, INK, 1);
  drawText(24, 974, "1 SHENZHEN  2 VICE CITY  3 HORMUZ", 1, GREY);
  drawText(24, 984, "4 GAZA  5 KERCH  6 MYANMAR", 1, GREY);
}

const ALSO: string[][] = [
  ["Cyclone Akvan nears", "Odisha coast"],
  ["India vs NZ first", "Test today"],
  ["F1 Las Vegas GP", "begins today"],
  ["UAE economy seen", "up 7.3%"],
];

const MORE: string[] = [
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

function drawRightBottom(): void {
  vline(380, 792, 208, LGREY, 1);
  drawText(388, 792, "ALSO TODAY", 2, RED);
  for (let i = 0; i < 4; i++) {
    const x = i % 2 === 0 ? 388 : 698;
    const y = i < 2 ? 810 : 844;
    drawText(x, y, ALSO[i][0], 2, INK);
    drawText(x, y + 17, ALSO[i][1], 2, INK);
  }
  drawText(388, 878, "MORE STORIES", 2, RED);
  for (let i = 0; i < 12; i++) {
    const x = i % 2 === 0 ? 388 : 698;
    const y = 898 + ((i / 2) | 0) * 16;
    drawText(x, y, MORE[i], 2, INK);
  }
}

// ---------------------------------------------------------------- main

function main(): void {
  fillRect(0, 0, W, H, PAPER);
  drawMasthead();
  drawLeads();
  drawGrid();
  drawBrief();
  drawFigures();
  drawMap();
  drawRightBottom();
  drawTextCenter(512, 1006, "THE WORLD IN ONE DAY - THURSDAY 19 NOVEMBER 2026", 1, GREY);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "out";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), encodePNG(pxbuf, W, H));
}

main();


