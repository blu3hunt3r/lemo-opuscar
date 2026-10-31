// Light bake for Wing C — three.js r187: WebGPURenderer (WebGL2 backend, so it runs in any headless Chrome), unwrapUVs, LightMapper.
// Output (through window.SAVE, see tools/bake.mjs): per surface set (walls / floor / ceil) and pass, one RGBA half-float light map:
//   passes 0…9: light-style layers 3p, 3p+1, 3p+2 in R, G, B (luminance of direct + bounce); pass 10: everything on, RGB (the chroma map)
//   plus the unwrapped wall geometry (position, normal, uv, uv1, index) so the film draws exactly what was baked.
// The bake is deterministic: each texel cycles through all 8 panel sub-points and all 64 virtual lights of every panel (spp a multiple of 8).
import * as THREE from 'three/webgpu';
import { Fn, Loop, If, float, int, ivec2, vec2, vec3, uint, textureLoad, uniform, hash, screenCoordinate, max, dot, sqrt, select, atan, floor, mod, step } from 'three/tsl';
import { unwrapUVs } from 'three/addons/utils/unwrapUVs.js';
import { LightMapper } from 'three/addons/lighting/LightMapper.js';
import * as WD from '../world.js';
import { buildLight2D, A_FIX, A_VPL, NVPL, R_FIX, R_VPL, LE } from '../light2d.js';

const Q = new URLSearchParams(location.search);
const SPP = +(Q.get('spp') || 16);
const SIZE = { walls: +(Q.get('wall') || 1536), floor: +(Q.get('plan') || 1024), ceil: +(Q.get('plan') || 1024) };
const NPASS = Math.ceil(WD.NLAYER / 3);   // layer passes; then one chroma pass
const log = (...a) => console.log('[bake]', ...a);

const renderer = new THREE.WebGPURenderer({ forceWebGL: !Q.has('gpu'), antialias: false });
renderer.setSize(64, 64); document.body.appendChild(renderer.domElement);
await renderer.init();

// —— Plan-view data (CPU) ——
let t0 = performance.now();
const L2 = buildLight2D();
log(`light2d ${L2.NF} panels, VPL wall/floor ${L2.stats.nWall}/${L2.stats.nFloor}, ${Math.round(performance.now() - t0)} ms`);
const dtex = (arr, w, h) => { const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; };
const fixData = dtex(L2.fixData, L2.NF, 1), fixShadow = dtex(L2.fixShadow, A_FIX, L2.NF * 2);
const vplPos = dtex(L2.vplPos, NVPL, L2.NF), vplPow = dtex(L2.vplPow, NVPL, L2.NF), vplShadow = dtex(L2.vplShadow, A_VPL, L2.NF * NVPL / 4);

// —— Irradiance (TSL) ——
// Each texel only visits the panels that can reach it: a layer pass visits its three corridor panels; the classroom pass visits
// the panels of the texel's own room (or, from the corridor, of the three nearest rooms on each side); the chroma pass visits both.
const uPass = uniform(0), uMode = uniform(0);   // mode 0: corridor layers, 1: classroom layer, 2: chroma (everything, RGB)
const TINT = vec3(1.0, 0.975, 0.9);   // panel colour (cool-white tubes behind a yellowed diffuser)
const pick4 = (v, k) => select(k.lessThan(0.5), v.x, select(k.lessThan(1.5), v.y, select(k.lessThan(2.5), v.z, v.w)));
// polar shadow map lookup: is plan point p visible from origin o? (taps: neighbouring directions averaged)
function polarVis(T, A, row, ch, o, p, taps) {
  const d = p.sub(o), dist = d.length();
  const b = floor(atan(d.y, d.x).add(Math.PI).mul(A / (2 * Math.PI)));
  let acc = float(0);
  for (const db of taps) acc = acc.add(step(dist, pick4(textureLoad(T, ivec2(int(mod(b.add(db + A), A)), int(row))), ch)));
  return acc.div(taps.length);
}
const normalFromCode = c => select(c.lessThan(0.5), vec3(0, 1, 0), select(c.lessThan(1.5), vec3(1, 0, 0), select(c.lessThan(2.5), vec3(-1, 0, 0), select(c.lessThan(3.5), vec3(0, 0, 1), vec3(0, 0, -1)))));
const ROOM0 = WD.NCOR;   // index of the first classroom panel in LIT (6 per room, rooms in world.js ROOMS order)

