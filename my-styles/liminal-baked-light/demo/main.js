// Wing C — Liminal Found Footage · Baked Light
// three.js r187 WebGLRenderer: baked light-style layers (bake/bake.js) → 720×540 scene → physical DOF + bloom → VHS camcorder pass → 1920×1080 pillarboxed
import * as THREE from 'three';
import { makePost } from '/core/three/post.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, seg, ss, lerp, hash, vnoise, env } from '/core/lib.js';
import * as WD from './world.js';
import { U, wallMat, floorMat, ceilMat, panelMat, sensorMat, farMat, loadMaps } from './look.js';
import { notice, diffuser } from './tex.js';
import { makeLegs } from './figures.js';
import { VHS } from './vhs.js';
import { drawOSD } from './osd.js';
import * as ST from './story.js';

const Q = new URLSearchParams(location.search);
const NOSUB = Q.has('nosub'), RAW = Q.has('raw'), BASE = Q.has('base'), LMDIR = (Q.get('lm') || 'lm') + '/';
for (const f of ["700 30px 'IBM Plex Sans Condensed'", "600 30px 'IBM Plex Sans Condensed'", "400 30px 'IBM Plex Sans'", "600 30px 'IBM Plex Sans'", "700 30px 'IBM Plex Sans'", "600 30px 'IBM Plex Mono'"]) await document.fonts.load(f);

const W = 1920, H = 1080, SW = 720, SH = 540;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 0.62;
document.getElementById('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0, 0, 0);
const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.03, 160); camera.rotation.order = 'YXZ';
const post = makePost(renderer, scene, camera, SW, SH, { ssaa: 1, ao: false });
post.bloom.strength = 0.32; post.bloom.radius = 0.5; post.bloom.threshold = 1.6;
post.vig.uniforms.amt.value = 0; post.vig.uniforms.contrast.value = 0; post.vig.uniforms.sat.value = 1;
post.dof.maxCoc = 14;
const osdCv = document.createElement('canvas'); osdCv.width = SW; osdCv.height = SH;
const osdTex = new THREE.CanvasTexture(osdCv); osdTex.minFilter = osdTex.magFilter = THREE.LinearFilter; osdTex.generateMipmaps = false;
const vhs = new ShaderPass(VHS);
vhs.uniforms.tOSD.value = osdTex; vhs.uniforms.res.value = [W, H]; vhs.uniforms.src.value = [SW, SH];
if (RAW) Object.assign(vhs.uniforms, { sharp: { value: 0 }, lumaW: { value: .3 }, chromaW: { value: .01 }, chromaShift: { value: 0 }, gain: { value: 0 }, jitter: { value: 0 }, barrel: { value: 0 }, dropout: { value: 0 }, smear: { value: 0 } });
post.composer.addPass(vhs);

