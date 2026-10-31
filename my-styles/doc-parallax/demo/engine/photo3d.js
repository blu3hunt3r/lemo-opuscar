// A public-domain photo as a 3D place: each depth band (tools/layers.py) is a grid mesh unprojected from the start camera.
// vertex = ray(uv) × Z, 1/Z = 1/zFar + d · (1/zNear − 1/zFar) with d the band's disparity (0 far … 1 near).
// From the start camera (origin, looking −z, horizontal fov hfov) the composite equals the original photo.
import * as THREE from 'three';

const loadTex = (url, srgb = true) => new Promise((res, rej) => new THREE.TextureLoader().load(url, t => {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; res(t);
}, undefined, rej));
const loadBin = async url => new Float32Array(await (await fetch(url)).arrayBuffer());

const VS = `
varying vec2 vUv; varying float vZ; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vZ = -mv.z; gl_Position = projectionMatrix * mv; }`;
const FS = `
uniform sampler2D map, alphaMap, flowMask; uniform float uHasAlpha, uLevels, uBlack, uWhite, uGamma, uFade, uTime, uFlow, uHasFlow, uFlowPeriod;
uniform vec2 uFlowDir;
uniform vec3 uFogCol, uFogWind; uniform float uFogDen, uFogNoise, uFogScale, uFogY0, uFogY1;
varying vec2 vUv; varying float vZ; varying vec3 vW;
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ return .5 * vn3(p) + .27 * vn3(p * 2.03 + 7.1) + .15 * vn3(p * 4.07 + 3.3) + .08 * vn3(p * 8.1 + 1.7); }
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
// Water that moves inside a still photograph (cinemagraph flow): two copies of the scan slide along a noisy flow field, half a period
// apart, cross-faded so neither ever slides further than |dir| x period. Only where the flow mask says water.
vec3 photo(vec2 uv){
  if (uHasFlow < .5) return texture2D(map, uv).rgb;
  float m = texture2D(flowMask, uv).r * uFlow;
  if (m < .002) return texture2D(map, uv).rgb;
  float P = uFlowPeriod, p1 = fract(uTime / P), p2 = fract(uTime / P + .5);
  vec2 q = uv * vec2(9., 14.);
  vec2 n = vec2(vn(q + uTime * .15) - .5, vn(q + 31.7 - uTime * .12) - .5);
  vec2 d = (uFlowDir + n * length(uFlowDir) * 1.6) * m;
  vec3 c1 = texture2D(map, uv - d * p1 * P).rgb, c2 = texture2D(map, uv - d * p2 * P).rgb;
  return mix(c1, c2, abs(1. - 2. * p1));
}
float cover(float a){ float w = max(fwidth(a), 1e-4); return clamp((a - .5) / w + .5, 0., 1.); }
void main(){
  float a = uHasAlpha > .5 ? texture2D(alphaMap, vUv).r : 1.;
  if (a < .02) discard;
  vec3 c = photo(vUv);
  // levels on the scan (black/white points, gamma): the archive's tones, set per photo; the grade happens in post
  c = pow(clamp((c - uBlack) / max(uWhite - uBlack, 1e-3), 0., 1.), vec3(uGamma));
  if (uFogDen > 0.) {   // mist in depth: thicker with distance, drifting (3D noise carried by the wind), living between two heights
    float dist = length(vW - cameraPosition);
    float n = fbm3(vW * uFogScale - uFogWind * uTime * uFogScale);
    float hm = 1. - smoothstep(uFogY0, uFogY1, vW.y);
    float f = (1. - exp(-uFogDen * dist)) * mix(1., smoothstep(.25, .8, n) * 1.6, uFogNoise) * hm;
    c = mix(c, uFogCol, clamp(f, 0., 1.));
  }
  gl_FragColor = vec4(c * uFade, a);
}`;

