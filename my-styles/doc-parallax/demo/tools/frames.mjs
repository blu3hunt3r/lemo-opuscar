// Resumable frame renderer for long CPU renders (the library's video.mjs stops the whole render when one frame passes 30 s):
//   LIB=<library> node tools/frames.mjs <demo> --out <dir> [--fps 24] [--workers 3] [--q 'k=v'] [--timeout 180]
// Each worker opens its own page and renders every Nth frame (interleaved, so the heavy scenes are shared out), writing <out>/f_00000.jpg …
// Frames already on disk are skipped: after a crash or a stop, run it again and only the missing frames are rendered. Then encode:
//   ffmpeg -framerate 24 -i <out>/f_%05d.jpg -c:v libx264 -preset medium -crf 14 -pix_fmt yuv420p video.mp4
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const LIB = process.env.LIB || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { openDemo, closeServer } = await import(path.join(LIB, 'core/render/page.mjs'));
const args = process.argv.slice(2);
const take = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const out = take('--out'), fps = +take('--fps', 24), WK = +take('--workers', 3), q = take('--q', ''), TO = +take('--timeout', 180) * 1000;
const dir = args[0];
if (!dir || !out) { console.error('usage: node tools/frames.mjs <demo> --out <dir> [--fps 24] [--workers 3] [--q k=v] [--timeout 180]'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const probe = await openDemo(dir, { q }); const DUR = await probe.page.evaluate(() => window.DUR); await probe.browser.close();
const N = Math.round(DUR * fps), t0 = Date.now(), name = f => path.join(out, `f_${String(f).padStart(5, '0')}.jpg`);
let done = 0; for (let f = 0; f < N; f++) if (fs.existsSync(name(f))) done++;
console.log(`${N} frames, ${done} already on disk, ${WK} workers`);
let slow = 0;
await Promise.all([...Array(WK)].map(async (_, w) => {
  const todo = []; for (let f = w; f < N; f += WK) if (!fs.existsSync(name(f))) todo.push(f);
  if (!todo.length) return;
  const { browser, page } = await openDemo(dir, { q });
  for (const f of todo) {
    const s = Date.now();
    await page.evaluate(t => window.render(t), f / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95, timeout: TO });
    fs.writeFileSync(name(f) + '.tmp', buf); fs.renameSync(name(f) + '.tmp', name(f));
    const dt = (Date.now() - s) / 1000; slow = Math.max(slow, dt); done++;
    if (done % 30 === 0 || done === N) console.log(`${done}/${N}  last w${w} f${f} ${dt.toFixed(1)} s, slowest ${slow.toFixed(1)} s  ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
  await browser.close();
}));
closeServer(); console.log(`all ${N} frames on disk (slowest ${slow.toFixed(1)} s)`);
