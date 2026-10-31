// Plan-view light transport (CPU, deterministic). Walls are full height, so whether a point on a panel (or a virtual light)
// sees a surface point is decided in plan: a polar "shadow map" per emitter point stores, for every direction, the distance
// to the nearest wall. The bake shader then tests visibility with one texture fetch.
//   direct: every lit panel → 8 sub-points (2 × 4 over its 0.6 × 1.2 m area), one polar map each (A_FIX directions)
//   bounce: every lit panel → NVPL virtual point lights where its light lands (floor or wall), with power = flux × albedo / NVPL
import { RECTS, H, LIT, PANEL, ALB, wallAlbedo, ROOMS, CW, RD, WT } from './world.js';
import { mulberry } from '/core/lib.js';

export const A_FIX = 2048, A_VPL = 1024, NSUB = 8, NVPL = 64;
export const R_FIX = 15, R_VPL = 11;       // influence radius (m): beyond it a light counts as occluded (≤ 0.2 % of its peak)
export const LE = 10;                       // panel radiance (arbitrary units; floor under a panel ≈ 1)
export const BOUNCE_BOOST = 1.35;           // stands in for the second and later bounces
export const SUB = [];                      // sub-point offsets over the panel
for (const sx of [-0.15, 0.15]) for (const sz of [-0.45, -0.15, 0.15, 0.45]) SUB.push([sx, sz]);

const RF = new Float32Array(RECTS.flat());
function near(ox, oz, r) {   // wall rects that come within r of (ox, oz)
  const out = [];
  for (let i = 0; i < RF.length; i += 4) {
    const dx = Math.max(RF[i] - ox, 0, ox - RF[i + 2]), dz = Math.max(RF[i + 1] - oz, 0, oz - RF[i + 3]);
    if (dx * dx + dz * dz < r * r) out.push(RF[i], RF[i + 1], RF[i + 2], RF[i + 3]);
  }
  return new Float32Array(out);
}
// plan ray → [distance, face normal x, face normal z]
function cast(ox, oz, dx, dz, rs, rmax) {
  let best = rmax, nx = 0, nz = 0;
  const ix = 1 / (Math.abs(dx) < 1e-9 ? (dx < 0 ? -1e-9 : 1e-9) : dx), iz = 1 / (Math.abs(dz) < 1e-9 ? (dz < 0 ? -1e-9 : 1e-9) : dz);
  for (let i = 0; i < rs.length; i += 4) {
    let t0 = (rs[i] - ox) * ix, t1 = (rs[i + 2] - ox) * ix; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; }
    let u0 = (rs[i + 1] - oz) * iz, u1 = (rs[i + 3] - oz) * iz; if (u0 > u1) { const q = u0; u0 = u1; u1 = q; }
    const tn = Math.max(t0, u0), tf = Math.min(t1, u1);
    if (tn < tf && tf > 0) {
      const t = Math.max(tn, 0);
      if (t < best) { best = t; if (t0 > u0) { nx = dx > 0 ? -1 : 1; nz = 0; } else { nx = 0; nz = dz > 0 ? -1 : 1; } }
    }
  }
  return [best, nx, nz];
}
// polar map from (ox, oz): A directions, bin a covers angle ((a + .5)/A)·2π − π (matches the shader's atan2 binning)
function polar(ox, oz, A, r, out, stride, off) {
  const rs = near(ox, oz, r);
  for (let a = 0; a < A; a++) {
    const th = (a + 0.5) / A * 2 * Math.PI - Math.PI;
    out[a * stride + off] = cast(ox, oz, Math.cos(th), Math.sin(th), rs, r)[0];
  }
}
const boardAt = (x, y, z, nz) => nz > 0 && ROOMS.some(r => Math.abs(z - (r.zn + WT / 2)) < 0.02 && Math.abs(x - r.side * (CW + RD / 2)) < 1.7) && y > 0.92 && y < 2.08;

export function buildLight2D() {
  const NF = LIT.length;
  const fixData = new Float32Array(NF * 4);
  const fixShadow = new Float32Array(A_FIX * NF * 2 * 4);   // width A_FIX, height 2·NF, RGBA: row 2f + r holds sub-points 4r…4r+3
  const vplPos = new Float32Array(NVPL * NF * 4);           // width NVPL, height NF: x, y, z, normal code (0 +y, 1 +x, 2 −x, 3 +z, 4 −z)
  const vplPow = new Float32Array(NVPL * NF * 4);           // r, g, b, luminance of (flux × albedo / NVPL)
  const vplShadow = new Float32Array(A_VPL * NF * (NVPL / 4) * 4);   // width A_VPL, height NF·NVPL/4, RGBA: 4 VPLs per row
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let nWall = 0, nFloor = 0;
  LIT.forEach((f, fi) => {
    fixData.set([f.x, f.z, f.layer, 0], fi * 4);
    // direct: polar maps of the 8 sub-points
    SUB.forEach(([sx, sz], s) => {
      const row = fi * 2 + (s >> 2), ch = s & 3;
      polar(f.x + sx, f.z + sz, A_FIX, R_FIX, fixShadow.subarray(row * A_FIX * 4), 4, ch);
    });
    // bounce: stratified cosine-weighted rays down from the panel
    const R = mulberry(1000 + fi * 7919), rs = near(f.x, f.z, 30), oy = H - 0.02;
    const perm = Array.from({ length: NVPL }, (_, i) => i); for (let i = NVPL - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let v = 0; v < NVPL; v++) {
      const px = f.x + ((v % 8 + R()) / 8 - 0.5) * PANEL.w, pz = f.z + ((Math.floor(v / 8) + R()) / 8 - 0.5) * PANEL.l;
      const r1 = (perm[v] + R()) / NVPL, phi = 2 * Math.PI * R();
      const st = Math.sqrt(r1), ct = Math.sqrt(1 - r1), dx = Math.cos(phi), dz = Math.sin(phi);
      const tFloor = oy / ct;
      const [pd, nx, nz] = cast(px, pz, dx, dz, rs, 1e4);
      const tWall = st > 1e-6 ? pd / st : 1e9;
      let x, y, z, code, alb;
      if (tWall < tFloor) {
        x = px + dx * pd + nx * 0.02; z = pz + dz * pd + nz * 0.02; y = oy - ct * tWall;
        code = nx > 0 ? 1 : nx < 0 ? 2 : nz > 0 ? 3 : 4;
        alb = boardAt(x, y, z, nz) ? ALB.board : wallAlbedo(x - nx * 0.02, y, z - nz * 0.02, nx);
        nWall++;
      } else {
        x = px + dx * st * tFloor; z = pz + dz * st * tFloor; y = 0.02; code = 0; alb = ALB.floor; nFloor++;
      }
      const k = LE * PANEL.w * PANEL.l / NVPL * BOUNCE_BOOST;
      const o = (fi * NVPL + v) * 4;
      vplPos.set([x, y, z, code], o);
      vplPow.set([k * alb[0], k * alb[1], k * alb[2], k * lum(alb)], o);
      const row = fi * (NVPL / 4) + (v >> 2);
      polar(x, z, A_VPL, R_VPL, vplShadow.subarray(row * A_VPL * 4), 4, v & 3);
    }
  });
  return { NF, fixData, fixShadow, vplPos, vplPow, vplShadow, stats: { nWall, nFloor } };
}
