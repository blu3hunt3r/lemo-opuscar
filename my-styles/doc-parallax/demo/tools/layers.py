"""Archive photo → 3D photo layers for the page.
usage: .venv/bin/python -I tools/layers.py <project_dir> <id> [--bands 0.42,0.70] [--sky 0.08] [--edge 3] [--max 3200]

Reads assets/raw/<id>.jpg (a public-domain scan; see SOURCES.md) and writes to assets/tex/:
  <id>_L<k>.jpg   colour of depth band k (0 = farthest). Regions a nearer band covers are filled (push-pull membrane +
                  grain matched to the photo), so a small camera move reveals plausible background, never a hole.
  <id>_L<k>_a.png alpha of band k (band 0 is opaque). Feathered by --edge px, dilated 2 px under the nearer band.
  <id>_L<k>_d.png 16-bit disparity of band k, extended smoothly past its mask (so edge vertices don't stretch).
  <id>_L<k>_d.bin the same, float32 at the mesh grid (GW+1)×(GH+1), row 0 = top: what the page reads.
  <id>.json       { w, h, bands: [[lo, hi, median]...], sky }  (disparity in 0..1, 1 = nearest)
Depth: Depth Anything V2 Small (Apache-2.0, models/depth_anything_v2_small.onnx), relative disparity, normalised 2–98 %.
Bands split the disparity at --bands (or at automatic valleys of its histogram). --sky: disparity below this is sky (flat, farthest).
"""
import sys, os, json, argparse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import onnxruntime as ort
Image.MAX_IMAGE_PIXELS = None

ap = argparse.ArgumentParser()
ap.add_argument('dir'); ap.add_argument('id')
ap.add_argument('--bands', default=''); ap.add_argument('--sky', type=float, default=0.0)
ap.add_argument('--edge', type=float, default=3); ap.add_argument('--max', type=int, default=3200)
ap.add_argument('--res', type=int, default=518, help='depth model input (long side, multiple of 14)')
ap.add_argument('--crop', default='', help='trim the print border: left,top,right,bottom as fractions of the scan')
ap.add_argument('--blur', type=float, default=0, help='Gaussian sigma (px, at full scan size) against halftone moire')
a = ap.parse_args()
RAW = os.path.join(a.dir, 'assets', 'raw'); OUT = os.path.join(a.dir, 'assets', 'tex'); os.makedirs(OUT, exist_ok=True)
MODEL = os.path.join(a.dir, 'models', 'depth_anything_v2_small.onnx')

img = Image.open(os.path.join(RAW, a.id + '.jpg')).convert('RGB')
if a.crop:
    l, t, r, b = map(float, a.crop.split(','))
    img = img.crop((round(img.width * l), round(img.height * t), round(img.width * (1 - r)), round(img.height * (1 - b))))
if a.blur > 0:
    from PIL import ImageFilter
    img = img.filter(ImageFilter.GaussianBlur(a.blur))
if max(img.size) > a.max: img = img.resize((round(img.width * a.max / max(img.size)), round(img.height * a.max / max(img.size))), Image.LANCZOS)
W, H = img.size
rgb = np.asarray(img).astype(np.float32) / 255

# —— depth ——
s = a.res / max(W, H); dw, dh = max(14, round(W * s / 14) * 14), max(14, round(H * s / 14) * 14)
x = np.asarray(img.resize((dw, dh), Image.BICUBIC)).astype(np.float32) / 255
x = ((x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]).transpose(2, 0, 1)[None].astype(np.float32)
sess = ort.InferenceSession(MODEL, providers=['CPUExecutionProvider'])
d = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
lo, hi = np.percentile(d, 2), np.percentile(d, 98)
d = np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)
D = np.asarray(Image.fromarray(d.astype(np.float32)).resize((W, H), Image.BICUBIC))
D = np.clip(D, 0, 1)
if a.sky > 0: D = np.where(D < a.sky, 0, D)

# —— bands ——
if a.bands: cuts = [float(v) for v in a.bands.split(',')]
else:   # valleys of the smoothed histogram between 0.15 and 0.9
    hgram, _ = np.histogram(D, 64, (0, 1)); hs = ndi.gaussian_filter1d(hgram.astype(float), 2)
    val = [i for i in range(10, 58) if hs[i] < hs[i - 1] and hs[i] <= hs[i + 1]]
    val = sorted(val, key=lambda i: hs[i])[:2]; cuts = sorted((i + .5) / 64 for i in val) or [0.5]
edges = [0.0] + cuts + [1.01]
K = len(edges) - 1


