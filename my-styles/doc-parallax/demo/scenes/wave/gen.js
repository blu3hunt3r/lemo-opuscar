// Procedural textures, made once at build time on the GPU (no image files):
//   noise atlas (RGBA, tileable): R cloud fbm · G second fbm · B foam (cells + fbm) · A ridged streaks
//   ripple map (RGBA, tileable): RG slope of a directional sum of small waves, B its height
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const COMMON = /* glsl */`
varying vec2 vUv;
vec2 h2(vec2 p, float s){ p = vec2(dot(p, vec2(127.1, 311.7)) + s, dot(p, vec2(269.5, 183.3)) + s * 1.7); return -1. + 2. * fract(sin(p) * 43758.5453); }
float h1(vec2 p, float s){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + s) * 43758.5453); }
// tileable gradient noise, period P cells
float gn(vec2 x, float P, float s){
  vec2 i = floor(x), f = fract(x), u = f * f * f * (f * (f * 6. - 15.) + 10.);
  float a = dot(h2(mod(i, P), s), f), b = dot(h2(mod(i + vec2(1, 0), P), s), f - vec2(1, 0));
  float c = dot(h2(mod(i + vec2(0, 1), P), s), f - vec2(0, 1)), d = dot(h2(mod(i + vec2(1, 1), P), s), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 uv, float P, float s, int oct, float gain){
  float t = 0., a = .5, n = 0.;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; t += a * gn(uv * P, P, s + float(i) * 13.1); n += a; P *= 2.; a *= gain; }
  return t / n;
}
// tileable worley: (F1, F2)
vec2 worley(vec2 uv, float P, float s){
  vec2 x = uv * P, i = floor(x), f = fract(x); float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = vec2(float(xx), float(y)), c = mod(i + g, P);
    vec2 o = vec2(h1(c, s), h1(c, s + 5.3));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2);
}
`;
const NOISE_FS = COMMON + /* glsl */`
void main(){
  vec2 uv = vUv;
  float r = fbm(uv, 4., 1., 7, .55) * .5 + .5;
  float g = fbm(uv + vec2(.31, .17), 8., 7., 6, .5) * .5 + .5;
  // foam: bubbly cell walls, broken up by fbm (white = foam)
  // foam: soft blotches of lace with dark holes of many sizes (no cell-wall networks)
  vec2 w1 = worley(uv, 22., 3.), w2 = worley(uv, 57., 9.);
  float holes = (.5 + .5 * smoothstep(.02, .5, w1.x)) * (.62 + .38 * smoothstep(.02, .42, w2.x));
  float lump = fbm(uv, 9., 4., 6, .55) * .5 + .5;
  float fine = fbm(uv, 48., 8., 3, .5) * .5 + .5;
  float b = clamp(smoothstep(.34, .78, lump + (fine - .5) * .25) * holes * (.75 + .5 * fine), 0., 1.);
  // ridged streaks
  float rd = 1. - abs(fbm(uv, 6., 21., 6, .5) * 2.);
  float a = pow(clamp(rd, 0., 1.), 3.);
  gl_FragColor = vec4(r, g, b, a);
}`;
const RIPPLE_FS = COMMON + /* glsl */`
void main(){
  vec2 uv = vUv; float h = 0.; vec2 sl = vec2(0.);
  for (int i = 0; i < 40; i++) {
    float fi = float(i);
    float ang = (h1(vec2(fi, 1.), 3.) - .5) * 2.4 + (fi < 6. ? 0. : (h1(vec2(fi, 2.), 4.) - .5) * 1.2);    // spread around +y (the wind)
    float km = floor(mix(2., 26., pow(h1(vec2(fi, 3.), 5.), 1.6)));
    vec2 m = floor(vec2(sin(ang), cos(ang)) * km + .5);
    if (dot(m, m) < 1.) m = vec2(0., 2.);
    float k = length(m), amp = pow(k, -1.45), ph = h1(vec2(fi, 4.), 6.) * 6.2832;
    float th = 6.2832 * dot(m, uv) + ph;
    h += amp * sin(th); sl += amp * 6.2832 * m * cos(th);
  }
  float n = fbm(uv, 16., 2., 4, .5);
  gl_FragColor = vec4(sl / 22. * .5 + .5, h * .25 + .5 + n * .1, 1.);
}`;

export function makeTextures(THREE, renderer) {
  const make = (fs, size) => {
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false });
    rt.texture.anisotropy = 4;
    const q = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs }));
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); q.render(renderer); renderer.setRenderTarget(prev);
    q.material.dispose(); q.dispose();
    return rt.texture;
  };
  return { noise: make(NOISE_FS, 1024), ripple: make(RIPPLE_FS, 512) };
}
