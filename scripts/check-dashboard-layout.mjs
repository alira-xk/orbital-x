// Read-only browser verification against the local dashboard. Requires Edge CDP on 9335.
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const pages = await (await fetch('http://127.0.0.1:9335/json')).json();
const socket = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params;
    const metric = new URL(request.url).searchParams.get('metric');
    const base = metric === 'fuel_pressure' ? 2.6 : metric === 'fuel_level' ? 88 : 20;
    const rows = Array.from({ length: 60 }, (_, i) => ({ timestamp: new Date(Date.now() - (59-i)*15000).toISOString(), value: base + Math.sin(i/8)*base*0.015, min: base*0.975, max: base*1.025 }));
    void command('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify({ success: true, data: rows })).toString('base64') }).catch((error) => {
      // React aborts superseded metric requests on selection/navigation.
      if (!error.message.includes('Invalid InterceptionId')) throw error;
    });
  }
  if (pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
});
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
await command('Page.enable');
// Optional fixtures exist only in this isolated browser; never write fabricated telemetry to the app or database.
const fixtureMode = process.argv.includes('--fixtures');
if (fixtureMode) await command('Fetch.enable', { patterns: [{ urlPattern: '*telemetry/history/*', requestStage: 'Request' }] });
for (const width of [1440, 390]) {
  await command('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: 'http://127.0.0.1:5173/' });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate('Boolean(document.querySelector(".chart-grid"))')) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await evaluate('document.fonts.ready.then(() => true)');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log(JSON.stringify(await evaluate(`({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('main, header, main *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(e => ({ tag:e.tagName, class:e.className, right:e.getBoundingClientRect().right })), font: getComputedStyle(document.body).fontFamily })`)));
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Dashboard must not overflow horizontally');
  await evaluate(`document.querySelectorAll('.subsystem-control')[1].focus()`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(await evaluate(`document.querySelectorAll('.subsystem-control')[1].getAttribute('aria-pressed') === 'true'`), 'Keyboard selects power');
  await evaluate(`document.querySelectorAll('.range-controls button')[3].click()`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(await evaluate(`document.querySelectorAll('.range-controls button')[3].getAttribute('aria-pressed') === 'true'`), 'One hour range selected');
  await evaluate(`document.querySelector('.subsystem-control').click()`);
  await evaluate('window.scrollTo(0,0)');
  const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const label = `${width === 390 ? 'narrow' : 'desktop'}${fixtureMode ? '-fixtures' : ''}`;
  await writeFile(new URL(`../docs/evidence/phase4-redesign-${label}.png`, import.meta.url), Buffer.from(shot.data, 'base64'));
  await evaluate(`document.querySelector('.telemetry-workspace').scrollIntoView()`);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const analytics = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL(`../docs/evidence/phase4-redesign-${label}-charts.png`, import.meta.url), Buffer.from(analytics.data, 'base64'));
}
if (fixtureMode) await command('Fetch.disable');
socket.close();
