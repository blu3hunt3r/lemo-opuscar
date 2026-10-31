// Endurance v2. Beats: TREATMENT.md. Facts on screen: FACTS.md / FACTS-v2.md. Archive: SOURCES.md / SOURCES-v2.md.
// Real photographs carry what Hurley photographed (never altered: only light, weather, water and the lens move over them);
// 3D reconstructions (scenes/sinking, scenes/wave), tagged RECONSTRUCTION, carry what no camera saw; the desk holds the record.
import * as THREE from 'three';
import { clamp, seg, ss, eo, ei, eio, lerp } from '/core/lib.js';
import { photo3d } from './engine/photo3d.js';
import { shatter } from './engine/shatter.js';
import { title, tag, story, number, RED } from './engine/type.js';

export const DUR = 35;
const ASP = 16 / 9, D2R = Math.PI / 180;
const vfovOf = hfov => 2 * Math.atan(Math.tan(hfov * D2R / 2) / ASP) / D2R;
const TV = h => Math.tan(h * D2R / 2) / ASP;   // tan of half the vertical fov for a horizontal fov h

// —— timeline ——
const B = { flash: 0, colour: 3.9, crush: 6.95, sink: 10.7, launch: 14.5, wave: 17.8, desk: 23.0, beach: 30.2 };
const SH = { t0: B.crush, impact: [.57, .52] };   // the ice-crack shatter from the colour plate into the wreck
// whiteouts: [peak, rise, fall, colour]: the flash cut, a snow gust, the blizzard (months pass), spray, the wave breaking, the paper's white
const WH = [[B.colour, .1, .38, [1, 1, 1]], [B.sink, .32, .45, [.93, .95, .98]], [B.launch, .65, .8, [.9, .93, .96]], [B.wave, .42, .62, [.86, .9, .9]],
  [B.desk, .3, .75, [.94, .96, .97]], [B.beach, .55, .75, [.97, .94, .87]]];
const FADE_OUT = [34.1, 34.9];
export function GRADE(t) {
  let w = 0, col = [.93, .95, .97];
  for (const [p, up, dn, c] of WH) {
    const v = t < p ? Math.pow(ss(seg(t, p - up, p)), 1.5) : 1 - ss(seg(t, p + .05, p + .05 + dn));
    if (v > w) { w = v; col = c; }
  }
  return { white: w, whiteCol: col, fade: 1 - ss(seg(t, ...FADE_OUT)) };
}
const gust = (t, p, a = 1) => Math.max(0, 1 - Math.abs(t - p) / a);

// —— the flash: Hurley lit the night photograph with 25 charges of flash powder wired together and fired at once (Argonauts of the
// South, 1925, p. 159; FACTS-v2 row 23). One blinding burst out of darkness; the photograph stays, as the exposure he made ——
const FL = [[.6, 4.2, 1]];
function flash(t) {
  let base = 0, peak = 0;
  for (const [ti, pk, res] of FL) if (t >= ti) { base = res * (1 - Math.exp(-(t - ti) / .35)); peak += pk * Math.exp(-(t - ti) / .11); }
  return { level: base + peak, peak };
}

