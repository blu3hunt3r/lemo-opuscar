// Wing C: layout, fixtures, sensors and light-style layers. Shared by the bake page (three.webgpu.js) and the film page (three.module.js),
// so the geometry the bake lights is exactly the geometry the film draws.
// Coordinates: metres; x east, z south; the corridor runs north (−z). All walls are full height: plan-view visibility is exact.
import * as THREE from 'three';

export const H = 2.7, WT = 0.14;          // ceiling height, wall thickness
export const CW = 1.5;                    // corridor half width (faces at x = ±1.5)
export const RD = 7.0, RL = 7.2;          // classroom depth (x) and length (z)
export const Z0 = -2.4, NROOM = 8;        // first classroom boundary; rooms per side
export const ZEND = Z0 - NROOM * RL;      // −60.0: last classroom boundary
export const ZSTART = 4.0, ZFAR = -130;   // dead end behind the start; the corridor runs on unlit into the fog
export const XO = CW + RD;                // outer (window) wall face, ±8.5
export const DOOR = { w: 1.0, off: 0.7 }; // doorway width; gap starts 0.7 m north of the room's south partition
export const BAKE_ZMIN = -76;             // walls south of this are baked; beyond, the unlit far corridor
// Plan maps (floor and ceiling light maps): x ∈ [−9, 9], z ∈ [−72, 4], folded into two side-by-side strips of 18 × 38 m
export const PLAN = { x0: -9, x1: 9, zA: [-34, 4], zB: [-72, -34] };

// —— Walls: rectangles in plan [x0, z0, x1, z1], all floor to ceiling ——
export const RECTS = [];
const rx = (x0, x1, zc) => RECTS.push([Math.min(x0, x1), zc - WT / 2, Math.max(x0, x1), zc + WT / 2]);   // wall running along x at z = zc
const rz = (xc, z0, z1) => RECTS.push([xc - WT / 2, Math.min(z0, z1), xc + WT / 2, Math.max(z0, z1)]);  // wall running along z at x = xc
export const ROOMS = [];   // {side: −1 west / +1 east, j, zs (south edge, larger z), zn (north edge), door: [zA, zB]}
for (const s of [-1, 1]) for (let j = 0; j < NROOM; j++) {
  const zs = Z0 - j * RL, zn = zs - RL;
  ROOMS.push({ side: s, j, zs, zn, door: [zs - DOOR.off - DOOR.w, zs - DOOR.off] });
}
// corridor walls (faces at x = ±CW), broken by one doorway per classroom
for (const s of [-1, 1]) {
  const xc = s * (CW + WT / 2);
  const gaps = ROOMS.filter(r => r.side === s).map(r => r.door).sort((a, b) => b[0] - a[0]);
  let z = ZSTART + WT;
  for (const [g0, g1] of gaps) { rz(xc, z, g1); z = g0; }
  rz(xc, z, BAKE_ZMIN); rz(xc, BAKE_ZMIN, ZFAR);
  // classroom partitions (south edge of each room + the last north edge) and the outer window wall
  for (let j = 0; j <= NROOM; j++) rx(s * CW, s * (XO + WT), Z0 - j * RL);
  rz(s * (XO + WT / 2), Z0, ZEND);
}
rx(-CW - WT, CW + WT, ZSTART + WT / 2);   // dead end behind the start
rx(-CW - WT, CW + WT, ZFAR - WT / 2);     // far end (never lit, deep in the fog)

// —— Fixtures: 0.6 × 1.2 m recessed panels, long axis along z ——
// Corridor: one row at x = 0, F0…F26 at z = 1.2 − 2.4k; each is its own light-style layer (0…26). Past F26 the panels are dead.
// Classrooms: 2 × 3 per room, all on one layer (27). Layer −1 = never lit.
export const PANEL = { w: 0.6, l: 1.2 };
export const NCOR = 27, LAYER_ROOMS = 27, NLAYER = 28;
export const FIXTURES = [];
for (let k = 0; ; k++) {
  const z = 1.2 - 2.4 * k; if (z < ZFAR + 3) break;
  FIXTURES.push({ x: 0, z, layer: k < NCOR ? k : -1, corr: true, k });
}
for (const r of ROOMS) for (const dx of [1.75, 5.25]) for (const dz of [-2.4, 0, 2.4])
  FIXTURES.push({ x: r.side * (CW + dx), z: (r.zs + r.zn) / 2 + dz, layer: LAYER_ROOMS, corr: false, room: r });
export const LIT = FIXTURES.filter(f => f.layer >= 0);   // the ones the bake lights
// motion sensors: a white dome beside every corridor panel, red LED facing down the corridor
export const SENSORS = FIXTURES.filter(f => f.corr).map(f => ({ x: 0.62, z: f.z + 0.35, k: f.k }));

// —— Notices (rules), chalkboards and windows ——
export const NOTICES = [
  { id: 'n1', x: -CW + 0.004, z: 0.55, y: 1.45, face: 1 },      // on the west wall at the start, facing +x
  { id: 'n2', x: CW - 0.004, z: -12.95, y: 1.38, face: -1 },     // on the east wall where the walk stops, facing −x
];
export const NOTICE_SIZE = [0.34, 0.46];

