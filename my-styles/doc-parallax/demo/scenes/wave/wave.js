// Endurance v2 · beat 6 · RECONSTRUCTION — the James Caird in the Scotia Sea, the night of 5–6 May 1916, and the giant wave.
// "At midnight I was at the tiller and suddenly noticed a line of clear sky between the south and south-west ... a moment later I realized
//  that what I had seen was not a rift in the clouds but the white crest of an enormous wave." (Shackleton, South, 1919)
// Module contract: build({ THREE, renderer, atmos, pxH }) → { scene, cam, state(u) }; state is a pure function of u (see ../_harness/harness.js).
// u: 0–0.7 spray clears · 0.7–1.6 the boat climbs a swell · 1.6 a pale line low ahead (the crest) · 3.4 a wall filling the frame ·
//    4.4–5.2 the crest throws forward and breaks toward the lens · 5.2 whiteout (the film's grade) · rendered sensibly to 5.8.
import { makeTextures } from './gen.js';
import { makeBoat } from './boat.js';
import { GLSL_WAVES, waveUniforms, setGiantUniforms, giantParams, surface, gerstnerDisp, giantDisp, GDIR } from './wavefn.js';
import { mulberry } from '/core/lib.js';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const nz = (x, s) => Math.sin(x * 1.13 + s) * .5 + Math.sin(x * 2.31 + s * 1.7) * .3 + Math.sin(x * 4.7 + s * 2.9) * .2;   // smooth pseudo-noise

// ---- look (linear HDR; the film's grade does the rest). Day for night: a dim overcast lit from above by a hidden moon, upper right.
const MOON = [0.42, 0.62, -0.66];
const LOOK = {
  zen: [.014, .019, .026], hor: [.030, .037, .044], glow: [.13, .145, .165],
  amb: [.12, .14, .165], key: [.26, .29, .33], water: [.004, .010, .013], sss: [.010, .042, .044], foam: [.8, .86, .92],
  fog: 1 / 175,
};
const ROWS = 640, COLS = 380, HALF = 50 * Math.PI / 180;

const SKY_GLSL = /* glsl */`
uniform sampler2D tNoise; uniform vec3 uMoon, uZen, uHor, uGlow; uniform vec2 uCloud;
vec3 skyCol(vec3 d, float detail){
  float yy = max(d.y, 0.);
  vec3 col = mix(uHor, uZen, smoothstep(0., .5, yy));
  vec2 cp = d.xz / (yy + .07);
  float c1 = texture2D(tNoise, cp * .03 + uCloud).r;
  float c2 = detail > .5 ? texture2D(tNoise, cp * .11 + uCloud * 2.6 + vec2(.37, .11)).g : .5;
  float dens = clamp((c1 - .5) * 3.6 + (c2 - .5) * 1.8 + .5, 0., 1.);
  float md = max(dot(d, uMoon), 0.);
  float glow = pow(md, 4.) * .5 + pow(md, 30.) * 1.2;
  float rim = smoothstep(.15, .5, dens) * (1. - smoothstep(.5, .9, dens));     // thin cloud edges catch the moon
  col *= mix(1.6, .45, dens);
  col += uGlow * glow * (mix(1.4, .25, dens) + rim * 1.2);
  col = mix(col, uHor * (1. + .5 * pow(max(dot(normalize(vec3(d.x, .25, d.z)), uMoon), 0.), 4.)), exp(-yy * 16.));
  return col;
}
vec3 fogCol(vec3 d){ return uHor * (1. + .5 * pow(max(dot(normalize(vec3(d.x, .25, d.z)), uMoon), 0.), 4.)); }
`;

