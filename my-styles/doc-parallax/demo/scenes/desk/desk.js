// The record: a desk under a lamp with the map from Shackleton's "South" (1919) and the New-York Tribune of 4 Sep 1916 (both real,
// public-domain scans), two of Hurley's prints, a brass compass and a pencil. The James Caird's route draws on the map in red ink, then
// the camera tracks across the desk to the headline. Contract: same as the reconstruction scenes (scenes/_harness/harness.js).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mulberry, clamp, seg, ss, eio, lerp, track } from '/core/lib.js';

const loadTex = url => new Promise((res, rej) => new THREE.TextureLoader().load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, rej));
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function woodCanvas() {   // dark walnut: long grain lines bent by noise, a few knots, fine scratches
  const W = 2048, H = 1024, c = cv(W, H), x = c.getContext('2d'), R = mulberry(41);
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3b2416'); g.addColorStop(.5, '#46291a'); g.addColorStop(1, '#382215');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const knots = [[R() * W, R() * H, 30 + R() * 40], [R() * W, R() * H, 20 + R() * 30]];
  for (let i = 0; i < 520; i++) {
    let y = R() * H; const a = .04 + R() * .1, f1 = R() * .004 + .001, ph = R() * 9, dark = R() < .55;
    x.strokeStyle = dark ? `rgba(20,10,5,${a})` : `rgba(120,80,45,${a * .7})`; x.lineWidth = .6 + R() * 2.2; x.beginPath();
    for (let X = 0; X <= W; X += 16) {
      let yy = y + Math.sin(X * f1 + ph) * 14 + Math.sin(X * f1 * 3.7 + ph * 2) * 4;
      for (const [kx, ky, kr] of knots) { const dx = X - kx, dy = yy - ky, d2 = dx * dx + dy * dy; yy += dy / Math.sqrt(d2 + 1) * kr * Math.exp(-d2 / (kr * kr * 9)) * 1.4; }
      X ? x.lineTo(X, yy) : x.moveTo(X, yy);
    }
    x.stroke();
  }
  for (const [kx, ky, kr] of knots) { const rg = x.createRadialGradient(kx, ky, 0, kx, ky, kr); rg.addColorStop(0, 'rgba(15,7,3,.7)'); rg.addColorStop(1, 'rgba(15,7,3,0)'); x.fillStyle = rg; x.beginPath(); x.ellipse(kx, ky, kr * 1.6, kr * .7, 0, 0, 7); x.fill(); }
  x.strokeStyle = 'rgba(200,160,120,.06)'; x.lineWidth = 1;
  for (let i = 0; i < 160; i++) { const sx = R() * W, sy = R() * H, l = 20 + R() * 120, an = (R() - .5) * .6; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(an) * l, sy + Math.sin(an) * l); x.stroke(); }
  return c;
}
function dialCanvas() {   // a compass card: cream, degree ticks, the cardinal letters, a red north
  const S = 1024, c = cv(S, S), x = c.getContext('2d'), m = S / 2;
  x.fillStyle = '#e9dfc6'; x.beginPath(); x.arc(m, m, m, 0, 7); x.fill();
  x.strokeStyle = '#2a2219'; x.fillStyle = '#2a2219';
  for (let d = 0; d < 360; d += 2) { const a = d * Math.PI / 180, r0 = m * (d % 10 ? .86 : .8), r1 = m * .93; x.lineWidth = d % 10 ? 2 : 4; x.beginPath(); x.moveTo(m + Math.sin(a) * r0, m - Math.cos(a) * r0); x.lineTo(m + Math.sin(a) * r1, m - Math.cos(a) * r1); x.stroke(); }
  x.font = "600 120px 'Cormorant', serif"; x.textAlign = 'center'; x.textBaseline = 'middle';
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([s, d]) => { const a = d * Math.PI / 180; x.fillStyle = s === 'N' ? '#a8231c' : '#2a2219'; x.fillText(s, m + Math.sin(a) * m * .62, m - Math.cos(a) * m * .62); });
  x.lineWidth = 3; x.strokeStyle = '#2a2219'; x.beginPath(); x.arc(m, m, m * .97, 0, 7); x.stroke();
  return c;
}
// a sheet of paper lying on the desk: a subdivided plane in XZ, its edges lifted a little, optional fold ridges (fractions across)
function paper(w, h, { lift = .004, folds = [], seed = 3 } = {}) {
  const g = new THREE.PlaneGeometry(w, h, 96, Math.round(96 * h / w)); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv, R = mulberry(seed), ph = R() * 6;
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i), v = uv.getY(i), e = Math.min(u, 1 - u, v, 1 - v);
    let y = .0034 + lift * Math.pow(1 - Math.min(1, e / .12), 2) + .0012 * Math.sin(u * 7 + ph) * Math.sin(v * 5 + ph);   // never below the desk
    for (const f of folds) y += .0016 * Math.exp(-Math.pow((f.axis === 'u' ? u : v) - f.at, 2) / .00004) * (f.up ? 1 : -1);
    p.setY(i, y);
  }
  g.computeVertexNormals(); return g;
}

