const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../pwa-install.js'), 'utf8');

function setup({ installed = false, standalone = false, blocked = false, ua = '', platform = '', touch = 0 } = {}) {
  const events = {};
  const elements = Object.fromEntries(['installApp', 'installAppBtn', 'installHelp'].map(id => [id, {
    hidden: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(k, cb) { this[k] = cb; }
  }]));
  const modes = [];
  let saved = installed ? '1' : null;
  vm.runInNewContext(source, {
    document: { getElementById: id => elements[id] },
    navigator: { standalone, userAgent: ua, platform, maxTouchPoints: touch },
    localStorage: {
      getItem() { if (blocked) throw Error(); return saved; },
      setItem(k, v) { if (blocked) throw Error(); saved = v; },
      removeItem() { if (blocked) throw Error(); saved = null; }
    },
    window: {
      addEventListener: (k, cb) => { events[k] = cb; },
      matchMedia: () => { const m = { matches: false, addEventListener(k, cb) { this.change = cb; } }; modes.push(m); return m; }
    }
  });
  return { box: elements.installApp, button: elements.installAppBtn, help: elements.installHelp, events, modes };
}
function offer(ui, outcome = 'dismissed', reject = false) {
  let calls = 0;
  ui.events.beforeinstallprompt({ preventDefault() {}, prompt() { calls++; return reject ? Promise.reject(Error()) : Promise.resolve(); }, userChoice: Promise.resolve({ outcome }) });
  return () => calls;
}
test('browser fallback is visible; installed and iOS standalone are hidden', () => {
  assert.equal(setup().box.hidden, false);
  assert.equal(setup({ installed: true }).box.hidden, true);
  assert.equal(setup({ standalone: true }).box.hidden, true);
  assert.equal(setup({ blocked: true }).box.hidden, false);
});
test('accepted native prompt hides immediately and is used only once', async () => {
  const ui = setup(); const calls = offer(ui, 'accepted');
  await ui.button.click(); await ui.button.click();
  assert.equal(calls(), 1); assert.equal(ui.box.hidden, true);
  assert.equal(ui.button.disabled, false);
});
test('dismissal remains available with fallback; new offer recovers after uninstall', async () => {
  const ui = setup({ installed: true }); const calls = offer(ui);
  assert.equal(ui.box.hidden, false);
  await ui.button.click(); await ui.button.click();
  assert.equal(calls(), 1); assert.equal(ui.box.hidden, false); assert.equal(ui.help.hidden, false);
});
test('browser-menu installation and display-mode changes hide the UI', () => {
  const ui = setup(); ui.events.appinstalled(); assert.equal(ui.box.hidden, true);
  const other = setup(); other.modes[0].matches = true; other.modes[0].change();
  assert.equal(other.box.hidden, true);
});
test('iPadOS desktop user agent gets home-screen instructions', async () => {
  const ui = setup({ platform: 'MacIntel', touch: 5 }); await ui.button.click();
  assert.match(ui.help.textContent, /iPhone\/iPad/);
  assert.equal(ui.button.attrs['aria-expanded'], 'true');
  await ui.button.click(); assert.equal(ui.help.hidden, true);
});
test('prompt failure restores the button and shows help', async () => {
  const ui = setup(); offer(ui, 'dismissed', true); await ui.button.click();
  assert.equal(ui.button.disabled, false); assert.equal(ui.help.hidden, false);
});
test('installation syncs across tabs even with storage blocked locally', () => {
  const ui = setup({ blocked: true }); ui.events.storage({ key: 'cinedanal_pwa_installed', newValue: '1' });
  assert.equal(ui.box.hidden, true);
});