// —— sound events (core/render/events.mjs exports them) ——
export const EVENTS = [
  { t: 0, type: 'wind', dur: B.colour, level: 'night' },
  { t: FL[0][0], type: 'flash', n: 0, note: '25 charges of flash powder fired at once: one huge pop-whoomph and hiss; the picture burns into view' },
  { t: 1.3, type: 'type', dur: .45, n: 9, note: 'ENDURANCE' },
  { t: 1.45, type: 'type', dur: .55, n: 15 },
  { t: B.colour, type: 'cut', note: 'flash cut to the colour plate: a low swell lands, the score enters' },
  { t: 4.1, type: 'type', dur: .4, n: 11 },
  { t: 4.15, type: 'count', dur: .7, note: '281 days' },
  { t: 4.35, type: 'story', dur: .6 },
  { t: SH.t0, type: 'crack', dur: .32, note: 'ice cracks racing across the frame' },
  { t: SH.t0 + .32, type: 'shatter', dur: .62, note: 'the frame breaks like plate ice; shards fall' },
  { t: 7.6, type: 'type', dur: .4, n: 12 },
  { t: 7.8, type: 'story', dur: .6, note: 'The ice crushed her.' },
  { t: 8.1, type: 'groan', dur: 2.2, note: 'timber groaning under pressure' },
  { t: B.sink - .35, type: 'gust', dur: .35 },
  { t: B.sink, type: 'whiteout', note: 'snow gust: the reconstruction of the sinking' },
  { t: B.sink + .3, type: 'type', dur: .7, n: 21 },
  { t: B.sink + .6, type: 'story', dur: .5, note: 'She\'s going, boys!' },
  { t: B.sink + .5, type: 'sink', dur: 2.8, note: 'the wreck goes down bows first: a long groan, ice grinding, then nothing' },
  { t: B.launch - .65, type: 'gust', dur: .65, note: 'blizzard: five months pass' },
  { t: B.launch, type: 'whiteout' },
  { t: B.launch, type: 'surf', dur: B.wave - B.launch },
  { t: B.launch + .25, type: 'type', dur: .35, n: 11 },
  { t: B.launch + .35, type: 'story', dur: .7, note: 'Six men. One small boat.' },
  { t: B.wave - .42, type: 'spray', dur: .42 },
  { t: B.wave, type: 'whiteout', note: 'spray: the storm at night (reconstruction)' },
  { t: B.wave, type: 'storm', dur: 5.2 },
  { t: B.wave + .5, type: 'type', dur: .75, n: 22 },
  { t: B.wave + 1.2, type: 'story', dur: .6, note: 'Not clearing sky. A wave.' },
  { t: B.wave + 1.6, type: 'rise', dur: 2.6, note: 'the giant wave rises: a deep swell' },
  { t: B.wave + 4.4, type: 'break', dur: .8, note: 'the crest breaks over the lens' },
  { t: B.desk, type: 'whiteout', note: 'to the desk under the lamp: room tone' },
  { t: B.desk + .3, type: 'route', dur: 3.3, note: 'red ink pen on paper along the route' },
  { t: B.desk + .4, type: 'type', dur: .75, n: 22 },
  { t: B.desk + .3, type: 'count', dur: 3.3, note: '1,300 km, counting with the line' },
  { t: B.desk + 3.6, type: 'hit', level: 'soft', note: 'the route lands at South Georgia' },
  { t: B.desk + 3.7, type: 'silence', dur: .9, note: 'the score stops (≥ 0.8 s)' },
  { t: B.desk + 4.2, type: 'slide', dur: 1.3, note: 'the camera crosses the desk: paper' },
  { t: B.desk + 4.65, type: 'type', dur: .35, n: 10 },
  { t: B.desk + 5.6, type: 'pen', dur: .45, note: 'red underline under "Marooned"' },
  { t: B.beach - .55, type: 'swell', dur: .55 },
  { t: B.beach, type: 'whiteout', note: 'paper white to the beach: sea and wind' },
  { t: B.beach, type: 'sea', dur: DUR - B.beach },
  { t: 31.0, type: 'count', dur: .9 },
  { t: 31.9, type: 'hit', level: 'low', note: '28 lands: the final chord' },
  { t: 31.35, type: 'story', dur: .6, note: 'men. Every one lived.' },
  { t: FADE_OUT[0], type: 'fade', dur: FADE_OUT[1] - FADE_OUT[0] },
  { t: DUR, type: 'end' },
];

const camOf = scene => { const c = new THREE.PerspectiveCamera(30, ASP, .05, 800); scene.add(c); return c; };
const photoScene = async (o, snow) => {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
  const ph = await photo3d({ base: 'assets/tex/', ...o }); scene.add(ph);
  const cam = camOf(scene);
  return { scene, cam, ph, snow: snow ? snow(cam) : null };
};
const exists = async url => { try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; } };
const placeholder = (label) => {   // used only while a reconstruction module is missing: a dark frame that says so
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101418); const cam = camOf(scene);
  return { scene, cam, state: () => ({ cam: { pos: [0, 0, 0], look: [0, 0, -1], fov: 30 }, focus: 10, aper: 0, maxCoc: 0 }), missing: label };
};

