// Documentary Parallax — page contract: window.READY, window.DUR, window.render(t), window.EV, window.TEXTS(t).
// Scenes (story.js): the front page, photo3d places, the map. Handovers: into the printed photo (the next scene shows inside the
// printed photo as a portal; when it covers the frame that scene takes over), whiteout (white rises over the old scene, falls over the new).
import * as THREE from 'three';
import { Pipe } from './engine/post.js';
import { atmos } from './engine/atmos.js';
import { REG } from './engine/type.js';
import { SHOTS, DUR, EVENTS, TEXT, GRADE, build } from './story.js';

const Q = new URLSearchParams(location.search), SSAA = +(Q.get('ssaa') || 1.25);
await Promise.all(["800 40px Inter", "500 40px Inter", "500 40px 'Plex Mono'", "500 40px Cormorant", "italic 600 40px Cormorant"].map(f => document.fonts.load(f, 'ENDURANCE 1915 crushed')));

const canvas = document.getElementById('c'), ov = document.getElementById('ov'), ox = ov.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(SSAA); renderer.setSize(1920, 1080, false);
renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const pipe = new Pipe(renderer, 1920, 1080, SSAA);

const S = await build({ renderer, pipe, THREE, atmos });   // every scene, built once
const shots = SHOTS(S);
window.DUR = DUR; window.EV = EVENTS;

function drawShot(sh, t, target) {
  const st = sh.state(t);   // { cam: {pos, look, fov, shift?}, focus, aper, maxCoc, atmos?, portal?, bloom? }
  const cam = sh.cam;
  cam.position.set(...st.cam.pos); cam.lookAt(...st.cam.look);
  cam.fov = st.cam.fov; cam.updateProjectionMatrix();
  if (st.cam.shift) {   // shift lens: the projection's centre moves, the camera doesn't turn (frames a tall photo without tilting it)
    const e = cam.projectionMatrix.elements; e[8] = st.cam.shift[0]; e[9] = st.cam.shift[1];
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }
  cam.updateMatrixWorld();
  if (sh.snow) sh.snow.update(t - sh.t0, { focus: st.focus, aper: st.atmos?.aper ?? .4, density: st.atmos?.density ?? 0, gust: st.atmos?.gust ?? 0, cam: st.atmos?.cam, pxH: 1080 * SSAA });
  if (st.portal) {   // the next scene, seen through the printed photo: render it first into a portal target
    drawShot(st.portal.shot, t, pipe.rtP[0]);
    const u = st.portal.mesh.material.uniforms;
    u.tPortal.value = pipe.rtP[0].texture; u.uRes.value.set(pipe.W, pipe.H); u.uMix.value = st.portal.mix;
  }
  pipe.shot(sh.scene, cam, { focus: st.focus, aper: st.aper, maxCoc: st.maxCoc ?? 14, bloom: st.bloom || { strength: .14, radius: .5, threshold: .8 } }, target);
}

window.render = (t) => {
  let i = shots.findIndex(s => t >= s.t0 && t < s.t1); if (i < 0) i = shots.length - 1;
  drawShot(shots[i], t, pipe.rtA);
  pipe.final({ expo: 1, vig: .38, sat: 1, contrast: .14, lift: [.004, .006, .011], gain: [1.03, 1.0, .96], ...GRADE(t), time: t });
  ox.clearRect(0, 0, 1920, 1080);
  REG.length = 0; TEXT(ox, t);
};
const scratch = document.createElement('canvas'); scratch.width = 1920; scratch.height = 1080; const sx = scratch.getContext('2d');
window.TEXTS = t => { REG.length = 0; TEXT(sx, t); return REG.slice(); };
window.render(0);
window.READY = true;
