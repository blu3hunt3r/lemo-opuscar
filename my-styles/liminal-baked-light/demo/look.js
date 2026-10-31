// Materials: every static surface reads its baked light-style layers, scaled per frame by the layer curves (story.js layers()),
// coloured by the chroma map. Floor gloss, fog and moving objects read the floor map under them. GLSL for WebGLRenderer (r187).
import * as THREE from 'three';
import { H, CW, NCOR, LAYER_ROOMS, Z0, RL, NROOM, LIT } from './world.js';

export const NPASS = 10;   // layer passes per map array; index NPASS = chroma
export const U = {
  uL: { value: new Float32Array(32) }, uLed: { value: new Float32Array(32) },
  uExpo: { value: 1.0 }, uEmit: { value: 3.0 },
  uFogCol: { value: new THREE.Color(0.075, 0.085, 0.055) }, uFogD: { value: 0.03 },
  uFloorLM: { value: null }, uCeilLM: { value: null },
  // ?base=1: the base style's light (nearest panels summed, no occlusion) for the side-by-side style frame
  uBase: { value: 0 }, uFix: { value: LIT.map(f => new THREE.Vector4(f.x, f.z, f.layer, 0)) },
};
const f = n => n.toFixed(3);
const COMMON = `
precision highp float; precision highp sampler2DArray;
uniform float uL[32]; uniform float uLed[32]; uniform float uExpo, uEmit, uFogD; uniform vec3 uFogCol;
uniform sampler2DArray uFloorLM, uCeilLM; uniform float uBase; uniform vec4 uFix[${LIT.length}];
in vec3 vW; in vec3 vN; in vec2 vUv; in vec2 vUv1;
float lum(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for (int k = 0; k < 4; k++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
// baked irradiance: sum of layers × their level now, coloured by the chroma map (maps were read back flipped in v)
vec3 lmE(sampler2DArray M, vec2 uv1){
  vec2 t = vec2(uv1.x, 1. - uv1.y); float s = 0.;
  for (int p = 0; p < ${NPASS}; p++){ vec3 m = texture(M, vec3(t, float(p))).rgb; s += m.r * uL[p*3] + m.g * uL[p*3+1] + m.b * uL[p*3+2]; }
  vec3 c = texture(M, vec3(t, ${NPASS}.)).rgb; float cl = lum(c);
  return (cl > 1e-4 ? c / cl : vec3(1., .98, .9)) * s;
}
// one layer's value at a texel (for gloss visibility)
float lmLayer(sampler2DArray M, vec2 uv1, int k){ vec3 m = texture(M, vec3(uv1.x, 1. - uv1.y, float(k / 3))).rgb; int c = k - (k / 3) * 3; return c == 0 ? m.r : c == 1 ? m.g : m.b; }
// the base style's light: every panel within the nearest 5 × 5 grid cells summed, no walls, plus a local "bounce" average
vec3 baseE(vec3 P, vec3 N){
  vec3 dif = vec3(0.), amb = vec3(0.);
  for (int i = 0; i < ${LIT.length}; i++){
    vec4 F = uFix[i]; float Lv = uL[int(F.z + .5)]; if (Lv <= 0.) continue;
    vec3 d = vec3(F.x, ${f(H - 0.02)}, F.y) - P; float d2 = dot(d, d); if (d2 > 45.) continue;
    vec3 l = d * inversesqrt(d2);
    dif += Lv * max(dot(N, l), 0.) * (.3 + .7 * max(l.y, 0.)) / (d2 + .3);
    amb += vec3(Lv) / (dot(d.xz, d.xz) + 3.);
  }
  return (dif * 2.2 + amb * .16) * 3.4 * vec3(1., .975, .9);
}
vec3 surfE(sampler2DArray M, vec2 uv1, vec3 P, vec3 N){ return uBase > .5 ? baseE(P + N * .02, N) : lmE(M, uv1); }
bool inPlan(vec2 xz){ return xz.x > -9. && xz.x < 9. && xz.y > -72. && xz.y < 4.; }
vec2 planUV(vec2 xz){ float st = xz.y < -34. ? 1. : 0.; return vec2((xz.x + 9.) / 36. + st * .5, (xz.y - (st > .5 ? -72. : -34.)) / 38.); }
vec3 floorE(vec2 xz){ return uBase > .5 ? baseE(vec3(xz.x, .02, xz.y), vec3(0., 1., 0.)) : inPlan(xz) ? lmE(uFloorLM, planUV(xz)) : vec3(0.); }
// fog follows local light: haze is as bright as the floor under it (dark where the panels are off)
vec3 fogA(vec3 c, vec3 P){
  float d = length(P - cameraPosition), fo = 1. - exp(-d * uFogD);
  float k = clamp(lum(floorE(P.xz)) / .7, .0, 1.3);
  return mix(c, uFogCol * k * uExpo, fo);
}
`;
const VS = `
in vec2 uv1; out vec3 vW; out vec3 vN; out vec2 vUv; out vec2 vUv1;
void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vUv1 = uv1;
  gl_Position = projectionMatrix * viewMatrix * w; }`;