const irradiance = (P, N, S) => Fn(() => {
  const Pp = P.add(N.mul(0.02)).toVar();
  const out = vec3(0).toVar();
  const seed = uint(screenCoordinate.x).mul(uint(73856093)).bitXor(uint(screenCoordinate.y).mul(uint(19349663))).toVar();
  const s = floor(S).toVar();
  const sub = mod(s.add(floor(hash(seed).mul(8))), 8).toVar();                 // panel sub-point for this sample
  const vofs = floor(hash(seed.add(uint(17))).mul(NVPL)).toVar();              // per-texel start in the VPL cycle
  const sx = select(sub.lessThan(3.5), float(-0.15), float(0.15)), sz = mod(sub, 4).mul(0.3).sub(0.45);
  const contrib = (fi, w) => {   // fi: float index into LIT; w: output weights (one-hot channel or tint)
    const ii = int(fi);
    const F = textureLoad(fixData, ivec2(ii, int(0)));
    const dxz = Pp.xz.sub(F.xy);
    If(dot(dxz, dxz).lessThan(R_FIX * R_FIX), () => {
      // direct: one sub-point of the panel per sample
      const sp = vec2(F.x.add(sx), F.y.add(sz));
      const l = vec3(sp.x, WD.H - 0.01, sp.y).sub(Pp).toVar();
      const d2 = dot(l, l), ln = l.div(sqrt(d2));
      const g = max(ln.y, 0).mul(max(dot(N, ln), 0)).div(d2.add(0.05)).toVar();
      If(g.greaterThan(0), () => {
        const vis = polarVis(fixShadow, A_FIX, fi.mul(2).add(floor(sub.div(4))), mod(sub, 4), sp, Pp.xz, [-1, 0, 1]);
        out.addAssign(w.mul(g.mul(vis).mul(LE * WD.PANEL.w * WD.PANEL.l)));
      });
      // bounce: 8 of the panel's 64 virtual lights per sample (×8, so the average over 8 samples is the full sum)
      Loop({ start: 0, end: 8, type: 'int', condition: '<', name: 'vm' }, ({ vm }) => {
        const v = mod(s.mul(8).add(float(vm)).add(vofs), NVPL);
        const VP = textureLoad(vplPos, ivec2(int(v), ii)), VW = textureLoad(vplPow, ivec2(int(v), ii));
        const lv = VP.xyz.sub(Pp).toVar();
        const dv2 = dot(lv, lv), lvn = lv.div(sqrt(dv2));
        const gv = max(dot(normalFromCode(VP.w), lvn.negate()), 0).mul(max(dot(N, lvn), 0)).div(dv2.add(0.6)).toVar();
        If(gv.greaterThan(0).and(dv2.lessThan(R_VPL * R_VPL)), () => {
          const vis = polarVis(vplShadow, A_VPL, fi.mul(NVPL / 4).add(floor(v.div(4))), mod(v, 4), VP.xz, Pp.xz, [0]);
          const pw = select(uMode.greaterThan(1.5), VW.xyz.mul(TINT), w.mul(VW.w));
          out.addAssign(pw.mul(gv.mul(vis).mul(NVPL / 8)));
        });
      });
    });
  };
  // corridor panels: layer passes take panels 3p…3p+2, the chroma pass a ±6 window around the texel
  const k0 = select(uMode.lessThan(0.5), uPass.mul(3), floor(Pp.z.negate().add(1.2).div(2.4).add(0.5)).sub(6).clamp(0, WD.NCOR - 1)).toVar();
  const kn = select(uMode.lessThan(0.5), float(3), select(uMode.greaterThan(1.5), float(13), float(0))).toVar();
  Loop({ start: 0, end: 13, type: 'int', condition: '<', name: 'ck' }, ({ ck }) => {
    const k = k0.add(float(ck));
    If(float(ck).lessThan(kn).and(k.lessThan(WD.NCOR - 0.5)), () => {
      const c = k.sub(uPass.mul(3));
      const w = select(uMode.greaterThan(1.5), TINT, vec3(select(c.lessThan(0.5), float(1), float(0)), select(c.greaterThan(0.5).and(c.lessThan(1.5)), float(1), float(0)), select(c.greaterThan(1.5), float(1), float(0))));
      contrib(k, w);
    });
  });
  // classroom panels (layer 27, output in R in its pass)
  const inRoom = Pp.x.abs().greaterThan(WD.CW).toVar();
  const jc = floor(float(WD.Z0).sub(Pp.z).div(WD.RL)).toVar();
  const ownSide = select(Pp.x.lessThan(0), float(0), float(1));
  If(uMode.greaterThan(0.5), () => {
    Loop({ start: 0, end: 6, type: 'int', condition: '<', name: 'rs' }, ({ rs }) => {
      const r = float(rs);
      const side = select(inRoom, ownSide, mod(r, 2));
      const j = select(inRoom, jc, jc.add(floor(r.div(2))).sub(1));
      const ok = j.greaterThan(-0.5).and(j.lessThan(WD.NROOM - 0.5)).and(inRoom.not().or(r.lessThan(0.5)));
      If(ok, () => {
        const base = side.mul(WD.NROOM).add(j).mul(6).add(ROOM0);
        const w = select(uMode.greaterThan(1.5), TINT, vec3(1, 0, 0));
        Loop({ start: 0, end: 6, type: 'int', condition: '<', name: 'rq' }, ({ rq }) => { contrib(base.add(float(rq)), w); });
      });
    });
  });
  return out;
})();