export async function build({ renderer, atmos, pxH }) {
  const S = {};
  S.p1 = await photoScene({ id: 'p1', hfov: 52, zNear: 8, zFar: 90, cover: 1.1, levels: [.02, 1, 1],
    },
    cam => atmos(cam, { n: 3400, z0: 1.2, z1: 40, size: .03, color: '#eef2f6', opacity: .85, wind: [-3.2, .25], fall: .25, seed: 5 }));
  const colourId = (await exists('assets/tex/colour2.json')) ? 'colour2' : 'p2';   // Hurley's Paget colour plate of the ship trapped in the ice (SLNSW ON 26/16)
  S.colour = await photoScene({ id: colourId, hfov: 50, zNear: 7, zFar: 300, cover: 1.12, levels: [0, 1, 1],
    fog: { color: [.9, .93, .96], density: .0016, noise: .9, scale: .06, wind: [1.6, 0, .3], y0: -3, y1: .5 } },
    cam => atmos(cam, { n: 1600, z0: 1, z1: 30, size: .025, color: '#fff4ec', opacity: .6, wind: [.8, .05], fall: .3, seed: 7 }));
  S.p3 = await photoScene({ id: 'p3', hfov: 50, zNear: 5, zFar: 70, cover: 1.1, levels: [.03, .98, 1.1],
    fog: { color: [.85, .82, .76], density: .004, noise: .8, scale: .07, wind: [1.2, 0, 0], y0: -4, y1: 4 } },
    cam => atmos(cam, { n: 2800, z0: .7, z1: 30, size: .032, color: '#f4f4f2', opacity: .75, wind: [1.4, 0], fall: .55, seed: 8 }));
  S.p5 = await photoScene({ id: 'p5', hfov: 50, zNear: 5, zFar: 120, cover: 1.1, levels: [.02, .98, 1.05], flow: { dir: [.0006, -.0058], period: 1.3, amount: 1 } },
    cam => atmos(cam, { n: 1800, z0: .5, z1: 20, size: .02, color: '#f2f4f5', opacity: .55, wind: [-1.2, .4], fall: .2, seed: 12 }));
  // the beach: Hurley's own lantern slide (SLNSW Slides 22/48, continuous tone, 2692 px after the crop) when its layers exist, else the LoC copy negative (1536 px)
  const hi = await exists('assets/tex/p6_hi.json');
  S.p6 = await photoScene(hi ? { id: 'p6_hi', hfov: 50, zNear: 6, zFar: 200, cover: 1.12, levels: [.02, .92, .88], flow: { dir: [.0012, -.0036], period: 1.6, amount: 1, layers: [0, 1] } }
    : { id: 'p6', hfov: 50, zNear: 6, zFar: 200, cover: 1.12, levels: [.02, .98, 1.05], flow: { dir: [.0012, -.0036], period: 1.6, amount: 1 } },
    cam => atmos(cam, { n: 2200, z0: .6, z1: 40, size: .028, color: '#f2f4f5', opacity: .7, wind: [-.6, .05], fall: .45, seed: 13 }));
  // reconstructions (built by scenes/*/; state(u) with u = seconds since the shot began)
  for (const [k, path] of [['sink', './scenes/sinking/sinking.js'], ['wave', './scenes/wave/wave.js']]) {
    try { const M = await import(path); S[k] = await M.build({ THREE, renderer, atmos, pxH }); } catch (e) { console.warn('missing', path, e.message); S[k] = placeholder(k); }
  }
  // the desk: the period map when its scan and control points exist, else the code-drawn paper map
  const D = await import('./scenes/desk/desk.js');
  const route = (await (await fetch('assets/raw/route.json')).json()).lines.find(l => l.id === 'james_caird').coords;
  let map, mapGeo, routeUV = null;
  if (await exists('assets/raw/map_control.json')) {   // Stanford's map from "South" (1919): its own conic graticule, fitted to 160 printed crossings
    const C = await (await fetch('assets/raw/map_control.json')).json(), q = C.fit_check?.conic?.params, [W, H] = C.image_size;
    map = 'assets/tex/map1919.jpg';
    mapGeo = q ? (lon, lat) => { const th = q.n * (lon - q.lon_c) * D2R, rho = q.r0 + q.r1 * (lat + 64) + q.r2 * (lat + 64) ** 2;
      return [(q.apex_x + rho * Math.sin(th)) / W, 1 - (q.apex_y - rho * Math.cos(th)) / H]; } : fitGeo({ ...C, points: C.control_points, width: W, height: H });
    if (await exists('assets/raw/map_boatline.json')) routeUV = (await (await fetch('assets/raw/map_boatline.json')).json()).uv;   // the printed "Boat Journey" line, traced
  } else {
    const g = await (await fetch('assets/tex/papermap_geo.json')).json();
    const s0 = Math.sin(g.lat0 * D2R), c0 = Math.cos(g.lat0 * D2R);
    mapGeo = (lon, lat) => { const f = lat * D2R, l = (lon - g.lon0) * D2R, x = Math.cos(f) * Math.sin(l), y = c0 * Math.sin(f) - s0 * Math.cos(f) * Math.cos(l); return [(g.cx + x * g.k) / g.w, 1 - (g.cy - y * g.k) / g.h]; };
    map = 'assets/tex/papermap.jpg';
  }
  S.desk = await D.build({ THREE, renderer, atmos, pxH }, { map, mapGeo, route, routeUV, news: 'assets/tex/news_desk.jpg',
    prints: [{ url: 'assets/raw/p4.jpg', pos: [-.56, .0008, -.27], rot: .22, w: .16 }, { url: 'assets/raw/p2.jpg', pos: [.74, .0008, .3], rot: -.2, w: .15 }] });
  S.shatter = shatter({ impact: SH.impact, seed: 9 });
  return S;
}
// a period map's own graticule → (lon, lat) → (u, v): least-squares quadratic fit to the control points [px, py, lon, lat]
function fitGeo(C) {
  const pts = C.points || C, W = C.width, H = C.height;
  const basis = (lo, la) => [1, lo, la, lo * lo, lo * la, la * la];
  const solve = (A, b) => { const n = A[0].length, M = Array.from({ length: n }, (_, i) => Array.from({ length: n + 1 }, (_, j) => j < n ? A.reduce((s, r) => s + r[i] * r[j], 0) : A.reduce((s, r, k) => s + r[i] * b[k], 0)));
    for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]];
      for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; } }
    return M.map((r, i) => r[n] / r[i]); };
  const A = pts.map(p => basis(p[2], p[3])), cx = solve(A, pts.map(p => p[0])), cy = solve(A, pts.map(p => p[1]));
  return (lon, lat) => { const b = basis(lon, lat), x = b.reduce((s, v, i) => s + v * cx[i], 0), y = b.reduce((s, v, i) => s + v * cy[i], 0); return [x / W, 1 - y / H]; };
}

