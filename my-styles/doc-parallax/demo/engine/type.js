// Editorial type on the 1920×1080 overlay canvas. Four roles (STYLE.md §4): title, tag/date (mono), story line (serif, one red word,
// hand-drawn underline), number (counts up and lands). Every function is a pure function of time: deterministic per frame.
// Tone: paper-white with a soft dark shadow over dark areas; ink black with a soft paper halo ({ ink: true }) over light skies and paper.
// Every visible piece registers its full text and box in REG (for window.TEXTS / readcheck), from its first visible frame.
import { clamp, seg, ss, eo, mulberry } from '/core/lib.js';

export const RED = '#d7322b', WHITE = '#f4f1ea', INK = '#17140f';
export const F = { title: "800 {s}px 'Inter'", tag: "500 {s}px 'Plex Mono'", serif: "500 {s}px 'Cormorant'", serifI: "italic 600 {s}px 'Cormorant'", num: "800 {s}px 'Inter'" };
const font = (k, s) => F[k].replace('{s}', s);
export const REG = [];
const reg = (id, text, x0, y0, x1, y1) => REG.push({ id, text, x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) });

function toned(x, ink, draw, red = false) {   // shadow (white type) or halo (ink type) behind the glyphs, then the glyphs
  x.save();
  if (ink) { x.shadowColor = 'rgba(246,241,230,.85)'; x.shadowBlur = 16; }
  else if (red) { x.shadowColor = 'rgba(0,0,0,.28)'; x.shadowBlur = 8; x.shadowOffsetY = 1; }   // a dark halo muddies red on a bright sky
  else { x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 18; x.shadowOffsetY = 2; }
  draw(); x.restore();
  draw();
}
const spaced = (x, s, px, py, track) => { let cx = px; for (const ch of s) { x.fillText(ch, cx, py); cx += x.measureText(ch).width + track; } return cx - px - track; };
const spacedW = (x, s, track) => { let w = 0; for (const ch of s) w += x.measureText(ch).width + track; return w - track; };