// —— The baked space ——
const man = await (await fetch(LMDIR + 'manifest.json')).json();
const [wallLM, floorLM, ceilLM] = await Promise.all([loadMaps(LMDIR, 'walls', man.size.walls), loadMaps(LMDIR, 'floor', man.size.floor), loadMaps(LMDIR, 'ceil', man.size.ceil)]);
U.uFloorLM.value = floorLM; U.uCeilLM.value = ceilLM; U.uBase.value = BASE ? 1 : 0;
const bin = async (fn, T) => new T(await (await fetch(LMDIR + fn)).arrayBuffer());
const NOTICE_TEX = { n1: notice(false), n2: notice(true) };
const KIND = { walls: 0, trims: 1, boards: 2, windows: 3, n1: 4, n2: 4 };
for (const g of man.geometry) {
  const geo = new THREE.BufferGeometry();
  for (const [a, n] of Object.entries(g.attrs)) geo.setAttribute(a, new THREE.BufferAttribute(await bin(`geo_${g.name}_${a}.bin`, Float32Array), n));
  if (g.index) geo.setIndex(new THREE.BufferAttribute(await bin(`geo_${g.name}_index.bin`, Uint32Array), 1));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  scene.add(new THREE.Mesh(geo, wallMat(KIND[g.name], wallLM, NOTICE_TEX[g.name] || null)));
}
scene.add(new THREE.Mesh(WD.planGeometry(0, true), floorMat()));
scene.add(new THREE.Mesh(WD.planGeometry(WD.H, false), ceilMat()));
// the unlit far corridor beyond the bake
{
  const far = farMat();
  scene.add(new THREE.Mesh(WD.wallGeometry(WD.ZFAR - 1, WD.BAKE_ZMIN), far));
  for (const [y, up] of [[0, true], [WD.H, false]]) { const g = new THREE.PlaneGeometry(4, 62); g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); g.translate(0, y, -72 - 31 + 0.01); g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); scene.add(new THREE.Mesh(g, far)); }
}
// panels
{
  const gs = WD.FIXTURES.map(fx => { const g = new THREE.PlaneGeometry(WD.PANEL.w, WD.PANEL.l); g.rotateX(Math.PI / 2); g.translate(fx.x, WD.H - 0.004, fx.z); g.setAttribute('aLayer', new THREE.BufferAttribute(new Float32Array(4).fill(fx.layer), 1)); return g; });
  scene.add(new THREE.Mesh(mergeGeometries(gs), panelMat(diffuser())));
}
// motion sensors: dome + LED facing south (toward the camera)
{
  const gs = [];
  for (const s of WD.SENSORS) {
    const d = new THREE.SphereGeometry(0.055, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2); d.rotateX(Math.PI); d.translate(s.x, WD.H, s.z);
    d.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(d.attributes.position.count).fill(s.k), 1)); d.setAttribute('aLed', new THREE.BufferAttribute(new Float32Array(d.attributes.position.count).fill(0), 1));
    const l = new THREE.SphereGeometry(0.011, 8, 6); l.translate(s.x, WD.H - 0.04, s.z + 0.035);
    l.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(l.attributes.position.count).fill(s.k), 1)); l.setAttribute('aLed', new THREE.BufferAttribute(new Float32Array(l.attributes.position.count).fill(1), 1));
    for (const g of [d, l]) { g.deleteAttribute('uv'); gs.push(g.index ? g.toNonIndexed() : g); }
  }
  scene.add(new THREE.Mesh(mergeGeometries(gs), sensorMat()));
}
const legs = makeLegs(scene);
const ov = document.getElementById('ov'), ox = ov.getContext('2d');

// —— Gait: phase from distance walked (one step per 0.72 m) ——
const DT = 1 / 240, NS = Math.ceil(ST.DUR / DT) + 2, DIST = new Float32Array(NS);
for (let k = 1; k < NS; k++) { const a = ST.POS((k - 1) * DT), b = ST.POS(k * DT); DIST[k] = DIST[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]); }
const distAt = t => { const f = clamp(t / DT, 0, NS - 1.001), i = Math.floor(f); return lerp(DIST[i], DIST[i + 1], f - i); };
const speedAt = t => (distAt(t + 0.15) - distAt(t - 0.15)) / 0.3;
const STRIDE = 0.72;

// —— Handheld camera (rig from the Liminal Found Footage demo) ——
const nz = (t, f, s) => vnoise(t * f + s * 17.3) - 0.5;
function camPose(t) {
  const [x, z] = ST.POS(t); let yaw = ST.YAW(t), pitch = ST.PITCH(t), roll = 0;
  const sp = speedAt(t), amp = clamp(sp / 1.25), ph = distAt(t) / STRIDE * Math.PI, fear = ST.FEAR(t);
  const hold = ST.HOLD(t) * (1 - 0) ;
  const hs = hold ? 1 : 0.08;
  let y = 1.56 + ST.CAMH(t);
  y += 0.032 * amp * (Math.abs(Math.sin(ph)) - 0.6);
  const sway = 0.018 * amp * Math.sin(ph);
  const br = Math.sin(t * Math.PI * 2 * (0.27 + 0.12 * fear));
  pitch += (nz(t, 1.1, 1) * 0.016 + nz(t, 3.7, 2) * 0.005 * (1 + 2 * fear) + nz(t, 9.5, 3) * 0.0022 * fear + br * 0.006) * hs;
  yaw += (nz(t, 0.9, 4) * 0.018 + nz(t, 3.3, 5) * 0.005 * (1 + 2 * fear) + 0.011 * amp * Math.sin(ph)) * hs;
  roll = (nz(t, 0.6, 6) * 0.035 + 0.014 * amp * Math.sin(ph) + nz(t, 7, 7) * 0.003 * fear) * hs + 0.012;
  y += br * 0.006 * hs;
  const down = clamp(-pitch - 0.4, 0, 1);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw), reach = down * 0.22;
  return { x: x + rx * sway * hs + fx * reach, y: y - down * 0.16, z: z + rz * sway * hs + fz * reach, yaw, pitch, roll, amp, ph, bx: x, bz: z };
}