// —— the shots ——
export function SHOTS(S) {
  const sh = [];
  const atm = (t, d, g, extra = {}) => ({ density: d, gust: g, aper: .25, ...extra });
  // 1 FLASH: the ship appears from darkness flash by flash; slow push through the ice; spindrift
  sh.push({ ...S.p1, t0: B.flash, t1: B.colour, state: t => {
    const f = flash(t); S.p1.ph.setFade(f.level); S.p1.ph.setTime(t);
    S.p1.snow.material.uniforms.uOpacity.value = .85 * Math.min(1, f.level);   // the snow is only seen in the flash's light
    const k = eio(seg(t, -.6, B.colour + 1)), pos = [lerp(.22, -.16, k), lerp(-.08, .12, k), lerp(.25, -2.2, k)];
    return { cam: { pos, look: [pos[0], pos[1], pos[2] - 1], fov: vfovOf(52), shift: [0, .22] }, focus: 17 + pos[2], aper: 80, maxCoc: 12,
      atmos: atm(t, .5 + .5 * gust(t, B.colour, .5), 1.2 + .8 * gust(t, B.colour, .6), { cam: [pos[0], pos[1]] }),
      bloom: { strength: .2 + .22 * Math.min(1, f.peak), radius: .6, threshold: .7 },
      grade: { tone: .6, contrast: .22, lift: [0, 0, 0].map((z, i) => lerp(z, [.003, .005, .009][i], Math.min(1, f.level * 2))) } };   // true black before the first flash
  } });
  // 2 COLOUR: Hurley's colour plate; a rise and drift through low mist
  sh.push({ ...S.colour, t0: B.colour, t1: SH.t0, state: t => {
    S.colour.ph.setTime(t);
    const k = eio(seg(t, B.colour - .6, SH.t0 + 1.2)), pos = [lerp(.32, -.3, k), lerp(-.05, .25, k), lerp(.3, -1.5, k)];
    return { cam: { pos, look: [pos[0], pos[1], pos[2] - 1], fov: vfovOf(50), shift: [0, .05] }, focus: 16 + pos[2], aper: 60, maxCoc: 12,
      atmos: atm(t, .25, .3, { cam: [pos[0], pos[1]] }), bloom: { strength: .2, radius: .6, threshold: .75 },
      grade: S.colour.ph.name !== 'p2' ? { tone: 0, sat: 1.06, contrast: .2 } : { tone: .55, contrast: .2 } };
  } });
  // 3 CRUSH: rise from the dogs to the broken masts (shift lens frames the tall print, the camera rises for parallax)
  const tv3 = TV(50);
  sh.push({ ...S.p3, t0: SH.t0, t1: B.sink, state: t => {
    S.p3.ph.setTime(t);
    const k = eio(seg(t, SH.t0 - .4, B.sink + .8)), pos = [lerp(.1, -.08, k), lerp(0, .5, k), lerp(.25, -.75, k)], cy = lerp(-.34, .27, k);
    return { cam: { pos, look: [pos[0], pos[1], pos[2] - 1], fov: vfovOf(50), shift: [0, cy / tv3] }, focus: lerp(7, 12.5, ss(seg(t, 7.4, 9))), aper: 55, maxCoc: 12,
      atmos: atm(t, .3 + .7 * gust(t, B.sink, .7), 1.6 * gust(t, B.sink, .7), { cam: [pos[0], pos[1]] }), bloom: { strength: .12, radius: .5, threshold: .85 },
      grade: { tone: .55, contrast: .2 } };
  } });
  // 4 SINK (reconstruction)
  sh.push({ ...S.sink, t0: B.sink, t1: B.launch, state: t => S.sink.state(t - B.sink) });
  // 5 LAUNCH: push toward the boat; the surf runs
  sh.push({ ...S.p5, t0: B.launch, t1: B.wave, state: t => {
    S.p5.ph.setTime(t);
    const k = eio(seg(t, B.launch - .8, B.wave + .6)), pos = [lerp(.16, -.12, k), lerp(-.02, .08, k), lerp(.3, -1.15, k)];
    return { cam: { pos, look: [pos[0], pos[1], pos[2] - 1], fov: vfovOf(50) }, focus: 7 + pos[2], aper: 50, maxCoc: 12,
      atmos: atm(t, .3 + .7 * gust(t, B.launch, .9) + .6 * gust(t, B.wave, .5), 1.5 * gust(t, B.launch, .9), { cam: [pos[0], pos[1]] }),
      bloom: { strength: .12, radius: .5, threshold: .85 }, grade: { tone: .55, contrast: .2 } };
  } });
  // 6 WAVE (reconstruction)
  sh.push({ ...S.wave, t0: B.wave, t1: B.desk, state: t => S.wave.state(t - B.wave) });
  // 7 DESK
  sh.push({ ...S.desk, t0: B.desk, t1: B.beach, state: t => ({ ...S.desk.state(t - B.desk), grade: { tone: .15, contrast: .16 } }) });
  // 8 BEACH: lateral drift along the waving men; the sea runs
  sh.push({ ...S.p6, t0: B.beach, t1: DUR + 1, state: t => {
    S.p6.ph.setTime(t);
    const k = eio(seg(t, B.beach - .8, DUR)), pos = [lerp(.3, -.25, k), lerp(.02, .07, k), lerp(.25, -.9, k)];
    return { cam: { pos, look: [pos[0], pos[1], pos[2] - 1], fov: vfovOf(50) }, focus: 7.4 + pos[2], aper: 45, maxCoc: 12,
      atmos: atm(t, .22 + .7 * gust(t, B.beach, .8), 1.2 * gust(t, B.beach, .8), { cam: [pos[0], pos[1]] }), bloom: { strength: .12, radius: .5, threshold: .85 },
      grade: { tone: .5, contrast: .2, sat: 0 } };   // the slide is monochrome: neutral before the split tone (an old stain on it has a yellow tint)
  } });
  return sh;
}
export function TRANS(S, shots) {
  return [{ t0: SH.t0, t1: SH.t0 + S.shatter.dur, from: shots[1], to: shots[2], fx: S.shatter }];
}

