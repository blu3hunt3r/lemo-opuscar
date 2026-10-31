// Test harness for a 3D reconstruction scene module (Endurance v2). The film's own page (main.js) drives the same module the same way:
//   const S = await build({ THREE, renderer, atmos, pxH });   // once
//   const st = S.state(u);                                    // per frame, u = seconds since the shot starts (may be < 0 or > the shot's length)
//   st = { cam: { pos:[x,y,z], look:[x,y,z], fov (vertical, deg), roll? (rad) }, focus (m), aper, maxCoc (px at 1080p),
//          bloom: { strength, radius, threshold }, grade?: { expo, sat, contrast, lift:[r,g,b], gain:[r,g,b] } }
//   S.cam must be a THREE.PerspectiveCamera that is a child of S.scene (particles parented to the camera render with it).
// Rendering: linear HDR values into half-float targets, no tone mapping; Pipe (engine/post.js) does MSAA → depth of field → bloom → grade → sRGB.
// DoF: circle of confusion in px at 1080p = aper × (1/focus − 1/z), clamped to maxCoc.
import * as THREE from 'three';
import { Pipe } from '../../engine/post.js';
import { atmos } from '../../engine/atmos.js';

export async function harness(SCENE, { dur = 6, u0 = 0 } = {}) {
  const Q = new URLSearchParams(location.search), SSAA = +(Q.get('ssaa') || 1.25);
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(SSAA); renderer.setSize(1920, 1080, false);
  renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const pipe = new Pipe(renderer, 1920, 1080, SSAA);
  const S = await SCENE.build({ THREE, renderer, atmos, pxH: 1080 * SSAA });
  window.DUR = dur;
  window.render = t => {
    const u = t + u0, st = S.state(u), cam = S.cam;
    cam.position.set(...st.cam.pos); cam.up.set(0, 1, 0); cam.lookAt(...st.cam.look); if (st.cam.roll) cam.rotateZ(st.cam.roll);
    cam.fov = st.cam.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    pipe.shot(S.scene, cam, { focus: st.focus, aper: st.aper, maxCoc: st.maxCoc ?? 12, bloom: st.bloom || { strength: .15, radius: .5, threshold: .85 } }, pipe.rtA);
    // the film's base grade (main.js); a scene may add its own on top
    pipe.final({ expo: 1, vig: .38, sat: 1, contrast: .16, lift: [.004, .006, .011], gain: [1.03, 1.0, .96], ...(st.grade || {}), time: t });
  };
  window.render(0);
  window.READY = true;
}