// —— Auto exposure: the light near the camera, with the camcorder's lag ——
const LT = new Float32Array(32);
function sceneLight(t) {
  ST.layers(t, LT); const [, z] = ST.POS(t); let s = 0;
  for (let k = 0; k < WD.NCOR; k++) { const dz = (1.2 - 2.4 * k) - z; s += LT[k] / (1 + (dz / 3.2) ** 2); }
  return s + LT[WD.LAYER_ROOMS] * 0.45;
}
const aeTarget = t => clamp(0.98 / Math.pow(sceneLight(t) + 0.05, 0.5), 0.8, 3.4);
function aeAt(t) { let s = 0, w = 0; for (let k = 0; k < 45; k++) { const d = k * 0.033, e = Math.exp(-d / 0.45); s += aeTarget(Math.max(0, t - d)) * e; w += e; } return s / w; }

// —— Captions (CEA-608 style) ——
function drawCaps(x, t) {
  const c = ST.CAPS.find(c => t >= c.t0 && t < c.t1); if (!c) return;
  const fs = 42, cw = fs * 0.6, rh = 54, cx = 960, y = 1080 - 222, w = (c.text.length + 2) * cw, x0 = Math.round(cx - w / 2);
  x.font = `600 ${fs}px 'IBM Plex Mono'`; x.textBaseline = 'middle';
  x.fillStyle = '#000'; x.fillRect(x0, y - rh / 2, w, rh); x.fillStyle = '#f2f2f2'; x.fillText(c.text, x0 + cw, y + 2);
}

// —— Picture ——
function render(t) {
  const T = ST.T, tv = Math.min(t, T.recOff + 0.02);   // the picture freezes when REC goes off
  const cp = camPose(tv);
  camera.position.set(cp.x, cp.y, cp.z); camera.rotation.set(cp.pitch, cp.yaw, cp.roll);
  const hf = ST.FOV(tv) * Math.PI / 180; camera.fov = 2 * Math.atan(Math.tan(hf / 2) / (4 / 3)) * 180 / Math.PI; camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  legs.pose({ x: cp.bx, z: cp.bz, yaw: ST.YAW(tv), phase: cp.ph, amp: cp.amp, stance: 0.02 });
  ST.layers(tv, U.uL.value); ST.leds(tv, U.uLed.value);
  post.dof.focus = ST.FOCUS(tv); post.dof.aper = ST.APER(tv);
  // VHS
  const u = vhs.uniforms, ae = aeAt(tv), f = Math.floor(t * 30);
  u.frame.value = f;
  const awb = ss(seg(t, T.rollIn, T.rollIn + 1.8)), lit = ss(seg(tv, T.restrike, T.restrike + 1.5)) * (1 - ss(seg(tv, T.roomsOff, T.roomsOff + 2)));
  u.tint.value = [lerp(0.8, 0.97, awb) * (1 - 0.03 * lit), lerp(0.92, 1.02, awb), lerp(1.4, 0.93, awb) * (1 + 0.04 * Math.sin(t * 0.31)) * (1 + 0.05 * lit)];
  u.expo.value = ae * ST.EXPO(tv) * (0.98 + 0.02 * Math.sin(t * 0.47));
  u.gain.value = 0.03 + 0.11 * seg(ae, 1.3, 3.2) + 0.02 * seg(ST.FOV(tv), 52, 24) + 0.01 * ST.FEAR(tv);
  let track = 0, roll = 0;
  if (t < T.rollIn + 0.5) { const k = 1 - seg(t, T.rollIn, T.rollIn + 0.5); track = k; roll = k * k * 0.4; }
  if (t > T.recOff) track = Math.max(track, seg(t, T.recOff, T.recOff + 0.15));
  u.track.value = track; u.roll.value = roll;
  u.off.value = t < T.rollIn ? 1 : t > T.recOff + 0.22 ? 1 : 0;
  // OSD
  drawOSD(osdCv, {
    hide: t < T.rollIn || t > T.recOff + 0.22, t, rec: t >= T.rollIn && t < T.recOff,
    clock: ST.clock(t), date: ST.DATE, bat: ST.battery(t),
    title: t >= T.title[0] && t < T.title[1] ? ['WING C', 'NIGHT CHECK'] : null, titleN: Math.floor((t - T.title[0]) * 12),
  });
  osdTex.needsUpdate = true;
  post.composer.render();
  ox.clearRect(0, 0, W, H);
  if (!NOSUB) drawCaps(ox, t);
}

