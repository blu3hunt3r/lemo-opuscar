// A public-domain photo as a 3D place: each depth band (tools/layers.py) is a grid mesh unprojected from the start camera.
// vertex = ray(uv) × Z, 1/Z = 1/zFar + d · (1/zNear − 1/zFar) with d the band's disparity (0 far … 1 near).
// From the start camera (origin, looking −z, horizontal fov hfov) the composite equals the original photo.
import * as THREE from 'three';

const loadTex = (url, srgb = true) => new Promise((res, rej) => new THREE.TextureLoader().load(url, t => {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; res(t);
}, undefined, rej));
const loadBin = async url => new Float32Array(await (await fetch(url)).arrayBuffer());

const VS = `
varying vec2 vUv; varying float vZ;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`;
const FS = `
uniform sampler2D map, alphaMap; uniform float uHasAlpha, uLevels, uBlack, uWhite, uGamma, uFade;
varying vec2 vUv; varying float vZ;
float cover(float a){ float w = max(fwidth(a), 1e-4); return clamp((a - .5) / w + .5, 0., 1.); }
void main(){
  float a = uHasAlpha > .5 ? texture2D(alphaMap, vUv).r : 1.;
  if (a < .02) discard;
  vec3 c = texture2D(map, vUv).rgb;
  // levels on the scan (black/white points, gamma): the archive's tones, set per photo; the grade happens in post
  c = pow(clamp((c - uBlack) / max(uWhite - uBlack, 1e-3), 0., 1.), vec3(uGamma));
  gl_FragColor = vec4(c * uFade, a);
}`;

// o: { base: 'assets/tex/', id, hfov, zNear, zFar, cover (≥ 1: extra margin round the frame), levels: [black, white, gamma] }
export async function photo3d(o) {
  const meta = await (await fetch(`${o.base}${o.id}.json`)).json();
  const [GW, GH] = meta.grid, aspect = meta.h / meta.w;
  const T = Math.tan(o.hfov * Math.PI / 360) * (o.cover ?? 1.06);
  const g = new THREE.Group(); g.name = o.id;
  const [bk, wh, ga] = o.levels || [0, 1, 1];
  const mats = [];
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
      uniforms: { map: { value: map }, alphaMap: { value: alpha }, uHasAlpha: { value: alpha ? 1 : 0 }, uLevels: { value: 1 }, uBlack: { value: bk }, uWhite: { value: wh }, uGamma: { value: ga }, uFade: { value: 1 } },
      vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide,
    });
    m.alphaToCoverage = true;
    const mesh = new THREE.Mesh(geo, m); mesh.renderOrder = k; mesh.name = `${o.id}_L${k}`;
    g.add(mesh); mats.push(m);
  }
  g.userData = { meta, T, aspect, mats, zNear: o.zNear, zFar: o.zFar };
  g.setFade = f => mats.forEach(m => m.uniforms.uFade.value = f);
  return g;
}