const OCEAN_VS = /* glsl */`
${GLSL_WAVES}
uniform sampler2D tRows; uniform vec2 uO, uF; uniform float uHalf, uCols;
varying vec3 vW; varying vec3 vN; varying vec2 vX0; varying float vJ; varying vec4 vGi; varying float vHg;
void main(){
  int row = int(position.y + .5);
  float z = texelFetch(tRows, ivec2(row, 0), 0).r, z1 = texelFetch(tRows, ivec2(row + 1, 0), 0).r;
  float ang = position.x * uHalf;
  vec2 R = vec2(-uF.y, uF.x);
  vec2 p = uO + uF * z + R * (z * tan(ang));
  float cell = max(z1 - z, z * uHalf * 2. / uCols / cos(ang));
  vec3 Tx, Tz; float jac;
  vec3 D = gerstner(p, cell, Tx, Tz, jac);
  vec4 gi, gt; vec3 Gd = giantDisp(p, gi);
  float e = clamp(cell * .6, .05, 2.);
  vec3 Gx = giantDisp(p + vec2(e, 0.), gt), Gz = giantDisp(p + vec2(0., e), gt);
  Tx += (Gx - Gd) / e; Tz += (Gz - Gd) / e;
  vec3 W = vec3(p.x, 0., p.y) + D + Gd;
  vW = W; vN = cross(Tz, Tx); vX0 = p; vJ = Tx.x * Tz.z - Tz.x * Tx.z; vGi = gi; vHg = D.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(W, 1.);
}`;
const OCEAN_FS = /* glsl */`
${SKY_GLSL}
uniform sampler2D tRip; uniform float uT, uFogD; uniform vec3 uAmb, uKey, uWater, uSSS, uFoam;
uniform vec4 uG0, uG3; uniform vec4 uGF;   // giant foam: crest, face streaks, back foam, spray mist
uniform vec4 uBoat;                          // boat x, z, heading (sin, cos)
varying vec3 vW; varying vec3 vN; varying vec2 vX0; varying float vJ; varying vec4 vGi; varying float vHg;
void main(){
  vec3 Vv = cameraPosition - vW; float dist = length(Vv); vec3 V = Vv / dist;
  vec3 N = normalize(vN);
  float near = exp(-dist / 70.);
  // small waves: two scales of the ripple map, carried with the water (Lagrangian coordinates) and the wind
  vec4 r1 = texture2D(tRip, vX0 / 19. + vec2(.003, -.021) * uT);
  vec4 r2 = texture2D(tRip, vX0 / 5.7 + vec2(-.011, -.047) * uT);
  vec2 sl = (r1.xy - .5) * 1.1 + (r2.xy - .5) * .75;
  N = normalize(N - vec3(sl.x, 0., sl.y) * (.25 + .75 * near));
  float ndv = max(dot(N, V), 0.);
  float F = .02 + .98 * pow(1. - ndv, 5.);
  vec3 Rf = reflect(-V, N); Rf.y = abs(Rf.y) + .02; Rf = normalize(Rf);
  vec3 refl = skyCol(Rf, 0.);
  // water body: light scattered up from inside, a little more where the surface faces the sky
  vec3 amb = uAmb * (.6 + .4 * clamp(N.y, 0., 1.));
  vec3 body = uWater * (.5 + .5 * clamp(N.y, 0., 1.));
  // subsurface: thin crests, and the upper face of the giant wave, glow when the sky is behind them
  float xi = vGi.x, ge = vGi.y, gs = vGi.z, gy = vGi.w;
  float thin = clamp(vHg / 3.2, 0., 1.) * .6 + smoothstep(.6, .92, gy) * (1. - smoothstep(.97, 1.03, gy)) * smoothstep(-2., 3., xi) * 1.4 + gs * smoothstep(.5, .9, gy);
  float back = pow(clamp(dot(-V, normalize(vec3(uMoon.x, .15, uMoon.z))) * .5 + .5, 0., 1.), 3.);
  vec3 col = body + uSSS * thin * (.25 + 1.4 * back);
  col = mix(col, refl, F);
  // ---- foam
  vec2 q = vX0 + vec2(.0, .55) * uT;                        // foam drifts downwind (+z)
  float fA = texture2D(tNoise, q / 8.5).b;
  float fB = texture2D(tNoise, q / 3.1 + .5).b;
  vec2 wq = vec2(q.x / 2.2, q.y / 38.);                      // wind streaks: long along the wind
  float fS = texture2D(tNoise, wq * .25).a;
  float cap = smoothstep(.78, .3, vJ);                       // crest compression → whitecaps
  float wc = cap * smoothstep(.1, .75, fA * .7 + fB * .5 + cap * .35 - .2);
  float streak = smoothstep(.45, .85, fS) * smoothstep(.35, .7, fA) * .65;
  // the giant wave: torn white crest, foam streaks running down its face, a whitewater avalanche once it breaks
  vec2 gd = uG3.yz, gp = vec2(gd.y, -gd.x);
  float along = dot(vX0, gp);
  float fF = texture2D(tNoise, vec2(along / 11., xi / 95. - uT * .015)).a;
  float fC = texture2D(tNoise, vec2(along / 9., xi / 14.) + .3).b;
  float crest = smoothstep(.7, .93, gy) * smoothstep(.12, .4, ge) * smoothstep(-9., -2., xi);
  float g1 = crest * mix(1., smoothstep(.2, .65, fC * .7 + fA * .5 + crest * .45 - .15), uGF.y) * uGF.x;
  float onFace = smoothstep(-1.5, 1.5, xi) * (1. - smoothstep(uG0.z * 1.1, uG0.z * 2.2, xi)) * smoothstep(.12, .45, gy) * smoothstep(.25, .6, ge);
  float g2 = onFace * smoothstep(.38, .85, fF * (.6 + .8 * fA)) * .7 * uGF.y;
  float g3 = gs * smoothstep(1.02 - gs * 1.25, 1.12 - gs * 1.25, gy) * smoothstep(.15, .5, fA + fB * .5 + gs * .6);
  float g4 = (1. - smoothstep(-30., -4., xi)) * smoothstep(-80., -30., xi) * ge * smoothstep(.45, .8, fA) * .6 * uGF.z;
  float foam = clamp(max(max(wc, streak), max(max(g1, g2), max(g3, g4))), 0., 1.);
  // wash around the hull
  vec2 bq = vW.xz - uBoat.xy; vec2 bl = vec2(dot(bq, vec2(uBoat.w, -uBoat.z)), dot(bq, uBoat.zw));
  float hd = length(vec2(bl.x / 1.15, bl.y / 3.75));
  foam = max(foam, smoothstep(1.7, 1.0, hd) * smoothstep(.3, .65, fB + fA * .4) * .85);
  float ndl = max(dot(N, uMoon), 0.);
  vec3 foamCol = uFoam * (amb * 1.6 + uKey * ndl + uGlow * (.35 + 2.8 * crest) * back * (.35 + .65 * (1. - ndv)));
  col = mix(col, foamCol, foam);
  // fog to the horizon, plus spray mist hanging low over the water
  float fog = 1. - exp(-dist * uFogD * (1. + uGF.w * 2.5));
  float mist = (1. - exp(-dist / 90.)) * exp(-max(vW.y + 2., 0.) / 5.) * .22;
  vec3 fc = mix(fogCol(-V), uFoam * .55, uGF.w * .8);
  col = mix(col, fc, clamp(fog + mist, 0., 1.));
  gl_FragColor = vec4(col, 1.);
}`;
const SKY_VS = `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position.z = gl_Position.w * .99999; }`;
const SKY_FS = `${SKY_GLSL}\nvarying vec3 vD; void main(){ gl_FragColor = vec4(skyCol(normalize(vD), 1.), 1.); }`;