// o: { base: 'assets/tex/', id, hfov, zNear, zFar, cover (≥ 1: extra margin round the frame), levels: [black, white, gamma],
//      flow: { dir: [du, dv] (uv per second), period (s), amount, layers (optional: the bands that flow, e.g. [0, 1], so people in a
//              nearer band never pick up the water's motion at their edges) } with assets/tex/<id>_flow.png as the water mask,
//      fog: { color: [r,g,b] linear, density (1/m), noise (0..1), scale (1/m), wind: [x,y,z] m/s, y0, y1 (world heights where it thins out) } }
export async function photo3d(o) {
  const meta = await (await fetch(`${o.base}${o.id}.json`)).json();
  const [GW, GH] = meta.grid, aspect = meta.h / meta.w;
  const T = Math.tan(o.hfov * Math.PI / 360) * (o.cover ?? 1.06);
  const g = new THREE.Group(); g.name = o.id;
  const [bk, wh, ga] = o.levels || [0, 1, 1];
  const mats = [];
  const flowTex = o.flow ? await loadTex(`${o.base}${o.id}_flow.png`, false) : null;
  for (let k = 0; k < meta.bands.length; k++) {
    const [map, d] = await Promise.all([loadTex(`${o.base}${o.id}_L${k}.jpg`), loadBin(`${o.base}${o.id}_L${k}_d.bin`)]);
    const alpha = k > 0 ? await loadTex(`${o.base}${o.id}_L${k}_a.png`, false) : null;
    const pos = new Float32Array((GW + 1) * (GH + 1) * 3), uv = new Float32Array((GW + 1) * (GH + 1) * 2);
    for (let j = 0; j <= GH; j++) for (let i = 0; i <= GW; i++) {
      const n = j * (GW + 1) + i, u = i / GW, v = 1 - j / GH;      // row 0 of the grid = top of the photo
      const disp = Math.min(1, Math.max(0, d[n]));
      const Z = 1 / (1 / o.zFar + disp * (1 / o.zNear - 1 / o.zFar));
      pos[n * 3] = (u - .5) * 2 * T * Z; pos[n * 3 + 1] = (v - .5) * 2 * T * aspect * Z; pos[n * 3 + 2] = -Z;
      uv[n * 2] = u; uv[n * 2 + 1] = v;
    }
    const idx = [];
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const a = j * (GW + 1) + i, b = a + 1, c = a + GW + 1, e = c + 1; idx.push(a, c, b, b, c, e); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, alphaMap: { value: alpha }, uHasAlpha: { value: alpha ? 1 : 0 }, uLevels: { value: 1 }, uBlack: { value: bk }, uWhite: { value: wh }, uGamma: { value: ga }, uFade: { value: 1 },
        flowMask: { value: flowTex }, uHasFlow: { value: flowTex && (!o.flow.layers || o.flow.layers.includes(k)) ? 1 : 0 }, uFlow: { value: o.flow?.amount ?? 1 }, uFlowDir: { value: new THREE.Vector2(...(o.flow?.dir || [0, 0])) },
        uFlowPeriod: { value: o.flow?.period ?? 1.6 }, uTime: { value: 0 },
        uFogCol: { value: new THREE.Color(...(o.fog?.color || [.8, .82, .85])) }, uFogDen: { value: o.fog?.density ?? 0 }, uFogNoise: { value: o.fog?.noise ?? .8 },
        uFogScale: { value: o.fog?.scale ?? .08 }, uFogWind: { value: new THREE.Vector3(...(o.fog?.wind || [1.5, 0, 0])) },
        uFogY0: { value: o.fog?.y0 ?? -100 }, uFogY1: { value: o.fog?.y1 ?? 100 } },
      vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide,
    });
    m.alphaToCoverage = true;
    const mesh = new THREE.Mesh(geo, m); mesh.renderOrder = k; mesh.name = `${o.id}_L${k}`;
    g.add(mesh); mats.push(m);
  }
  g.userData = { meta, T, aspect, mats, zNear: o.zNear, zFar: o.zFar };
  g.setFade = f => mats.forEach(m => m.uniforms.uFade.value = f);
  g.setTime = t => mats.forEach(m => m.uniforms.uTime.value = t);
  g.setFog = f => mats.forEach(m => { const u = m.uniforms; if (f.density !== undefined) u.uFogDen.value = f.density; if (f.color) u.uFogCol.value.setRGB(...f.color); });
  return g;
}
