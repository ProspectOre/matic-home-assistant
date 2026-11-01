// Offline synthetic gallery qualification. No Home Assistant or robot traffic.
// Example: node scripts/measure_map_capacity.mjs --checkout /tmp/baseline --points 1200000 --cycles 20 --soak-seconds 1800
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { cpus, platform, arch } from 'node:os';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({ options: {
  checkout: { type: 'string', default: '.' }, points: { type: 'string', default: '1200000' },
  cycles: { type: 'string', default: '20' }, 'soak-seconds': { type: 'string', default: '1800' },
  'sample-seconds': { type: 'string', default: '60' }, headed: { type: 'boolean', default: false },
} });
const integer = (name, minimum, maximum) => {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw Error(`Invalid ${name}: ${values[name]}`);
  return value;
};
const points = integer('points', 1, 1500000), cycles = integer('cycles', 1, 100);
const soakSeconds = integer('soak-seconds', 0, 1800), sampleSeconds = integer('sample-seconds', 1, 300);
const root = resolve(values.checkout), files = new Map();
async function readScripts(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const key = prefix + entry.name;
    if (entry.isDirectory()) await readScripts(join(directory, entry.name), `${key}/`);
    else if (key.endsWith('.js')) files.set(key, await readFile(join(directory, entry.name)));
  }
}
await readScripts(join(root, 'custom_components/matic_robot/map_studio_v4'));
await readScripts(join(root, 'tests/browser/.generated/map-studio-v4-review'));
const hash = createHash('sha256');
for (const [path, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(path).update('\0').update(content).update('\0');
const bundleHash = hash.digest('hex');
const harnessHash = createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
const stamp = JSON.parse(await readFile(join(root, 'tests/browser/.generated/map-studio-v4-review/source-stamp.json'), 'utf8'));
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname.slice(1);
  response.setHeader('Cache-Control', 'no-store');
  if (!path) {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%}</style><script type="module">import "/index.js"; import "/review.js";</script>');
  } else if (files.has(path)) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(files.get(path).toString().replaceAll('"/map_studio_v4/', '"/'));
  } else { response.writeHead(404); response.end(); }
});
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: !values.headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(() => customElements.whenDefined('matic-map-studio-gallery-v0-4-0'));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const fixture = await page.evaluate(async count => {
    const gallery = document.createElement('matic-map-studio-gallery-v0-4-0');
    gallery.controls = false; document.body.append(gallery);
    await gallery.updateComplete;
    const state = gallery.getWorkspaceSnapshot(), old = state.resources.scene.value;
    const buffer = new ArrayBuffer(old.pointOffset + count * 8), bytes = new Uint8Array(buffer);
    bytes.set(new Uint8Array(old.buffer, 0, old.pointOffset));
    const view = new DataView(buffer); view.setUint32(16, count, true); view.setUint32(20, 0, true);
    for (let i = 0; i < count; i++) {
      const p = old.pointOffset + i * 8;
      view.setUint16(p, 10 + i % 160, true); view.setUint16(p + 2, 10 + Math.floor(i / 160) % 120, true);
      view.setUint8(p + 4, i % 20); view.setUint8(p + 5, 180); view.setUint8(p + 6, 200); view.setUint8(p + 7, 210);
    }
    window.__capacity = { state, buffer, pointOffset: old.pointOffset };
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return { points: count, bytes: buffer.byteLength, sha256: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('') };
  }, points);
  const mount = async () => {
    await page.evaluate(async () => {
      document.querySelector('matic-map-studio-gallery-v0-4-0')?.remove();
      const gallery = document.createElement('matic-map-studio-gallery-v0-4-0'); gallery.controls = false; document.body.append(gallery);
      await gallery.updateComplete;
    });
    await page.locator('matic-map-studio-gallery-v0-4-0').getByRole('button', { name: '3D', exact: true }).click();
    return page.evaluate(async count => {
    const gallery = document.querySelector('matic-map-studio-gallery-v0-4-0');
    const state = gallery.getWorkspaceSnapshot(), previous = state.resources.scene.value;
    state.resources.scene.value = { ...previous, buffer: window.__capacity.buffer.slice(0), floorCount: count, surfaceCount: 0, total: count, revision: previous.revision + 1 };
    const start = performance.now(); gallery.replaceWorkspaceState(state); await gallery.updateComplete;
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const snapshot = gallery.getWorkspaceSnapshot();
    return { elapsedMs: performance.now() - start, admitted: snapshot.resources.scene.value.total, view: snapshot.view };
    }, points);
  };
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const usage = await cdp.send('Runtime.getHeapUsage'); return { usedBytes: usage.usedSize, backingStorageBytes: usage.backingStorageSize ?? null }; };
  await mount();
  const baselineHeap = await heap(), replacements = [];
  for (let i = 0; i < cycles; i++) {
    const sample = await mount(); if (sample.admitted !== points || sample.view !== "three") throw Error(`unexpected admission: ${JSON.stringify(sample)}`);
    replacements.push({ ...sample, heapBytes: await heap() });
  }
  const started = Date.now(), soak = [];
  while (Date.now() - started < soakSeconds * 1000) {
    const delay = Math.min(sampleSeconds * 1000, soakSeconds * 1000 - (Date.now() - started));
    if (delay > 0) await new Promise(done => setTimeout(done, delay));
    soak.push({ elapsedSeconds: (Date.now() - started) / 1000, heapBytes: await heap() });
  }
  if (errors.length) throw Error(`Page errors: ${JSON.stringify(errors)}`);
  const sorted = replacements.map(s => s.elapsedMs).sort((a, b) => a - b);
  const q = p => sorted[Math.ceil(sorted.length * p) - 1];
  console.log(JSON.stringify({ schema: 1, measuredAt: new Date().toISOString(), checkout: root, bundleHash, harnessHash, reviewSourceHash: stamp.sourceHash,
    conditions: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, browser: browser.version(), viewport: '1280x900', dpr: 1, headless: !values.headed, network: 'offline loopback', fixture: 'synthetic repeating points; gallery in 3D, not HA or robot' },
    fixture, cycles, requestedSoakSeconds: soakSeconds, baselineHeapBytes: baselineHeap, replacements, soak,
    replaceToTwoFramesMs: { samples: sorted.length, p50: q(.5), p95: q(.95), p99: q(.99), max: q(1) },
    unavailable: ['actual mobile device', 'GPU driver memory', 'owned GPU resource counts', 'worker/listener/timer counts', 'field INP', 'point visibility or GPU completion', 'HA transport latency'],
    limits: ['Two animation frames are not proof of completed progressive GPU upload.', 'CDP forced-GC heap and backing storage include the retained fixture and are Chromium desktop lab evidence only; they exclude GPU driver memory.', 'Soak is idle after replacement cycles; no hidden-state or sustained interaction coverage.', 'Bundle/source hash must be independently matched to the tested revision.'] }, null, 2));
  await context.close();
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