// o: { map: 'assets/raw/map1919.jpg', mapGeo(lon, lat) → [u, v] (0..1, v up), news: 'assets/tex/news_desk.jpg', prints: [urls] }
export async function build({ THREE: T3, renderer, atmos, pxH }, o = {}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050403);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .22;
  // desk
  const wood = new THREE.CanvasTexture(woodCanvas()); wood.colorSpace = THREE.SRGBColorSpace; wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.anisotropy = 8;
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: wood, bumpMap: wood, bumpScale: 1.2, roughness: .62, metalness: 0 }));
  desk.receiveShadow = true; scene.add(desk);
  // the map (real scan), with an ink layer on top for the route
  const mapTex = await loadTex(o.map); const MA = mapTex.image.height / mapTex.image.width;
  const MW = .62, MH = MW * MA;
  const mapG = paper(MW, MH, { lift: .005, folds: [{ axis: 'u', at: .5, up: true }, { axis: 'v', at: .5, up: false }], seed: 5 });
  const mapM = new THREE.Mesh(mapG, new THREE.MeshStandardMaterial({ map: mapTex, roughness: .92 })); mapM.receiveShadow = true; mapM.castShadow = true;
  mapM.position.set(-.18, .0006, .02); mapM.rotation.y = .035; scene.add(mapM);
  const inkC = cv(4096, Math.round(4096 * MA)), ink = inkC.getContext('2d'); const inkT = new THREE.CanvasTexture(inkC); inkT.colorSpace = THREE.SRGBColorSpace; inkT.anisotropy = 8;
  const inkM = new THREE.Mesh(mapG.clone(), new THREE.MeshStandardMaterial({ map: inkT, transparent: true, roughness: .5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  inkM.position.copy(mapM.position).add(new THREE.Vector3(0, .0004, 0)); inkM.rotation.copy(mapM.rotation); scene.add(inkM);
  // the newspaper (real scan), overlapping the map's right edge
  const newsTex = await loadTex(o.news); const NA = newsTex.image.height / newsTex.image.width;
  const NW = .58, NH = NW * NA;
  const newsM = new THREE.Mesh(paper(NW, NH, { lift: .007, folds: [{ axis: 'v', at: .5, up: true }], seed: 8 }), new THREE.MeshStandardMaterial({ map: newsTex, roughness: .95 }));
  newsM.castShadow = true; newsM.receiveShadow = true; newsM.position.set(.42, .0022, -.08); newsM.rotation.y = -.06; scene.add(newsM);
  const nInkC = cv(4096, Math.round(4096 * NA)), nInk = nInkC.getContext('2d'); const nInkT = new THREE.CanvasTexture(nInkC); nInkT.colorSpace = THREE.SRGBColorSpace;
  const nInkM = new THREE.Mesh(newsM.geometry.clone(), new THREE.MeshStandardMaterial({ map: nInkT, transparent: true, roughness: .5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  nInkM.position.copy(newsM.position).add(new THREE.Vector3(0, .0004, 0)); nInkM.rotation.copy(newsM.rotation); scene.add(nInkM);
  let lastU = -1;
  const underline = (k, [u0, u1, v]) => {   // a red pen stroke under a word of the headline, drawn left to right
    if (Math.abs(k - lastU) < 1e-4) return; lastU = k; nInk.clearRect(0, 0, nInkC.width, nInkC.height);
    if (k > 0) {
      const W = nInkC.width, H = nInkC.height, x0 = u0 * W, x1 = u1 * W, y = (1 - v) * H, R = mulberry(7), n = 30;
      nInk.strokeStyle = 'rgba(176,24,18,.95)'; nInk.lineCap = 'round';
      for (let i = 0; i < n * k; i++) {
        const a = i / n, b = Math.min(k, (i + 1) / n), wv = q => y + Math.sin(q * 3.1 + 1.3) * 4 + Math.sin(q * 9.7) * 1.4 - q * 6;
        nInk.lineWidth = 9 * Math.pow(Math.sin(Math.PI * Math.min(1, a + .05)), .5) + 2;
        nInk.beginPath(); nInk.moveTo(x0 + (x1 - x0) * a, wv(a)); nInk.lineTo(x0 + (x1 - x0) * b, wv(b)); nInk.stroke();
      }
    }
    nInkT.needsUpdate = true;
  };
  // two of Hurley's prints with their white borders, near the edges
  for (const [i, pr] of (o.prints || []).entries()) {
    const t = await loadTex(pr.url), A = t.image.height / t.image.width, w = pr.w ?? .15, h = w * A, b = .008;
    const card = new THREE.Mesh(paper(w + 2 * b, h + 2 * b, { lift: .003, seed: 20 + i }), new THREE.MeshStandardMaterial({ color: 0xe8e1d0, roughness: .8 }));
    const ph = new THREE.Mesh(paper(w, h, { lift: .003, seed: 20 + i }), new THREE.MeshStandardMaterial({ map: t, roughness: .45 }));
    ph.position.y = .0018; card.add(ph); card.position.set(...pr.pos); card.rotation.y = pr.rot ?? 0; card.castShadow = card.receiveShadow = ph.receiveShadow = true; scene.add(card);
  }
  // brass compass with a glass cover
  const brass = new THREE.MeshStandardMaterial({ color: 0xb48a42, metalness: 1, roughness: .32, envMapIntensity: 1.4 });
  const comp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.042, .045, .016, 64), brass); body.position.y = .008; comp.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.04, .003, 12, 64), brass); rim.rotation.x = Math.PI / 2; rim.position.y = .0165; comp.add(rim);
  const dialT = new THREE.CanvasTexture(dialCanvas()); dialT.colorSpace = THREE.SRGBColorSpace;
  const dial = new THREE.Mesh(new THREE.CircleGeometry(.037, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: dialT, roughness: .6 })); dial.position.y = .0162; comp.add(dial);
  const needle = new THREE.Group();
  const nN = new THREE.Mesh(new THREE.ConeGeometry(.004, .03, 4).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a1d16, roughness: .4 })); nN.position.x = .015;
  const nS = new THREE.Mesh(new THREE.ConeGeometry(.004, .03, 4).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: .4 })); nS.position.x = -.015;
  needle.add(nN, nS); needle.position.y = .0178; comp.add(needle);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(.04, 48, 16, 0, Math.PI * 2, 0, .45), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: .1, roughness: .03, metalness: 0, envMapIntensity: 2.5 }));
  glass.position.y = -.0005; glass.scale.y = .35; comp.add(glass);
  comp.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  comp.position.set(...(o.compass || [-.36, .002, .15])); scene.add(comp);
  // pencil
  const pencil = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.0042, .0042, .16, 6), new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: .5 })); shaft.rotation.z = Math.PI / 2; pencil.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.0042, .02, 6), new THREE.MeshStandardMaterial({ color: 0xc9a77c, roughness: .7 })); tip.rotation.z = -Math.PI / 2; tip.position.x = .09; pencil.add(tip);
  pencil.traverse(m => { if (m.isMesh) m.castShadow = true; });
  pencil.position.set(...(o.pencil || [.09, .0045, .3])); pencil.rotation.y = -.35; scene.add(pencil);
  // the lamp: a warm spot from the upper left, soft shadows; a cool fill from the room
  const spot = new THREE.SpotLight(0xffd6a8, 3.2, 4, .7, .9, 1.4); spot.position.set(-.35, 1.15, -.55); spot.target.position.set(.1, 0, .0);
  spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -.0004; spot.shadow.radius = 4; spot.shadow.camera.near = .3; spot.shadow.camera.far = 3;
  scene.add(spot, spot.target);
  scene.add(new THREE.HemisphereLight(0x9fb4d0, 0x2a1a10, .18));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const cam = new THREE.PerspectiveCamera(30, 16 / 9, .01, 10); scene.add(cam);
  const dust = atmos(cam, { n: 900, z0: .08, z1: 1.2, size: .0007, color: '#ffe2b8', opacity: .55, wind: [.012, .004], fall: .006, seed: 19, density: .6 });

  // map (u, v) and newspaper (u, v) → world (on the paper's surface)
  const onSheet = (mesh, w, h) => (u, v) => mesh.localToWorld(new THREE.Vector3((u - .5) * w, .006, (.5 - v) * h));
  mapM.updateMatrixWorld(); newsM.updateMatrixWorld();
  const mapW = onSheet(mapM, MW, MH), newsW = onSheet(newsM, NW, NH);
  const route = o.routeUV || (o.route || []).map(([lon, lat]) => o.mapGeo(lon, lat));   // map (u, v), v up
  const routePx = route.map(([u, v]) => [u * inkC.width, (1 - v) * inkC.height]);
  const L = [0]; for (let i = 1; i < routePx.length; i++) L.push(L[i - 1] + Math.hypot(routePx[i][0] - routePx[i - 1][0], routePx[i][1] - routePx[i - 1][1]));
  const headAt = k => {   // point along the route at fraction k of its length (map uv)
    const d = k * L[L.length - 1]; let i = 1; while (i < L.length - 1 && L[i] < d) i++;
    const f = (d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]); return [lerp(route[i - 1][0], route[i][0], f), lerp(route[i - 1][1], route[i][1], f)];
  };
  let lastK = -1;
  const drawRoute = k => {   // red ink: a slightly wavering pen line with a soft bleed, the start dot, a moving nib dot
    if (Math.abs(k - lastK) < 1e-4) return; lastK = k;
    ink.clearRect(0, 0, inkC.width, inkC.height); if (k <= 0 || !routePx.length) { inkT.needsUpdate = true; return; }
    const d = k * L[L.length - 1], pts = [routePx[0]];
    for (let i = 1; i < routePx.length; i++) { if (L[i] <= d) pts.push(routePx[i]); else { const f = (d - L[i - 1]) / (L[i] - L[i - 1]); pts.push([lerp(routePx[i - 1][0], routePx[i][0], f), lerp(routePx[i - 1][1], routePx[i][1], f)]); break; } }
    const S = inkC.width / 4096;
    for (const [w, col] of [[34 * S, 'rgba(150,18,14,.14)'], [15 * S, 'rgba(170,22,16,.97)']]) {
      ink.strokeStyle = col; ink.lineWidth = w; ink.lineCap = 'round'; ink.lineJoin = 'round'; ink.beginPath();
      pts.forEach((p, i) => i ? ink.lineTo(...p) : ink.moveTo(...p)); ink.stroke();
    }
    ink.fillStyle = 'rgba(176,24,18,1)';
    ink.beginPath(); ink.arc(...routePx[0], 22 * S, 0, 7); ink.fill();
    const h = pts[pts.length - 1]; ink.beginPath(); ink.arc(...h, (k < 1 ? 18 : 22) * S, 0, 7); ink.fill();
    inkT.needsUpdate = true;
  };

  const S = { scene, cam, mapW, newsW, headAt, drawRoute, underline, needle, dust };
  // state(u): u = seconds since the shot began (−0.6 … 7.8)
  const T = o.timing || { draw: [.3, 3.6], cross: [4.2, 5.5], push: [6.3, 7.2] };
  const headline = o.headline || [.262, .815];   // "Marooned" on the Tribune page (u, v)
  const mark = o.mark || [.2105, .3138, .8195];   // the underline under "Marooned": u0, u1, v
  S.state = u => {
    const k = eio(seg(u, ...T.draw)); drawRoute(k);
    underline(ss(seg(u, ...(T.mark || [5.6, 6.05]))), mark);
    needle.rotation.y = .35 + Math.sin(u * 1.7) * .05 * Math.exp(-u * .3);
    // camera: high over the map (the whole journey in view, leaning toward the nib), then across to the headline, then into the paper's white
    const hk = headAt(Math.max(.02, k)), H = mapW(...hk);
    const mid = mapW(...headAt(.5));
    const mapLook = mid.clone().lerp(H, .28);
    const mapDist = lerp(.62, .5, ss(seg(u, -.6, 4.4)));
    const nl = newsW(...headline);
    const c = ss(seg(u, ...T.cross));
    const look = mapLook.clone().lerp(nl, c);
    const dist = lerp(mapDist, .3, c) * lerp(1, .42, eio(seg(u, ...T.push)));
    const dir = new THREE.Vector3(-.18, 1, lerp(.42, .62, c)).normalize();
    const pos = look.clone().addScaledVector(dir, dist);
    dust.update(u + 1, { focus: dist, aper: .3, density: .55, cam: [pos.x, pos.z], pxH: pxH || 1350 });
    return { cam: { pos: pos.toArray(), look: look.toArray(), fov: 30 }, focus: dist, aper: 70, maxCoc: 14, bloom: { strength: .12, radius: .55, threshold: .9 } };
  };
  return S;
}