// spray blown off the giant crest (world space): each particle rides the crest it left, rises, blows forward and falls; pure function of u
const SPRAY_VS = /* glsl */`
${GLSL_WAVES}
attribute vec4 seed;
uniform float uPx, uAmt, uThrow;
varying float vA; varying float vS;
void main(){
  vec2 gd = uG3.yz, gp = vec2(gd.y, -gd.x);
  float zeta = uG2.x + (seed.x - .5) * 2. * 150. * (.35 + .65 * seed.x * (1. - seed.x) * 4.);
  float dz = zeta - uG2.x;
  float life = 1.4 + seed.z * 1.6;
  float age = fract(uT / life + seed.y) * life, a = age / life;
  float xi = -1. + seed.w * 3.;
  vec2 p0 = gp * zeta + gd * (uG0.x + xi - uG2.w * dz * dz);
  vec4 gi; vec3 Gd = giantDisp(p0, gi);
  vec3 Tx, Tz; float jac; vec3 D = gerstner(p0, 4., Tx, Tz, jac);
  vec3 P = vec3(p0.x, 0., p0.y) + D + Gd;
  float e = gi.y, s = gi.z;
  float fw = (3.5 + 9. * uThrow * s) * age + seed.w * 2.;
  float up = (4. + 5. * seed.z) * age - 3.2 * age * age - 9. * uThrow * s * age * age * .5;
  vec3 side = vec3(gp.x, 0., gp.y) * (seed.y - .5) * 6. * age;
  P += vec3(gd.x, 0., gd.y) * fw + vec3(0., up, 0.) + side;
  vec4 mv = modelViewMatrix * vec4(P, 1.);
  float size = (.12 + .45 * a + .3 * seed.z) * (1. + 2. * uThrow * s);
  float px = size * uPx / max(-mv.z, .5);
  float w = smoothstep(.6, .95, e) * smoothstep(.0, .12, a) * (1. - smoothstep(.45, 1., a)) * uAmt * .45;
  vA = w * min(1., 14. / max(px, 1.)) * (.55 + .45 * seed.z) * clamp(px / 2., 0., 1.) * .7;
  vS = seed.z;
  gl_PointSize = clamp(px, 1., 260.);
  gl_Position = projectionMatrix * mv;
  if (w < .002 || mv.z > -.3) gl_Position = vec4(2., 2., 2., 1.);
}`;
const SPRAY_FS = /* glsl */`
uniform vec3 uCol; uniform sampler2D tNoise;
varying float vA; varying float vS;
void main(){
  vec2 c = gl_PointCoord - .5; float r = length(c) * 2.;
  float n = texture2D(tNoise, gl_PointCoord * .35 + vS * 7.).r;
  float a = (1. - smoothstep(.15, 1., r)) * vA * (.5 + n);
  if (a < .002) discard;
  gl_FragColor = vec4(uCol * a, a);
}`;
// wind-torn spray "smoking" off the giant crest: ribbons along the crest that rise and blow forward, textured with advected noise
const SHEET_VS = /* glsl */`
${GLSL_WAVES}
uniform float uLen, uAmt, uThrow, uRise;
varying vec2 vQ; varying float vH; varying float vE; varying float vS;
void main(){
  vec2 gd = uG3.yz, gp = vec2(gd.y, -gd.x);
  float zeta = uG2.x + (position.x - .5) * uLen, dz = zeta - uG2.x;
  vec2 p0 = gp * zeta + gd * (uG0.x + .4 - uG2.w * dz * dz);
  vec4 gi; vec3 Gd = giantDisp(p0, gi);
  vec3 Tx, Tz; float jac; vec3 D = gerstner(p0, 4., Tx, Tz, jac);
  vec3 base = vec3(p0.x, 0., p0.y) + D + Gd;
  float e = gi.y, h = position.y, th = uThrow * gi.z;
  float Hs = (1.5 + 10. * e * e) * uRise * (1. + 1.4 * th);
  vec3 P = base + vec3(0., h * Hs * (1. - .35 * th * h), 0.) + vec3(gd.x, 0., gd.y) * (h * Hs * (.75 + 1.8 * th) - 1.);
  vQ = vec2(zeta / 9., h * Hs / 7.); vH = h; vE = e; vS = gi.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.);
}`;
const SHEET_FS = /* glsl */`
uniform sampler2D tNoise; uniform float uT, uAmt, uK; uniform vec3 uCol, uMoon;
varying vec2 vQ; varying float vH; varying float vE; varying float vS;
void main(){
  vec2 q = vQ + vec2(uK * 3.1, -uT * 1.2);
  float n = texture2D(tNoise, q * vec2(.11, .16)).r;
  float n2 = texture2D(tNoise, q * vec2(.4, .5) + vec2(uK, -uT * .7)).g;
  float n3 = texture2D(tNoise, q * vec2(.05, .3) + vec2(.13, -uT * .25)).a;
  float d = n * .7 + n2 * .45 + n3 * .25 - vH * .35;
  float prof = smoothstep(0., .06, vH) * (1. - smoothstep(.15, 1., vH));
  float a = smoothstep(.5, .95, d) * prof * smoothstep(.25, .7, vE) * uAmt;
  a = min(a, .9);
  if (a < .003) discard;
  gl_FragColor = vec4(uCol * (.75 + .5 * (1. - vH)) * a, a);
}`;
// spindrift torn off ordinary whitecaps, blowing toward the camera (world space, a tiled field around the camera)
const DRIFT_VS = /* glsl */`
${GLSL_WAVES}
attribute vec4 seed;
uniform float uPx, uAmt; uniform vec2 uC;   // camera xz
varying float vA; varying float vS;
void main(){
  float T = 90.;
  vec2 base = (seed.xy - .5) * T;
  float life = 1. + seed.z * 1.3, age = fract(uT / life + seed.w) * life, a = age / life;
  float born = uT - age;
  vec2 cell = floor((uC - base) / T + .5);
  vec2 p0 = base + cell * T + vec2(0., -6.);
  vec3 Tx, Tz; float jac; vec3 D = gerstner(p0, 2.5, Tx, Tz, jac);
  vec4 gi; vec3 Gd = giantDisp(p0, gi);
  vec3 P = vec3(p0.x, 0., p0.y) + D + Gd;
  float crest = smoothstep(.75, .35, jac) * smoothstep(.2, 1.2, D.y);
  P += vec3(.6, 0., 1.) * (5.5 + 4. * seed.z) * age + vec3(0., 1.6 * age - 1.4 * age * age + .2, 0.);
  vec4 mv = modelViewMatrix * vec4(P, 1.);
  float size = .25 + .9 * a + .4 * seed.z;
  float px = size * uPx / max(-mv.z, .5);
  float w = crest * smoothstep(0., .15, a) * (1. - smoothstep(.4, 1., a)) * uAmt;
  vA = w * min(1., 20. / max(px, 1.)) * clamp(px / 2., 0., 1.);
  vS = seed.z;
  gl_PointSize = clamp(px, 1., 200.);
  gl_Position = projectionMatrix * mv;
  if (w < .002 || mv.z > -.3) gl_Position = vec4(2., 2., 2., 1.);
}`;
// a wall of spray across the lens (start: clearing; end: the breaking crest arriving)
const VEIL_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const VEIL_FS = /* glsl */`
uniform sampler2D tNoise; uniform float uAmt, uT, uK; uniform vec3 uCol; uniform vec2 uScroll;
varying vec2 vUv;
void main(){
  vec2 q = vUv * vec2(1.6, .9) + uScroll * uT + uK;
  float n = texture2D(tNoise, q * .45).r * .6 + texture2D(tNoise, q * 1.3 + .2).g * .4;
  float a = smoothstep(1. - uAmt, 1.3 - uAmt, n) * sqrt(uAmt);
  if (a < .003) discard;
  gl_FragColor = vec4(uCol * a, a);
}`;