function mat(frag, extra = {}, side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, ...extra }, vertexShader: VS, fragmentShader: COMMON + frag, side, glslVersion: THREE.GLSL3 });
}

// —— Walls (atlas): green paint above a locker band on the corridor faces, rubber cove base ——
const WALL_FS = `
uniform sampler2DArray uLM; uniform float uKind; uniform sampler2D map;
out vec4 outColor;
vec3 S(vec3 h){ return pow(h, vec3(2.2)); }
void main(){
  vec3 N = normalize(vN); vec3 P = vW;
  vec3 E = surfE(uLM, vUv1, P, N);
  vec3 alb;
  float u = abs(N.x) > .5 ? P.z * sign(N.x) : -P.x * sign(N.z);
  if (uKind < .5) {               // walls
    bool corr = abs(abs(P.x) - ${f(CW)}) < .04 && N.x * P.x < 0. && P.z < ${f(Z0)} + .01;
    alb = S(vec3(.725, .769, .604)) * (.94 + .1 * fbm(vec2(u * .7, P.y * 1.3)));
    alb *= 1. - .1 * smoothstep(.62, .8, fbm(vec2(u * 2.1, P.y * 3.) + 7.));            // scuffs and patching
    alb *= mix(vec3(1.), vec3(.9, .9, .78), smoothstep(${f(H - 0.4)}, ${f(H)}, P.y) * .5);  // discoloured band under the ceiling
    if (corr && P.y < 1.85) {     // lockers: 0.38 m doors, vents near the top, a handle, the odd dented door
      float id = floor(u / .381), lx = fract(u / .381);
      alb = S(vec3(.435, .498, .4)) * (.93 + .1 * h21(vec2(id, 1.)));
      alb *= 1. - .55 * (smoothstep(.012, .0, lx) + smoothstep(.988, 1., lx));
      float vent = step(1.6, P.y) * step(P.y, 1.74) * step(.5, fract(P.y * 55.)) * step(.2, lx) * step(lx, .8);
      alb *= 1. - .6 * vent;
      alb *= 1. - .5 * step(abs(lx - .82), .02) * step(abs(P.y - 1.02), .07);
      alb *= 1. - .08 * smoothstep(.7, .8, fbm(vec2(u * 6., P.y * 4.)));
    }
    if (corr && abs(P.y - 1.875) < .025) alb = S(vec3(.3, .32, .27));
    if (P.y < .12) alb = S(vec3(.24, .25, .22)) * (.9 + .1 * vn(vec2(u * 30., 1.)));
  } else if (uKind < 1.5) {       // door trims
    alb = S(vec3(.36, .34, .29));
  } else if (uKind < 2.5) {       // chalkboards: dark green with old chalk dust
    alb = S(vec3(.18, .27, .22)) * (.9 + .25 * fbm(vec2(u * 1.3, P.y * 2.)));
    alb += .025 * smoothstep(.55, .8, fbm(vec2(u * 3., P.y * 8.) + 3.));
  } else if (uKind < 3.5) {       // night windows: black glass, a faint sheen of the room's own light
    alb = vec3(.012, .014, .016);
    E *= 1. + 6. * pow(1. - abs(dot(N, normalize(cameraPosition - P))), 3.);
  } else {                        // notices
    alb = pow(texture(map, vUv).rgb, vec3(1.));
  }
  vec3 c = alb * E * uExpo;
  outColor = vec4(fogA(c, P), 1.);
}`;
export function wallMat(kind, lm, map = null) {
  const m = mat(WALL_FS, { uLM: { value: lm }, uKind: { value: kind }, map: { value: map } });
  return m;
}

