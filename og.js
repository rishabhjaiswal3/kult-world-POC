'use strict';

const zlib = require('node:zlib');

const WIDTH = 1200;
const HEIGHT = 630;
const FONT = {
  A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],J:['00111','00010','00010','00010','10010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],
  0:['01110','10001','10011','10101','11001','10001','01110'],1:['00100','01100','00100','00100','00100','00100','01110'],2:['01110','10001','00001','00010','00100','01000','11111'],3:['11110','00001','00001','01110','00001','00001','11110'],4:['00010','00110','01010','10010','11111','00010','00010'],5:['11111','10000','10000','11110','00001','00001','11110'],6:['01110','10000','10000','11110','10001','10001','01110'],7:['11111','00001','00010','00100','01000','01000','01000'],8:['01110','10001','10001','01110','10001','10001','01110'],9:['01110','10001','10001','01111','00001','00001','01110'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'],'.':['00000','00000','00000','00000','00000','00110','00110'],',':['00000','00000','00000','00000','00110','00110','00100'],'!':['00100','00100','00100','00100','00100','00000','00100'],':':['00000','00110','00110','00000','00110','00110','00000'],'-':['00000','00000','00000','11111','00000','00000','00000'],'/':['00001','00010','00010','00100','01000','01000','10000'],"'":['00100','00100','00000','00000','00000','00000','00000'],'?':['01110','10001','00001','00010','00100','00000','00100'],'&':['01100','10010','10100','01000','10101','10010','01101'],'+':['00000','00100','00100','11111','00100','00100','00000'],'_':['00000','00000','00000','00000','00000','00000','11111'],
};

function hex(value, fallback = [112, 225, 255]) {
  const match = /^#?([a-f\d]{6})$/i.exec(String(value || ''));
  if (!match) return fallback;
  return [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16)];
}

function image() { return Buffer.alloc(WIDTH * HEIGHT * 4); }
function pixel(buffer, x, y, color, alpha = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const index = (y * WIDTH + x) * 4;
  const a = Math.max(0, Math.min(255, alpha)) / 255;
  buffer[index] = Math.round(color[0] * a + buffer[index] * (1 - a));
  buffer[index + 1] = Math.round(color[1] * a + buffer[index + 1] * (1 - a));
  buffer[index + 2] = Math.round(color[2] * a + buffer[index + 2] * (1 - a));
  buffer[index + 3] = 255;
}
function rect(buffer, x, y, width, height, color, alpha = 255) {
  const x0 = Math.max(0, Math.floor(x)); const x1 = Math.min(WIDTH, Math.ceil(x + width));
  const y0 = Math.max(0, Math.floor(y)); const y1 = Math.min(HEIGHT, Math.ceil(y + height));
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) pixel(buffer, px, py, color, alpha);
}
function circle(buffer, cx, cy, radius, color, alpha = 255) {
  const r2 = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(HEIGHT, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(WIDTH, Math.ceil(cx + radius)); x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d <= r2) pixel(buffer, x, y, color, alpha * (1 - Math.max(0, d / r2 - .72) / .28));
    }
  }
}
function textWidth(value, scale, spacing = scale) { return Math.max(0, String(value).length * (5 * scale + spacing) - spacing); }
function drawText(buffer, value, x, y, scale, color, spacing = scale) {
  const input = String(value || '').normalize('NFKD').replace(/[“”]/g,"'").replace(/[–—·]/g,'-').toUpperCase();
  let cursor = x;
  for (const char of input) {
    const glyph = FONT[char] || FONT['?'];
    glyph.forEach((row, gy) => [...row].forEach((cell, gx) => { if (cell === '1') rect(buffer, cursor + gx * scale, y + gy * scale, scale, scale, color); }));
    cursor += 5 * scale + spacing;
  }
  return cursor;
}
function wrap(value, limit = 24, maxLines = 3) {
  const words = String(value || '').toUpperCase().split(/\s+/).filter(Boolean); const lines = []; let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > limit && line) { lines.push(line); line = word; } else line = candidate;
    if (lines.length === maxLines - 1) break;
  }
  const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length;
  const rest = words.slice(consumed).join(' ');
  if (rest) lines.push(rest.length > limit ? `${rest.slice(0, limit - 1)}.` : rest);
  else if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

let crcTable;
function crc32(buffer) {
  if (!crcTable) crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type); const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8); return out;
}
function png(buffer) {
  const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) { const offset = y * (WIDTH * 4 + 1); raw[offset] = 0; buffer.copy(raw, offset + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4); }
  const header = Buffer.alloc(13); header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function renderCard({ eyebrow = 'KULT WORLD', title = 'THE WORLD IS WAKING', detail = 'EARNED IDENTITY. PORTABLE PROOF.', accent = '#70e1ff', accent2 = '#9c7cff', stats = [] } = {}) {
  const buffer = image(); const primary = hex(accent); const secondary = hex(accent2, [156, 124, 255]);
  for (let y = 0; y < HEIGHT; y++) {
    const t = y / HEIGHT; rect(buffer, 0, y, WIDTH, 1, [Math.round(6 + t * 4), Math.round(7 + t * 5), Math.round(17 + t * 12)]);
  }
  for (let x = 0; x < WIDTH; x += 60) rect(buffer, x, 0, 1, HEIGHT, [70, 84, 125], 26);
  for (let y = 0; y < HEIGHT; y += 60) rect(buffer, 0, y, WIDTH, 1, [70, 84, 125], 20);
  circle(buffer, 1040, 90, 290, secondary, 38); circle(buffer, 1100, 130, 190, primary, 48); circle(buffer, 1020, 160, 90, [7, 10, 23], 245);
  rect(buffer, 54, 48, 12, 46, primary); drawText(buffer, 'KULT', 86, 52, 6, [247, 249, 255]); drawText(buffer, 'WORLD', 250, 60, 4, primary);
  drawText(buffer, eyebrow, 62, 140, 3, primary, 3);
  const titleLines = wrap(title, 27, 3); titleLines.forEach((line, index) => drawText(buffer, line, 62, 190 + index * 72, 8, [246, 248, 255], 6));
  const detailLines = wrap(String(detail || '').toUpperCase(), 56, 2); detailLines.forEach((line, index) => drawText(buffer, line, 64, 418 + index * 32, 3, [132, 146, 180], 3));
  const shown = stats.slice(0, 3); shown.forEach((stat, index) => {
    const x = 62 + index * 250; rect(buffer, x, 500, 224, 82, [13, 19, 39], 235); rect(buffer, x, 500, 4, 82, index === 0 ? primary : secondary, 210);
    drawText(buffer, String(stat.value ?? '-').slice(0, 12), x + 18, 516, 4, [244, 246, 255], 4);
    drawText(buffer, String(stat.label || '').slice(0, 18), x + 18, 554, 2, [113, 126, 157], 2);
  });
  const stamp = 'ROBINHOOD CHAIN'; const stampWidth = textWidth(stamp, 3, 3); drawText(buffer, stamp, WIDTH - stampWidth - 52, 568, 3, [113, 241, 184], 3);
  return png(buffer);
}

module.exports = { WIDTH, HEIGHT, renderCard };
