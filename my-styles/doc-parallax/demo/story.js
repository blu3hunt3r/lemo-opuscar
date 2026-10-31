// Endurance: the demo film of Documentary Parallax. Structure and beats: TREATMENT.md. Every fact on screen: FACTS.md.
// Scenes: NEWS (New-York Tribune, 4 Sep 1916) → into its printed portrait → PORTRAIT (the print in 3D) → whiteout → P1 (frozen in)
// → whiteout → P3 (crushed) → whiteout → MAP (the James Caird) → dive + whiteout → P6 (the men on the beach) → 28 → black.
import * as THREE from 'three';
import { clamp, seg, ss, eo, ei, eio, track, monotone, lerp } from '/core/lib.js';
import { photo3d } from './engine/photo3d.js';
import { mapScene } from './engine/map.js';
import { title, tag, story, number, underline, RED } from './engine/type.js';

export const DUR = 32;
const ASP = 16 / 9, D2R = Math.PI / 180;
const vfovOf = hfov => 2 * Math.atan(Math.tan(hfov * D2R / 2) / ASP) / D2R;
const TAN_NEWS = Math.tan(15 * D2R) * ASP;               // news / map cameras: 30° vertical fov → tan of half the horizontal fov

// —— timeline ——
const PEAK = { p1: 8.75, p3: 14.0, map: 19.4, p6: 25.6 };   // whiteout peaks = the cuts
const FADE_IN = [.45, 1.25], FADE_OUT = [30.9, 31.7];
function whiteout(t) {
  let w = 0;
  for (const p of Object.values(PEAK)) {
    const up = Math.pow(ss(seg(t, p - .6, p)), 1.6), down = 1 - ss(seg(t, p + .06, p + .78));
    w = Math.max(w, t < p ? up : down);
  }
  return w;
}
export const GRADE = t => ({ white: whiteout(t), fade: ss(seg(t, ...FADE_IN)) * (1 - ss(seg(t, ...FADE_OUT))) });
const gust = (t, p, a = 1.1) => Math.max(0, 1 - Math.abs(t - p) / a);   // snow thickens into each whiteout

// —— the front page (page pixels / 1000 = metres; y down the page) ——
const PAGE = { w: 3.792, h: 4.216 };
const PRINT = { x0: .894, y0: 1.625, x1: 2.264, y1: 3.570 };          // the printed portrait = assets/tex/portrait*.jpg
PRINT.cx = (PRINT.x0 + PRINT.x1) / 2; PRINT.cy = (PRINT.y0 + PRINT.y1) / 2; PRINT.hw = (PRINT.x1 - PRINT.x0) / 2;
const MAROONED = { x0: 1.318, x1: 1.995, y: 1.523 };                    // under "Marooned" in the headline
// the reader's eye: centre on the page and the width of page seen, from the date line down to the headline, into the portrait (continues inside it)
const NC = (() => {
  const k = [[.0, 2.09, .93, 3.45], [.45, 2.08, .95, 3.42], [1.45, 2.05, 1.03, 3.36], [2.6, 1.63, 1.5, 2.2], [3.3, 1.6, 1.79, 1.86], [4.7, 1.58, 2.16, 1.22], [6.5, 1.578, 2.22, .98], [8.9, 1.575, 2.26, .82]];
  const fx = monotone(k.map(r => [r[0], r[1]])), fy = monotone(k.map(r => [r[0], r[2]])), fw = monotone(k.map(r => [r[0], Math.log(r[3])]));
  return t => ({ cx: fx(t), cy: fy(t), W: Math.exp(fw(t)) });
})();
const coversFrame = t => { const { cx, cy, W } = NC(t), H = W / ASP, m = .004; return cx - W / 2 > PRINT.x0 + m && cx + W / 2 < PRINT.x1 - m && cy - H / 2 > PRINT.y0 + m && cy + H / 2 < PRINT.y1 - m; };
let T_IN = 4.7; for (let t = 3.0; t < 6; t += 1 / 480) if (coversFrame(t)) { T_IN = Math.ceil(t * 24) / 24; break; }   // the print fills the frame: cut inside
const pageToScreen = (px, py, t) => { const { cx, cy, W } = NC(t), H = W / ASP; return [960 + (px - cx) / (W / 2) * 960, 540 + (py - cy) / (H / 2) * 540, 1920 / W]; };