// —— Floor: 30 cm vinyl tiles, glossy; reflections of the lit panels the point can see ——
const FLOOR_FS = `
out vec4 outColor;
const float HH = ${f(H - 0.01)};
float spot(vec3 P, vec3 R, vec2 c, vec2 hs, float sh){
  float t = (HH - P.y) / R.y; vec3 hp = P + R * t;
  vec2 q = clamp(hp.xz, c - hs, c + hs);
  vec3 L = normalize(vec3(q.x, HH, q.y) - P);
  return pow(max(dot(R, L), 0.), sh);
}
void main(){
  vec3 P = vW; vec3 V = normalize(cameraPosition - P);
  vec3 E = surfE(uFloorLM, vUv1, P, vec3(0., 1., 0.));
  vec2 tl = floor(P.xz / .3), tf = fract(P.xz / .3);
  vec3 alb = pow(vec3(.659, .604, .49), vec3(2.2)) * (.9 + .14 * h21(tl));
  if (h21(tl + 9.) > .93) alb *= .78;                                        // replacement tiles
  alb *= .9 + .2 * vn(P.xz * 9.) ;                                           // speckle
  alb *= 1. - .25 * (smoothstep(.02, 0., min(tf.x, tf.y)) );                 // seams
  if (abs(P.x) < ${f(CW)} && abs(abs(P.x) - ${f(CW - 0.2)}) < .1) alb *= .72;  // darker border course along the corridor walls
  alb *= 1. - .18 * smoothstep(.6, .78, fbm(P.xz * .6 + 4.));                  // dull, scuffed lanes
  vec3 c = alb * E * uExpo;
  // gloss: the panels the point can see (layer value > 0 at this texel), Fresnel-weighted
  vec3 R = reflect(-V, vec3(0, 1, 0));
  float fr = .03 + .97 * pow(1. - max(V.y, 0.), 5.);
  float g = 0.;
  if (R.y > .01) {
    float t = (HH - P.y) / R.y; vec3 hp = P + R * t;
    int kc = int(floor((1.2 - hp.z) / 2.4 + .5));
    for (int d = -1; d <= 1; d++) {
      int k = kc + d; if (k < 0 || k > ${NCOR - 1}) continue;
      float vis = uBase > .5 ? 1. : smoothstep(.0005, .006, lmLayer(uFloorLM, vUv1, k));
      vec2 cc = vec2(0., 1.2 - 2.4 * float(k));
      g += (spot(P, R, cc, vec2(.3, .6), 900.) * 1.0 + spot(P, R, cc, vec2(.3, .6), 60.) * .06) * uL[k] * vis;
    }
    if (abs(P.x) > ${f(CW)}) {     // inside a classroom: its own six panels
      float side = sign(P.x); float j = floor((${f(Z0)} - P.z) / ${f(RL)});
      if (j >= 0. && j < ${NROOM}.) {
        float zc = ${f(Z0)} - (j + .5) * ${f(RL)};
        float vis = smoothstep(.0005, .006, lmLayer(uFloorLM, vUv1, ${LAYER_ROOMS}));
        for (int a = 0; a < 2; a++) for (int b = -1; b <= 1; b++) {
          vec2 cc = vec2(side * (${f(CW)} + (a == 0 ? 1.75 : 5.25)), zc + float(b) * 2.4);
          g += (spot(P, R, cc, vec2(.3, .6), 900.) + spot(P, R, cc, vec2(.3, .6), 60.) * .06) * uL[${LAYER_ROOMS}] * vis;
        }
      }
    }
  }
  c += vec3(1., .98, .9) * g * fr * uEmit * 1.6 * uExpo;
  outColor = vec4(fogA(c, P), 1.);
}`;
// —— Ceiling: 0.6 × 1.2 m mineral tiles on a T-bar grid; lit only by bounce ——
const CEIL_FS = `
out vec4 outColor;
void main(){
  vec3 P = vW;
  vec3 E = surfE(uCeilLM, vUv1, P, vec3(0., -1., 0.));
  vec2 q = vec2((P.x + .3) / .6, (P.z - .6) / 1.2); vec2 tl = floor(q), tf = fract(q);
  vec3 alb = pow(vec3(.847, .839, .769), vec3(2.2)) * (.93 + .08 * h21(tl)) * (.94 + .1 * vn(P.xz * 7.));
  float k = h21(tl + 71.);
  if (k > .95) alb *= mix(vec3(.95, .9, .75), vec3(.8, .7, .5), smoothstep(.15, .5, length(tf - .5)));   // water-stained tiles
  alb *= 1. - .35 * smoothstep(.03, 0., min(min(tf.x, 1. - tf.x), min(tf.y, 1. - tf.y) * 2.));          // T-bar grid
  vec3 c = alb * E * uExpo;
  if (k > .996) c *= .05;   // a missing tile: a black hole
  outColor = vec4(fogA(c, P), 1.);
}`;
export const floorMat = () => mat(FLOOR_FS);
export const ceilMat = () => mat(CEIL_FS);