// —— Albedos (linear), used by the bake for bounce and by the film for surfaces ——
const lin = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };   // THREE.Color parses hex as sRGB and stores linear
export const ALB = {
  wall: lin('#b9c49a'), locker: lin('#6f7f66'), floor: lin('#a89a7d'), ceil: lin('#d8d6c4'),
  board: lin('#2f4a3a'), base: lin('#3d3f37'), glass: lin('#0b0e10'),
};
export const LOCKER_Y = [0.12, 1.85];
// is a plan point on a corridor-facing wall face (lockers below 1.85 m inside the classroom zone)?
export const corridorFace = (x, z, nx) => Math.abs(Math.abs(x) - CW) < 0.03 && nx * x < 0 && z < Z0 + 0.01;
export function wallAlbedo(x, y, z, nx) {
  if (y < LOCKER_Y[0]) return ALB.base;
  if (corridorFace(x, z, nx) && y < LOCKER_Y[1]) return ALB.locker;
  return ALB.wall;
}

// —— Geometry ——
// Walls as vertical quads only (no tops or bottoms, which would waste light-map atlas space), 2 cm past floor and ceiling against seams.
function quad(P, N, a, b, n) {   // a, b: [x, z] ends of the bottom edge; n: outward normal [nx, nz]
  const y0 = -0.02, y1 = H + 0.02;
  const v = [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y0, a[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]];
  // counter-clockwise seen from the n side: a must lie left of b for a viewer looking along −n (right = (nz, −nx))
  const e = [b[0] - a[0], b[1] - a[1]], cr = e[0] * n[1] - e[1] * n[0];
  if (cr < 0) v.reverse();
  for (const p of v) { P.push(...p); N.push(n[0], 0, n[1]); }
}
export function wallGeometry(zmin, zmax) {
  const P = [], N = [];
  for (const [x0, z0, x1, z1] of RECTS) {
    const za = Math.max(z0, zmin), zb = Math.min(z1, zmax); if (zb <= za) continue;
    // long faces and end caps
    quad(P, N, [x0, za], [x0, zb], [-1, 0]); quad(P, N, [x1, za], [x1, zb], [1, 0]);
    if (zb - za > 0) { quad(P, N, [x0, za], [x1, za], [0, -1]); quad(P, N, [x0, zb], [x1, zb], [0, 1]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return g;
}
// planes facing ±x or ±z at a given spot (chalkboards, windows, notices)
function plane(w, h, cx, cy, cz, face) {   // face: '+x' '-x' '+z' '-z'
  const g = new THREE.PlaneGeometry(w, h);
  const rot = { '+x': Math.PI / 2, '-x': -Math.PI / 2, '+z': 0, '-z': Math.PI }[face];
  g.rotateY(rot); g.translate(cx, cy, cz);
  return g;
}
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export function boardGeometry() {   // one chalkboard per classroom on its north partition, facing the room (+z)
  return mergeGeometries(ROOMS.map(r => plane(3.4, 1.15, r.side * (CW + RD / 2), 1.5, r.zn + WT / 2 + 0.006, '+z')));
}
export function windowGeometry() {  // three black night windows per classroom on the outer wall
  const gs = [];
  for (const r of ROOMS) for (const dz of [-2.3, 0, 2.3]) gs.push(plane(1.5, 1.4, r.side * (XO - 0.006), 1.65, (r.zs + r.zn) / 2 + dz, r.side > 0 ? '-x' : '+x'));
  return mergeGeometries(gs);
}
export function trimGeometry() {     // door frames: two jambs + head, 6 cm proud of the corridor face
  const gs = [];
  for (const r of ROOMS) {
    const xf = r.side * CW, [za, zb] = r.door;
    for (const zj of [za, zb]) { const b = new THREE.BoxGeometry(0.06, 2.12, 0.07); b.translate(xf - r.side * 0.03, 1.06, zj + (zj === za ? -0.035 : 0.035)); gs.push(b.toNonIndexed()); }
    const hd = new THREE.BoxGeometry(0.06, 0.07, zb - za + 0.14); hd.translate(xf - r.side * 0.03, 2.155, (za + zb) / 2); gs.push(hd.toNonIndexed());
  }
  const g = mergeGeometries(gs); g.deleteAttribute('uv'); return g;
}
export function noticeGeometry(n) {
  return plane(NOTICE_SIZE[0], NOTICE_SIZE[1], n.x, n.y, n.z, n.face > 0 ? '+x' : '-x');
}
// floor / ceiling: one plane per plan strip, uv1 = plan map coordinates (no unwrap needed)
export function planGeometry(y, up) {
  const gs = [];
  for (const [si, [za, zb]] of [PLAN.zA, PLAN.zB].entries()) {
    const g = new THREE.PlaneGeometry(PLAN.x1 - PLAN.x0, zb - za, 72, 152);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); g.translate((PLAN.x0 + PLAN.x1) / 2, y, (za + zb) / 2);
    const p = g.attributes.position, uv1 = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { const [u, v] = planUV(p.getX(i), p.getZ(i), si); uv1[2 * i] = u; uv1[2 * i + 1] = v; }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    gs.push(g);
  }
  return mergeGeometries(gs);
}
// plan (x, z) → plan-map uv. The same formula is written in GLSL in look.js.
export function planUV(x, z, strip = z < PLAN.zA[0] ? 1 : 0) {
  const [za] = strip ? PLAN.zB : PLAN.zA;
  return [(x - PLAN.x0) / 36 + strip * 0.5, (z - za) / 38];
}