// —— type ——
export function TEXT(x, t) {
  title(x, 'ENDURANCE', 140, 250, 190, t, 1.3, { out: 3.5 });   // every line is gone before its whiteout peaks (type sits above the white)
  tag(x, 'WEDDELL SEA · 1915', 148, 318, 30, t, 1.38, { out: 3.5, id: 'p1-tag' });
  tag(x, 'COLOUR · 1915', 148, 718, 30, t, 4.1, { out: 6.95, ink: true, id: 'colour-tag' });
  number(x, 0, 281, v => String(Math.round(v)), 140, 920, 230, t, 4.15, .7, { out: 7.0, ink: true, id: 'colour-number' });
  story(x, ['days', 'locked', 'in', 'the', 'ice.'], null, 148, 1010, 80, t, 4.35, { out: 7.0, ink: true, id: 'colour-story' });
  tag(x, 'OCTOBER 1915', 1180, 232, 30, t, 7.6, { out: 10.2, ink: true, id: 'p3-tag' });
  story(x, ['The', 'ice', 'crushed', 'her.'], 2, 1176, 324, 84, t, 7.8, { out: 10.2, ink: true, id: 'p3-story' });
  tag(x, '21 NOV 1915 · RECONSTRUCTION', 148, 214, 30, t, B.sink + .3, { out: B.launch - .45, id: 'sink-tag' });
  story(x, ['“She’s', 'going,', 'boys!”'], 1, 140, 312, 88, t, B.sink + .6, { out: B.launch - .45, id: 'sink-story' });
  tag(x, '24 APRIL 1916', 1004, 112, 30, t, B.launch + .25, { out: B.wave - .45, ink: true, id: 'p5-tag' });
  story(x, ['Six', 'men.', 'One', 'small', 'boat.'], 4, 1000, 204, 84, t, B.launch + .35, { out: B.wave - .45, maxW: 900, ink: true, id: 'p5-story' });
  tag(x, 'MAY 1916 · RECONSTRUCTION', 148, 150, 30, t, B.wave + .5, { out: B.desk - .55, id: 'wave-tag' });
  story(x, ['Not', 'clearing', 'sky.', 'A', 'wave.'], 4, 140, 240, 88, t, B.wave + 1.2, { out: B.desk - .55, maxW: 1000, id: 'wave-story' });
  tag(x, 'JAMES CAIRD · 6 MEN · 16 DAYS', 1772, 862, 30, t, B.desk + .4, { out: B.desk + 3.95, align: 'right', ink: true, id: 'desk-tag' });
  number(x, 0, 1300, v => `${Math.round(v).toLocaleString('en-US')} KM`, 1772, 1010, 170, t, B.desk + .3, 3.3, { out: B.desk + 3.95, align: 'right', ink: true, id: 'desk-number', ease: eio });
  tag(x, '4 SEPT 1916', 148, 1000, 30, t, B.desk + 4.65, { out: B.beach - .35, ink: true, id: 'news-tag' });   // gone before the beach shows: the beach photo's date is disputed
  number(x, 0, 28, v => String(Math.round(v)), 140, 330, 230, t, 31.0, .9, { out: FADE_OUT[0], ink: true, id: 'p6-number' });
  story(x, ['men.', 'Every', 'one', 'lived.'], 3, 148, 430, 80, t, 31.35, { out: FADE_OUT[0], ink: true, id: 'p6-story' });
}
