// The sea, as one analytic function of (Lagrangian point x0, time u), shared by the GPU (GLSL below) and the CPU (boat + camera placement).
//   P(x0, u) = (x0.x, 0, x0.z) + Σ Gerstner(x0, u) + Giant(x0, u)
// Coordinates: y up, metres. The sea (and the giant wave) run toward +z; the boat heads into them (toward −z).
// Everything is a pure function of u (no simulation state), so any frame can be rendered alone.

const G = 9.81;
// ---- the storm sea: main swell from ahead, a cross-sea from the old north-westerly gale (South: "a tremendous cross-sea"), wind sea, chop
// [heading of travel (deg, 0 = +z, positive turns toward +x), wavelength (m), amplitude (m), steepness Q (0..1 of the no-fold limit), phase]
const SPEC = [
  [0, 118, 2.35, .55, 0.0],
  [-14, 86, 1.55, .6, 2.1],
  [52, 64, 1.05, .55, 4.0],     // cross-sea
  [11, 47, .8, .62, 1.3],
  [-30, 33, .52, .65, 5.2],
  [24, 24, .36, .7, 0.7],
  [62, 17, .2, .6, 3.3],
  [-8, 12.5, .17, .75, 2.4],
  [35, 8.7, .1, .7, 1.1],
  [-42, 6.3, .07, .7, 4.4],
  [14, 4.6, .05, .7, 0.3],
  [-20, 3.4, .035, .7, 2.9],
];
export const WAVES = SPEC.map(([deg, lam, A, Q, ph]) => {
  const a = deg * Math.PI / 180, k = 2 * Math.PI / lam;
  return { dx: Math.sin(a), dz: Math.cos(a), k, A, w: Math.sqrt(G * k), ph, Q: Q / (k * A * SPEC.length * .55), lam };
});
export const NW = WAVES.length;

// ---- the giant wave: a travelling solitary swell with a steep face; late in the shot the crest curls over (a rotation of the crest about a pivot in front of it)
// Travel direction: mostly +z, slightly toward −x so the crest line is oblique to the camera (its high, near end on the right of frame).
const GA = -35 * Math.PI / 180;
export const GDIR = [Math.sin(GA), Math.cos(GA)];          // travel direction (xz)
export const GPERP = [GDIR[1], -GDIR[0]];                 // along the crest
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
// keyed over u (piecewise-smooth): crest position along GDIR, height, widths, lean, curl
export function giantParams(u) {
  // crest position along GDIR (at the envelope centre): far out and low at u 1.6, closing fast as it rises; the lip reaches the boat near u ≈ 4.9
  const xi0 = -5.9 - 26 * (4.9 - u) - 42 * (1 - sm(1.0, 3.7, u));
  const grow = sm(.6, 3.6, u);
  const H = lerp(7.5, 18.5, grow) + 1.5 * sm(3.6, 5.0, u);  // peak height above mean sea
  const wf = lerp(15, 8.5, sm(0.5, 4.2, u));                // front half-width (steepens)
  const wb = lerp(34, 26, grow);                            // back half-width
  const T = lerp(1.2, 3.0, grow);                           // trough in front (the sea drawn into the wave)
  const L = lerp(1.0, 5.2, sm(1.0, 4.4, u));                // forward lean of the upper face
  const curl = sm(4.2, 5.7, u);                             // breaking: 0 → 1
  return {
    xi0, H, wf, wb, T, L, curl,
    phi: 8.5 * curl,                                        // lip jet: forward throw of the crest (m) at the envelope peak
    zc: 34, zs: 72, emin: .3,                               // envelope along the crest: centre (on GPERP), width, floor
    kap: 1 / 520,                                           // crest curvature (the ends lag)
    peel: 70,                                               // m/s: how fast the break spreads along the crest
    u,
  };
}
// cross-section: Lagrangian xi (+ ahead of the crest), local height scale e (envelope), local curl stage s → [dX (along GDIR), Y]
export function giantXY(xi, e, s, P) {
  const H = P.H * e;
  const w = lerp(P.wb, P.wf, sm(-5, 5, xi));
  let y = H * Math.exp(-(xi * xi) / (w * w)) - P.T * e * Math.exp(-((xi - 1.6 * P.wf - 6) ** 2) / (12 * 12));
  let x = xi + P.L * e * Math.exp(-((xi + 2) ** 2) / 64);
  if (s > 0) {   // the lip: the crest is thrown forward as a tongue that droops toward the trough
    const j = P.phi * s * e;
    x += j * Math.exp(-((xi - 0.6) ** 2) / 5.8);
    y -= j * 0.75 * s * Math.exp(-((xi - 1.8) ** 2) / 4.4);
  }
  return [x - xi, y];
}
// the giant wave's displacement at Lagrangian x0 (xz)
export function giantDisp(x, z, P) {
  const along = x * GPERP[0] + z * GPERP[1], dz = along - P.zc;
  const e = P.emin + (1 - P.emin) * Math.exp(-(dz * dz) / (P.zs * P.zs));
  const xi = x * GDIR[0] + z * GDIR[1] - P.xi0 + P.kap * dz * dz;
  const s = Math.min(1, Math.max(0, P.curl * 1.15 - Math.abs(dz) / (P.peel * 1.6)));
  const [dX, Y] = giantXY(xi, e, s, P);
  return [GDIR[0] * dX, Y, GDIR[1] * dX];
}
// Gerstner sum; waves shorter than minLam are left out (the boat and camera feel only the long ones)
export function gerstnerDisp(x, z, u, minLam = 0) {
  let X = 0, Y = 0, Z = 0;
  for (const W of WAVES) {
    if (W.lam < minLam) continue;
    const th = W.k * (W.dx * x + W.dz * z) - W.w * u + W.ph, s = Math.sin(th), c = Math.cos(th);
    Y += W.A * c; X -= W.Q * W.A * W.dx * s; Z -= W.Q * W.A * W.dz * s;
  }
  return [X, Y, Z];
}
export function surface(x, z, u, P, minLam = 0) {
  const g = gerstnerDisp(x, z, u, minLam), h = giantDisp(x, z, P);
  return [x + g[0] + h[0], g[1] + h[1], z + g[2] + h[2]];
}

