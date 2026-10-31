// The camera operator's shoes (technique from the Liminal Found Footage demo): extruded footprint + bevel, sole, laces.
// Moving things are not in the bake: they are lit from the floor light map under them (look.js dynMat).
import * as THREE from 'three';
import { dynMat } from './look.js';
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// —— The camera operator's shoes: when looking down only the toes and a strip of carpet show (trouser legs stay out of frame) ——
// Shoe = extruded footprint outline + bevel (upper) + a slightly larger light-coloured sole + laces + toe stitching; +z is the toe
function shoeGeo(w, L, h, bevel) {
  const sh = new THREE.Shape(), n = 40;
  for (let k = 0; k <= n; k++) {       // top-view outline: round toe, wide forefoot, narrow arch, round heel
    const a = k / n * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    const zf = sn;                      // -1 heel … +1 toe
    const wid = w / 2 * (0.78 + 0.22 * Math.sin((zf + 1) / 2 * Math.PI * 1.1)) * (zf > .55 ? Math.sqrt(Math.max(0, 1 - ((zf - .55) / .5) ** 2)) * .35 + .65 : 1);
    const x = c * wid - (zf > 0 ? .006 * zf : 0), z = zf * L / 2;
    k ? sh.lineTo(x, z) : sh.moveTo(x, z);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * .8, bevelSegments: 4, curveSegments: 24 });
  g.rotateX(-Math.PI / 2); g.scale(1, 1, -1);   // outline plane → ground, extrusion direction → up
  return g;
}
export function makeLegs(scene) {
  const g = new THREE.Group(); scene.add(g);
  const leather = dynMat('#2a2521', { shin: 60, spec: .14 }), sole = dynMat('#6b6457'), laceM = dynMat('#3a342e'), stitch = dynMat('#4a4239');
  const upperG = shoeGeo(.1, .28, .045, .025), soleG = shoeGeo(.112, .295, .012, .004);
  const parts = [0, 1].map(() => {
    const s = new THREE.Group();
    const so = new THREE.Mesh(soleG, sole); so.position.y = .004;
    const up = new THREE.Mesh(upperG, leather); up.position.y = .02; up.scale.set(1, 1, 1);
    // Upper higher at the front than the back: the "tongue/lace area" in the front half bulges up
    const tongue = new THREE.Mesh(new THREE.CapsuleGeometry(.03, .08, 4, 10), leather); tongue.rotation.x = Math.PI / 2 - .25; tongue.scale.set(1.2, 1, .7); tongue.position.set(0, .085, -.02);
    s.add(so, up, tongue);
    for (let k = 0; k < 4; k++) { const l = new THREE.Mesh(new THREE.BoxGeometry(.05, .006, .007), laceM); l.position.set(0, .1 - k * .006, -.05 + k * .022); l.rotation.x = -.25; s.add(l); }
    const cap = new THREE.Mesh(new THREE.TorusGeometry(.04, .0025, 4, 20, Math.PI), stitch); cap.rotation.x = -Math.PI / 2; cap.position.set(0, .085, .07); s.add(cap);
    g.add(s);
    return { s };
  });
  // body = {x, z, yaw, phase, amp} (phase = gait phase, amp = stride 0..1)
  g.pose = (b) => {
    const fw = V(-Math.sin(b.yaw), 0, -Math.cos(b.yaw)), rt = V(Math.cos(b.yaw), 0, -Math.sin(b.yaw));
    parts.forEach((p, i) => {
      const sd = i ? 1 : -1, ph = b.phase + i * Math.PI;
      const fwd = Math.sin(ph) * .26 * b.amp + .15, lift = Math.max(0, Math.cos(ph)) * .06 * b.amp;
      const ank = V(b.x, 0, b.z).addScaledVector(fw, fwd).addScaledVector(rt, sd * (.11 + b.stance));
      p.s.position.copy(ank).setY(lift);
      p.s.rotation.set(0, b.yaw + Math.PI - sd * .1, 0);   // +z (toe) forward, slightly toed out
      p.s.rotateX(Math.max(0, Math.cos(ph)) * .2 * b.amp);
    });
  };
  return g;
}

