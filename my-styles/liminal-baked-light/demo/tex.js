// Procedural textures (Canvas2D, deterministic): the two notices and the prismatic panel diffuser.
import * as THREE from 'three';
import { mulberry } from '/core/lib.js';

const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function tex(c, { repeat = false, aniso = 16 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function grain(x, w, h, n, a, R, cols) {
  for (let i = 0; i < n; i++) { x.fillStyle = cols[Math.floor(R() * cols.length)]; x.globalAlpha = a * (0.3 + R() * 0.7); const s = 1 + R() * 2; x.fillRect(R() * w, R() * h, s, s); }
  x.globalAlpha = 1;
}
export const RULES = ['Keep moving.', 'Never stand in the dark.', 'If lights come on ahead, stop.'];
export const RULE4 = 'The sensors do not detect staff.';

// Notice: photocopied facilities sheet. second = the copy on the east wall, with rule 4 on a taped strip
export function notice(second = false) {
  const W = 1020, H = 1380, c = cv(W, H), x = c.getContext('2d'), R = mulberry(second ? 31 : 17);
  x.fillStyle = second ? '#ebe5c9' : '#efeada'; x.fillRect(0, 0, W, H);
  const eg = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.78);
  eg.addColorStop(0, 'rgba(0,0,0,0)'); eg.addColorStop(1, `rgba(140,120,60,${second ? 0.34 : 0.24})`);
  x.fillStyle = eg; x.fillRect(0, 0, W, H);
  grain(x, W, H, 30000, 0.06, R, ['#8c7c55', '#fffbe9']);
  const ink = '#1c1b18', M = 78;
  x.fillStyle = ink; x.textBaseline = 'alphabetic';
  x.font = "700 30px 'IBM Plex Sans Condensed'"; x.fillText('WING C — FACILITIES', M, 112);
  const f = 'FORM L-3 (REV. 2)'; x.fillText(f, W - M - x.measureText(f).width, 112);
  x.fillRect(M, 130, W - 2 * M, 5);
  x.font = "700 104px 'IBM Plex Sans Condensed'"; x.fillText('MOTION', M, 258); x.fillText('LIGHTING', M, 360);
  x.font = "600 46px 'IBM Plex Sans Condensed'"; x.fillStyle = '#34312a'; x.fillText('Lights turn off when nothing moves.', M, 432);
  x.fillStyle = ink; x.fillRect(M, 462, W - 2 * M, 2);
  let y = 560;
  RULES.forEach((r, i) => {
    let fs = 66; do { x.font = `600 ${fs}px 'IBM Plex Sans Condensed'`; fs -= 2; } while (x.measureText(RULES[2]).width > W - 2 * M - 70);
    x.font = `700 ${fs + 2}px 'IBM Plex Sans Condensed'`; x.fillText(`${i + 1}.`, M, y);
    x.font = `600 ${fs + 2}px 'IBM Plex Sans Condensed'`; x.fillText(r, M + 70, y); y += 98;
  });
  x.fillRect(M, H - 190, W - 2 * M, 2);
  x.font = "400 30px 'IBM Plex Sans'"; x.fillStyle = '#34312a';
  x.fillText('Thank you for your cooperation.', M, H - 140); x.fillText('Facilities Management', M, H - 100);
  if (second) {
    // a strip printed later and taped over the footer, slightly crooked
    x.save(); x.translate(W / 2, 1010); x.rotate(-0.012);
    x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(-W / 2 + 40, -70, W - 70, 150);
    x.fillStyle = '#e9e3cb'; x.fillRect(-W / 2 + 34, -78, W - 72, 150);
    x.fillStyle = ink; x.font = "700 60px 'IBM Plex Sans'"; x.fillText('4.', -W / 2 + 70, 18);
    x.font = "700 60px 'IBM Plex Sans'"; x.fillText('The sensors do not', -W / 2 + 144, -8); x.fillText('detect staff.', -W / 2 + 144, 56);
    // tape at both ends
    x.fillStyle = 'rgba(214,204,150,.75)'; x.fillRect(-W / 2 + 14, -64, 56, 120); x.fillRect(W / 2 - 74, -64, 56, 120);
    x.restore();
  }
  for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(30,30,30,${R() * 0.25})`; x.fillRect(R() * W, R() * H, 1 + R() * 3, 1 + R() * 2); }
  x.fillStyle = 'rgba(0,0,0,.05)'; x.fillRect(0, H * 0.48, W, 3); x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(0, H * 0.48 + 3, W, 2);
  return tex(c);
}

// Prismatic diffuser for a 0.6 × 1.2 m troffer: white frame, a lens of tiny prisms, two tube shadows; alpha unused
export function diffuser() {
  const W = 128, H = 256, c = cv(W, H), x = c.getContext('2d'), R = mulberry(5);
  x.fillStyle = '#d9d6c8'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#fbfaf2'; x.fillRect(6, 6, W - 12, H - 12);
  for (let j = 8; j < H - 8; j += 3) for (let i = 8; i < W - 8; i += 3) { x.fillStyle = `rgba(200,200,190,${0.18 + 0.12 * R()})`; x.fillRect(i, j, 1, 1); }
  // the two tubes behind the lens read as brighter bands
  for (const cx of [W * 0.33, W * 0.67]) { const g = x.createLinearGradient(cx - 18, 0, cx + 18, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(cx - 18, 10, 36, H - 20); }
  // a few dead insects in the lens
  for (let k = 0; k < 3; k++) { x.fillStyle = 'rgba(40,35,25,.55)'; x.fillRect(12 + R() * (W - 30), 12 + R() * (H - 40), 3, 2); }
  const t = tex(c); t.generateMipmaps = true; return t;
}
