// Runs the bake page headless and writes the light maps + unwrapped wall geometry to lm/.
// usage (from the library root): node films/wing-c/tools/bake.mjs [--spp 16] [--wall 1536] [--plan 1024] [--passes 0,10]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = process.env.LIB || path.resolve(HERE, '../..');
const { openDemo } = await import(path.join(LIB, 'core/render/page.mjs'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const q = `spp=${arg('spp', 16)}&wall=${arg('wall', 1536)}&plan=${arg('plan', 1024)}`;
const only = arg('passes', null);
const OUT = path.join(HERE, 'lm'); fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const { browser, page } = await openDemo(path.join(HERE, 'bake'), { w: 64, h: 64, q });
page.on('console', m => { if (m.text().startsWith('[bake]')) console.log(m.text(), `(+${((Date.now() - t0) / 1000).toFixed(0)} s)`); });
const files = new Map();
await page.exposeFunction('SAVE', (name, b64, part) => {
  const buf = Buffer.from(b64, 'base64');
  fs[part === 0 ? 'writeFileSync' : 'appendFileSync'](path.join(OUT, name), buf);
  files.set(name, (files.get(name) || 0) + buf.length);
});
const manifest = await page.evaluate(o => window.BAKE(o), only ? only.split(',').map(Number) : null);
fs.writeFileSync(path.join(OUT, only ? 'manifest_partial.json' : 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`baked ${manifest.maps.length} maps, ${files.size} files, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await browser.close();
process.exit(0);   // the library page server keeps the event loop alive
