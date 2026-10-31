"""Water mask for a photo's cinemagraph flow (photo3d `flow`): where the scan may move like water.
usage: .venv/bin/python -I tools/flowmask.py <project_dir> <id> [--disp lo,hi] [--lum lo,hi] [--rect x0,y0,x1,y1] [--feather px] [--inset px] [--show]
Reads assets/tex/<id>_D.png (disparity, from layers.py) and the photo as layers.py cut it (<id>_L<last>.jpg); writes assets/tex/<id>_flow.png.
--disp: disparity range of the water; --lum: luminance range (keeps rocks, people and boats out); --rect: fractions of the frame (x right, y down);
--inset: how far (px) the mask is pulled back from people, boats and rocks before feathering. Use about the feather: the flow then fades
to nothing at their outlines, so water moving past them never drags their edges (with a small inset their outlines shimmer)."""
import os, json, argparse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
ap = argparse.ArgumentParser(); ap.add_argument('dir'); ap.add_argument('id')
ap.add_argument('--disp', default='0,1'); ap.add_argument('--lum', default='0,1'); ap.add_argument('--rect', action='append', help='x0,y0,x1,y1 (repeatable: union)')
ap.add_argument('--feather', type=float, default=12); ap.add_argument('--inset', type=int, default=3); ap.add_argument('--show', action='store_true')
a = ap.parse_args()
T = os.path.join(a.dir, 'assets', 'tex'); meta = json.load(open(os.path.join(T, a.id + '.json')))
D = np.asarray(Image.open(os.path.join(T, a.id + '_D.png'))).astype(np.float32) / 65535
rgb = np.asarray(Image.open(os.path.join(T, f"{a.id}_L{len(meta['bands']) - 1}.jpg")).convert('RGB')).astype(np.float32) / 255
H, W = D.shape; lum = ndi.gaussian_filter(rgb.mean(2), 2)
d0, d1 = map(float, a.disp.split(',')); l0, l1 = map(float, a.lum.split(','))
yy, xx = np.mgrid[0:H, 0:W] / np.array([H, W])[:, None, None]
inr = np.zeros_like(D, bool)
for r in (a.rect or ['0,0,1,1']):
    x0, y0, x1, y1 = map(float, r.split(',')); inr |= (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
m = (D >= d0) & (D <= d1) & (lum >= l0) & (lum <= l1) & inr
m = ndi.binary_opening(m, iterations=2); m = ndi.binary_closing(m, iterations=4)
m = ndi.binary_erosion(m, iterations=a.inset)   # keep the flow off the edges of people and rocks
f = np.clip(ndi.gaussian_filter(m.astype(np.float32), a.feather * .5), 0, 1)
Image.fromarray((f * 255 + .5).astype(np.uint8)).save(os.path.join(T, a.id + '_flow.png'))
print(a.id, 'flow mask covers', round(float(f.mean()) * 100, 1), '% of the frame')
if a.show:
    prev = (rgb * .55 + np.stack([f * .9, f * .35, f * .1], -1) * .45)
    Image.fromarray((prev * 255).astype(np.uint8)).resize((W // 2, H // 2)).save(os.path.join(T, a.id + '_flow_preview.jpg'), quality=85)