// ---- GLSL: the same functions (uniform names: uWA[i] = (dx, dz, k, A), uWB[i] = (ω, phase, Q, λ), uT, uG0..uG3)
export const GLSL_WAVES = /* glsl */`
#define NW ${NW}
uniform vec4 uWA[NW]; uniform vec4 uWB[NW]; uniform float uT;
uniform vec4 uG0;   // xi0, H, wf, wb
uniform vec4 uG1;   // T, L, phi, curl
uniform vec4 uG2;   // zc, zs, emin, kap
uniform vec4 uG3;   // peel, GDIR.x, GDIR.y, 0
float sm1(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
// returns displacement; info = (xi, e, s, y/H)
vec3 giantDisp(vec2 p, out vec4 info){
  vec2 gd = uG3.yz, gp = vec2(gd.y, -gd.x);
  float dz = dot(p, gp) - uG2.x;
  float e = uG2.z + (1. - uG2.z) * exp(-(dz * dz) / (uG2.y * uG2.y));
  float xi = dot(p, gd) - uG0.x + uG2.w * dz * dz;
  float s = clamp(uG1.w * 1.15 - abs(dz) / (uG3.x * 1.6), 0., 1.);
  float H = uG0.y * e;
  float w = mix(uG0.w, uG0.z, sm1(-5., 5., xi));
  float y = H * exp(-(xi * xi) / (w * w)) - uG1.x * e * exp(-(xi - 1.6 * uG0.z - 6.) * (xi - 1.6 * uG0.z - 6.) / 144.);
  float x = xi + uG1.y * e * exp(-(xi + 2.) * (xi + 2.) / 64.);
  if (s > 0.) {
    float j = uG1.z * s * e;
    x += j * exp(-(xi - .6) * (xi - .6) / 5.8);
    y -= j * .75 * s * exp(-(xi - 1.8) * (xi - 1.8) / 4.4);
  }
  info = vec4(xi, e, s, y / max(H, .5));
  return vec3(gd.x * (x - xi), y, gd.y * (x - xi));
}
// Gerstner sum with analytic tangents; waves shorter than ~3 grid cells fade out (no shimmer where the grid is coarse)
vec3 gerstner(vec2 p, float cell, out vec3 Tx, out vec3 Tz, out float jac){
  vec3 D = vec3(0.); float jxx = 1., jzz = 1., jxz = 0., gx = 0., gz = 0.;
  for (int i = 0; i < NW; i++) {
    vec4 a = uWA[i], b = uWB[i];
    float A = a.w * clamp((b.w / cell - 3.) / 3., 0., 1.);
    if (A <= 0.) continue;
    float th = a.z * dot(a.xy, p) - b.x * uT + b.y, s = sin(th), c = cos(th);
    float qa = b.z * A;
    D += vec3(-qa * a.x * s, A * c, -qa * a.y * s);
    float qk = qa * a.z * c;
    jxx -= qk * a.x * a.x; jzz -= qk * a.y * a.y; jxz -= qk * a.x * a.y;
    gx -= A * a.z * a.x * s; gz -= A * a.z * a.y * s;
  }
  Tx = vec3(jxx, gx, jxz); Tz = vec3(jxz, gz, jzz);
  jac = jxx * jzz - jxz * jxz;
  return D;
}
`;
export function waveUniforms(THREE) {
  return {
    uWA: { value: WAVES.map(W => new THREE.Vector4(W.dx, W.dz, W.k, W.A)) },
    uWB: { value: WAVES.map(W => new THREE.Vector4(W.w, W.ph, W.Q, W.lam)) },
    uT: { value: 0 },
    uG0: { value: new THREE.Vector4() }, uG1: { value: new THREE.Vector4() }, uG2: { value: new THREE.Vector4() }, uG3: { value: new THREE.Vector4() },
  };
}
export function setGiantUniforms(U, P) {
  U.uG0.value.set(P.xi0, P.H, P.wf, P.wb); U.uG1.value.set(P.T, P.L, P.phi, P.curl);
  U.uG2.value.set(P.zc, P.zs, P.emin, P.kap); U.uG3.value.set(P.peel, GDIR[0], GDIR[1], 0);
}
