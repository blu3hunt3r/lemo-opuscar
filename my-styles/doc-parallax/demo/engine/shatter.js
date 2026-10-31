// Ice-crack shatter: the outgoing shot cracks from an impact point (lines race along a Voronoi fracture), then breaks into shards that
// tip, turn and fall toward the lens, revealing the incoming shot behind. Deterministic: everything is a function of the time since the
// transition began. The shards sample the outgoing frame (a render target), so they carry its graded picture exactly.
import * as THREE from 'three';
import { mulberry } from '/core/lib.js';

const ASP = 16 / 9;
const VS = `
attribute float edge; varying vec2 vUv; varying float vEdge; varying vec3 vN;
void main(){ vUv = uv; vEdge = edge; vN = normalize(normalMatrix * vec3(0., 0., 1.)); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const FS = `
uniform sampler2D tOld; uniform float uRim; varying vec2 vUv; varying float vEdge; varying vec3 vN;
void main(){
  vec3 c = texture2D(tOld, vUv).rgb;
  float lit = .72 + .28 * abs(vN.z) + .25 * max(0., vN.y);   // a tilted shard catches the light differently
  float rim = smoothstep(.955, 1., vEdge) * uRim;              // the broken edge glints
  gl_FragColor = vec4(c * lit + vec3(.9, .95, 1.) * rim, 1.);
}`;

function clip(poly, nx, ny, d) {   // keep the part of a convex polygon where nx*x + ny*y <= d
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nx * a[0] + ny * a[1] - d, db = nx * b[0] + ny * b[1] - d;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) { const u = da / (da - db); out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
  }
  return out;
}

// o: { impact: [x, y] in 0..1 screen coords (y down), n (shards), seed, crack (s), fall (s) }
export function shatter(o = {}) {
  const R = mulberry(o.seed ?? 9), imp = o.impact || [.6, .45];
  const I = [(imp[0] - .5) * ASP, .5 - imp[1]];             // impact in plane units (x right, y up; frame = ASP × 1)
  const seeds = [];
  for (let i = 0; i < (o.n ?? 44); i++) {
    if (i < (o.n ?? 44) * .65) { const r = Math.pow(R(), 1.7) * .75, a = R() * Math.PI * 2; seeds.push([I[0] + Math.cos(a) * r * 1.2, I[1] + Math.sin(a) * r]); }
    else seeds.push([(R() - .5) * ASP * 1.1, (R() - .5) * 1.1]);
  }
  const frame = [[-ASP / 2, -.5], [ASP / 2, -.5], [ASP / 2, .5], [-ASP / 2, .5]];
  const cells = seeds.map((s, i) => {
    let p = frame;
    seeds.forEach((q, j) => { if (j !== i && p.length) p = clip(p, q[0] - s[0], q[1] - s[1], (q[0] * q[0] + q[1] * q[1] - s[0] * s[0] - s[1] * s[1]) / 2); });
    return p;
  }).filter(p => p.length >= 3);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, ASP, .01, 20); const D = .5 / Math.tan(15 * Math.PI / 180);
  cam.position.set(0, 0, D); cam.lookAt(0, 0, 0); scene.add(cam);
  const U = { tOld: { value: null }, uRim: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide });
  let maxR = 0;
  const shards = cells.map(p => {
    const c = p.reduce((s, v) => [s[0] + v[0] / p.length, s[1] + v[1] / p.length], [0, 0]);
    const pos = [], uv = [], edge = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      for (const [v, e] of [[c, 0], [a, 1], [b, 1]]) { pos.push(v[0] - c[0], v[1] - c[1], 0); uv.push(v[0] / ASP + .5, v[1] + .5); edge.push(e); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
    const m = new THREE.Mesh(g, mat); m.position.set(c[0], c[1], 0); scene.add(m);
    const dx = c[0] - I[0], dy = c[1] - I[1], dist = Math.hypot(dx, dy); maxR = Math.max(maxR, dist);
    const ax = new THREE.Vector3(R() - .5, R() - .5, (R() - .5) * .4).normalize();
    return { m, c, dist, dir: [dx / (dist || 1), dy / (dist || 1)], ax, spin: (1.2 + R() * 1.6) * (R() < .5 ? -1 : 1), push: .6 + R() * .8, poly: p };
  });
  // crack segments: every Voronoi edge once, plus a few radial cracks from the impact
  const segs = [];
  const key = v => v.map(x => x.toFixed(4)).join(',');
  const seen = new Set();
  for (const s of shards) for (let i = 0; i < s.poly.length; i++) {
    const a = s.poly[i], b = s.poly[(i + 1) % s.poly.length], k = [key(a), key(b)].sort().join('|');
    if (seen.has(k)) continue; seen.add(k);
    const onFrame = v => Math.abs(Math.abs(v[0]) - ASP / 2) < 1e-6 || Math.abs(Math.abs(v[1]) - .5) < 1e-6;
    if (onFrame(a) && onFrame(b)) continue;   // the frame border is not a crack
    const da = Math.hypot(a[0] - I[0], a[1] - I[1]), db = Math.hypot(b[0] - I[0], b[1] - I[1]);
    segs.push(da < db ? { a, b, d0: da, d1: db } : { a: b, b: a, d0: db, d1: da });
  }
  const toPx = v => [(v[0] / ASP + .5) * 1920, (.5 - v[1]) * 1080];
  const crackT = o.crack ?? .32, fallT = o.fall ?? .62;

  return {
    scene, cam, dur: crackT + fallT,
    // u: seconds since the transition began; tex: the outgoing frame
    update(u, tex) {
      U.tOld.value = tex;
      const tb = u - crackT;
      U.uRim.value = Math.min(1, Math.max(0, (u - crackT * .6) / (crackT * .6)));
      for (const s of shards) {
        const k = Math.max(0, Math.min(1, (tb - .16 * s.dist / maxR) / fallT));
        const e = k * k;
        s.m.position.set(s.c[0] + s.dir[0] * (.05 * k + .35 * e) * s.push, s.c[1] + s.dir[1] * (.05 * k + .25 * e) * s.push - .9 * e, 1.1 * e * s.push);
        s.m.quaternion.setFromAxisAngle(s.ax, s.spin * e * 1.6);
        // a hairline offset when the crack reaches it, so the fracture reads before the fall
        const cr = Math.max(0, Math.min(1, (u - crackT * s.dist / maxR) / .06));
        if (k === 0) { s.m.position.x += s.dir[0] * .0016 * cr; s.m.position.y += s.dir[1] * .0016 * cr; }
      }
    },
    // the bright crack lines, drawn on the 2D overlay while the cracks run and as the shards part
    drawCracks(x, u) {
      const front = (u / crackT) * maxR * 1.05, fade = 1 - Math.max(0, Math.min(1, (u - crackT) / .25));
      if (u < 0 || fade <= 0) return;
      x.save(); x.lineCap = 'round'; x.globalAlpha = fade;
      x.strokeStyle = 'rgba(235,245,255,.95)'; x.shadowColor = 'rgba(190,225,255,.9)'; x.shadowBlur = 10; x.lineWidth = 2.2;
      x.beginPath();
      for (const s of segs) {
        if (front <= s.d0) continue;
        const k = Math.min(1, (front - s.d0) / Math.max(1e-4, s.d1 - s.d0));
        const A = toPx(s.a), B = toPx([s.a[0] + (s.b[0] - s.a[0]) * k, s.a[1] + (s.b[1] - s.a[1]) * k]);
        x.moveTo(...A); x.lineTo(...B);
      }
      x.stroke();
      // the impact: a small white star
      const P = toPx(I), r = 26 * Math.min(1, u / .06) * fade;
      const g = x.createRadialGradient(P[0], P[1], 0, P[0], P[1], r * 3); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(P[0], P[1], r * 3, 0, 7); x.fill();
      x.restore();
    },
  };
}
