// Wing C — timeline: the single source of truth. Camera keyframes, every light-style layer's curve, sensor LEDs, captions and sound cues.
// Coordinates: metres; x east, z south; yaw 0 = facing north (−z), +π/2 = facing west, −π/2 = facing east.
import { track, monotone, clamp, seg, hash } from '/core/lib.js';
import { FIXTURES, NCOR, LAYER_ROOMS, NLAYER } from './world.js';

const PI = Math.PI;
export const DUR = 60.7;
export const T = {
  recOn: 0.45, rollIn: 0.6, title: [0.8, 2.6],
  strike0: 2.0,                 // the first panel, over the notice
  read1: [2.6, 11.4],           // notice 1 readable (≈ 103 characters → 8.4 s needed)
  pan: [11.4, 13.2],
  walk: [13.2, 23.6],
  look: [16.2, 18.2],           // glance down at the shoes
  leave: 21.0,                  // the lights stop answering (nothing strikes after this)
  offBehind: [23.6, 24.5, 25.3, 26.1], dark: 27.0,
  approach: 28.4,               // first far strike (F20)
  zoom: [29.4, 30.6], unzoom: [38.0, 38.8],
  hush: [39.4, 40.8],           // digital silence
  ledAhead: [40.8, 41.15], tilt: [41.4, 42.6], ledOver: [42.7, 43.0],
  restrike: 43.4, snap: [43.45, 44.0],
  turn: [45.4, 46.6], read2: [46.8, 51.4], back: [51.4, 52.6],
  roomsOff: 52.2, offOut: 53.0,
  recOff: 59.7,
};

// —— Camera path ——
const X0 = -0.56, Z0c = 0.55, XW = 0.15, ZSTOP = -12.0;
// walk: accelerate 1 s, cruise 1.35 m/s, decelerate into the stop
const VW = 1.35;
function walkDist(t) {
  const [a, b] = T.walk, ta = 1.0, td = 1.4, cruise = b - a - ta - td;
  if (t <= a) return 0;
  const u = t - a;
  if (u < ta) return 0.5 * VW * u * u / ta;
  if (u < ta + cruise) return 0.5 * VW * ta + VW * (u - ta);
  const w = Math.min(u - ta - cruise, td);
  return 0.5 * VW * ta + VW * cruise + VW * (w - 0.5 * w * w / td);
}
const WALK_LEN = walkDist(T.walk[1] + 1);
const zw = t => 0.3 + (ZSTOP - 0.3) * walkDist(t) / WALK_LEN;
export function POS(t) {
  if (t < T.pan[0]) return [X0, Z0c];
  if (t < T.walk[0]) { const u = seg(t, T.pan[0], T.pan[1]), e = u * u * (3 - 2 * u); return [X0 + (XW - X0) * e, Z0c + (0.3 - Z0c) * e]; }
  if (t < T.turn[0]) return [XW, zw(t)];
  return P2(t);
}
const P2 = track([
  [T.turn[0], [XW, ZSTOP]], [T.turn[1], [0.5, -12.95]], [T.read2[0], [0.55, -12.95]], [T.read2[1], [0.86, -12.95]],
  [T.back[1], [XW, -12.6]], [DUR, [XW, -12.6]],
]);
export const YAW = monotone([
  [0, PI / 2], [T.pan[0], PI / 2], [T.pan[1], 0.0], [T.walk[1], 0.0],
  [T.tilt[0], 0.0], [T.tilt[1], -0.36], [T.snap[0], -0.36], [T.snap[1], 0.02], [T.turn[0], 0.0],
  [T.turn[1], -PI / 2], [T.read2[1], -PI / 2], [T.back[1], 0.0], [DUR, 0.0],
]);
export const PITCH = monotone([
  [0, -0.01], [T.pan[0], -0.01], [T.pan[1], -0.05], [T.look[0], -0.05], [T.look[0] + 0.6, -1.2], [T.look[1] - 0.6, -1.16], [T.look[1], -0.06],
  [T.walk[1], -0.02], [T.zoom[0], 0.0], [T.unzoom[1], 0.0], [T.hush[0] + 0.2, 0.0], [T.hush[1] - 0.1, 0.13],
  [T.tilt[0], 0.13], [T.tilt[1], 0.92], [T.snap[0], 0.92], [T.snap[1], 0.0], [T.turn[0], 0.0],
  [T.turn[1], 0.0], [T.read2[1], 0.0], [T.back[1], -0.02], [DUR, -0.02],
]);
// camera height offset: down to the notice's centre (lens parallel to the page), then lower again for the taped strip
export const CAMH = monotone([
  [0, -0.17], [T.pan[0], -0.17], [T.pan[1], 0], [T.turn[0], 0], [T.turn[1], -0.18], [T.read2[0] + 1.2, -0.2], [T.read2[1], -0.3], [T.back[1], 0], [DUR, 0],
]);
// horizontal field of view (degrees)
export const FOV = monotone([[0, 52], [T.zoom[0], 52], [T.zoom[1], 24], [T.unzoom[0], 24], [T.unzoom[1], 52], [DUR, 52]]);
// autofocus distance (m): hunts at the opening, on the far lights, on the notice
export const FOCUS = monotone([
  [0, 0.3], [T.strike0, 0.3], [T.strike0 + 0.5, 2.2], [T.strike0 + 0.8, 0.55], [T.strike0 + 1.0, 0.7], [T.pan[0], 0.7], [T.pan[1], 6], [T.walk[1], 6],
  [T.zoom[0], 6], [T.zoom[1], 1.2], [T.zoom[1] + 0.5, 30], [T.zoom[1] + 0.8, 14], [32.4, 14], [32.8, 0.9], [33.2, 26], [34.6, 26], [35.0, 4],
  [35.5, 22], [T.unzoom[0], 16], [T.unzoom[1], 5], [T.restrike, 5], [T.turn[1], 0.4], [T.turn[1] + 0.4, 1.1], [T.read2[0], 0.95], [T.read2[1], 0.7],
  [T.back[1], 6], [DUR, 6],
]);
export const APER = monotone([[0, 3.0], [T.zoom[0], 3.0], [T.zoom[1], 13], [T.unzoom[0], 13], [T.unzoom[1], 3.0], [DUR, 3.0]]);
export const FEAR = monotone([[0, 0.12], [T.leave, 0.15], [T.walk[1], 0.35], [T.dark, 0.6], [T.approach + 3, 0.7], [T.unzoom[1], 0.95], [T.restrike, 0.9], [T.read2[1], 0.75], [DUR, 0.8]]);
// exposure trim: the camcorder closes down on bright close-ups (the notices, the lit floor at its feet)
export const EXPO = monotone([
  [0, 1], [T.read1[0], 1], [T.read1[0] + 0.8, 0.86], [T.pan[0], 0.86], [T.pan[1], 1],
  [T.look[0], 1], [T.look[0] + 0.7, 0.72], [T.look[1] - 0.5, 0.72], [T.look[1], 1],
  [T.turn[0], 1], [T.turn[1], 0.66], [T.read2[0] + 1.5, 0.6], [T.read2[1], 0.56], [T.back[1], 0.95], [DUR, 0.95],
]);
export const HOLD = t => (t > T.hush[0] - 0.1 && t < T.restrike - 0.05) ? 0 : 1;   // held breath: the handheld freezes