// —— Panels: diffuser × the panel's layer level; dead panels just catch a little bounce ——
const PANEL_VS = `
in float aLayer; out float vLayer; out vec3 vW; out vec2 vUv;
void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vUv = uv; vLayer = aLayer; gl_Position = projectionMatrix * viewMatrix * w; }`;
const PANEL_FS = `
precision highp float; precision highp sampler2DArray;
uniform float uL[32]; uniform float uExpo, uEmit, uFogD; uniform vec3 uFogCol; uniform sampler2DArray uFloorLM; uniform sampler2D map;
in float vLayer; in vec3 vW; in vec2 vUv; out vec4 outColor;
void main(){
  vec3 tx = texture(map, vUv).rgb;
  float lv = vLayer < -.5 ? 0. : uL[int(vLayer + .5)];
  float glow = smoothstep(.55, .95, dot(tx, vec3(.333)));
  vec3 c = mix(tx * .02, tx * vec3(1., .985, .93) * uEmit * lv, glow) + tx * .03 * lv;
  float d = length(vW - cameraPosition), fo = 1. - exp(-d * uFogD);
  outColor = vec4(mix(c * uExpo, uFogCol * .0, fo * .85), 1.);
}`;
export function panelMat(map) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, map: { value: map } }, vertexShader: PANEL_VS, fragmentShader: PANEL_FS, glslVersion: THREE.GLSL3 });
}

// —— Sensors: white domes lit from the floor map below, red LEDs that blink ——
const SENSOR_VS = `
in float aK; in float aLed; out float vK; out float vLedF; out vec3 vW; out vec3 vN;
void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vK = aK; vLedF = aLed; gl_Position = projectionMatrix * viewMatrix * w; }`;
const SENSOR_FS = COMMON.replace('in vec3 vW; in vec3 vN; in vec2 vUv; in vec2 vUv1;', 'in vec3 vW; in vec3 vN; in float vK; in float vLedF;') + `
out vec4 outColor;
void main(){
  vec3 P = vW;
  if (vLedF > .5) { float on = uLed[int(vK + .5)]; outColor = vec4(vec3(1., .07, .03) * (.05 + 16. * on) * uExpo, 1.); return; }
  vec3 E = floorE(P.xz) * (.35 + .25 * max(-normalize(vN).y, 0.));
  outColor = vec4(fogA(vec3(.62, .62, .58) * E * uExpo, P), 1.);
}`;
export function sensorMat() { return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: SENSOR_VS, fragmentShader: SENSOR_FS, glslVersion: THREE.GLSL3 }); }

// —— Moving things (the operator's shoes): lit from the floor map under them ——
const DYN_VS = `out vec3 vW; out vec3 vN; out vec2 vUv; out vec2 vUv1;
void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vUv1 = vec2(0.); gl_Position = projectionMatrix * viewMatrix * w; }`;
const DYN_FS = `
uniform vec3 color; uniform float shin, spec; out vec4 outColor;
void main(){
  vec3 N = normalize(vN); vec3 P = vW; vec3 V = normalize(cameraPosition - P);
  vec3 E = floorE(P.xz) * (.55 + .45 * max(N.y, 0.)) + floorE(P.xz) * .25;
  vec3 c = color * E * uExpo;
  if (spec > 0.) { vec3 Hh = normalize(vec3(0., 1., 0.) + V); c += vec3(1.) * pow(max(dot(N, Hh), 0.), shin) * spec * lum(E) * uExpo; }
  outColor = vec4(fogA(c, P), 1.);
}`;
export function dynMat(color, { shin = 0, spec = 0 } = {}) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, color: { value: new THREE.Color(color) }, shin: { value: shin }, spec: { value: spec } }, vertexShader: DYN_VS, fragmentShader: COMMON + DYN_FS, glslVersion: THREE.GLSL3 });
}

// —— The unlit far corridor: only fog ——
export function farMat() { return mat(`out vec4 outColor; void main(){ outColor = vec4(fogA(vec3(0.), vW), 1.); }`); }

// —— Light-map arrays: 10 layer passes + chroma, RGBA half floats ——
export async function loadMaps(base, set, size) {
  const n = NPASS + 1, per = size * size * 4, data = new Uint16Array(per * n);
  const files = [...Array(NPASS).keys()].map(p => `lm_${set}_p${p}.bin`).concat([`lm_${set}_chroma.bin`]);
  await Promise.all(files.map(async (fn, i) => { const r = await fetch(base + fn); if (!r.ok) { console.warn('light map missing (zeros): ' + fn); return; } data.set(new Uint16Array(await r.arrayBuffer()), i * per); }));
  const t = new THREE.DataArrayTexture(data, size, size, n);
  t.type = THREE.HalfFloatType; t.format = THREE.RGBAFormat; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