// —— Events: sound cues for mix.py (events.json) ——
const EV = [];
const T = ST.T, FZ = k => 1.2 - 2.4 * k;
EV.push({ t: T.recOn, type: 'recOn' }, { t: T.recOff, type: 'recOff' });
ST.SWITCH.forEach((l, k) => l.forEach(([t, s]) => EV.push({ t, type: s === 'on' ? 'strike' : 'off', k, z: FZ(k), all: Math.abs(t - T.restrike) < 0.1 })));
EV.push({ t: T.restrike + 0.05, type: 'roomsOn' }, { t: T.roomsOff, type: 'roomsOff' });
ST.LED_BLINKS.forEach(([k, t]) => EV.push({ t, type: 'led', k, z: FZ(k) }));
{ let last = 0; for (let t = 0; t < T.recOff; t += 1 / 120) { const n = Math.floor(distAt(t) / STRIDE); if (n > last) { last = n; EV.push({ t, type: 'step', v: clamp(speedAt(t) / 1.3, 0.35, 1.1) }); } } }
EV.push({ t: T.zoom[0], type: 'zoom', d: T.zoom[1] - T.zoom[0] }, { t: T.unzoom[0], type: 'zoom', d: T.unzoom[1] - T.unzoom[0] });
for (const a of [T.strike0 + 0.5, T.strike0 + 0.8, T.zoom[1] + 0.5, T.zoom[1] + 0.8, 32.8, 33.2, 35.0, 35.5, T.turn[1] + 0.4]) EV.push({ t: a, type: 'af' });
for (const [t, v] of [[T.pan[0], 0.8], [T.look[0], 0.6], [T.look[1] - 0.5, 0.5], [T.walk[1] - 0.6, 0.5], [T.tilt[0], 0.5], [T.snap[0], 1.0], [T.turn[0], 0.8], [T.turn[1] - 0.3, 0.7], [T.back[0], 0.8]]) EV.push({ t, type: 'rustle', v });
EV.push({ t: T.hush[0], type: 'hush', d: T.hush[1] - T.hush[0] });
EV.push({ t: T.hush[0] - 0.1, type: 'holdBreath', d: T.restrike - T.hush[0] + 0.1 }, { t: T.restrike + 0.1, type: 'gasp' }, { t: T.read2[1] - 0.6, type: 'exhale' });
EV.push({ t: T.turn[1] - 0.2, type: 'crouch' });
ST.CAPS.forEach(c => EV.push({ t: c.t0, type: 'cap', t1: c.t1, text: c.text }));
// light and camera track for the hum (50 Hz): camera z, then the 28 layer levels
{
  const fps = 50, rows = [], L = new Float32Array(32);
  for (let i = 0; i <= Math.ceil(ST.DUR * fps); i++) { const t = i / fps; ST.layers(t, L); rows.push([+ST.POS(t)[1].toFixed(3), +sceneLight(t).toFixed(3), ...Array.from(L.slice(0, WD.NLAYER), v => +v.toFixed(3))]); }
  EV.push({ t: 0, type: 'track', fps, rows });
}
EV.sort((a, b) => a.t - b.t);

window.DUR = ST.DUR; window.EV = EV; window.render = render;
window.dbg = { camera, scene, post, vhs, U, camPose, sceneLight, aeAt };
render(0);
window.READY = true;
