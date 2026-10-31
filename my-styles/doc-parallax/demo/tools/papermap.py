"""Fallback paper map (used only if no period map scan is available): Natural Earth land (public domain) drawn like an engraved chart
on cream paper: orthographic projection, graticule, coast in sepia with a stipple, period place names. Writes assets/tex/papermap.jpg and
assets/tex/papermap_geo.json ({lon0, lat0, k (px per radian), cx, cy, w, h}) so the page can place the route exactly."""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
D = sys.argv[1]; RAW = os.path.join(D, 'assets', 'raw'); OUT = os.path.join(D, 'assets', 'tex')
W, H = 4400, 3300; lon0, lat0 = -46.0, -65.0
s0, c0 = math.sin(math.radians(lat0)), math.cos(math.radians(lat0))
def P(lon, lat):
    f, l = math.radians(lat), math.radians(lon - lon0)
    return math.cos(f) * math.sin(l), c0 * math.sin(f) - s0 * math.cos(f) * math.cos(l)
x0, _ = P(-74, -64); x1, _ = P(-22, -64); _, ya = P(-46, -80.5); _, yb = P(-46, -50.5)
k = min(W * .92 / (x1 - x0), H * .92 / (yb - ya)); cx, cy = W / 2, H / 2 + (ya + yb) / 2 * k
px = lambda lon, lat: (cx + P(lon, lat)[0] * k, cy - P(lon, lat)[1] * k)
rng = np.random.default_rng(7)
paper = np.ones((H, W, 3), np.float32) * np.array([232, 220, 192], np.float32) / 255
n = rng.normal(0, 1, (H // 4, W // 4)).astype(np.float32); n = np.asarray(Image.fromarray(n).resize((W, H), Image.BICUBIC))
paper *= (1 + .025 * n)[..., None]
yy, xx = np.mgrid[0:H, 0:W]; r = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2)); paper *= (1 - .18 * np.clip(r - .55, 0, 1) ** 1.5)[..., None]
img = Image.fromarray((np.clip(paper, 0, 1) * 255).astype(np.uint8)); d = ImageDraw.Draw(img, 'RGBA')
ink, faint = (58, 40, 26, 255), (90, 66, 44, 120)
for lat in range(-80, -49, 5): d.line([px(lon, lat) for lon in range(-80, -14)], fill=faint, width=3)
for lon in range(-80, -14, 10): d.line([px(lon, lat) for lat in range(-82, -48)], fill=faint, width=3)
geo = json.load(open(os.path.join(RAW, 'land.geojson')))
for f in geo['features']:
    g = f['geometry']; polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates'] if g['type'] == 'MultiPolygon' else []
    shelf = f.get('properties', {}).get('kind') == 'ice_shelf'
    for poly in polys:
        ring = [px(lo, la) for lo, la in poly[0]]
        if len(ring) < 3: continue
        d.polygon(ring, fill=(214, 200, 168, 255) if not shelf else (226, 216, 194, 255))
        d.line(ring + [ring[0]], fill=ink if not shelf else faint, width=4 if not shelf else 3)
# stipple along coasts (engraved look): small dots just offshore
fs = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf', 64); fb = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf', 56)
fl = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf', 42)
def label(t, lon, lat, f, sp=10):
    X, Y = px(lon, lat); tw = sum(d.textlength(ch, font=f) + sp for ch in t) - sp; x = X - tw / 2
    for ch in t: d.text((x, Y), ch, font=f, fill=ink, anchor='lm'); x += d.textlength(ch, font=f) + sp
label('WEDDELL SEA', -40, -70.5, fs, 18); label('GRAHAM LAND', -63.5, -67.5, fb, 8); label('ELEPHANT I.', -55, -62.1, fb, 6)
label('SOUTH GEORGIA', -36.6, -55.3, fb, 6); label('SCOTIA SEA', -44, -58.4, fs, 14); label('SOUTH ORKNEYS', -45, -61.6, fl, 4)
for lat in range(-75, -49, 5): X, Y = px(-72.5, lat); d.text((X, Y), f'{-lat}°', font=fl, fill=ink, anchor='mm')
for lon in range(-70, -19, 10): X, Y = px(lon, -51.2); d.text((X, Y), f'{-lon}°', font=fl, fill=ink, anchor='mm')
d.rectangle([60, 60, W - 60, H - 60], outline=ink, width=6); d.rectangle([84, 84, W - 84, H - 84], outline=ink, width=2)
img = img.filter(ImageFilter.GaussianBlur(.6))
img.save(os.path.join(OUT, 'papermap.jpg'), quality=92)
json.dump({'lon0': lon0, 'lat0': lat0, 'k': k, 'cx': cx, 'cy': cy, 'w': W, 'h': H}, open(os.path.join(OUT, 'papermap_geo.json'), 'w'))
print('papermap', W, H)