// —— the map ——
const LON0 = -45, LAT0 = -65, KM = 10;   // orthographic, metres per radian
const R = { drift: null, caird: null };
const MAPCAM = track([[19.4, [.02, -1.3, 3.7]], [20.6, [-.04, -.75, 3.8]], [23.8, [.0, 1.15, 3.6]], [24.45, [-.22, 1.02, 3.25]]]);
const DIVE_T = [24.45, PEAK.p6];

// —— events for the sound (exported by core/render/events.mjs) ——
export const EVENTS = [
  { t: 0, type: 'wind', dur: 9, level: 'low' },
  { t: .2, type: 'page', note: 'a newspaper page settles' },
  { t: .9, type: 'note', note: 'one low piano note: the score begins' },
  { t: 2.35, type: 'pen', dur: .5, note: 'red underline under "Marooned"' },
  { t: 3.0, type: 'swell', dur: T_IN - 3.0, note: 'push into the printed portrait' },
  { t: T_IN, type: 'into_print', note: 'the print fills the frame' },
  { t: 5.2, type: 'type', dur: .7, n: 21 },
  { t: 7.6, type: 'gust', dur: PEAK.p1 - 7.6 },
  { t: PEAK.p1, type: 'whiteout', note: 'cut to p1 (night, frozen in)' },
  { t: PEAK.p1, type: 'ice', dur: PEAK.p3 - PEAK.p1, note: 'ice groaning, creaking hull' },
  { t: 9.35, type: 'type', dur: .41, n: 9, note: 'ENDURANCE' },
  { t: 9.95, type: 'type', dur: .5, n: 15 },
  { t: 13.2, type: 'gust', dur: PEAK.p3 - 13.2 },
  { t: PEAK.p3, type: 'whiteout', note: 'cut to p3 (crushed); timpani swell peaks here' },
  { t: 14.55, type: 'type', dur: .4, n: 12 },
  { t: 15.1, type: 'story', dur: .7, note: 'The ice crushed her.' },
  { t: 15.45, type: 'crack', note: 'timber cracks under the red word' },
  { t: 18.7, type: 'gust', dur: PEAK.map - 18.7 },
  { t: PEAK.map, type: 'whiteout', note: 'clears onto the map' },
  { t: 19.6, type: 'pen', dur: 1.2, note: 'drift line (dashed, pale)' },
  { t: 20.6, type: 'route', dur: 3.2, note: 'James Caird line draws in red: pen scratch, pulse' },
  { t: 20.8, type: 'type', dur: 1.0, n: 29 },
  { t: 20.6, type: 'count', dur: 3.2, note: 'distance counts to 1,300 km with the line (ease in-out)' },
  { t: 23.8, type: 'hit', level: 'soft', note: 'route lands at South Georgia' },
  { t: 24.0, type: 'silence', dur: .95, note: 'the score stops (≥ 0.8 s): only the air' },
  { t: 24.45, type: 'dive', dur: PEAK.p6 - 24.45 },
  { t: PEAK.p6, type: 'whiteout', note: 'sea spray: cut to p6 (the beach)' },
  { t: PEAK.p6, type: 'sea', dur: 6.4 },
  { t: 26.3, type: 'count', dur: .9 },
  { t: 27.2, type: 'hit', level: 'low', note: '28 lands: low hit, the final chord blooms' },
  { t: 27.15, type: 'story', dur: .7, note: 'men. Every one lived.' },
  { t: FADE_OUT[0], type: 'fade', dur: FADE_OUT[1] - FADE_OUT[0] },
  { t: DUR, type: 'end' },
];

const loadTex = url => new Promise((res, rej) => new THREE.TextureLoader().load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, rej));
const camera = (scene, near = .05, far = 400) => { const c = new THREE.PerspectiveCamera(30, ASP, near, far); scene.add(c); return c; };