// —— Surfaces ——
const basic = new THREE.MeshBasicNodeMaterial();
const wallGroup = new THREE.Group();
const parts = {
  walls: WD.wallGeometry(WD.BAKE_ZMIN, WD.ZSTART + 1), trims: WD.trimGeometry(), boards: WD.boardGeometry(), windows: WD.windowGeometry(),
  n1: WD.noticeGeometry(WD.NOTICES[0]), n2: WD.noticeGeometry(WD.NOTICES[1]),
};
const wallMeshes = Object.entries(parts).map(([name, g]) => { const m = new THREE.Mesh(g, basic); m.name = name; wallGroup.add(m); return m; });
t0 = performance.now();
const atlas = unwrapUVs(wallGroup, { resolution: SIZE.walls, padding: 4 });
if (!atlas) throw new Error('unwrapUVs: charts do not fit');
log(`unwrapUVs ${Math.round(performance.now() - t0)} ms`, JSON.stringify(atlas.warnings || {}), 'texels/m', atlas.texelsPerUnit ?? atlas.density);
const floorMesh = new THREE.Mesh(WD.planGeometry(0, true), basic), ceilMesh = new THREE.Mesh(WD.planGeometry(WD.H, false), basic);
const SETS = { walls: wallMeshes, floor: [floorMesh], ceil: [ceilMesh] };
const LMS = {};
for (const [k, objs] of Object.entries(SETS)) { LMS[k] = new LightMapper(renderer, SIZE[k], irradiance); LMS[k].addObjects(objs); }

// —— Export helpers ——
async function save(name, typed) {
  const blob = new Blob([typed.buffer.slice(typed.byteOffset, typed.byteOffset + typed.byteLength)]);
  const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  const b64 = url.slice(url.indexOf(',') + 1), CH = 8 << 20;
  for (let o = 0, part = 0; o < b64.length; o += CH, part++) await window.SAVE(name, b64.slice(o, o + CH), part);
}
async function exportGeometry() {
  const meta = [];
  for (const m of wallMeshes) {
    const g = m.geometry, entry = { name: m.name, attrs: {} };
    for (const a of ['position', 'normal', 'uv', 'uv1']) {
      const at = g.getAttribute(a); if (!at) continue;
      const arr = new Float32Array(at.count * at.itemSize); for (let i = 0; i < at.count; i++) for (let c = 0; c < at.itemSize; c++) arr[i * at.itemSize + c] = at.getComponent(i, c);
      await save(`geo_${m.name}_${a}.bin`, arr); entry.attrs[a] = at.itemSize; entry.count = at.count;
    }
    if (g.index) { await save(`geo_${m.name}_index.bin`, new Uint32Array(g.index.array)); entry.index = g.index.count; }
    meta.push(entry);
  }
  return meta;
}

window.BAKE = async (only = null) => {
  const manifest = { spp: SPP, size: SIZE, npass: NPASS, nlayer: WD.NLAYER, maps: [], geometry: await exportGeometry(), atlas: { warnings: atlas.warnings } };
  const passes = [...Array(NPASS + 1).keys()].filter(p => only == null || only.includes(p));
  for (const p of passes) {
    uPass.value = p; uMode.value = p === NPASS ? 2 : p * 3 >= WD.NCOR ? 1 : 0;
    for (const [k, lm] of Object.entries(LMS)) {
      const t = performance.now();
      lm.reset(); lm.update(SPP);
      const px = await renderer.readRenderTargetPixelsAsync(lm._renderTarget, 0, 0, SIZE[k], SIZE[k]);
      const name = `lm_${k}_${p === NPASS ? 'chroma' : 'p' + p}.bin`;
      await save(name, px);
      manifest.maps.push({ set: k, pass: p, file: name, size: SIZE[k], type: px.constructor.name });
      log(`pass ${p} ${k}: ${Math.round(performance.now() - t)} ms (${px.constructor.name})`);
    }
  }
  return manifest;
};
window.READY = true;
