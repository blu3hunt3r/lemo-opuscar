// The James Caird, built in code: a 22 ft 6 in (6.9 m) double-ended whaler, ~6 ft (1.83 m) beam, decked over by McNish with canvas on a
// framework of sledge runners and box lids, leaving a small well aft; main and mizzen ("our little jigger") with reefed sails; deep-laden
// (about 1,000 lb of sand bags plus boulders), so little freeboard; ice on the bows, deck and rigging. Local frame: bow toward −z, y = 0 at the waterline.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry } from '/core/lib.js';

export const LOA = 6.9, BEAM = 1.83;
const hb = t => (BEAM / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.3)), 0.6);   // half-breadth at the sheer, t ∈ [−1 bow, 1 stern]
const sheer = t => 0.5 + 0.3 * t * t;                                                        // gunwale height above the waterline
const keel = t => -0.62 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(t), 6)));
const Z = t => t * LOA / 2;

export function makeBoat(THREE, env) {
  const R = mulberry(41), grp = new THREE.Group();
  const n3 = (x, y, z) => Math.sin(x * 3.1 + y * 1.7) * Math.cos(z * 2.3 - x) * .5 + Math.sin(z * 7.3 + y * 5.1) * .25 + Math.sin(x * 11. + z * 9.) * .15;

  // ---- hull (clinker strakes drawn as darker bands; ice on the bows and along the top strake)
  {
    const NS = 64, NV = 28, pos = [], col = [], idx = [];
    for (let i = 0; i <= NS; i++) {
      const t = -1 + 2 * i / NS, b = hb(t), s = sheer(t), k = keel(t);
      for (let j = 0; j <= NV; j++) {
        const v = -1 + 2 * j / NV, th = Math.abs(v) * Math.PI / 2;
        const x = Math.sign(v) * b * Math.pow(Math.sin(th), 0.75), y = k + (s - k) * (1 - Math.cos(th));
        pos.push(x, y, Z(t));
        const strake = Math.abs(v) * 9 % 1, edge = strake < .16 ? .55 : 1;           // lap shadows of the planks
        const top = Math.abs(v) > .93 ? 1.55 : 1;                                     // pale sheer strake (as in Hurley's launch photo)
        const ice = Math.min(1, Math.max(0, (-t - .25) * 1.6 + (y - .15) * 1.2 + n3(x * 4, y * 4, t * 9) * .55));   // the bows carry the most ice
        const wood = [.085 * edge * top, .07 * edge * top, .058 * edge * top];
        const icec = [.62, .7, .76];
        for (let c = 0; c < 3; c++) col.push(wood[c] + (icec[c] - wood[c]) * ice * .85);
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .42, metalness: 0, side: THREE.DoubleSide, envMap: env, envMapIntensity: 1.1 })));
  }
  // ---- canvas deck (bow → well) and a short after deck; crowned, sagging between the sledge-runner battens, iced in patches
  const WELL0 = .5, WELL1 = .84;                                                       // the well (cockpit), in t
  {
    const parts = [];
    for (const [t0, t1, ns] of [[-1, WELL0, 70], [WELL1, 1, 12]]) {
      const NV = 18, pos = [], col = [], idx = [];
      for (let i = 0; i <= ns; i++) {
        const t = t0 + (t1 - t0) * i / ns, b = hb(t) * 1.01, s = sheer(t);
        for (let j = 0; j <= NV; j++) {
          const v = -1 + 2 * j / NV, x = v * b;
          const sag = .035 * Math.pow(Math.abs(Math.sin(t * 9.5)), .7) * (1 - v * v);
          const y = s + .07 * (1 - v * v) - sag + .006;
          pos.push(x, y, Z(t));
          const ice = Math.min(1, Math.max(0, .35 + n3(x * 3, t * 6, x * 2 + t * 3) * .9 - t * .35));
          const canvas = [.19, .185, .165];
          for (let c = 0; c < 3; c++) col.push(canvas[c] + ([.66, .74, .8][c] - canvas[c]) * ice);
        }
      }
      for (let i = 0; i < ns; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeVertexNormals(); parts.push(g);
    }
    grp.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, envMap: env, envMapIntensity: .9 })));
    // the well: a dark floor just below the gunwale and a coaming
    const wl = Z(WELL1) - Z(WELL0), wb = hb((WELL0 + WELL1) / 2) * 1.6;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(wb, .05, wl), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: .9 }));
    floor.position.set(0, sheer(.67) - .32, (Z(WELL0) + Z(WELL1)) / 2); grp.add(floor);
    const coam = new THREE.MeshStandardMaterial({ color: new THREE.Color(.09, .075, .06), roughness: .5, envMap: env });
    for (const zz of [Z(WELL0), Z(WELL1)]) { const m = new THREE.Mesh(new THREE.BoxGeometry(wb * 1.05, .12, .05), coam); m.position.set(0, sheer(zz / (LOA / 2)) + .08, zz); grp.add(m); }
  }
  // ---- gunwale rails (pale), stem and stern posts, rudder and tiller
  const ice = new THREE.MeshStandardMaterial({ color: new THREE.Color(.3, .35, .4), roughness: .62, envMap: env, envMapIntensity: .75 });
  {
    const rail = new THREE.MeshStandardMaterial({ color: new THREE.Color(.3, .29, .26), roughness: .45, envMap: env });
    for (const sgn of [-1, 1]) {
      const pts = []; for (let i = 0; i <= 40; i++) { const t = -0.995 + 1.99 * i / 40; pts.push(new THREE.Vector3(sgn * hb(t) * 1.02, sheer(t) + .015, Z(t))); }
      grp.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, .03, 5), rail));
    }
    const post = new THREE.MeshStandardMaterial({ color: new THREE.Color(.07, .06, .05), roughness: .5, envMap: env });
    for (const t of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(.06, sheer(t) - keel(t) + .12, .09), post); m.position.set(0, (sheer(t) + keel(t)) / 2 + .06, Z(t)); grp.add(m); }
    const rud = new THREE.Mesh(new THREE.BoxGeometry(.04, .95, .45), post); rud.position.set(0, .1, Z(1) + .2); grp.add(rud);
    const til = new THREE.Mesh(new THREE.CylinderGeometry(.022, .028, 1.25, 6), post); til.rotation.x = Math.PI / 2 - .12; til.position.set(.04, sheer(1) + .12, Z(1) - .45); grp.add(til);
  }
  // ---- masts, yards, sails
  const mastMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(.075, .065, .055), roughness: .45, envMap: env });
  const MAIN = { z: Z(-.33), h: 3.7 }, MIZ = { z: Z(.9), h: 2.35 };
  for (const m of [MAIN, MIZ]) {
    const y0 = sheer(m.z / (LOA / 2));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.04, .06, m.h, 8), mastMat); mast.position.set(0, y0 + m.h / 2, m.z); grp.add(mast);
    m.top = new THREE.Vector3(0, y0 + m.h, m.z); m.y0 = y0;
  }
  const sailMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(.05, .047, .042), roughness: .85, side: THREE.DoubleSide, envMap: env, envMapIntensity: .5 });
  const sails = [];
  const mkSail = (c0, c1, c2, c3, belly) => {   // quad corners: tack, clew, peak, throat (local coords); belly = camber (m)
    const g = new THREE.PlaneGeometry(1, 1, 10, 10); const P = g.attributes.position, base = [];
    for (let i = 0; i < P.count; i++) {
      const s = P.getX(i) + .5, t = P.getY(i) + .5;
      const p = new THREE.Vector3().copy(c0).multiplyScalar((1 - s) * (1 - t)).addScaledVector(c1, s * (1 - t)).addScaledVector(c2, s * t).addScaledVector(c3, (1 - s) * t);
      base.push(p.x, p.y, p.z, s, t); P.setXYZ(i, p.x, p.y, p.z);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, sailMat); grp.add(m); sails.push({ g, base, belly }); return m;
  };
  // double-reefed lug mainsail and a small mizzen, sheeted almost fore-and-aft (hove to), a little to starboard
  mkSail(new THREE.Vector3(0, MAIN.y0 + 1.05, MAIN.z - .35), new THREE.Vector3(.28, MAIN.y0 + .95, MAIN.z + 1.65), new THREE.Vector3(.12, MAIN.y0 + 3.05, MAIN.z + 1.25), new THREE.Vector3(0, MAIN.y0 + 2.55, MAIN.z - .55), .2);
  mkSail(new THREE.Vector3(0, MIZ.y0 + .55, MIZ.z - .05), new THREE.Vector3(.18, MIZ.y0 + .5, MIZ.z + .95), new THREE.Vector3(.08, MIZ.y0 + 1.95, MIZ.z + .55), new THREE.Vector3(0, MIZ.y0 + 2.05, MIZ.z - .02), .12);
  // yards and booms
  for (const [a, b] of [[[0, MAIN.y0 + 2.5, MAIN.z - .6], [.13, MAIN.y0 + 3.1, MAIN.z + 1.3]], [[0, MAIN.y0 + 1.0, MAIN.z - .35], [.3, MAIN.y0 + .92, MAIN.z + 1.7]]]) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, A.distanceTo(B), 6), mastMat);
    sp.position.copy(A).add(B).multiplyScalar(.5); sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); grp.add(sp);
  }
  // ---- standing rigging, thick with ice
  {
    const lines = [], stem = new THREE.Vector3(0, sheer(-1) + .1, Z(-1)), stern = new THREE.Vector3(0, sheer(1) + .1, Z(1));
    const add = (A, B, r) => { lines.push(new THREE.TubeGeometry(new THREE.LineCurve3(A, B), 1, r, 4)); };
    add(MAIN.top, stem, .016);
    for (const s of [-1, 1]) { const tt = -.18; add(MAIN.top, new THREE.Vector3(s * hb(tt), sheer(tt), Z(tt)), .016); }
    add(MIZ.top, stern, .014);
    for (const s of [-1, 1]) { const tt = .78; add(MIZ.top, new THREE.Vector3(s * hb(tt), sheer(tt), Z(tt)), .013); }
    add(MAIN.top, MIZ.top, .011);
    grp.add(new THREE.Mesh(mergeGeometries(lines), ice));
  }
  // ---- ice lumps: along the gunwales, on the bows and the fore-deck
  {
    const ico = new THREE.IcosahedronGeometry(1, 1), N = 170, im = new THREE.InstancedMesh(ico, ice, N), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < N; i++) {
      let p;
      if (i < 120) { const t = -1 + 1.85 * Math.pow(R(), 1.6), s = R() < .5 ? -1 : 1; p = new THREE.Vector3(s * hb(t) * (.9 + R() * .14), sheer(t) + (R() - .3) * .06, Z(t)); }
      else { const t = -1 + .6 * R(), v = (R() * 2 - 1); p = new THREE.Vector3(v * hb(t) * .85, sheer(t) + .055 * (1 - v * v), Z(t)); }
      const sc = .018 + .045 * Math.pow(R(), 2);
      e.set(R() * 6, R() * 6, R() * 6); q.setFromEuler(e);
      const flat = i < 120 ? .5 : .22; if (i >= 120) { e.set(R() * .3, R() * 6, R() * .3); q.setFromEuler(e); }
      M.compose(p, q, new THREE.Vector3(sc * (1 + R()) * (i < 120 ? 1 : 1.8), sc * flat, sc * (1 + R() * 2) * (i < 120 ? 1 : 1.8))); im.setMatrixAt(i, M);
    }
    grp.add(im);
  }
  // ---- the helmsman: seated in the well, hood up, one arm to the tiller (the other five are under the canvas)
  {
    const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(.03, .03, .033), roughness: .9, envMap: env, envMapIntensity: .6 });
    const fig = new THREE.Group(), zz = Z(.69), y0 = sheer(.69) - .25;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.2, .42, 4, 10), cloth); torso.position.set(0, y0 + .45, 0); torso.rotation.x = -.18; torso.scale.set(1.15, 1, .85); fig.add(torso);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(.155, 14, 10), cloth); hood.position.set(0, y0 + .98, -.03); hood.scale.set(1, 1.12, 1.08); fig.add(hood);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(.12, .035, 6, 14), cloth); brim.position.set(0, y0 + .96, -.13); brim.rotation.y = .1; fig.add(brim);
    const face = new THREE.Mesh(new THREE.SphereGeometry(.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x010101, roughness: 1 })); face.position.set(0, y0 + .95, -.12); fig.add(face);
    const sh = new THREE.Mesh(new THREE.CapsuleGeometry(.11, .38, 4, 8), cloth); sh.rotation.z = Math.PI / 2; sh.position.set(0, y0 + .74, .02); fig.add(sh);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.065, .5, 4, 8), cloth); arm.position.set(.2, y0 + .58, .2); arm.rotation.set(1.05, 0, .35); fig.add(arm);
    fig.position.set(-.18, 0, zz); fig.rotation.y = .12; grp.add(fig);
  }
  grp.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  // sails flog a little in the gale (pure function of u)
  grp.userData.update = u => {
    for (const [k, S] of sails.entries()) {
      const P = S.g.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const [x, y, z, s, t] = S.base.slice(i * 5, i * 5 + 5);
        const b = S.belly * 4 * s * (1 - s) * (.6 + .4 * t) + .05 * s * t * Math.sin(u * 13 + s * 6 + k) + .03 * s * Math.sin(u * 21 + t * 9 + k * 2);
        P.setXYZ(i, x + b, y, z);
      }
      P.needsUpdate = true; S.g.computeVertexNormals();
    }
  };
  return grp;
}
