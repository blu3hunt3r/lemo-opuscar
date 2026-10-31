// Atmosphere: snow / ice crystals / spray / dust as soft points in view space (they surround the camera at every moment),
// shifted against the camera's own travel so they parallax, wrapped inside the frustum. Depth of field is done per particle:
// a flake off the focus plane grows into a softer, fainter disc (energy kept), like the lens would draw it.
import * as THREE from 'three';
import { mulberry } from '/core/lib.js';

const VS = `
attribute vec4 seed;            // x, y in 0..1 across the frustum, z in 0..1 across depth, w = size/phase
uniform float uTime, uZ0, uZ1, uTanH, uTanV, uSize, uFocus, uAper, uDensity, uPxScale, uGust, uFall;
uniform vec3 uWind, uCam;       // wind (m/s in view axes), camera travel since the shot began (view axes)
varying float vA; varying float vSoft;
void main(){
  if (seed.w > uDensity) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }
  float z = mix(uZ0, uZ1, seed.z);
  float ph = seed.w * 50.;
  vec3 p = vec3(0., 0., -z);
  float W = 2. * z * uTanH * 1.15, H = 2. * z * uTanV * 1.15;
  float fall = .6 + .8 * fract(seed.w * 7.3);
  vec2 drift = uWind.xy * uTime * (.7 + .6 * fract(seed.w * 3.1)) + vec2(sin(uTime * 1.3 + ph) * .25, -fall * uTime) * uFall * (1. + uGust);
  drift -= uCam.xy * (1. - z / (uZ1 * 1.5));            // parallax: near flakes slide most against the camera's travel
  p.x = (fract(seed.x + drift.x / W) - .5) * W;
  p.y = (fract(seed.y + drift.y / H) - .5) * H;
  float size = uSize * (.5 + fract(seed.w * 13.7)) * uPxScale / z;
  float coc = uAper * abs(1. / uFocus - 1. / z) * uPxScale * .02;
  float s = size + coc;
  vA = clamp(size * size / (s * s), .02, 1.);
  vSoft = clamp(coc / s, 0., 1.);
  gl_PointSize = s;
  gl_Position = projectionMatrix * vec4(p, 1.);
}`;
const FS = `
uniform vec3 uColor; uniform float uOpacity;
varying float vA; varying float vSoft;
void main(){
  float r = length(gl_PointCoord - .5) * 2.;
  float e = mix(.25, .95, vSoft);
  float a = (1. - smoothstep(1. - e, 1., r)) * vA * uOpacity;
  if (a < .003) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

// o: { n, z0, z1, size (m), color, opacity, wind: [x, y] (m/s), fall (scale of the 0.6–1.4 m/s fall), seed }
export function atmos(cam, o = {}) {
  const n = o.n ?? 3000, R = mulberry(o.seed ?? 5), seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) seed.set([R(), R(), Math.pow(R(), .7), R()], i * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const U = {
    uTime: { value: 0 }, uZ0: { value: o.z0 ?? .6 }, uZ1: { value: o.z1 ?? 30 }, uTanH: { value: 1 }, uTanV: { value: 1 },
    uSize: { value: o.size ?? .035 }, uFocus: { value: 8 }, uAper: { value: 6 }, uDensity: { value: o.density ?? .5 }, uPxScale: { value: 1000 },
    uWind: { value: new THREE.Vector3(...(o.wind || [.6, 0]), 0) }, uCam: { value: new THREE.Vector3() }, uGust: { value: 0 }, uFall: { value: o.fall ?? 1 },
    uColor: { value: new THREE.Color(o.color || '#f2f4f6') }, uOpacity: { value: o.opacity ?? .85 },
  };
  const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const pts = new THREE.Points(geo, m); pts.frustumCulled = false; pts.renderOrder = 50;
  // view space: the points follow the camera (added as its child)
  cam.add(pts);
  pts.update = (t, s) => {
    U.uTime.value = t; U.uFocus.value = s.focus; U.uAper.value = s.aper; U.uDensity.value = s.density;
    U.uGust.value = s.gust ?? 0; if (s.cam) U.uCam.value.set(...s.cam, 0);
    const vf = cam.fov * Math.PI / 360; U.uTanV.value = Math.tan(vf); U.uTanH.value = Math.tan(vf) * cam.aspect;
    U.uPxScale.value = s.pxH / (2 * Math.tan(vf));
  };
  return pts;
}