export async function build({ atmos }) {
  const S = {};
  // NEWS: the page as a sheet, the printed portrait as a portal onto the PORTRAIT scene
  {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#050505');
    const map = await loadTex('assets/tex/page.jpg');
    const page = new THREE.Mesh(new THREE.PlaneGeometry(PAGE.w, PAGE.h), new THREE.MeshBasicMaterial({ map }));
    page.position.set(PAGE.w / 2, -PAGE.h / 2, 0); scene.add(page);
    const g = new THREE.PlaneGeometry(PRINT.x1 - PRINT.x0, PRINT.y1 - PRINT.y0), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (PRINT.x0 + uv.getX(i) * (PRINT.x1 - PRINT.x0)) / PAGE.w, 1 - (PRINT.y1 - uv.getY(i) * (PRINT.y1 - PRINT.y0)) / PAGE.h);
    const portal = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, tPortal: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uMix: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform sampler2D map, tPortal; uniform vec2 uRes; uniform float uMix; varying vec2 vUv;
        void main(){ vec3 a = texture2D(map, vUv).rgb; vec3 b = texture2D(tPortal, gl_FragCoord.xy / uRes).rgb; gl_FragColor = vec4(mix(a, b, uMix), 1.); }`,
    }));
    portal.position.set(PRINT.cx, -PRINT.cy, .0005); scene.add(portal);
    const cam = camera(scene, .02, 20);
    const dust = atmos(cam, { n: 450, z0: .25, z1: 3.2, size: .003, color: '#fff1d6', opacity: .35, wind: [.015, .004], fall: .02, seed: 11, density: .5 });
    S.news = { scene, cam, portal, snow: dust };
  }
  // PORTRAIT: the paper's own print of the portrait, cut into two depth bands (wall, figure)
  {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#000');
    const ph = await photo3d({ base: 'assets/tex/', id: 'portrait', hfov: 40, zNear: 2.0, zFar: 3.2, cover: 1.0, levels: [.03, .97, 1.05] });
    scene.add(ph);
    const cam = camera(scene, .05, 50);
    const snow = atmos(cam, { n: 2600, z0: .3, z1: 6, size: .012, color: '#eef2f6', opacity: .85, wind: [.9, -.1], fall: .5, seed: 3 });
    S.portrait = { scene, cam, ph, snow };
  }
  // P1: frozen in (Hurley's night flash, 1915)
  {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#000');
    const ph = await photo3d({ base: 'assets/tex/', id: 'p1', hfov: 52, zNear: 8, zFar: 90, cover: 1.08, levels: [.02, 1, 1.0] });
    scene.add(ph);
    const cam = camera(scene, .1, 400);
    const snow = atmos(cam, { n: 3000, z0: 1.3, z1: 40, size: .035, color: '#eef2f6', opacity: .8, wind: [.6, 0], fall: .7, seed: 5 });
    S.p1 = { scene, cam, ph, snow };
  }
  // P3: "The End" (the wreck, November 1915)
  {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#000');
    const ph = await photo3d({ base: 'assets/tex/', id: 'p3', hfov: 50, zNear: 5, zFar: 70, cover: 1.08, levels: [.03, .98, 1.1] });
    scene.add(ph);
    const cam = camera(scene, .1, 300);
    const snow = atmos(cam, { n: 2600, z0: .6, z1: 30, size: .035, color: '#f4f4f2', opacity: .75, wind: [.9, 0], fall: .6, seed: 8 });
    S.p3 = { scene, cam, ph, snow };
  }
  // MAP: Natural Earth land, the drift (pale, dashed), the James Caird (red)
  {
    const geo = await (await fetch('assets/raw/land.geojson')).json();
    const route = await (await fetch('assets/raw/route.json')).json();
    const line = id => route.lines.find(l => l.id === id).coords;
    R.drift = line('drift'); R.caird = line('james_caird'); R.sink = route.points.find(p => p.id === 'sank_logged').coord;
    const m = mapScene({ geo, lon0: LON0, lat0: LAT0, scale: KM, W: 8, H: 6.4, ppm: 600, labels: [
      ['WEDDELL SEA', -41.5, -70.6, 40, 'center'], ['ELEPHANT IS.', -55.1, -61.9, 36, 'center'], ['SOUTH GEORGIA', -36.9, -55.1, 36, 'center'],
    ] });
    const cam = camera(m.scene, .02, 50);
    S.map = { scene: m.scene, cam, m };
  }
  // P6: the men on the beach, Elephant Island (date disputed: no date on screen)
  {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#000');
    const ph = await photo3d({ base: 'assets/tex/', id: 'p6', hfov: 50, zNear: 6, zFar: 200, cover: 1.12, levels: [.02, .98, 1.05] });
    scene.add(ph);
    const cam = camera(scene, .1, 600);
    const snow = atmos(cam, { n: 2400, z0: .6, z1: 40, size: .03, color: '#f2f4f5', opacity: .7, wind: [-.5, .05], fall: .5, seed: 13 });
    S.p6 = { scene, cam, ph, snow };
  }
  return S;
}

// —— the shots: each state(t) gives the camera, focus, aperture, atmosphere ——
export function SHOTS(S) {
  const Tp = S.portrait.ph.userData.T;
  const portraitCam = t => {   // the print as the reader's eye sees it (NC), then the camera inside it
    const { cx, cy, W } = NC(t), H = W / ASP;
    const sx = PRINT.hw / (W / 2), ndcX = (PRINT.cx - cx) / (W / 2), ndcY = -(PRINT.cy - cy) / (H / 2);
    const tanH = Tp / sx, k = ss(seg(t, T_IN, 8.9));
    const pos = [.035 * k, .012 * k, -.02 * ss(seg(t, 3.4, T_IN)) - .30 * eio(seg(t, T_IN - .3, 9.2))];
    return { pos, look: [pos[0], pos[1], pos[2] - 1], fov: 2 * Math.atan(tanH / ASP) / D2R, shift: [-ndcX, -ndcY] };
  };
  const portraitState = t => ({
    cam: portraitCam(t), focus: 2.15, aper: 18, maxCoc: 10,
    atmos: { density: .9 * ss(seg(t, 7.2, PEAK.p1)), gust: 1.6 * gust(t, PEAK.p1, 1.2), aper: .25, cam: [0, 0] },
    bloom: { strength: .1, radius: .5, threshold: .85 },
  });
  const sh = [];
  // NEWS
  sh.push({ ...S.news, t0: 0, t1: T_IN, state: t => {
    const { cx, cy, W } = NC(t), d = W / (2 * TAN_NEWS);
    const mix = ss(seg(t, 2.85, Math.min(4.15, T_IN - .15)));
    return {
      cam: { pos: [cx, -cy, d], look: [cx, -cy, 0], fov: 30 }, focus: d, aper: 2, maxCoc: 0,
      atmos: { density: .45, aper: .02, cam: [cx * .2, -cy * .2] },
      portal: t > 2.8 ? { shot: { ...S.portrait, t0: 0, state: portraitState }, mesh: S.news.portal, mix } : null,
      bloom: { strength: 0, radius: .4, threshold: 1 },
    };
  } });
  // PORTRAIT
  sh.push({ ...S.portrait, t0: T_IN, t1: PEAK.p1, state: portraitState });
  // P1: slow push through the ice toward the ship
  sh.push({ ...S.p1, t0: PEAK.p1, t1: PEAK.p3, state: t => {
    const k = eio(seg(t, PEAK.p1 - 1.2, PEAK.p3 + 1.0)), pos = [lerp(.16, -.1, k), lerp(-.06, .1, k), lerp(.1, -1.45, k)];
    return {
      cam: { pos, look: [pos[0], pos[1], pos[2] - 1], fov: vfovOf(52), shift: [0, .2] },
      focus: 17.5 + pos[2], aper: 90, maxCoc: 12,
      atmos: { density: .32 + .6 * gust(t, PEAK.p1, .9) + .6 * gust(t, PEAK.p3, 1.0), gust: 1.4 * (gust(t, PEAK.p1, .9) + gust(t, PEAK.p3, 1.0)), aper: .2, cam: [pos[0], pos[1]] },
      bloom: { strength: .2, radius: .55, threshold: .72 },
    };
  } });
  // P3: rise from the dogs past the hull to the broken masts (shift lens frames the tall print; the camera itself rises for parallax)
  const tanV3 = Math.tan(25 * D2R) / ASP;
  sh.push({ ...S.p3, t0: PEAK.p3, t1: PEAK.map, state: t => {
    const k = eio(seg(t, PEAK.p3 - .9, PEAK.map + .9));
    const pos = [lerp(.08, -.06, k), lerp(0, .35, k), lerp(.15, -.4, k)], cy = lerp(-.33, .25, k);
    return {
      cam: { pos, look: [pos[0], pos[1], pos[2] - 1], fov: vfovOf(50), shift: [0, cy / tanV3] },
      focus: lerp(7.5, 12.5, ss(seg(t, 14.6, 16.4))), aper: 55, maxCoc: 12,
      atmos: { density: .25 + .7 * gust(t, PEAK.p3, .9) + .7 * gust(t, PEAK.map, 1.0), gust: 1.5 * (gust(t, PEAK.p3, .9) + gust(t, PEAK.map, 1.0)), aper: .35, cam: [pos[0], pos[1]] },
      bloom: { strength: .12, radius: .5, threshold: .85 },
    };
  } });
  // MAP: the drift, then the James Caird; then the dive into Elephant Island
  const EI = S.map.m.toWorld(-54.95, -61.12);
  sh.push({ ...S.map, t0: PEAK.map, t1: PEAK.p6, state: t => {
    let [x, y, W] = MAPCAM(t);
    const kd = ei(seg(t, ...DIVE_T)) ** .9;
    x = lerp(x, EI[0], kd); y = lerp(y, EI[1], kd); W = Math.exp(lerp(Math.log(W), Math.log(.45), kd));
    const d = W / (2 * TAN_NEWS);
    S.map.m.draw([
      { pts: R.drift, k: ss(seg(t, 19.6, 20.8)), width: 4, dash: [14, 12], color: 'rgba(240,235,224,.55)', dots: t > 20.8 ? [R.sink] : [] },
      { pts: R.caird, k: eio(seg(t, 20.6, 23.8)), width: 7, head: true, dots: t > 20.65 ? [R.caird[0]].concat(t > 23.8 ? [R.caird[R.caird.length - 1]] : []) : [] },
    ]);
    return { cam: { pos: [x, y - .03 * d, d], look: [x, y, 0], fov: 30 }, focus: d, aper: 2, maxCoc: 0, bloom: { strength: 0, radius: .4, threshold: 1 } };
  } });
  // P6: lateral drift along the waving men
  sh.push({ ...S.p6, t0: PEAK.p6, t1: DUR + 1, state: t => {
    const k = eio(seg(t, PEAK.p6 - .8, DUR)), pos = [lerp(.22, -.2, k), lerp(.02, .06, k), lerp(.2, -.7, k)];
    return {
      cam: { pos, look: [pos[0], pos[1], pos[2] - 1], fov: vfovOf(50), shift: [0, 0] },
      focus: 7.4 + pos[2], aper: 45, maxCoc: 12,
      atmos: { density: .22 + .7 * gust(t, PEAK.p6, .9), gust: 1.4 * gust(t, PEAK.p6, .9), aper: .35, cam: [pos[0], pos[1]] },
      bloom: { strength: .12, radius: .5, threshold: .85 },
    };
  } });
  return sh;
}

// —— type (1920×1080 overlay); every line from FACTS.md ——
export function TEXT(x, t) {
  // NEWS: a red hand-drawn line under "Marooned" (a marker on the page, moves with it)
  if (t < T_IN) {
    const [ax, ay, s] = pageToScreen(MAROONED.x0, MAROONED.y, t), [bx] = pageToScreen(MAROONED.x1, MAROONED.y, t);
    const k = eo(seg(t, 2.35, 2.85)), fa = ss(seg(t, 2.35, 2.45)) * (1 - ss(seg(t, 3.9, 4.3)));
    if (k > 0 && fa > 0) { x.save(); x.globalAlpha = fa; x.strokeStyle = RED; x.lineCap = 'round'; underline(x, ax, bx, ay, k, .016 * s, 21); x.restore(); }
  }
  tag(x, 'SIR ERNEST SHACKLETON', 150, 968, 28, t, 5.2, { out: 8.25, id: 'portrait-tag' });
  title(x, 'ENDURANCE', 146, 238, 168, t, 9.35, { out: 13.25 });
  tag(x, 'WEDDELL SEA · 1915', 154, 300, 28, t, 9.95, { out: 13.25, id: 'p1-tag' });
  tag(x, 'OCTOBER 1915', 1180, 232, 28, t, 14.55, { out: 18.75, ink: true, id: 'p3-tag' });
  story(x, ['The', 'ice', 'crushed', 'her.'], 2, 1176, 320, 78, t, 15.1, { out: 18.75, ink: true, id: 'p3-story' });
  tag(x, 'JAMES CAIRD · 6 MEN · 16 DAYS', 1772, 772, 28, t, 20.8, { out: 24.55, align: 'right', id: 'map-tag' });
  number(x, 0, 1300, v => `${Math.round(v).toLocaleString('en-US')} KM`, 1772, 930, 150, t, 20.6, 3.2, { out: 24.55, align: 'right', id: 'map-number', ease: eio });   // counts with the line
  number(x, 0, 28, v => String(Math.round(v)), 146, 318, 220, t, 26.3, .9, { out: FADE_OUT[0], ink: true, id: 'p6-number' });
  story(x, ['men.', 'Every', 'one', 'lived.'], 3, 154, 418, 78, t, 27.15, { out: FADE_OUT[0], ink: true, id: 'p6-story' });
}
