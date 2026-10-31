// Endurance v2 · beat 4 "She's going": RECONSTRUCTION of the Endurance going down, 21 November 1915, seen from Ocean Camp.
// Long lens over the pack, the low sun behind the wreck, men in silhouette on a pressure ridge in the foreground.
// Contract (scenes/_harness/harness.js): build({ THREE, renderer, atmos, pxH }) → { scene, cam, state(u) }; state(u) is a pure function of u.
// Everything is procedural. Lighting is baked where it is static: a sun-aligned grid holds, per ground cell, the height under which
// a point is in the shadow of the ridges (swept once toward the sun), the distance to that occluder (soft penumbra) and the lead mask.

const DEG = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash2(i, j, s) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4, s = 0) { let a = 0, w = .5, n = 0, f = 1; for (let i = 0; i < oct; i++) { a += w * vnoise(x * f, y * f, s + i * 31); n += w; f *= 2.03; w *= .5; } return a / n; }
// periodic value noise (period px, py in lattice units) for tiling textures
function pnoise(x, y, px, py, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const X0 = ((xi % px) + px) % px, X1 = (X0 + 1) % px, Y0 = ((yi % py) + py) % py, Y1 = (Y0 + 1) % py;
  const a = hash2(X0, Y0, s), b = hash2(X1, Y0, s), c = hash2(X0, Y1, s), d = hash2(X1, Y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pfbm(x, y, px, py, oct, s) { let a = 0, w = .5, n = 0, f = 1; for (let i = 0; i < oct; i++) { a += w * pnoise(x * f, y * f, px * f, py * f, s + i * 31); n += w; f *= 2; w *= .5; } return a / n; }

export async function build({ THREE, renderer, atmos, pxH }) {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(9.6, 16 / 9, 1, 20000); scene.add(cam);

  // ───────────────────────── layout & light ─────────────────────────
  const SUN_AZ = -0.6 * DEG, SUN_ALT = 0.9 * DEG;                 // low evening sun, just left of the wreck
  const SUN = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_ALT), Math.sin(SUN_ALT), -Math.cos(SUN_AZ) * Math.cos(SUN_ALT));
  const SAX = [Math.cos(SUN_AZ), Math.sin(SUN_AZ)], TAX = [Math.sin(SUN_AZ), -Math.cos(SUN_AZ)];   // grid axes in (x, z): s across, t toward the sun
  const KSUN = Math.tan(SUN_ALT);
  const PIV = new THREE.Vector3(12, 0, -700);                      // where the hull pivots, on the ice (cheated closer than South's 1.5 miles)
  const YAW = Math.PI - 22 * DEG;                                  // bow points left and away, stern right and toward camera
  const BOW = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW)); // world direction of the ship's +x (bow) at zero pitch

  // ───────────────────────── shared uniforms & GLSL ─────────────────────────
  const NS = 2048, NT = 1024, SHALF = 330, T0 = 6, T1 = 3200, LNR = Math.log(T1 / T0);
  const U = {
    uSun: { value: SUN.clone() }, uSunC: { value: new THREE.Vector3(15, 9.6, 5.4) },
    uAmbUp: { value: new THREE.Vector3(0.135, 0.16, 0.215) }, uAmbDn: { value: new THREE.Vector3(0.10, 0.11, 0.14) }, uAmbSun: { value: new THREE.Vector3(0.24, 0.15, 0.09) },
    uFogD: { value: 1 / 22000 }, uGrid: { value: null }, uSHp: { value: new THREE.Vector4(SAX[0], SAX[1], TAX[0], TAX[1]) },
    uSHr: { value: new THREE.Vector4(SHALF, T0, 1 / LNR, 0) },
    uShA: { value: new THREE.Vector3() }, uShB: { value: new THREE.Vector3() }, uShR: { value: 3.2 },
    uCloud: { value: null }, uDetail: { value: null }, uT: { value: 0 },
  };
  const COMMON = /* glsl */`
  uniform vec3 uSun, uSunC, uAmbUp, uAmbDn, uAmbSun, uShA, uShB;
  uniform float uFogD, uShR, uT;
  uniform sampler2D uGrid, uCloud, uDetail;
  uniform vec4 uSHp, uSHr;
  // sky radiance (linear HDR) for a unit direction; the low sun sits in a warm haze band, steel blue above
  vec3 skyBase(vec3 d) {
    float e = max(d.y, 0.0);
    float ang = acos(clamp(dot(d, uSun), -1.0, 1.0));
    float band = exp(-e / 0.012), band2 = exp(-e / 0.045);
    vec3 c = mix(vec3(0.045, 0.078, 0.155), vec3(0.25, 0.225, 0.26), band2);  // steel blue above, dusty haze below
    c = mix(c, vec3(0.50, 0.40, 0.37), band * 0.75);                          // warm haze line on the horizon
    float g1 = exp(-ang / 0.008), g2 = exp(-ang / 0.03), g3 = exp(-ang / 0.11);
    c += vec3(1.0, 0.55, 0.24) * (g2 * 1.3 + g3 * 0.42) * (0.15 + 0.85 * band2);
    c += vec3(1.0, 0.80, 0.52) * g1 * 4.0;
    return c;
  }
  // colour of the haze along a near-horizontal ray: warm wash toward the sun's azimuth
  vec3 haze(vec3 d) {
    vec2 a = normalize(d.xz), b = normalize(uSun.xz); float ang = acos(clamp(dot(a, b), -1.0, 1.0));
    return vec3(0.46, 0.38, 0.37) + vec3(1.0, 0.55, 0.24) * (exp(-ang / 0.03) * 0.5 + exp(-ang / 0.11) * 0.35);
  }
  vec3 fogIt(vec3 col, float dist, vec3 dir) { float q = dist / 5200.0; float f = 1.0 - exp(-dist * uFogD - q * q); return mix(col, haze(dir), f); }
  vec4 gridAt(vec3 p) {
    float s = dot(p.xz, uSHp.xy), t = dot(p.xz, uSHp.zw);
    vec2 uv = vec2(s / (2.0 * uSHr.x) + 0.5, log(max(t, uSHr.y) / uSHr.y) * uSHr.z);
    if (uv.y > 1.0 || uv.x < 0.0 || uv.x > 1.0) return vec4(-50.0, 0.0, 0.0, 0.0);
    return texture2D(uGrid, uv);
  }
  float sunVis(vec3 p, vec4 g) { float w = 0.06 + g.g * 0.0046; return smoothstep(-w, w, p.y - g.r + 0.09); }
  // the wreck's own shadow: a capsule (hull axis) tested along the ray toward the sun
  float shipVis(vec3 p) {
    vec3 ba = uShB - uShA, oa = p - uShA;
    float baba = dot(ba, ba), bard = dot(ba, uSun), baoa = dot(ba, oa), rdoa = dot(uSun, oa);
    float mu = clamp((baoa - rdoa * bard) / max(baba - bard * bard, 1e-4), 0.0, 1.0);
    float lam = mu * bard - rdoa; if (lam < 0.0) return 1.0;
    float dd = length(oa + lam * uSun - mu * ba);
    float w = 0.05 + lam * 0.0046;
    float occ = (1.0 - smoothstep(uShR - w, uShR + w, dd)) * min(1.0, uShR / w);
    return 1.0 - occ;
  }
  vec3 ambient(vec3 N) {
    vec3 a = mix(uAmbDn, uAmbUp, N.y * 0.5 + 0.5);
    vec2 sh = normalize(uSun.xz); float f = dot(N.xz, sh);
    a *= 1.0 - 0.35 * max(-f, 0.0);
    a += uAmbSun * max(f, 0.0) * (1.0 - abs(N.y));
    return a;
  }
  // backlit rim: edges turned toward the sun catch it (fabric fuzz, rime, wet paint)
  float rimTerm(vec3 N, vec3 V) {
    vec3 lp = uSun - V * dot(uSun, V); float ll = length(lp);
    float dirw = ll > 1e-4 ? max(dot(N, lp / ll), 0.0) : 1.0;
    dirw = mix(1.0, dirw, clamp(ll * 12.0, 0.0, 1.0));
    return pow(1.0 - abs(dot(N, V)), 3.0) * dirw;
  }
  `;

  // ───────────────────────── sky dome ─────────────────────────
  // cloud texture (tiling): streaky layers, read in (azimuth, log elevation) space so they compress toward the horizon
  {
    const N = 512, d = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i / N, y = j / N;
      const wx = pfbm(x * 4, y * 4, 4, 4, 3, 101) - .5;
      let c = pfbm(x * 6 + wx * 1.4, y * 16, 6, 16, 5, 202);
      const big = pfbm(x * 2, y * 3, 2, 3, 2, 303);
      c = Math.pow(clamp((c - .42) * 3.2), 1.3) * clamp((big - .28) * 2.8);
      d[(j * N + i) * 4] = c * 255; d[(j * N + i) * 4 + 1] = pfbm(x * 24, y * 40, 24, 40, 2, 404) * 255; d[(j * N + i) * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    U.uCloud.value = t;
  }
  const sky = new THREE.Mesh(new THREE.SphereGeometry(15000, 64, 32), new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false,
    vertexShader: /* glsl */`varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); p.z = p.w * 0.999999; gl_Position = p; }`,
    fragmentShader: COMMON + /* glsl */`
    varying vec3 vD;
    void main(){
      vec3 d = normalize(vD);
      vec3 c = skyBase(d);
      float ang = acos(clamp(dot(d, uSun), -1.0, 1.0));
      // clouds: thin layered streaks; warm-lit undersides near the sun, cool grey away from it; calm in the upper left
      float az = atan(d.x, -d.z), e = max(d.y, 0.0);
      vec2 cuv = vec2(az * 2.3 + 0.37, log(e + 0.006) * 0.42 + uT * 0.0015);
      vec4 ct = texture2D(uCloud, cuv);
      float calm = 1.0 - 0.88 * smoothstep(-0.02, -0.09, az) * smoothstep(0.026, 0.042, e);
      float a = min(1.0, ct.r * 1.25) * smoothstep(0.003, 0.02, e) * calm * 0.9;
      float near = exp(-ang / 0.06), mid = exp(-ang / 0.22);
      vec3 lit = vec3(1.0, 0.50, 0.22) * (0.16 + 2.4 * near + 0.55 * mid);
      vec3 dark = mix(vec3(0.03, 0.04, 0.07), vec3(0.17, 0.10, 0.09), mid * mid);
      float edge = 1.0 - smoothstep(0.15, 0.7, ct.r);   // thin cloud edges catch the light
      vec3 cc = mix(dark, lit, clamp(0.12 + 0.8 * near + 0.55 * edge * mid + 0.25 * ct.g * mid, 0.0, 1.0));
      c = mix(c, cc, a);
      // sun disc (squashed by refraction), limb darkened, and a faint pillar of ice-crystal light above and below it
      vec2 q = vec2((az - atan(uSun.x, -uSun.z)) * cos(e), (asin(d.y) - asin(uSun.y)) * 1.12);
      float r = length(q) / 0.00465;
      float disc = smoothstep(1.06, 0.94, r) * (1.0 - 0.35 * r * r);
      c += vec3(1.0, 0.72, 0.42) * disc * 36.0;
      float pil = exp(-pow(q.x / 0.0028, 2.0)) * exp(-abs(q.y) / (q.y > 0.0 ? 0.022 : 0.010));
      c += vec3(1.0, 0.62, 0.34) * pil * 0.5;
      gl_FragColor = vec4(c, 1.0);
    }`,
  }));
  sky.renderOrder = 9; sky.frustumCulled = false; scene.add(sky);

  // ───────────────────────── ice blocks (pressure ridges) ─────────────────────────
  const R = rng(1915);
  const H = new Float32Array(NS * NT);                  // caster height raster in the sun-aligned grid
  const rowT = j => T0 * Math.exp(LNR * (j + .5) / NT), colS = i => (i + .5) / NS * 2 * SHALF - SHALF;
  const toS = (x, z) => x * SAX[0] + z * SAX[1], toT = (x, z) => x * TAX[0] + z * TAX[1];
  function stamp(x, z, r, h) {
    const s = toS(x, z), t = toT(x, z); if (t + r < T0 || t - r > T1) return;
    const j0 = Math.max(0, Math.floor(Math.log(Math.max(t - r, T0) / T0) / LNR * NT)), j1 = Math.min(NT - 1, Math.ceil(Math.log(Math.max(t + r, T0) / T0) / LNR * NT));
    const i0 = Math.max(0, Math.floor((s - r + SHALF) / (2 * SHALF) * NS)), i1 = Math.min(NS - 1, Math.ceil((s + r + SHALF) / (2 * SHALF) * NS));
    for (let j = j0; j <= j1; j++) { const dt = rowT(j) - t; for (let i = i0; i <= i1; i++) { const ds = colS(i) - s; if (ds * ds + dt * dt <= r * r) { const k = j * NS + i; if (h > H[k]) H[k] = h; } } }
  }
  // jittered box variants (flat-shaded, irregular slabs)
  function jbox(seed, jit) {
    const r = rng(seed), g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), p = g.attributes.position, m = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = [p.getX(i), p.getY(i), p.getZ(i)].map(Math.sign).join();
      if (!m.has(k)) m.set(k, [(r() - .5) * jit, (r() - .5) * jit, (r() - .5) * jit]);
      const o = m.get(k); p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
    }
    g.computeVertexNormals(); return g;
  }
  function jico(seed, jit) {
    const r = rng(seed), g = new THREE.IcosahedronGeometry(.62, 0), p = g.attributes.position, m = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = [p.getX(i), p.getY(i), p.getZ(i)].map(v => v.toFixed(3)).join();
      if (!m.has(k)) m.set(k, 1 + (r() - .5) * jit);
      const f = m.get(k); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * .8, p.getZ(i) * f);
    }
    g.computeVertexNormals(); return g;
  }
  function smoothNormals(g) {   // non-indexed: average the face normals of coincident vertices
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, acc = new Map(), key = i => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    for (let i = 0; i < p.count; i++) { const k = key(i), a = acc.get(k) || [0, 0, 0]; a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i); acc.set(k, a); }
    for (let i = 0; i < p.count; i++) { const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
    return g;
  }
  function rubble(seed, sx, sy, sz) {   // rounded, lumpy block with a flatter top (smooth normals)
    const r = rng(seed), g = new THREE.IcosahedronGeometry(.6, 1), p = g.attributes.position, m = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = [p.getX(i), p.getY(i), p.getZ(i)].map(v => v.toFixed(3)).join();
      if (!m.has(k)) m.set(k, .84 + r() * .28);
      const f = m.get(k); let y = p.getY(i) * f * sy; if (y > 0) y *= .78;
      p.setXYZ(i, p.getX(i) * f * sx, y, p.getZ(i) * f * sz);
    }
    return smoothNormals(g);
  }
  const VARS = [jbox(11, .35), jico(12, .5), jbox(13, .3), jico(14, .6), rubble(21, 1.15, .7, 1.0), rubble(22, 1.3, .5, 1.1)];
  const blocks = [];   // {p:[x,y,z], q:Quaternion, s:[x,y,z], info:[snow,tint,trans], v}
  const qtmp = new THREE.Quaternion(), etmp = new THREE.Euler(), m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), sv = new THREE.Vector3();
  function addBlock(x, z, top, size, thin, opt = {}) {
    const sx = size * (0.7 + R() * .8), sz = size * (0.6 + R() * .7), sy = size * thin * (0.5 + R() * .7);
    etmp.set((R() - .5) * 1.3, R() * Math.PI * 2, (R() - .5) * 1.3, 'YXZ'); const q = new THREE.Quaternion().setFromEuler(etmp);
    // vertical half-extent after rotation → put the top at `top`
    let hy = 0; for (const c of [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1]]) { v3.set(c[0] * sx / 2, c[1] * sy / 2, c[2] * sz / 2).applyQuaternion(q); hy = Math.max(hy, Math.abs(v3.y)); }
    const y = top - hy, rad = Math.max(sx, sz) * .45;
    const b = { p: [x, y, z], q, s: [sx, sy, sz], info: [opt.snow ?? (.55 + R() * .45), R(), opt.trans ?? (.4 + R() * .6)], v: (R() * 4) | 0, rad, top, dyn: opt.dyn };
    blocks.push(b); if (!opt.dyn && top > 0.05) stamp(x, z, rad, top);
    return b;
  }
  // ridges across the field: polylines roughly across the view, receding to the horizon
  const RIDGES = [[62, 1.1], [84, 0.9], [112, 1.5], [146, 1.0], [188, 1.8], [238, 1.2], [300, 2.0], [372, 1.4], [455, 2.2], [545, 1.6], [640, 2.4], [770, 2.0], [900, 2.6], [1060, 2.0], [1260, 2.8], [1500, 2.4], [1800, 3.0], [2150, 2.6], [2600, 3.2], [3100, 3.0]];
  for (const [d, hb] of RIDGES) {
    const ang = (R() - .5) * .5, xc = (R() - .5) * .1 * d, x0 = -0.24 * d - 40, x1 = 0.17 * d + 40, seed = (d * 7) | 0;
    const spacing = clamp(0.55 + d * 0.0026, .55, 7), size = 0.8 + d * 0.0009;
    for (let x = x0; x < x1; x += spacing * (0.6 + R() * .8)) {
      const gap = fbm(x / (40 + d * .2), d * .01, 2, seed); if (gap < .38) continue;
      const z = -d + (x - xc) * Math.tan(ang) + (fbm(x / (60 + d * .3), 3.1, 3, seed + 1) - .5) * d * .12;
      const h = hb * (0.35 + 0.9 * fbm(x / (12 + d * .05), 7.7, 3, seed + 2)) * clamp((gap - .38) * 6);
      if (h < .15) continue;
      const n = 2 + (R() * 2.5 | 0);
      for (let k = 0; k < n; k++) {
        const o = (R() - .5) * 3.2 * h, top = h * Math.pow(clamp(1 - Math.abs(o) / (1.7 * h + .4)), .7) * (.6 + .4 * R());
        if (top < .08) continue;
        addBlock(x + (R() - .5) * spacing, z + o, top, size * (0.6 + h * .35), .45);
      }
    }
  }
  // the pressure ice nipping the wreck: piled against her side, over her buried bows; blocks near the hull collapse into the hole
  const shipJumble = [];
  for (let k = 0; k < 330; k++) {
    const a = -32 + R() * 50;                                  // along the ship axis (bow = +), metres from the pivot
    const side = R() < .72 ? -1 : 1, off = side * (3.6 + Math.pow(R(), 1.6) * 14);   // across (camera side = -)
    const x = PIV.x + BOW.x * a - BOW.z * off, z = PIV.z + BOW.z * a + BOW.x * off;   // off < 0: the camera side
    const near = Math.abs(off) < 8 && a < 6;
    const hgt = (a > 2 ? 2.4 : 1.6) * (0.4 + R() * .9) * (1.2 - Math.abs(off) / 18);
    const b = addBlock(x, z, Math.max(.2, hgt), 1.1 + R() * 1.4, .5, { dyn: near, snow: .4 + R() * .5 });
    if (near) { b.a = a; b.off = off; shipJumble.push(b); }
  }
  // foreground: the hummocky ridge the men stand on (12–36 m), big soft blocks
  for (let k = 0; k < 90; k++) {
    const z = -(13 + Math.pow(R(), .8) * 24), x = (R() - .5) * z * -0.42 - 1.2;
    const top = 0.2 + R() * 0.7 + (z < -20 && z > -32 ? .2 : 0);
    addBlock(x, z, top, .7 + R() * .9, .85, { snow: .35 + R() * .4 });
  }
  // tabular bergs on the horizon (South: "dotted with numerous noble bergs")
  const bergs = new THREE.Group();
  {
    const mk = (cx, cz, rx, rz, h, seed) => {
      const r = rng(seed), shp = new THREE.Shape(), n = 18;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, f = .7 + r() * .4; const px = Math.cos(a) * rx * f, pz = Math.sin(a) * rz * f; i ? shp.lineTo(px, pz) : shp.moveTo(px, pz); }
      const g = new THREE.ExtrudeGeometry(shp, { depth: h, bevelEnabled: false, steps: 1 }); g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;   // ragged, sagging top surface
      for (let i = 0; i < p.count; i++) if (p.getY(i) > h * .5) p.setY(i, h * (.78 + .22 * fbm(p.getX(i) / 60, p.getZ(i) / 60, 2, seed)) - Math.pow(Math.abs(p.getX(i)) / rx, 3) * h * .35);
      g.computeVertexNormals(); g.translate(cx, -1, cz);
      return g;
    };
    bergs.userData.geos = [mk(-1350, -7600, 230, 90, 26, 7), mk(780, -6400, 140, 60, 21, 8), mk(-420, -8800, 190, 80, 30, 9), mk(1900, -8300, 260, 100, 24, 10)];
  }

  // shadow sweep toward the sun: SH(t) = max over t' > t of (H(t') − k (t' − t)), plus the distance to that caster
  const GRID = new Uint16Array(NS * NT * 4);
  {
    const SH = new Float32Array(NS * NT), DD = new Float32Array(NS * NT), WAT = new Float32Array(NS * NT), NIL = new Float32Array(NS * NT);
    for (let i = 0; i < NS; i++) {
      let sh = -50, dd = 0;
      for (let j = NT - 1; j >= 0; j--) {
        const k = j * NS + i; SH[k] = sh; DD[k] = dd;
        const dt = j > 0 ? rowT(j) - rowT(j - 1) : 0, h = H[k];
        if (h >= sh) { sh = h; dd = 0; }
        sh -= KSUN * dt; dd += dt;
      }
    }
    // leads of open water and grey young ice, stamped along wandering polylines
    const LR = rng(77);
    const stampW = (s, t, r, arr, val) => {
      if (t + r < T0 || t - r > T1) return;
      const j0 = Math.max(0, Math.floor(Math.log(Math.max(t - r, T0) / T0) / LNR * NT)), j1 = Math.min(NT - 1, Math.ceil(Math.log(Math.max(t + r, T0) / T0) / LNR * NT));
      const i0 = Math.max(0, Math.floor((s - r + SHALF) / (2 * SHALF) * NS)), i1 = Math.min(NS - 1, Math.ceil((s + r + SHALF) / (2 * SHALF) * NS));
      for (let j = j0; j <= j1; j++) { const dt = rowT(j) - t; for (let i = i0; i <= i1; i++) { const ds = colS(i) - s, dist = Math.sqrt(ds * ds + dt * dt); const v = clamp((r - dist) / .45 + .5) * val; const k = j * NS + i; if (v > arr[k]) arr[k] = v; } }
    };
    for (let n = 0; n < 34; n++) {
      const d = 160 + Math.pow(LR(), 1.25) * 2300, az = (LR() - .58) * 22 * DEG;
      let x = Math.sin(az) * d, z = -Math.cos(az) * d;
      let dir = (LR() < .7 ? (LR() - .5) * 70 : 90 + (LR() - .5) * 50) * DEG;
      const len = 60 + LR() * (200 + d * .5), wid = (1.2 + LR() * 7) * (d > 900 ? 1.6 : 1), nil = LR() < .3;
      for (let a = 0; a < len; a += .6) {
        dir += (vnoise(a / 25, n * 3.3, 9) - .5) * .06;
        x += Math.cos(dir) * .6; z += Math.sin(dir) * .6;
        if (Math.hypot(x - PIV.x, z - PIV.z) < 35) continue;
        const w = wid * (.5 + vnoise(a / 18, n, 5));
        stampW(toS(x, z), toT(x, z), w / 2, nil ? NIL : WAT, 1);
      }
    }
    const h16 = THREE.DataUtils.toHalfFloat;
    for (let k = 0; k < NS * NT; k++) { GRID[k * 4] = h16(SH[k]); GRID[k * 4 + 1] = h16(DD[k]); GRID[k * 4 + 2] = h16(WAT[k]); GRID[k * 4 + 3] = h16(NIL[k]); }
    const t = new THREE.DataTexture(GRID, NS, NT, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
    U.uGrid.value = t;
  }
  // detail texture (tiling, metres): snow relief slopes (sastrugi), albedo variation
  {
    const N = 256, d = new Uint8Array(N * N * 4), h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = pfbm(i / N * 4, j / N * 10, 4, 10, 4, 505) + .35 * pfbm(i / N * 16, j / N * 16, 16, 16, 2, 606);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const dx = h[j * N + (i + 1) % N] - h[j * N + (i + N - 1) % N], dz = h[((j + 1) % N) * N + i] - h[((j + N - 1) % N) * N + i];
      const k = (j * N + i) * 4;
      d[k] = clamp(.5 + dx * 9) * 255; d[k + 1] = clamp(.5 + dz * 9) * 255; d[k + 2] = pfbm(i / N * 3, j / N * 3, 3, 3, 3, 707) * 255; d[k + 3] = h[j * N + i] / 1.35 * 255;
    }
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    U.uDetail.value = t;
  }

  // ───────────────────────── ground: snow-covered floes, leads, the hole ─────────────────────────
  const HOLE = { c: new THREE.Vector2(), ax: new THREE.Vector2(BOW.x, BOW.z), ab: new THREE.Vector2(), open: 0 };
  U.uHoleC = { value: HOLE.c }; U.uHoleAx = { value: HOLE.ax }; U.uHoleAB = { value: HOLE.ab }; U.uHoleOpen = { value: 0 };
  const groundMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: COMMON + /* glsl */`
    uniform vec2 uHoleC, uHoleAx, uHoleAB; uniform float uHoleOpen;
    varying vec3 vW;
    void main(){
      vec3 p = vW; vec3 toC = cameraPosition - p; float dist = length(toC); vec3 V = toC / dist;
      vec4 g = gridAt(p);
      vec4 d1 = texture2D(uDetail, p.xz * vec2(0.09, 0.06));
      vec4 d2 = texture2D(uDetail, p.xz * vec2(0.017, 0.011) + 0.37);
      vec2 sl = (d1.rg - 0.5) * 0.06 + (d2.rg - 0.5) * 0.10;
      vec3 N = normalize(vec3(sl.x, 1.0, sl.y));
      float vis = sunVis(p, g) * shipVis(p);
      // snow
      float floe = texture2D(uDetail, p.xz * 0.0031 + 0.71).b;   // floe-to-floe differences in snow cover
      vec3 alb = vec3(0.86, 0.89, 0.93) * (0.84 + 0.16 * d2.b + 0.12 * (floe - 0.5));
      float ndl = max(dot(N, uSun), 0.0);
      vec3 col = alb * (ambient(N) + uSunC * ndl * vis);
      vec3 Rv = reflect(-V, N);
      float sp = pow(max(dot(Rv, uSun), 0.0), 1400.0) * 0.06;
      col += uSunC * sp * vis * smoothstep(0.35, 0.9, d1.a + d2.b * 0.4);
      // grey young ice (nilas)
      col = mix(col, vec3(0.16, 0.19, 0.23) * (0.8 + 0.4 * d1.b) + uSunC * pow(max(dot(Rv, uSun), 0.0), 300.0) * 0.08 * vis, g.a * 0.85);
      // open water: the leads, and the hole the wreck leaves
      vec2 hp = p.xz - uHoleC; float ha = dot(hp, uHoleAx), hb = dot(hp, vec2(-uHoleAx.y, uHoleAx.x));
      float ell = length(vec2(ha / uHoleAB.x, hb / uHoleAB.y)) + (d1.a - 0.5) * 0.5 + (d2.b - 0.5) * 0.3;
      float hole = (1.0 - smoothstep(0.82, 1.0, ell)) * step(0.01, uHoleAB.x);
      float water = max(g.b, hole);
      if (water > 0.002) {
        vec4 rw = texture2D(uDetail, p.xz * 1.3 + uT * vec2(0.11, 0.05));
        vec2 rp = (d1.rg - 0.5) * 0.05 + (rw.rg - 0.5) * 0.09;
        vec3 Nw = normalize(vec3(rp.x, 1.0, rp.y));
        vec3 Rw = reflect(-V, Nw); Rw.y = abs(Rw.y);
        float fr = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
        float glint = pow(max(dot(Rw, uSun), 0.0), 6000.0) * smoothstep(0.55, 0.8, rw.a);
        vec3 refl = skyBase(Rw) * vec3(0.05, 0.06, 0.075) + uSunC * glint * 2.5;
        vec3 wc = vec3(0.004, 0.007, 0.011) + refl * fr;
        // brash and slush churned in the hole once she has gone
        float brash = smoothstep(0.55, 0.8, d1.a * 0.7 + texture2D(uDetail, p.xz * 0.21).a * 0.6) * hole * uHoleOpen;
        wc = mix(wc, alb * ambient(vec3(0.0, 1.0, 0.0)) * 0.8, brash);
        col = mix(col, wc, water);
      }
      gl_FragColor = vec4(fogIt(col, dist, -V), 1.0);
    }`,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2), groundMat);
  ground.renderOrder = 8; ground.frustumCulled = false; scene.add(ground);

  // ───────────────────────── lit material (ice / dark objects) ─────────────────────────
  const LIT_VS = /* glsl */`
    attribute vec3 aCol; attribute vec4 aInfo;
    varying vec3 vW, vN, vC; varying vec4 vI;
    void main(){
      #ifdef INST
        mat4 m = modelMatrix * instanceMatrix;
      #else
        mat4 m = modelMatrix;
      #endif
      vec4 w = m * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(m) * normal);
      #ifdef VCOL
        vC = aCol;
      #else
        vC = vec3(1.0);
      #endif
      #ifdef INFO
        vI = aInfo;
      #else
        vI = vec4(0.8, 0.5, 0.6, 0.0);
      #endif
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const LIT_FS = COMMON + /* glsl */`
    uniform vec3 uAlb; uniform float uRim, uSpec;
    varying vec3 vW, vN, vC; varying vec4 vI;
    void main(){
      vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
      vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
      vec4 g = gridAt(vW);
      float vis = sunVis(vW, g) * shipVis(vW);
      float ndl = dot(N, uSun);
      #if defined(SIL)
        // backlit silhouette: near-black cloth, a little cold sky from above, no fill; a thin warm rim where the contour turns to the sun
        vec3 col = uAlb * uAmbUp * max(N.y, 0.0) * 0.8;
        vec3 lp = uSun - V * dot(uSun, V); vec3 ld = lp / max(length(lp), 1e-5);
        float edge = pow(1.0 - abs(dot(N, V)), 4.0);   // broad enough that the lens blur turns it into a glow, not a dotted line
        col += uSunC * edge * smoothstep(0.1, 0.8, dot(N, ld)) * vis * uRim;
      #elif defined(NEAR)
        // near rubble, backlit: shadowed sides toward the camera, smooth snow caps, a bright rim on the sun side
        float snow = smoothstep(0.28, 0.72, N.y) * (0.55 + 0.45 * vI.x);
        vec3 ice = mix(vec3(0.30, 0.38, 0.46), vec3(0.38, 0.46, 0.54), vI.y);
        vec3 alb = mix(ice, vec3(0.90, 0.92, 0.95), snow);
        vec3 amb = ambient(N) * (1.0 - 0.55 * max(dot(N.xz, -normalize(uSun.xz)), 0.0) * (1.0 - snow));
        vec3 col = alb * (amb + uSunC * max(ndl, 0.0) * vis);
        vec3 lp = uSun - V * dot(uSun, V); vec3 ld = lp / max(length(lp), 1e-5);
        col += uSunC * pow(1.0 - abs(dot(N, V)), 6.0) * smoothstep(0.0, 0.6, dot(N, ld)) * vis * (0.07 + 0.10 * snow);
      #elif defined(ICE)
        float snow = smoothstep(0.3, 0.75, N.y) * vI.x;
        vec3 ice = mix(vec3(0.50, 0.58, 0.66), vec3(0.62, 0.68, 0.74), vI.y);
        vec3 alb = mix(ice, vec3(0.88, 0.90, 0.93), snow);
        vec3 col = alb * (ambient(N) + uSunC * max(ndl, 0.0) * vis);
        // sunlight through thin ice toward the camera
        float tr = max(-ndl, 0.0) * pow(max(dot(-V, uSun), 0.0), 60.0) * (1.0 - snow) * vI.z;
        col += uSunC * vec3(0.18, 0.42, 0.56) * tr * 0.018 * vis;
        col += uSunC * rimTerm(N, V) * vis * 0.04 * (0.4 + snow);
      #else
        vec3 alb = uAlb * vC;
        vec3 col = alb * (ambient(N) + uSunC * max(ndl, 0.0) * vis);
        col += uSunC * rimTerm(N, V) * vis * uRim;
        vec3 Rv = reflect(-V, N);
        col += uSunC * pow(max(dot(Rv, uSun), 0.0), 200.0) * uSpec * vis;
      #endif
      gl_FragColor = vec4(fogIt(col, dist, -V), 1.0);
    }`;
  function litMat({ inst = false, ice = false, near = false, sil = false, vcol = false, info = false, alb = [1, 1, 1], rim = .12, spec = 0, side = THREE.FrontSide }) {
    const defines = {}; if (inst) defines.INST = 1; if (ice) defines.ICE = 1; if (near) defines.NEAR = 1; if (sil) defines.SIL = 1; if (vcol) defines.VCOL = 1; if (info) defines.INFO = 1;
    return new THREE.ShaderMaterial({ defines, side, uniforms: { ...U, uAlb: { value: new THREE.Vector3(...alb) }, uRim: { value: rim }, uSpec: { value: spec } }, vertexShader: LIT_VS, fragmentShader: LIT_FS });
  }

  // static blocks → instanced meshes per variant; the hull's neighbours are animated separately; blocks within 130 m are smooth rubble
  const iceMat = litMat({ inst: true, ice: true, info: true }), nearMat = litMat({ inst: true, near: true, info: true });
  for (const b of blocks) if (!b.dyn && Math.hypot(b.p[0], b.p[2]) < 130) b.v = 4 + (b.v & 1);
  const dynList = [];
  for (let v = 0; v < 6; v++) {
    const list = blocks.filter(b => b.v === v && !b.dyn); dynList.push(...blocks.filter(b => b.v === v && b.dyn));
    const geo = VARS[v].clone(), info = new Float32Array(list.length * 4);
    list.forEach((b, i) => info.set([b.info[0], b.info[1], b.info[2], 0], i * 4));
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    const im = new THREE.InstancedMesh(geo, v >= 4 ? nearMat : iceMat, list.length);
    list.forEach((b, i) => { m4.compose(v3.set(...b.p), b.q, sv.set(...b.s)); im.setMatrixAt(i, m4); });
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.renderOrder = 4; scene.add(im);
  }
  const dynGeo = VARS[1].clone(); { const info = new Float32Array(dynList.length * 4); dynList.forEach((b, i) => info.set([b.info[0], b.info[1], b.info[2], 0], i * 4)); dynGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4)); }
  const dynMesh = new THREE.InstancedMesh(dynGeo, iceMat, dynList.length); dynMesh.frustumCulled = false; dynMesh.renderOrder = 4; scene.add(dynMesh);
  for (const g of bergs.userData.geos) { const m = new THREE.Mesh(g, litMat({ ice: true })); m.renderOrder = 5; scene.add(m); }

  // ───────────────────────── the wreck ─────────────────────────
  // local frame: x from the stern (0) to the stem head (44 m), y up from the design waterline, z across. Mastless (South), rudder and
  // sternpost torn out on 27 Oct (South), stumps of the three masts, fallen spars and tangled rigging.
  const KEEL = -4.3;
  const deckY = x => { const u = (x - 21) / 23; return 1.55 + .55 * u * u + Math.max(0, u) * Math.max(0, u) * .65; };
  const botY = x => {
    if (x > 38.5) return KEEL + (deckY(44) - KEEL) * Math.pow((x - 38.5) / 5.5, 1.7);
    if (x >= 4.7) return KEEL;
    if (x >= 4.1) return lerp(-0.6, KEEL, (x - 4.1) / .6);                  // ragged gap where the sternpost was
    return -0.6 + 2.0 * Math.pow((4.1 - x) / 4.1, .75);                      // the counter rising to the stern
  };
  const halfB = x => 3.75 * Math.pow(Math.sin(clamp((44 - x) / 17) * Math.PI / 2), .8) * Math.sqrt(clamp(1 - Math.pow((5.6 - Math.min(x, 5.6)) / 5.6, 2)));
  const secQ = x => x > 33 ? lerp(2.5, 1.25, clamp((x - 33) / 9)) : x < 9 ? lerp(2.5, 1.7, clamp((9 - x) / 8)) : 2.5;
  const sec = (x, hh) => { const q = secQ(x); return Math.pow(1 - Math.pow(1 - hh, q), 1 / q); };
  const ship = new THREE.Group(), shipBody = new THREE.Group(); ship.add(shipBody); scene.add(ship);
  const PIVL = new THREE.Vector3(31, 1.5, 0);
  {
    const NX = 90, NK = 14, pos = [], col = [], idx = [];
    const xs = []; for (let i = 0; i <= NX; i++) { const u = i / NX; xs.push(44 * (u - Math.sin(u * Math.PI * 2) * .06)); }
    const frost = (x, y, z) => fbm(x * .35 + z * .2, y * .9, 3, 909);
    for (const side of [-1, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= NX; i++) for (let k = 0; k <= NK + 2; k++) {
        const x = xs[i], b = botY(x), t = deckY(x);
        let y, z;
        if (k <= NK) { const hh = k / NK; y = b + (t - b) * hh; z = side * halfB(x) * sec(x, hh); }
        else { y = t + (k - NK) * .45; z = side * halfB(x) * .99; }                // bulwark
        pos.push(x, y, z);
        const f = frost(x, y, z), ice = y < .7 && y > -.8 ? .55 : 0;
        const c = clamp(sst(.7, .85, f) * .6 + ice * sst(.55, .75, f)) * .55;
        col.push(lerp(.02, .5, c), lerp(.02, .54, c), lerp(.024, .6, c));
      }
      const S = NK + 3;
      for (let i = 0; i < NX; i++) for (let k = 0; k < S - 1; k++) {
        const a = base + i * S + k, b = a + S, c = a + 1, d = b + 1;
        if (side > 0) idx.push(a, b, c, c, b, d); else idx.push(a, c, b, c, d, b);
      }
    }
    // deck (snow-covered aft, broken planking)
    const base = pos.length / 3;
    for (let i = 0; i <= NX; i++) { const x = xs[i], y = deckY(x) - .05, w = halfB(x) * .98; pos.push(x, y, -w, x, y, w); const s = .45 + .35 * fbm(x * .4, 1, 2, 71); col.push(s, s * 1.02, s * 1.06, s, s * 1.02, s * 1.06); }
    for (let i = 0; i < NX; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const hull = new THREE.Mesh(g, litMat({ vcol: true, rim: .07, spec: .12, side: THREE.DoubleSide })); hull.renderOrder = 3; shipBody.add(hull);
  }
  const woodMat = litMat({ alb: [.10, .085, .07], rim: .07, side: THREE.DoubleSide });
  const SPARS = [];   // [from, to, radius] in local ship coords
  const cyl = (a, b, r, mat = woodMat) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * .8, r, L, 7, 1), mat);
    m.position.copy(A).add(B).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    m.renderOrder = 3; shipBody.add(m); SPARS.push([A, B, r]); return m;
  };
  const dk = x => deckY(x);
  // mast stumps (main snapped ~10 ft above the deck, South), with splintered tops
  cyl([33.5, dk(33.5) - 1, 0], [33.4, dk(33.5) + 5.4, .05], .3); cyl([33.4, dk(33.5) + 5.2, .05], [33.0, dk(33.5) + 6.3, .45], .14);
  cyl([22, dk(22) - 1, 0], [22.1, dk(22) + 3.1, 0], .32); cyl([22.1, dk(22) + 2.9, 0], [22.6, dk(22) + 3.7, -.2], .12);
  cyl([10.5, dk(10.5) - 1, 0], [10.4, dk(10.5) + 4.4, -.1], .25); cyl([10.4, dk(10.5) + 4.2, -.1], [10.9, dk(10.5) + 5.1, -.5], .1);
  // fallen spars: fore-yard hanging over the side, topmast across the deck, the spanker boom jutting over the stern, wreckage
  cyl([33.3, dk(33.5) + 5.1, .1], [26.5, dk(28) - .4, -5.6], .2);
  cyl([23, dk(22) + 2.6, .3], [11.5, dk(12) + 1.0, 3.6], .21);
  cyl([10.5, dk(10.5) + 2.2, 0], [-2.6, dk(0) + 3.4, -1.6], .17);
  cyl([17, dk(17) + .6, 1.6], [20.5, dk(20) + .9, 8.4], .16);
  cyl([28.5, dk(28.5) + .4, -2.2], [36, dk(36) + 1.8, 1.4], .15);
  cyl([6, dk(6) + .3, 1.2], [14, dk(14) + 2.6, -1.4], .12);
  // what is left of the deckhouses and hatches
  const boxM = (c, s, r = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(...s), woodMat); m.position.set(...c); m.rotation.y = r; m.renderOrder = 3; shipBody.add(m); };
  boxM([15.5, dk(15.5) + .9, 0], [4.5, 1.8, 3.4], .04); boxM([27, dk(27) + .5, .4], [2.8, 1.0, 2.2], -.1); boxM([5.6, dk(5.6) + .6, -.3], [1.8, 1.2, 1.6], .2);
  // rigging: slack shrouds and stays (local endpoints), lines hanging from spar ends (world gravity), recomputed per frame
  const SHROUDS = [];
  for (const [mx, top] of [[33.4, 5.0], [22.1, 2.8], [10.4, 4.1]]) for (const side of [-1, 1]) for (const dx of [-1.6, 0, 1.4]) SHROUDS.push([[mx, dk(mx) + top, 0], [mx + dx, dk(mx + dx) + .9, side * halfB(mx + dx) * .98], .8 + Math.abs(dx) * .3]);
  SHROUDS.push([[33.4, dk(33.5) + 5.0, 0], [22.1, dk(22) + 2.9, 0], 2.6], [[22.1, dk(22) + 2.9, 0], [10.4, dk(10.5) + 4.2, 0], 3.2], [[33.3, dk(33.5) + 5.1, .1], [26.5, dk(28) - .4, -5.6], 1.2], [[10.4, dk(10.5) + 4.2, 0], [-2.6, dk(0) + 3.4, -1.6], 2.4], [[22, dk(22) + 2.5, 0], [17, dk(17) + .8, 3.8], 1.5]);
  const HANG = [[[26.5, dk(28) - .4, -5.6], 6.5], [[-2.6, dk(0) + 3.4, -1.6], 4.5], [[20.5, dk(20) + .9, 8.4], 5], [[1.5, dk(1.5) + 1.2, -2.2], 3.4], [[30, dk(30) + 2.4, -3.8], 4.2], [[14, dk(14) + 2.6, -1.4], 2.8], [[36, dk(36) + 1.8, 1.4], 3.6]];
  const RSEG = 10, nLines = SHROUDS.length + HANG.length;
  const rigPos = new Float32Array(nLines * RSEG * 2 * 3);
  const rigGeo = new THREE.BufferGeometry(); rigGeo.setAttribute('position', new THREE.BufferAttribute(rigPos, 3));
  const rig = new THREE.LineSegments(rigGeo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: COMMON + /* glsl */`varying vec3 vW; void main(){ vec3 toC = cameraPosition - vW; float d = length(toC); gl_FragColor = vec4(fogIt(vec3(0.02, 0.02, 0.025), d, -toC / d), 1.0); }` }));
  rig.frustumCulled = false; rig.renderOrder = 3; scene.add(rig);

  // pose of the wreck at time u: pitch (bow down), slide along her axis (into the sea), list
  function shipPose(u) {
    const a = clamp((u - .5) / 1.75);
    const lurch = .04 * Math.sin(clamp((u - .55) / .9) * Math.PI) * Math.sin(u * 7.5) * (1 - a);   // the "struggling" of her last minute
    const e = a < .5 ? 2 * a * a : 1 - Math.pow(-2 * a + 2, 2.2) / 2;
    let th = 9 + 65 * clamp(e + lurch, 0, 1.05);
    th += 4 * clamp((u - 2.25) / 1.0);
    const sl = 3.5 * e + (u > 2.25 ? 31 * Math.pow(clamp((u - 2.25) / 1.0, 0, 1.5), 1.75) : 0);
    const list = (10 + 5 * e) * DEG;
    return { th: th * DEG, sl, list };
  }
  const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), YAW), qP = new THREE.Quaternion(), qR = new THREE.Quaternion();
  const ZAX = new THREE.Vector3(0, 0, 1), XAX = new THREE.Vector3(1, 0, 0);
  function poseShip(u, obj = ship, body = shipBody) {
    const P = shipPose(u);
    qP.setFromAxisAngle(ZAX, -P.th); qR.setFromAxisAngle(XAX, -P.list);
    obj.position.copy(PIV); obj.quaternion.copy(qY).multiply(qP).multiply(qR);
    body.position.set(P.sl - PIVL.x, -PIVL.y, 0);
    obj.updateMatrixWorld(true);
    return P;
  }
  const ghost = new THREE.Group(), ghostBody = new THREE.Group(); ghost.add(ghostBody);   // for evaluating the pose at other times
  const toWorld = (u, p, out) => { poseShip(u, ghost, ghostBody); return out.set(...p).applyMatrix4(ghostBody.matrixWorld); };

  // ───────────────────────── the men ─────────────────────────
  // Burberry windproofs: hooded smock to mid-thigh, trousers, finnesko; backs to the camera, looking at the ship
  const menMat = litMat({ sil: true, alb: [.03, .028, .026], rim: .05, side: THREE.DoubleSide });
  function lathe(profile, seg = 18) { return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg); }
  function makeMan(o) {
    const root = new THREE.Group(), hips = new THREE.Group(), chest = new THREE.Group(), head = new THREE.Group();
    const mesh = (g, parent, p = [0, 0, 0], s = [1, 1, 1], r = null) => { const m = new THREE.Mesh(g, menMat); m.position.set(...p); m.scale.set(...s); if (r) m.rotation.set(...r); m.renderOrder = 1; parent.add(m); return m; };
    const sc = o.h / 1.75, w = o.w, S = [sc, sc, sc];
    root.add(hips); hips.position.y = .9 * sc; hips.add(chest); chest.position.y = .04 * sc;
    // windproof smock over the trousers: bulky chest and shoulders, drawn in at the belt, loose skirt to mid-thigh
    mesh(lathe([[.0, -.38], [.214, -.38], [.234, -.33], [.214, -.2], [.19, -.07], [.18, -.01], [.197, .09], [.214, .23], [.213, .33], [.192, .41], [.15, .46], [.09, .495], [.0, .5]]), chest, [0, 0, 0], [1.26 * sc * w, sc, .76 * sc * w]);
    chest.add(head); head.position.set(0, .47 * sc, -.02 * sc);
    if (o.cap) {   // woollen helmet with ear flaps
      mesh(lathe([[.0, -.03], [.11, -.02], [.124, .06], [.12, .13], [.094, .19], [.05, .218], [.0, .224]]), head, [0, .02 * sc, 0], [sc, sc, 1.12 * sc]);
      mesh(new THREE.BoxGeometry(.05, .11, .08), head, [-.118 * sc, .02 * sc, .01], S, [0, 0, .15]); mesh(new THREE.BoxGeometry(.05, .11, .08), head, [.118 * sc, .02 * sc, .01], S, [0, 0, -.15]);
      mesh(lathe([[.0, -.06], [.16, -.05], [.12, .0], [.0, .01]]), head, [0, -.02 * sc, 0], [1.15 * sc, sc, sc]);   // scarf at the collar
    } else {       // Burberry hood: peaked crown, deep sides, its cape over the shoulders
      mesh(lathe([[.0, -.09], [.19, -.085], [.186, -.04], [.168, .03], [.166, .11], [.148, .18], [.11, .235], [.062, .272], [.024, .298], [.0, .315]]), head, [0, 0, -.015 * sc], [sc, sc, 1.2 * sc]);
    }
    const arms = [];
    for (const sd of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(sd * .232 * sc * w, .385 * sc, 0); chest.add(sh);
      mesh(lathe([[.0, .045], [.074, .02], [.084, -.06], [.08, -.18], [.072, -.29], [.0, -.33]]), sh, [0, 0, 0], S);   // bulky sleeve
      const el = new THREE.Group(); el.position.y = -.3 * sc; sh.add(el);
      mesh(lathe([[.0, .035], [.066, .01], [.068, -.1], [.064, -.2], [.078, -.235], [.074, -.26], [.0, -.27]]), el, [0, 0, 0], S);   // forearm, cuff
      mesh(new THREE.SphereGeometry(.08, 12, 9), el, [0, -.335 * sc, -.005], [sc, 1.32 * sc, .86 * sc]);   // gauntlet mitt
      mesh(new THREE.SphereGeometry(.034, 8, 6), el, [-sd * .055 * sc, -.3 * sc, -.035 * sc], [sc, 1.4 * sc, sc]);   // thumb
      arms.push({ sh, el });
    }
    const legs = [];
    for (const sd of [-1, 1]) {
      const hp = new THREE.Group(); hp.position.set(sd * .102 * sc, -.03 * sc, 0); hips.add(hp);
      mesh(lathe([[.0, .03], [.104, .0], [.108, -.12], [.098, -.3], [.09, -.43], [.0, -.47]]), hp, [0, 0, 0], S);   // baggy trouser leg
      const kn = new THREE.Group(); kn.position.y = -.43 * sc; hp.add(kn);
      mesh(lathe([[.0, .03], [.09, .0], [.087, -.12], [.078, -.3], [.074, -.38], [.0, -.41]]), kn, [0, 0, 0], S);
      mesh(new THREE.SphereGeometry(.1, 12, 8), kn, [0, -.43 * sc, -.045], [sc, .8 * sc, 1.6 * sc]);   // finnesko
      legs.push({ hp, kn });
    }
    if (o.act === 'glass') {   // field glasses: two barrels and a hinge in front of the face
      const gl = new THREE.Group(); gl.position.set(0, .115 * sc, -.27 * sc); head.add(gl);
      for (const sd of [-1, 1]) mesh(new THREE.CylinderGeometry(.03, .036, .16, 12), gl, [sd * .045 * sc, 0, 0], S, [Math.PI / 2, 0, 0]);
      mesh(new THREE.BoxGeometry(.06, .035, .07), gl, [0, .01, .02], S);
    }
    root.position.set(...o.p); root.rotation.y = o.yaw; scene.add(root);
    return { root, hips, chest, head, arms, legs, o };
  }
  const MEN = [
    makeMan({ p: [-3.35, .9, -23.8], yaw: -.16, h: 1.76, w: 1.0, act: 'shade' }),
    makeMan({ p: [-2.62, 1.1, -26.9], yaw: -.1, h: 1.80, w: 1.04, act: 'point', cap: true }),
    makeMan({ p: [-1.55, .7, -30.2], yaw: -.45, h: 1.72, w: .98, act: 'glass' }),
    makeMan({ p: [1.62, .38, -17.6], yaw: .25, h: 1.78, w: 1.08, act: 'still' }),
  ];
  const setRot = (o, x, y, z) => o.rotation.set(x, y, z, 'XYZ');
  const DOWN = new THREE.Vector3(0, -1, 0), adir = new THREE.Vector3(), a2 = new THREE.Vector3();
  // shoulder aims the upper arm along a direction (man's frame: +x his right, -z forward); the elbow flexes forward
  function aim(arm, sd, rest, pose, k, flex0, flex1) {
    adir.set(sd * rest[0], rest[1], rest[2]).normalize(); a2.set(sd * pose[0], pose[1], pose[2]).normalize();
    adir.lerp(a2, k).normalize(); arm.sh.quaternion.setFromUnitVectors(DOWN, adir); arm.el.rotation.set(lerp(flex0, flex1, k), 0, 0);
  }
  const REST = [.13, -1, -.06];
  function poseMen(u) {
    for (let i = 0; i < MEN.length; i++) {
      const M = MEN[i], ph = i * 1.7, act = M.o.act;
      const sway = Math.sin(u * 1.1 + ph) * .5 + Math.sin(u * .43 + ph * 2) * .5;
      M.hips.position.x = sway * .025; setRot(M.hips, 0, 0, sway * .03);
      setRot(M.chest, -.09 + Math.sin(u * 1.9 + ph) * .006, Math.sin(u * .5 + ph) * .04, -sway * .045);
      M.legs.forEach((L, k) => { const load = (k === (sway > 0 ? 1 : 0)) ? Math.abs(sway) : 0, sd = k ? 1 : -1, fwd = (k === i % 2) ? .16 : -.05;
        setRot(L.hp, fwd + .06 * load, 0, sd * .1 - sway * .03); setRot(L.kn, -(.1 + .14 * load + (fwd > 0 ? .1 : 0)), 0, 0); });
      let hd = [0, Math.sin(u * .7 + ph) * .06, 0];
      const [L, Rr] = M.arms;
      aim(L, -1, REST, REST, 0, .25, .25); aim(Rr, 1, REST, REST, 0, .25, .25);
      if (act === 'shade') {   // raises a hand against the low sun
        const k = ease((u - .9) / .7) * (1 - ease((u - 3.9) / .6));
        aim(Rr, 1, REST, [.62, .32, -.72], k, .25, 2.15);
        hd = [lerp(0, -.05, k), hd[1] * .5 + .05, 0];
      } else if (act === 'point') {   // "She's going!": points, holds, lets the arm drop, bows his head
        const k = ease((u - .45) / .45) * (1 - ease((u - 2.5) / .9));
        aim(Rr, 1, REST, [.5, .42, -.75], k, .25, .05);
        hd = [lerp(0, .06, k) - ease((u - 3.0) / .8) * .3, hd[1], 0];
      } else if (act === 'glass') {   // field glasses up, elbows out
        const k = ease((u + .4) / .6) * (1 - ease((u - 3.5) / .7));
        aim(L, -1, REST, [.62, -.02, -.78], k, .25, 2.25); aim(Rr, 1, REST, [.62, -.02, -.78], k, .25, 2.25);
      } else {   // the nearest man: weight shifts; when she is gone, his head drops
        const k = ease((u - 3.1) / .9);
        hd = [hd[0] - k * .42, hd[1] * (1 - k), 0];
        aim(L, -1, REST, [.05, -1, -.3], 1, .25, .7);
      }
      setRot(M.head, ...hd);
    }
  }

  // ───────────────────────── particles ─────────────────────────
  // falling sleet/snow in view space (from engine/atmos.js, plus backlight: flakes near the sun glow warm)
  const NSNOW = 2600;
  const snowSeed = new Float32Array(NSNOW * 4); { const r = rng(5); for (let i = 0; i < NSNOW; i++) snowSeed.set([r(), r(), Math.pow(r(), .7), r()], i * 4); }
  const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute('seed', new THREE.BufferAttribute(snowSeed, 4)); snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NSNOW * 3), 3));
  const SU = {
    uTime: { value: 0 }, uZ0: { value: 1.2 }, uZ1: { value: 70 }, uTanH: { value: 1 }, uTanV: { value: 1 }, uSize: { value: .006 }, uFocus: { value: 700 }, uAper: { value: 300 },
    uDensity: { value: .3 }, uPxScale: { value: 1000 }, uPxH: { value: pxH }, uWind: { value: new THREE.Vector3(1.6, -.2, 0) }, uSunV: { value: new THREE.Vector3() }, uSunC: U.uSunC, uGust: { value: 0 },
  };
  const snow = new THREE.Points(snowGeo, new THREE.ShaderMaterial({
    uniforms: SU, transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */`
      attribute vec4 seed;
      uniform float uTime, uZ0, uZ1, uTanH, uTanV, uSize, uFocus, uAper, uDensity, uPxScale, uPxH, uGust;
      uniform vec3 uWind, uSunV, uSunC;
      varying float vA, vSoft; varying vec3 vCol;
      void main(){
        if (seed.w > uDensity) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }
        float z = mix(uZ0, uZ1, seed.z), ph = seed.w * 50.;
        float W = 2. * z * uTanH * 1.15, H = 2. * z * uTanV * 1.15;
        float fall = 1.4 + 1.2 * fract(seed.w * 7.3);
        vec2 drift = uWind.xy * (1. + uGust) * uTime * (.7 + .6 * fract(seed.w * 3.1)) + vec2(sin(uTime * 1.7 + ph) * .3, -fall * uTime);
        vec3 p = vec3((fract(seed.x + drift.x / W) - .5) * W, (fract(seed.y + drift.y / H) - .5) * H, -z);
        float size = uSize * (.5 + fract(seed.w * 13.7)) * uPxScale / z;
        float coc = min(uAper * abs(1. / uFocus - 1. / z) * uPxH / 1080., 40.);
        float s = max(size, 1.2) + coc;
        vA = clamp(size * size / (s * s), .03, 1.) * clamp(size / 1.2, .25, 1.);
        vSoft = clamp(coc / s, 0., 1.);
        float cs = max(dot(normalize(p), uSunV), 0.);
        vCol = vec3(.30, .33, .40) + uSunC * (pow(cs, 4000.) * 1.5 + pow(cs, 500.) * .35 + pow(cs, 60.) * .05);
        gl_PointSize = s;
        gl_Position = projectionMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */`
      varying float vA, vSoft; varying vec3 vCol;
      void main(){
        float r = length(gl_PointCoord - .5) * 2.;
        float a = (1. - smoothstep(1. - mix(.3, .95, vSoft), 1., r)) * vA * .9;
        if (a < .004) discard;
        gl_FragColor = vec4(vCol * a, a);
      }`,
  }));
  snow.frustumCulled = false; snow.renderOrder = 20; cam.add(snow);

  // world-space debris: snow and ice streaming off the rising stern, the burst of powder and spray as she dives, mist hanging after
  const NB = 900, bPos = new Float32Array(NB * 3), bAtt = new Float32Array(NB * 4);
  const bGeo = new THREE.BufferGeometry(); bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3)); bGeo.setAttribute('aP', new THREE.BufferAttribute(bAtt, 4));
  const BU = { uPxScale: { value: 1000 }, uFocus: { value: 700 }, uAper: { value: 300 }, uPxH: { value: pxH }, uSun: U.uSun, uSunC: U.uSunC, uFogD: U.uFogD };
  const burst = new THREE.Points(bGeo, new THREE.ShaderMaterial({
    uniforms: BU, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */`
      attribute vec4 aP;   // size (m), alpha, softness, kind
      uniform float uPxScale, uFocus, uAper, uPxH; uniform vec3 uSun, uSunC;
      varying float vA, vSoft; varying vec3 vCol;
      void main(){
        if (aP.y < .003) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }
        vec4 w = modelMatrix * vec4(position, 1.0); vec4 vp = viewMatrix * w; float z = -vp.z;
        float size = aP.x * uPxScale / z, coc = uAper * abs(1. / uFocus - 1. / z) * uPxH / 1080.;
        float s = max(size, 1.0) + coc;
        vA = aP.y * clamp(size / 1.0, .3, 1.); vSoft = max(aP.z, clamp(coc / s, 0., 1.));
        vec3 V = normalize(cameraPosition - w.xyz);
        float cs = max(dot(-V, uSun), 0.);
        vCol = vec3(.42, .45, .52) + uSunC * (pow(cs, 3000.) * .9 + pow(cs, 300.) * .3 + .02);
        gl_PointSize = min(s, 90.);
        gl_Position = projectionMatrix * vp;
      }`,
    fragmentShader: /* glsl */`
      varying float vA, vSoft; varying vec3 vCol;
      void main(){ float r = length(gl_PointCoord - .5) * 2.; float a = (1. - smoothstep(1. - mix(.25, 1., vSoft), 1., r)) * vA; if (a < .003) discard; gl_FragColor = vec4(vCol * a, a); }`,
  }));
  burst.frustumCulled = false; burst.renderOrder = 15; scene.add(burst);
  const BP = []; { const r = rng(31);
    for (let i = 0; i < NB; i++) {
      const kind = i < 520 ? 0 : i < 800 ? 1 : 2;   // 0 stern streams, 1 dive burst, 2 mist
      BP.push({ kind, te: kind === 0 ? .9 + r() * 1.7 : kind === 1 ? 2.45 + r() * .9 : 2.8 + r() * .9, x: r() * 18, side: r() < .5 ? -1 : 1, r1: r(), r2: r(), r3: r(), r4: r() });
    } }
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function updateBurst(u) {
    for (let i = 0; i < NB; i++) {
      const b = BP[i], t = u - b.te; let x = 0, y = -100, z = 0, size = 0, alpha = 0, soft = 0;
      if (t > 0) {
        if (b.kind === 0 && t < 2.2) {   // shed from the deck edge as she rises, falls under gravity, drifts downwind
          const lx = 1 + b.x * .9, emit = toWorld(b.te, [lx, deckY(lx) + .7, b.side * halfB(lx) * (b.r3 * .9)], tmpA);
          const e2 = toWorld(b.te + .03, [lx, deckY(lx) + .7, b.side * halfB(lx) * (b.r3 * .9)], tmpB);
          const vx = (e2.x - emit.x) / .03 * .6 + 1.2, vy = (e2.y - emit.y) / .03 * .6, vz = (e2.z - emit.z) / .03 * .6;
          x = emit.x + vx * t; y = emit.y + vy * t - 4.9 * t * t; z = emit.z + vz * t;
          size = .04 + b.r1 * .07 + t * .06; alpha = .55 * (1 - sst(1.0, 2.0, t)); soft = .4;
          if (y < .1) alpha *= clamp(y / .1 + 1) * 0;
        } else if (b.kind === 1 && t < 3) {   // powder and spray thrown up as the stern drives under
          const a = b.r1 * Math.PI * 2, rr = 2 + b.r2 * 7, up = 4 + b.r3 * 9, dr = 1 - Math.exp(-1.6 * t);
          x = PIV.x + Math.cos(a) * rr + Math.cos(a) * dr * (1 + b.r4 * 3) + 1.5 * t; z = PIV.z + Math.sin(a) * rr * .6 + Math.sin(a) * dr * 2;
          y = Math.max(.05, up * dr / 1.6 - 2.2 * t * t * (.4 + b.r4 * .4));
          size = .12 + b.r4 * .3 + t * .5; alpha = .75 * sst(0, .08, t) * (1 - sst(.9, 3, t)); soft = .55;
        } else if (b.kind === 2 && t < 3.5) {   // mist hanging over the hole
          const a = b.r1 * Math.PI * 2, rr = b.r2 * 9;
          x = PIV.x + Math.cos(a) * rr + 1.8 * t + b.r4 * 2; z = PIV.z + Math.sin(a) * rr * .7; y = .5 + b.r3 * 4 + t * (.6 + b.r4);
          size = 1.6 + b.r3 * 2.4 + t * 1.2; alpha = .07 * sst(0, .4, t) * (1 - sst(1.6, 3.5, t)); soft = 1;
        }
      }
      bPos[i * 3] = x; bPos[i * 3 + 1] = y; bPos[i * 3 + 2] = z; bAtt.set([size, alpha, soft, b.kind], i * 4);
    }
    bGeo.attributes.position.needsUpdate = true; bGeo.attributes.aP.needsUpdate = true;
  }

  // ───────────────────────── per-frame state ─────────────────────────
  const W0 = new THREE.Vector3(), W1 = new THREE.Vector3();
  function updateRig(u) {
    let o = 0; const put = (p) => { rigPos[o++] = p.x; rigPos[o++] = p.y; rigPos[o++] = p.z; };
    const M = shipBody.matrixWorld, prev = new THREE.Vector3(), cur = new THREE.Vector3();
    for (const [a, b, sag] of SHROUDS) {
      W0.set(...a).applyMatrix4(M); W1.set(...b).applyMatrix4(M);
      for (let k = 0; k <= RSEG; k++) {
        const f = k / RSEG; cur.lerpVectors(W0, W1, f); cur.y -= sag * 4 * f * (1 - f);
        if (k) { put(prev); put(cur); } prev.copy(cur);
      }
    }
    const P = shipPose(u), Pb = shipPose(u - .08), dth = (P.th - Pb.th) / .08;
    for (const [a, len] of HANG) {
      W0.set(...a).applyMatrix4(M);
      const swing = clamp(-dth * .9, -1.2, 1.2);
      for (let k = 0; k <= RSEG; k++) {
        const f = k / RSEG; cur.set(W0.x + BOW.x * swing * f * f * len * .4, W0.y - len * f, W0.z + BOW.z * swing * f * f * len * .4);
        if (k) { put(prev); put(cur); } prev.copy(cur);
      }
    }
    rigGeo.attributes.position.needsUpdate = true;
  }
  const dq = new THREE.Quaternion(), dax = new THREE.Vector3();
  function updateDyn(u) {
    const P = shipPose(u);
    dynList.forEach((b, i) => {
      // each block lets go when the hull leaves it: the stern end first as she rises, the rest as she dives
      const ti = .7 + clamp((-b.a) / 30) * 1.4 + (Math.abs(b.off) - 3.6) * .05 + b.info[1] * .2;
      const k = ease((u - ti) / .7), k2 = ease((u - 2.6 - b.info[2] * .4) / .8);
      const toward = -Math.sign(b.off) * (1.2 + Math.abs(b.off) * .25) * (k * .5 + k2 * .5);   // slides toward the hull's axis
      v3.set(b.p[0] - BOW.z * toward, b.p[1] - b.top * (.45 * k + .35 * k2) + Math.sin(u * 2.3 + i) * .06 * k2, b.p[2] + BOW.x * toward);
      dax.set(Math.sin(i * 1.7), 0, Math.cos(i * 1.7)).normalize(); dq.setFromAxisAngle(dax, (k * .35 + k2 * .4) * (b.info[0] > .7 ? 1 : -1));
      m4.compose(v3, dq.multiply(b.q), sv.set(...b.s)); dynMesh.setMatrixAt(i, m4);
    });
    dynMesh.instanceMatrix.needsUpdate = true;
    // the opening: a long pool along the hull while she lies in the ice, a dark patch where she went down
    const e = clamp((u - .5) / 1.75), g = ease((u - 2.3) / 1.0);
    const cA = lerp(-13, -3, e) * (1 - g);
    HOLE.c.set(PIV.x + BOW.x * cA, PIV.z + BOW.z * cA);
    HOLE.ab.set(lerp(lerp(17, 10, e), 14, g), lerp(lerp(2.6, 5.5, e), 8.5, g) * (1 - .12 * ease((u - 3.6) / .8)));
    U.uHoleOpen.value = ease((u - 2.9) / .6);
    return P;
  }
  const look = new THREE.Vector3();
  function state(u) {
    U.uT.value = u;
    // camera: slow push in and a drift to the right, a slow zoom; a touch of tilt following the stern up
    const k = (u + .6) / 5;
    const cpos = [0.38 * k, 2.5, -1.7 * k], fov = 9.6 - 1.1 * k;
    const P = poseShip(u);
    const follow = Math.sin(clamp((u - .3) / 3.3) * Math.PI) * .14;
    const tilt = (0.06 * fov + follow) * DEG;
    look.set(-20, cpos[1] + 700 * Math.tan(tilt), -700);
    cam.position.set(...cpos); cam.up.set(0, 1, 0); cam.lookAt(look); cam.fov = fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    // wreck, its shadow capsule (bow end → stern), rigging, the ice around her
    W0.set(30, 0, 0).applyMatrix4(shipBody.matrixWorld); W1.set(4, 1.2, 0).applyMatrix4(shipBody.matrixWorld);
    U.uShA.value.copy(W0); U.uShB.value.copy(W1); U.uShR.value = 3.0;
    if (W1.y < -2) { U.uShA.value.set(0, -500, 0); U.uShB.value.set(0, -501, 0); }
    ship.visible = W1.y > -12;
    updateRig(u); rig.visible = ship.visible;
    updateDyn(u);
    poseMen(u);
    updateBurst(u);
    // snow: steady sleet, thickening into the blizzard at the end
    const dens = .22 + .55 * ease((u - 2.9) / 1.1);
    const vf = fov * DEG / 2;
    SU.uTime.value = u + 10; SU.uDensity.value = dens; SU.uGust.value = 1.4 * ease((u - 3.0) / 1.0);
    SU.uTanV.value = Math.tan(vf); SU.uTanH.value = Math.tan(vf) * cam.aspect; SU.uPxScale.value = pxH / (2 * Math.tan(vf));
    SU.uSunV.value.copy(SUN).transformDirection(cam.matrixWorldInverse);
    BU.uPxScale.value = pxH / (2 * Math.tan(vf));
    const focus = cam.position.distanceTo(PIV);
    SU.uFocus.value = BU.uFocus.value = focus;
    return {
      cam: { pos: cpos, look: [look.x, look.y, look.z], fov },
      focus, aper: 300, maxCoc: 18,
      bloom: { strength: .13, radius: .3, threshold: 3.5 },
      grade: { lift: [.002, .006, .016], gain: [1.04, 1.0, .95], contrast: .26, sat: 1.05 },
      atmos: { density: dens },
    };
  }
  state(0);
  return { scene, cam, state };
}