def pushpull(val, known):
    """fill unknown pixels from a pyramid of known ones (smooth membrane fill; from Archive Light Table prep.py, MIT)"""
    if min(val.shape) < 4 or known.all():
        out = val.copy()
        if not known.all(): out[~known] = val[known].mean() if known.any() else 0.5
        return out
    h, w = val.shape; h2, w2 = (h + 1) // 2, (w + 1) // 2
    pv = np.zeros((h2 * 2, w2 * 2)); pk = np.zeros((h2 * 2, w2 * 2))
    pv[:h, :w] = val * known; pk[:h, :w] = known
    sv = pv.reshape(h2, 2, w2, 2).sum((1, 3)); sk = pk.reshape(h2, 2, w2, 2).sum((1, 3))
    coarse = pushpull(np.where(sk > 0, sv / np.maximum(sk, 1e-9), 0), sk > 0)
    up = np.asarray(Image.fromarray(coarse.astype(np.float32)).resize((w2 * 2, h2 * 2), Image.BILINEAR))[:h, :w]
    out = val.copy(); out[~known] = up[~known]; return out


def feather(mask, px):
    if px <= 0: return mask.astype(np.float32)
    return np.clip(ndi.gaussian_filter(mask.astype(np.float32), px * .6), 0, 1)


rng = np.random.default_rng(11)
lum = rgb.mean(2)
grain_sd = float(np.std(lum - ndi.gaussian_filter(lum, 1.5)))   # the photo's own fine grain
GW = 240; GH = max(2, round(GW * H / W))
meta = {'w': W, 'h': H, 'grid': [GW, GH], 'bands': [], 'sky': a.sky, 'grain': grain_sd}
for k in range(K):
    inband = D >= edges[k]                       # this band and everything nearer
    nearer = D >= edges[k + 1]                   # covered by the next band
    keep = inband & ~nearer
    # colour: fill the area the nearer band covers (shrink it 3 px so the fill meets real pixels under the edge)
    hole = ndi.binary_erosion(nearer, iterations=3) if k < K - 1 else np.zeros_like(nearer)
    col = rgb.copy()
    if hole.any():
        for c in range(3): col[..., c] = pushpull(rgb[..., c].astype(np.float64), ~hole).astype(np.float32)
        n = rng.normal(0, grain_sd, (H, W)).astype(np.float32)
        col = np.where(hole[..., None], np.clip(col + n[..., None], 0, 1), col)
    Image.fromarray((col * 255 + .5).astype(np.uint8)).save(os.path.join(OUT, f'{a.id}_L{k}.jpg'), quality=92, subsampling=0)
    # alpha: band 0 opaque; others = their region (this band and nearer), dilated 2 px, feathered
    if k > 0:
        m = ndi.binary_dilation(inband, iterations=2)
        Image.fromarray((feather(m, a.edge) * 255 + .5).astype(np.uint8)).save(os.path.join(OUT, f'{a.id}_L{k}_a.png'))
    # disparity surface of the band, extended smoothly beyond it (nearer areas → this band's own depth, not the nearer one)
    surf = pushpull(D.astype(np.float64), keep | (inband & (k == K - 1)))
    if k == 0: surf = np.where(keep, D, surf)
    surf = ndi.gaussian_filter(surf, 2)
    Image.fromarray(np.clip(surf * 65535 + .5, 0, 65535).astype(np.uint16)).save(os.path.join(OUT, f'{a.id}_L{k}_d.png'))
    # the same surface sampled at the mesh's vertex grid (float32, row 0 = top of the photo): what the page reads
    gy, gx = np.mgrid[0:GH + 1, 0:GW + 1]
    grid = ndi.map_coordinates(surf, [gy * (H - 1) / GH, gx * (W - 1) / GW], order=1).astype(np.float32)
    grid.tofile(os.path.join(OUT, f'{a.id}_L{k}_d.bin'))
    vals = D[keep] if keep.any() else D[inband]
    meta['bands'].append([edges[k], min(edges[k + 1], 1.0), float(np.median(vals)) if vals.size else edges[k], float(keep.mean())])
# a preview of the depth and the band split, for review
prev = np.stack([D, D, D], -1)
band_id = np.digitize(D, edges[1:-1])
tint = np.array([[.35, .45, 1], [.4, 1, .45], [1, .5, .35], [1, 1, .3]])[band_id]
Image.fromarray(((prev * .6 + tint * .4) * 255).astype(np.uint8)).resize((W // 3, H // 3)).save(os.path.join(OUT, f'{a.id}_depth_preview.jpg'), quality=85)
json.dump(meta, open(os.path.join(OUT, a.id + '.json'), 'w'), indent=1)
print(a.id, f'{W}x{H}', 'cuts', [round(c, 3) for c in cuts], 'bands', [[round(v, 3) for v in b] for b in meta['bands']], 'grain', round(grain_sd, 4))