// Title typed on with a red caret
export function title(x, s, px, py, size, t, t0, { cps = 22, out = Infinity, ink = false, id = 'title' } = {}) {
  if (t < t0) return;
  const fa = 1 - ss(seg(t, out, out + .4)); if (fa <= 0) return;
  const n = Math.min(s.length, Math.floor((t - t0) * cps)), vis = s.slice(0, n);
  x.save(); x.globalAlpha = fa; x.font = font('title', size); x.textBaseline = 'alphabetic'; x.fillStyle = ink ? INK : WHITE;
  const tr = -size * .01;
  toned(x, ink, () => spaced(x, vis, px, py, tr));
  const w = spacedW(x, vis, tr), W = spacedW(x, s, tr);
  if (n < s.length || (Math.floor(t * 2.2) % 2 === 0 && t - t0 < s.length / cps + 1.2)) { x.fillStyle = RED; x.fillRect(px + w + size * .06, py - size * .74, size * .07, size * .78); }
  x.restore();
  reg(id, s, px, py - size * .76, px + W, py + size * .05);
}
// Small mono caps tag, typed on
export function tag(x, s, px, py, size, t, t0, { cps = 30, out = Infinity, align = 'left', ink = false, id = 'tag' } = {}) {
  if (t < t0) return;
  const fa = 1 - ss(seg(t, out, out + .4)); if (fa <= 0) return;
  const n = Math.min(s.length, Math.floor((t - t0) * cps));
  x.save(); x.font = font('tag', size); x.fillStyle = ink ? INK : WHITE; x.textBaseline = 'alphabetic';
  const tr = size * .12, W = spacedW(x, s, tr), ox = align === 'right' ? px - W : px;
  x.globalAlpha = fa; toned(x, ink, () => spaced(x, s.slice(0, n), ox, py, tr));
  x.restore();
  reg(id, s, ox, py - size * .75, ox + W, py + size * .1);
}
// A hand-drawn underline: a slightly wavy stroke with tapered ends, drawn on from left to right (k 0..1)
export function underline(x, x0, x1, y, k, w, seed) {
  const R = mulberry(seed), n = 24, pts = [];
  const a = R() * 6, b = R() * 6;
  for (let i = 0; i <= n; i++) { const u = i / n; pts.push([x0 + (x1 - x0) * u, y + Math.sin(u * 3.1 + a) * w * .35 + Math.sin(u * 7.3 + b) * w * .12 - u * w * .5]); }
  const m = Math.max(1, Math.floor(n * k));
  for (let i = 0; i < m; i++) {
    const u = i / n, th = w * Math.sin(Math.PI * Math.min(1, (u + .04) / 1.0)) ** .6;
    x.lineWidth = Math.max(1, th); x.beginPath(); x.moveTo(...pts[i]); x.lineTo(...pts[i + 1]); x.stroke();
  }
}
// Story line: words rise in one by one; the word at index red (or none) is red italic, then underlined
export function story(x, words, red, px, py, size, t, t0, { out = Infinity, gap = .085, maxW = 900, lh = 1.08, align = 'left', ink = false, id = 'story' } = {}) {
  if (t < t0 - .05) return;
  const fa = 1 - ss(seg(t, out, out + .45)); if (fa <= 0) return;
  x.save(); x.textBaseline = 'alphabetic';
  const sp = size * .26, lines = [[]]; let lw = 0;
  words.forEach((w, i) => { x.font = font(i === red ? 'serifI' : 'serif', size); const ww = x.measureText(w).width; if (lw + ww > maxW && lines[lines.length - 1].length) { lines.push([]); lw = 0; } lines[lines.length - 1].push({ w, i, ww }); lw += ww + sp; });
  let ux = null, bx0 = Infinity, bx1 = -Infinity;
  lines.forEach((ln, li) => {
    const tot = ln.reduce((s, o) => s + o.ww, 0) + sp * (ln.length - 1);
    let cx = align === 'right' ? px - tot : px; const y = py + li * size * lh;
    bx0 = Math.min(bx0, cx); bx1 = Math.max(bx1, cx + tot);
    for (const o of ln) {
      const k = ss(seg(t, t0 + o.i * gap, t0 + o.i * gap + .38));
      if (k > 0) {
        x.globalAlpha = k * fa; x.font = font(o.i === red ? 'serifI' : 'serif', size); x.fillStyle = o.i === red ? RED : ink ? INK : WHITE;
        const yy = y + (1 - k) * size * .12;
        toned(x, ink, () => x.fillText(o.w, cx, yy), o.i === red);
      }
      if (o.i === red) ux = [cx, cx + o.ww, y + size * .16];
      cx += o.ww + sp;
    }
  });
  if (ux && red != null) {
    const tu = t0 + red * gap + .4, k = eo(seg(t, tu, tu + .45));
    if (k > 0) { x.globalAlpha = fa; x.strokeStyle = RED; x.lineCap = 'round'; underline(x, ux[0] - size * .04, ux[1] + size * .06, ux[2], k, size * .07, 7 + red); }
  }
  x.restore();
  reg(id, words.join(' '), bx0, py - size * .8, bx1, py + (lines.length - 1) * size * lh + size * .25);
}
// Number: counts from `from` to `to` over dur with an ease-out, lands with a small settle; fmt(v) → string
export function number(x, from, to, fmt, px, py, size, t, t0, dur, { out = Infinity, align = 'left', ink = false, id = 'number', ease = eo } = {}) {   // ease: match the count to what it measures (a route's draw curve)
  if (t < t0) return;
  const fa = ss(seg(t, t0, t0 + .25)) * (1 - ss(seg(t, out, out + .4))); if (fa <= 0) return;
  const k = ease(seg(t, t0, t0 + dur)), v = from + (to - from) * k;
  const settle = 1 + .035 * Math.sin(clamp((t - t0 - dur) / .35, 0, 1) * Math.PI);
  x.save(); x.globalAlpha = fa; x.font = font('num', size); x.fillStyle = ink ? INK : WHITE; x.textBaseline = 'alphabetic'; x.textAlign = align;
  const fin = fmt(to), W = x.measureText(fin).width;
  x.translate(px, py); x.scale(settle, settle); toned(x, ink, () => x.fillText(fmt(v), 0, 0)); x.restore();
  const x0 = align === 'right' ? px - W : align === 'center' ? px - W / 2 : px;
  reg(id, fin, x0, py - size * .74, x0 + W, py + size * .04);
}
