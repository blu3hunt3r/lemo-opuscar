// The map: public-domain Natural Earth land drawn by code (STYLE.md §2), orthographic projection centred on the story,
// paper land on a dark sea, a faint graticule, mono caps labels; the route is a separate canvas redrawn per frame in the signal red.
// Both are planes in a small 3D scene (the route a few cm above the paper) so the camera can drift over them.
import * as THREE from 'three';
import { mulberry } from '/core/lib.js';

export const MAPC = { land: '#d8cfbd', landShade: '#cbc1ac', sea: '#1c2228', coast: '#8d8576', grat: 'rgba(216,207,189,.16)', ink: '#2a2620', red: '#d7322b' };
const D2R = Math.PI / 180;
export function ortho(lon0, lat0) {
  const s0 = Math.sin(lat0 * D2R), c0 = Math.cos(lat0 * D2R);
  return (lon, lat) => {
    const f = lat * D2R, l = (lon - lon0) * D2R;
    return [Math.cos(f) * Math.sin(l), c0 * Math.sin(f) - s0 * Math.cos(f) * Math.cos(l)];
  };
}

// o: { geo (GeoJSON), lon0, lat0, scale (map units per projected unit), W, H (map plane in metres), ppm, labels: [[text, lon, lat, size, align]] }
export function mapScene(o) {
  const P = ortho(o.lon0, o.lat0), k = o.scale;
  const toXY = (lon, lat) => { const [x, y] = P(lon, lat); return [x * k, y * k]; };
  const cw = Math.round(o.W * o.ppm), ch = Math.round(o.H * o.ppm);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d');
  const px = ([mx, my]) => [cw / 2 + mx * o.ppm, ch / 2 - my * o.ppm];
  x.fillStyle = MAPC.sea; x.fillRect(0, 0, cw, ch);
  // graticule
  x.strokeStyle = MAPC.grat; x.lineWidth = 1.2;
  for (let lat = -85; lat <= -45; lat += 5) { x.beginPath(); for (let lon = -90; lon <= 0; lon += 1) { const p = px(toXY(lon, lat)); lon === -90 ? x.moveTo(...p) : x.lineTo(...p); } x.stroke(); }
  for (let lon = -90; lon <= 0; lon += 10) { x.beginPath(); for (let lat = -85; lat <= -45; lat += 1) { const p = px(toXY(lon, lat)); lat === -85 ? x.moveTo(...p) : x.lineTo(...p); } x.stroke(); }
  // land
  const polys = [];
  for (const f of o.geo.features) {
    const g = f.geometry; if (!g) continue;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of list) polys.push(poly);
  }
  x.beginPath();
  for (const poly of polys) for (const ring of poly) ring.forEach(([lon, lat], i) => { const p = px(toXY(lon, lat)); i ? x.lineTo(...p) : x.moveTo(...p); });
  x.fillStyle = MAPC.land; x.fill('evenodd');
  x.save(); x.clip('evenodd');
  const R = mulberry(3);   // paper grain on the land only
  for (let i = 0; i < cw * ch / 90; i++) { x.fillStyle = R() < .5 ? 'rgba(80,70,50,.07)' : 'rgba(255,250,235,.08)'; x.fillRect(R() * cw, R() * ch, 1 + R() * 2, 1 + R() * 2); }
  x.restore();
  x.strokeStyle = MAPC.coast; x.lineWidth = 1.6; x.stroke();
  // labels
  for (const [s, lon, lat, size, align, col] of o.labels || []) {
    const [lx, ly] = px(toXY(lon, lat));
    x.font = `500 ${size}px 'Plex Mono'`; x.textAlign = align || 'left'; x.textBaseline = 'middle'; x.fillStyle = col || 'rgba(216,207,189,.8)';
    let cx = lx; const tr = size * .14;
    if ((align || 'left') === 'left') for (const chh of s) { x.fillText(chh, cx, ly); cx += x.measureText(chh).width + tr; }
    else { x.textAlign = 'center'; x.fillText(s.split('').join(String.fromCharCode(8202)), lx, ly); }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(MAPC.sea);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(o.W, o.H), new THREE.MeshBasicMaterial({ map: tex })); scene.add(paper);
  // route layer: redrawn per frame
  const rc = document.createElement('canvas'); rc.width = cw; rc.height = ch; const rx = rc.getContext('2d');
  const rtex = new THREE.CanvasTexture(rc); rtex.colorSpace = THREE.SRGBColorSpace;
  const route = new THREE.Mesh(new THREE.PlaneGeometry(o.W, o.H), new THREE.MeshBasicMaterial({ map: rtex, transparent: true, depthWrite: false }));
  route.position.z = .02; scene.add(route);
  // draw(paths): [{ pts: [[lon, lat]...], k (0..1 drawn), width, dash, color, head }]
  const draw = paths => {
    rx.clearRect(0, 0, cw, ch);
    for (const p of paths) {
      const pts = p.pts.map(([lon, lat]) => px(toXY(lon, lat)));
      const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const tot = L[L.length - 1] * p.k; if (tot <= 0) continue;
      rx.strokeStyle = p.color || MAPC.red; rx.lineWidth = p.width || 6; rx.lineCap = 'round'; rx.lineJoin = 'round'; rx.setLineDash(p.dash || []);
      rx.beginPath(); rx.moveTo(...pts[0]); let head = pts[0];
      for (let i = 1; i < pts.length; i++) {
        if (L[i] <= tot) { rx.lineTo(...pts[i]); head = pts[i]; }
        else { const u = (tot - L[i - 1]) / (L[i] - L[i - 1]); head = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]; rx.lineTo(...head); break; }
      }
      rx.stroke(); rx.setLineDash([]);
      if (p.head && p.k < 1) { rx.fillStyle = p.color || MAPC.red; rx.beginPath(); rx.arc(...head, (p.width || 6) * 1.6, 0, 7); rx.fill(); }
      for (const [lon, lat] of p.dots || []) { const q = px(toXY(lon, lat)); rx.fillStyle = p.color || MAPC.red; rx.beginPath(); rx.arc(...q, (p.width || 6) * 1.3, 0, 7); rx.fill(); }
    }
    rtex.needsUpdate = true;
  };
  return { scene, draw, toWorld: (lon, lat) => { const [mx, my] = toXY(lon, lat); return [mx / 1, my / 1]; } };
}
