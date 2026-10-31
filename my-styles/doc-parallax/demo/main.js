// Endurance v2 — page contract: window.READY, window.DUR, window.render(t), window.EV, window.TEXTS(t).
// Shots (story.js) are photo places (engine/photo3d.js), 3D reconstructions (scenes/*), and the desk. Each shot's state(t) gives its
// camera and lens; a transition that needs both pictures at once (the ice-crack shatter) renders the incoming shot into rtA, the outgoing
// one (frozen at the transition's start) into rtB, and lays the falling shards (textured with rtB) over rtA. Whiteouts, flashes and fades are grade (story.GRADE).
import * as THREE from 'three';
import { Pipe } from './engine/post.js';
import { atmos } from './engine/atmos.js';
import { REG } from './engine/type.js';
import { SHOTS, TRANS, DUR, EVENTS, TEXT, GRADE, build } from './story.js';

const Q = new URLSearchParams(location.search), SSAA = +(Q.get('ssaa') || 1.25);
await Promise.all(["800 40px Inter", "500 40px Inter", "500 40px 'Plex Mono'", "500 40px Cormorant", "italic 600 40px Cormorant", "600 40px Cormorant"].map(f => document.fonts.load(f, 'ENDURANCE 1915 crushed')));

const canvas = document.getElementById('c'), ov = document.getElementById('ov'), ox = ov.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(SSAA); renderer.setSize(1920, 1080, false);
renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const pipe = new Pipe(renderer, 1920, 1080, SSAA);

const S = await build({ renderer, pipe, THREE, atmos, pxH: 1080 * SSAA });
const shots = SHOTS(S), trans = TRANS(S, shots);
window.DUR = DUR; window.EV = EVENTS;

function drawShot(sh, t, target) {
  const st = sh.state(t);   // { cam: {pos, look, fov, roll?, shift?}, focus, aper, maxCoc, bloom, grade?, atmos? }
  const cam = sh.cam;
  cam.position.set(...st.cam.pos); cam.up.set(0, 1, 0); cam.lookAt(...st.cam.look); if (st.cam.roll) cam.rotateZ(st.cam.roll);
  cam.fov = st.cam.fov; cam.updateProjectionMatrix();
  if (st.cam.shift) {   // shift lens: the projection's centre moves, the camera doesn't turn
    const e = cam.projectionMatrix.elements; e[8] = st.cam.shift[0]; e[9] = st.cam.shift[1];
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }
  cam.updateMatrixWorld();
  if (sh.snow && st.atmos) sh.snow.update(t - sh.t0, { focus: st.focus, aper: st.atmos.aper ?? .3, density: st.atmos.density ?? 0, gust: st.atmos.gust ?? 0, cam: st.atmos.cam, pxH: 1080 * SSAA });
  pipe.shot(sh.scene, cam, { focus: st.focus, aper: st.aper, maxCoc: st.maxCoc ?? 12, bloom: st.bloom || { strength: .14, radius: .5, threshold: .85 } }, target);
  return st.grade || {};
}

// The outgoing picture of a transition is rendered once, as it was at the transition's start, and kept in rtB (nothing else draws into
// rtB): a photograph that cracks is a still, and a frame then draws one scene instead of two (the render tool allows 30 s per frame).
// Pure in t: whichever frame of the transition comes first renders the same picture.
let frozen = null;
window.render = (t) => {
  const tr = trans.find(x => t >= x.t0 && t < x.t1);
  let g;
  if (tr) {
    if (frozen !== tr) { tr.gOld = drawShot(tr.from, tr.t0, pipe.rtB); frozen = tr; }
    g = drawShot(tr.to, t, pipe.rtA);
    const gOld = tr.gOld;
    tr.fx.update(t - tr.t0, pipe.rtB.texture);
    renderer.setRenderTarget(pipe.rtA); renderer.autoClear = false; renderer.clearDepth(); renderer.render(tr.fx.scene, tr.fx.cam); renderer.autoClear = true;
    if (t - tr.t0 < tr.fx.dur * .45) g = gOld;   // the grade follows the picture that fills the frame
  } else {
    let i = shots.findIndex(s => t >= s.t0 && t < s.t1); if (i < 0) i = shots.length - 1;
    g = drawShot(shots[i], t, pipe.rtA);
  }
  pipe.final({ expo: 1, vig: .4, sat: 1, contrast: .18, lift: [.003, .005, .009], gain: [1.03, 1.0, .96], ...g, ...GRADE(t), time: t });
  ox.clearRect(0, 0, 1920, 1080);
  REG.length = 0; TEXT(ox, t);
  if (tr && tr.fx.drawCracks) tr.fx.drawCracks(ox, t - tr.t0);
};
const scratch = document.createElement('canvas'); scratch.width = 1920; scratch.height = 1080; const sx = scratch.getContext('2d');
window.TEXTS = t => { REG.length = 0; TEXT(sx, t); return REG.slice(); };
window.render(0);
window.READY = true;