export async function build({ THREE, renderer, atmos, pxH }) {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, .2, 6000); scene.add(cam);
  const TX = makeTextures(THREE, renderer);
  const V3 = a => new THREE.Vector3(...a);
  const SKYU = { tNoise: { value: TX.noise }, uMoon: { value: V3(MOON).normalize() }, uZen: { value: V3(LOOK.zen) }, uHor: { value: V3(LOOK.hor) }, uGlow: { value: V3(LOOK.glow) }, uCloud: { value: new THREE.Vector2() } };

  // ---- sky dome (follows the camera)
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), new THREE.ShaderMaterial({ uniforms: SKYU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  // ---- environment for the boat's wet surfaces: the same sky, prefiltered
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), new THREE.ShaderMaterial({ uniforms: SKYU, vertexShader: SKY_VS.replace('gl_Position.z = gl_Position.w * .99999;', ''), fragmentShader: `${SKY_GLSL}\nvarying vec3 vD; void main(){ vec3 d = normalize(vD); vec3 c = d.y > 0. ? skyCol(d, 1.) : mix(fogCol(d), uHor * .25, clamp(-d.y * 3., 0., 1.)); gl_FragColor = vec4(c, 1.); }`, side: THREE.BackSide }));
  envScene.add(envSky);
  const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromScene(envScene, 0, .1, 300).texture; pm.dispose();

  // ---- ocean: a camera-anchored fan grid (rows at constant forward distance, equal-angle columns); rows crowd around the giant crest
  const U = { ...waveUniforms(THREE), ...SKYU, tRip: { value: TX.ripple }, uFogD: { value: LOOK.fog }, uAmb: { value: V3(LOOK.amb) }, uKey: { value: V3(LOOK.key) },
    uWater: { value: V3(LOOK.water) }, uSSS: { value: V3(LOOK.sss) }, uFoam: { value: V3(LOOK.foam) }, uGF: { value: new THREE.Vector4() }, uBoat: { value: new THREE.Vector4() },
    uO: { value: new THREE.Vector2() }, uF: { value: new THREE.Vector2(0, -1) }, uHalf: { value: HALF }, uCols: { value: COLS } };
  const rowData = new Float32Array(ROWS + 2);
  const rowTex = new THREE.DataTexture(rowData, ROWS + 2, 1, THREE.RedFormat, THREE.FloatType); rowTex.needsUpdate = true;
  U.tRows = { value: rowTex };
  {
    const pos = new Float32Array((ROWS + 1) * (COLS + 1) * 3), idx = new Uint32Array(ROWS * COLS * 6);
    let k = 0; for (let r = 0; r <= ROWS; r++) for (let c = 0; c <= COLS; c++) { pos[k++] = -1 + 2 * c / COLS; pos[k++] = r; pos[k++] = 0; }
    k = 0; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const a = r * (COLS + 1) + c, b = a + COLS + 1; idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const ocean = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: U, vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS, side: THREE.DoubleSide }));
    ocean.frustumCulled = false; scene.add(ocean);
  }
  // rows: density ∝ 1/(z+4) (log spacing to the horizon) plus a band around the giant crest
  const NZ = 4096, zs = new Float64Array(NZ), cdf = new Float64Array(NZ), Z0 = .3, Z1 = 3600;
  for (let i = 0; i < NZ; i++) zs[i] = Z0 + (Z1 - Z0) * (Math.exp(i / (NZ - 1) * Math.log(1 + (Z1 - Z0) / 2)) - 1) / ((Z1 - Z0) / 2);
  function setRows(zw, beta) {
    const sig = .22 * Math.max(zw, 0) + 7, base = Math.log((Z1 + 4) / (Z0 + 4));
    cdf[0] = 0;
    for (let i = 1; i < NZ; i++) {
      const zm = (zs[i] + zs[i - 1]) / 2, dzz = zs[i] - zs[i - 1];
      const rho = (1 - beta) / ((zm + 4) * base) + beta * Math.exp(-.5 * ((zm - zw) / sig) ** 2) / (sig * 2.5066);
      cdf[i] = cdf[i - 1] + rho * dzz;
    }
    const tot = cdf[NZ - 1]; let j = 1;
    for (let r = 0; r <= ROWS; r++) {
      const s = tot * r / ROWS;
      while (j < NZ - 1 && cdf[j] < s) j++;
      const f = (s - cdf[j - 1]) / Math.max(cdf[j] - cdf[j - 1], 1e-12);
      rowData[r] = zs[j - 1] + (zs[j] - zs[j - 1]) * Math.min(1, Math.max(0, f));
    }
    rowData[ROWS + 1] = rowData[ROWS] * 1.01;
    rowTex.needsUpdate = true;
  }

  // ---- the boat
  const boat = makeBoat(THREE, env); scene.add(boat);
  scene.add(new THREE.HemisphereLight(new THREE.Color(.5, .58, .66), new THREE.Color(.03, .05, .06), 1.1));
  const moon = new THREE.DirectionalLight(new THREE.Color(.62, .68, .78), 1.6); moon.position.set(...MOON.map(v => v * 100)); scene.add(moon); scene.add(moon.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(.42, .48, .56), .45); fill.position.set(-40, 45, 90); scene.add(fill); scene.add(fill.target);

  // ---- spray off the giant crest, spindrift off the whitecaps
  const R = mulberry(77);
  const pointsMat = (vs, n, extra) => {
    const seed = new Float32Array(n * 4); for (let i = 0; i < seed.length; i++) seed[i] = R();
    const g = new THREE.BufferGeometry(); g.setAttribute('seed', new THREE.BufferAttribute(seed, 4)); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const m = new THREE.ShaderMaterial({ uniforms: { ...U, uPx: { value: 1000 }, uAmt: { value: 0 }, uCol: { value: V3([.55, .6, .64]) }, ...extra }, vertexShader: vs, fragmentShader: SPRAY_FS, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 20; scene.add(p); return p;
  };
  const spray = pointsMat(SPRAY_VS, 2600, { uThrow: { value: 0 } });
  const sheets = [0, 1, 2].map(i => {
    const g = new THREE.PlaneGeometry(1, 1, 260, 12); g.translate(.5, .5, 0);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...U, uLen: { value: 420 + i * 40 }, uAmt: { value: 0 }, uThrow: { value: 0 }, uRise: { value: 1 }, uK: { value: i * .37 }, uCol: { value: V3([.62, .68, .74]) } },
      vertexShader: SHEET_VS, fragmentShader: SHEET_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    m.frustumCulled = false; m.renderOrder = 15 + i; scene.add(m); return m;
  });
  const drift = pointsMat(DRIFT_VS, 4500, { uC: { value: new THREE.Vector2() } });

  // ---- lens-side weather (view space, per-particle depth of field): sleet, and big spray drops near the lens
  const sleet = atmos(cam, { n: 5000, z0: .6, z1: 26, size: .009, color: '#4a535c', opacity: .6, wind: [-6.5, -2.5], fall: 1.4, seed: 9 });
  const drops = atmos(cam, { n: 300, z0: .35, z1: 4, size: .03, color: '#56606a', opacity: .35, wind: [-9, -3], fall: .6, seed: 23 });
  // spray veils across the lens
  const veils = [1.2, 3.5, 9].map((d, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: { tNoise: { value: TX.noise }, uAmt: { value: 0 }, uT: { value: 0 }, uK: { value: i * .37 }, uCol: { value: V3([1.05, 1.1, 1.15]) }, uScroll: { value: new THREE.Vector2(-.35 - i * .1, .05) } },
      vertexShader: VEIL_VS, fragmentShader: VEIL_FS, transparent: true, depthWrite: false, depthTest: i > 0, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    m.position.z = -d; m.renderOrder = 60 + (2 - i); m.frustumCulled = false; m.userData.d = d; cam.add(m); return m;
  });

  // ---- motion: the boat holds her head toward the sea (bow ~10° right of −z), drifting ahead slowly; the camera chases off her port quarter
  const HEAD = [Math.sin(.17), -Math.cos(.17)], RIGHT = [-HEAD[1], HEAD[0]];
  const boatBase = u => [HEAD[0] * 1.1 * u, HEAD[1] * 1.1 * u];
  const tmpM = new THREE.Matrix4(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
  function boatPose(u, P) {
    const [bx, bz] = boatBase(u), S = (f, s) => surface(bx + HEAD[0] * f + RIGHT[0] * s, bz + HEAD[1] * f + RIGHT[1] * s, u, P, 10);
    const bow = S(2.9, 0), st = S(-2.9, 0), pt = S(0, -.85), sb = S(0, .85);
    const c = [0, 1, 2].map(i => (bow[i] + st[i] + pt[i] + sb[i]) / 4);
    vz.set(st[0] - bow[0], st[1] - bow[1], st[2] - bow[2]).normalize();          // local +z = toward the stern
    vx.set(sb[0] - pt[0], sb[1] - pt[1], sb[2] - pt[2]); vx.addScaledVector(vz, -vx.dot(vz)).normalize();
    vy.crossVectors(vz, vx).normalize();
    tmpM.makeBasis(vx, vy, vz);
    const q = new THREE.Quaternion().setFromRotationMatrix(tmpM);
    const roll = .07 * nz(u * 1.25, 3) + .03 * Math.sin(u * 2.9);                // the hull rolls more than the sea's slope alone
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    return { pos: new THREE.Vector3(c[0], c[1] - .06, c[2]), q };
  }

  function camAt(u, P, B) {
    const back = lerp(12.5, 14.4, sm(1.4, 3.4, u)) - 3 * sm(3.5, 4.7, u), side = lerp(3.0, 4.0, sm(1.4, 3.6, u));
    const [bx, bz] = boatBase(u);
    const cx0 = bx - HEAD[0] * back - RIGHT[0] * side, cz0 = bz - HEAD[1] * back - RIGHT[1] * side;
    const g = gerstnerDisp(cx0, cz0, u, 30), gg = giantDisp(cx0, cz0, P);
    const exact = surface(cx0, cz0, u, P, 0)[1];
    let y = g[1] * .8 + gg[1] + lerp(2.9, 3.3, sm(1.4, 3.6, u)) - .5 * sm(3.6, 4.6, u) + .15 * nz(u * 2.1, 1);
    y = Math.max(y, exact + 1.2, g[1] + gg[1] + 1.2);
    const pos = [cx0 + g[0] * .8 + gg[0] * .6, y, cz0 + g[2] * .8 + gg[2] * .6];
    const fov = lerp(40, 46, sm(1.6, 3.6, u)) + lerp(0, 8, sm(3.8, 5.0, u));
    const sL = gerstnerDisp(cx0 - RIGHT[0] * 4, cz0 - RIGHT[1] * 4, u, 30)[1], sR = gerstnerDisp(cx0 + RIGHT[0] * 4, cz0 + RIGHT[1] * 4, u, 30)[1];
    const roll = Math.atan2(sR - sL, 8) * .45 + .035 * nz(u * 1.7, 4);
    return { pos, fov, roll };
  }
  // raw aim (pitch, yaw) at u: early the boat sits ~72% down with the horizon high; later the crest sits near the top while the boat stays in frame
  function aimAt(u) {
    const P = giantParams(u), B = boatPose(u, P), C = camAt(u, P, B), cp = C.pos;
    const tv = Math.tan(C.fov * Math.PI / 360), th = tv * 16 / 9;
    const dx = B.pos.x - cp[0], dz = B.pos.z - cp[2], dh = Math.hypot(dx, dz);
    const thB = Math.atan2(B.pos.y + .6 - cp[1], dh), yawB = Math.atan2(dx, -dz);
    const early = .55 * (thB + Math.atan(.45 * tv)) + .45 * (-.07);
    // the giant crest straight ahead: Lagrangian xi = 0 on the boat's line of sight
    const fx = dx / dh, fz = dz / dh, fd = fx * GDIR[0] + fz * GDIR[1];
    let late = early;
    if (fd < -.2) {
      const zc = (P.xi0 - (cp[0] * GDIR[0] + cp[2] * GDIR[1])) / fd;
      const cr = surface(cp[0] + fx * zc, cp[2] + fz * zc, u, P, 30);
      const thC = Math.atan2(cr[1] - cp[1], Math.max(Math.hypot(cr[0] - cp[0], cr[2] - cp[2]), 3));
      late = Math.min(thC - Math.atan(.68 * tv), thB + Math.atan(.8 * tv));
    }
    const pitch = lerp(early, late, sm(1.8, 3.0, u));
    const yaw = yawB - Math.atan(lerp(.26, .34, sm(1.5, 3.5, u)) * th);
    return [pitch, yaw];
  }

  function state(u) {
    const P = giantParams(u);
    setGiantUniforms(U, P); U.uT.value = u;
    // giant wave foam ramps: crest whitening, face streaks, residual foam, spray mist
    U.uGF.value.set(sm(.8, 2.0, u), sm(2.0, 3.6, u), sm(1.5, 3.5, u), sm(4.6, 5.4, u));
    SKYU.uCloud.value.set(.012 * u, -.03 * u);

    // boat
    const B = boatPose(u, P);
    boat.position.copy(B.pos); boat.quaternion.copy(B.q); boat.userData.update(u);
    const hd = new THREE.Vector3(0, 0, -1).applyQuaternion(B.q);
    const hl = Math.hypot(hd.x, hd.z) || 1;
    U.uBoat.value.set(B.pos.x, B.pos.z, hd.x / hl, -hd.z / hl);

    // camera: off the port quarter, low; rides the swell (and the giant's trough); framing keeps the boat in and the crest near the top
    const C = camAt(u, P, B);
    const camPos = C.pos, fov = C.fov, roll = C.roll;
    let pitch = 0, yaw = 0; const K = [-3, -2, -1, 0, 1, 2, 3], KW = [.05, .1, .2, .3, .2, .1, .05];
    for (let i = 0; i < K.length; i++) { const a = aimAt(u + K[i] * .07); pitch += a[0] * KW[i]; yaw += a[1] * KW[i]; }
    const shake = .0025 + .006 * sm(4.2, 5.2, u);
    pitch += shake * nz(u * 9.3, 2); yaw += shake * nz(u * 8.1, 5);
    const look = [camPos[0] + 60 * Math.sin(yaw) * Math.cos(pitch), camPos[1] + 60 * Math.sin(pitch), camPos[2] - 60 * Math.cos(yaw) * Math.cos(pitch)];

    // ocean grid anchored to the camera
    const F = [look[0] - camPos[0], look[2] - camPos[2]], fl = Math.hypot(F[0], F[1]); F[0] /= fl; F[1] /= fl;
    const O = [camPos[0] - F[0] * 7, camPos[2] - F[1] * 7];
    U.uO.value.set(O[0], O[1]); U.uF.value.set(F[0], F[1]);
    const fdg = F[0] * GDIR[0] + F[1] * GDIR[1];
    const zw = fdg < -.2 ? (P.xi0 - (O[0] * GDIR[0] + O[1] * GDIR[1])) / fdg : 1e4;
    setRows(Math.max(zw - .2 * P.wf, 0), zw < 400 ? .42 : .05);
    sky.position.set(camPos[0], camPos[1], camPos[2]);

    // particles
    cam.fov = fov; cam.aspect = 16 / 9; cam.updateProjectionMatrix();
    const pxScale = pxH / (2 * Math.tan(fov * Math.PI / 360));
    spray.material.uniforms.uPx.value = pxScale; spray.material.uniforms.uAmt.value = sm(2.4, 3.8, u);
    sheets.forEach((m, i) => { const S = m.material.uniforms; S.uAmt.value = Math.max(i === 0 ? .55 * sm(1.2, 1.8, u) : 0, sm(1.9 + i * .2, 3.4, u) * (1 - i * .18)); S.uThrow.value = sm(4.3, 5.3, u); S.uRise.value = lerp(.22, 1, sm(1.8, 3.6, u)) * (1 + i * .3); });
    spray.material.uniforms.uThrow.value = sm(4.3, 5.2, u);
    drift.material.uniforms.uPx.value = pxScale; drift.material.uniforms.uAmt.value = 1; drift.material.uniforms.uC.value.set(camPos[0], camPos[2]);
    const t = u + .6, camTravel = [camPos[0] * .7, camPos[1]];
    const focus = Math.max(3, Math.hypot(B.pos.x - camPos[0], B.pos.y - camPos[1], B.pos.z - camPos[2]));
    sleet.update(t, { focus, aper: .55, density: .55 + .2 * sm(4, 5.2, u), gust: .4 + .6 * sm(4.2, 5.2, u), cam: camTravel, pxH });
    drops.update(t, { focus, aper: .55, density: .08 + .6 * (1 - sm(-.2, .8, u)) + .6 * sm(4.4, 5.3, u), gust: .5, cam: camTravel, pxH });
    const vAmt = [1 - sm(-.3, .75, u), 1 - sm(-.3, .6, u), 1 - sm(-.4, .5, u)].map((a, i) => Math.max(a * (1 - i * .15), sm(4.7 + i * .08, 5.35 + i * .08, u)));
    veils.forEach((m, i) => {
      const d = m.userData.d, h = 2 * d * Math.tan(fov * Math.PI / 360) * 1.25;
      m.scale.set(h * 16 / 9, h, 1); m.material.uniforms.uAmt.value = vAmt[i]; m.material.uniforms.uT.value = u; m.visible = vAmt[i] > .01;
    });

    return {
      cam: { pos: camPos, look, fov, roll },
      focus, aper: 0, maxCoc: 0,              // no screen-space DoF (it costs ~3.7 s/frame here); the lens-side particles carry their own
      bloom: { strength: .42, radius: .55, threshold: .55 },
      grade: { expo: 1 + .55 * sm(4.8, 5.4, u) + .35 * (1 - sm(-.2, .6, u)), sat: .82, contrast: .2, vig: .42, lift: [.004, .008, .013], gain: [.97, 1.0, 1.04] },
    };
  }
  return { scene, cam, state };
}