// —— Light-style layers ——
// strike: two dim ticks, a buzzing flicker, on by ~0.6 s, then a slow warm-up from 88 % to 100 %
function strike(u, k) {
  if (u < 0) return 0;
  const h = n => hash(k * 13.7 + n * 3.1);
  if (u < 0.05) return 0.18;
  if (u < 0.17 + 0.05 * h(1)) return 0.0;
  if (u < 0.22 + 0.05 * h(1)) return 0.3;
  if (u < 0.3 + 0.06 * h(2)) return 0.02;
  if (u < 0.62) { const f = Math.floor(u * 48 + k); return hash(f * 1.7 + k) < 0.45 ? 0.15 : 0.95; }
  return 0.88 + 0.12 * (1 - Math.exp(-(u - 0.62) / 1.2));
}
const switchOff = u => u < 0 ? 1 : u < 0.05 ? 1 - u / 0.05 * 0.85 : 0.15 * Math.exp(-(u - 0.05) / 0.12);
// per corridor panel: list of [time, 'on' | 'off']
export const SWITCH = Array.from({ length: NCOR }, () => []);
const FZ = k => 1.2 - 2.4 * k;
// during the walk each panel strikes when the camera comes within 4.2 m of it
const STRUCK = [];
SWITCH[0].push([T.strike0, 'on']); SWITCH[1].push([12.0, 'on']);
for (let k = 2; k < NCOR; k++) {
  let ts = null;
  for (let t = T.walk[0]; t < T.leave; t += 1 / 240) if (zw(t) <= FZ(k) + 4.2) { ts = t; break; }
  if (ts != null) { SWITCH[k].push([ts, 'on']); STRUCK.push(k); }
}
export const LAST_WALK = Math.max(...STRUCK);   // F6
// behind: off one by one (F0, F1 unseen), the panel just ahead last
[[0, 22.0], [1, 22.8]].forEach(([k, t]) => SWITCH[k].push([t, 'off']));
STRUCK.slice(0, -1).forEach((k, i) => SWITCH[k].push([T.offBehind[Math.min(i, 3)] + Math.max(0, i - 3) * 0.3, 'off']));
SWITCH[LAST_WALK].push([T.dark, 'off']);
// approach: F20 … F8, accelerating 1.4 s → 0.42 s
export const APPROACH = [];
{
  const ks = []; for (let k = 20; k >= LAST_WALK + 2; k--) ks.push(k);
  const n = ks.length - 1, r = Math.pow(0.42 / 1.4, 1 / (n - 1));
  let t = T.approach;
  ks.forEach((k, i) => { SWITCH[k].push([t, 'on']); APPROACH.push([k, t]); t += 1.4 * Math.pow(r, i); });
}
// restrike: everything at once
for (let k = 0; k < NCOR; k++) if (!SWITCH[k].some(([t, s]) => s === 'on' && Math.abs(t - T.restrike) < 0.01)) SWITCH[k].push([T.restrike + 0.03 * hash(k), 'on']);
// ending: off from the camera outward (behind first, unseen), then F6 … F26 receding, intervals 0.4 → 0.18 s
export const RECEDE = [];
{
  for (let k = 0; k < LAST_WALK; k++) SWITCH[k].push([T.offOut - 0.6 + 0.08 * k, 'off']);
  const ks = []; for (let k = LAST_WALK; k < NCOR; k++) ks.push(k);
  const r = Math.pow(0.18 / 0.4, 1 / (ks.length - 2));
  let t = T.offOut;
  ks.forEach((k, i) => { SWITCH[k].push([t, 'off']); RECEDE.push([k, t]); t += 0.4 * Math.pow(r, i); });
}
SWITCH.forEach(l => l.sort((a, b) => a[0] - b[0]));
export const LAST_OFF = RECEDE[RECEDE.length - 1][1];
const ROOMS_SW = [[T.restrike + 0.05, 'on'], [T.roomsOff, 'off']];
const BASE = Array.from({ length: NLAYER }, (_, k) => 0.92 + 0.16 * hash(k * 5.3 + 2));
function layerValue(sw, t, k) {
  let on = null, v = 0;
  for (const [ts, s] of sw) {
    if (ts > t) break;
    if (s === 'on') { on = ts; v = strike(t - ts, k); }
    else { const lev = on != null ? strike(ts - on, k) : 0; v = lev * switchOff(t - ts); on = null; }   // fades from the level it was at
  }
  return v;
}
export function layers(t, out = new Float32Array(32)) {
  for (let k = 0; k < NCOR; k++) out[k] = layerValue(SWITCH[k], t, k) * BASE[k];
  out[LAYER_ROOMS] = layerValue(ROOMS_SW, t, 99) * BASE[LAYER_ROOMS];
  return out;
}
// —— Sensor LEDs: blink red 0.25 s before a panel strikes (motion detected); plus the two blinks in the dark ——
export const LED_BLINKS = [];   // [k, t]
SWITCH.forEach((l, k) => l.forEach(([t, s]) => { if (s === 'on' && Math.abs(t - T.restrike) > 0.2 && t > 3) LED_BLINKS.push([k, t - 0.25]); }));
for (const t of T.ledAhead) LED_BLINKS.push([LAST_WALK + 1, t]);
for (const t of T.ledOver) LED_BLINKS.push([LAST_WALK, t]);
export function leds(t, out = new Float32Array(32)) {
  out.fill(0);
  for (const [k, tb] of LED_BLINKS) if (t >= tb && t < tb + 0.13) out[k] = 1;
  return out;
}

// —— OSD ——
export const clock = t => t < 31 ? 'PM 10:41' : 'PM 10:42';
export const DATE = 'NOV.02.1995';
export const battery = () => 3;

// —— Captions (SDH only; never over a notice) ——
export const CAPS = [
  { t0: T.strike0, t1: T.strike0 + 2.0, text: '[FLUORESCENT LIGHT BUZZES ON]' },
  { t0: T.offBehind[0], t1: T.offBehind[0] + 2.4, text: '[RELAYS CLICK OFF BEHIND]' },
  { t0: T.approach - 0.2, t1: T.approach + 1.9, text: '[DISTANT CLUNK]' },
  { t0: T.hush[0], t1: T.hush[1], text: '[SILENCE]' },
  { t0: T.restrike, t1: T.restrike + 2.0, text: '[EVERY LIGHT STRIKES ON]' },
  { t0: T.offOut, t1: T.offOut + 2.2, text: '[LIGHTS SWITCHING OFF]' },
];
