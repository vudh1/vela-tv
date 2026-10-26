const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

class Element {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.children = [];
    this.listeners = new Map();
    this.classes = new Set();
    this.attributes = new Map();
    this.disabled = false;
    this.classList = {
      contains: name => this.classes.has(name),
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      toggle: (name, force) => {
        if (force === undefined ? !this.classes.has(name) : force) this.classes.add(name);
        else this.classes.delete(name);
        return this.classes.has(name);
      }
    };
  }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  querySelector() { return this.firstSpan ||= new Element('span'); }
  replaceChildren() { this.children = []; }
  appendChild(child) { this.children.push(child); }
  focus() {}
  fire(name, props = {}) {
    const event = { preventDefault() {}, button: 0, detail: 1, ...props };
    return this.listeners.get(name)?.(event);
  }
}

async function run() {
  const elements = new Map();
  const element = name => {
    if (!elements.has(name)) elements.set(name, new Element(name));
    return elements.get(name);
  };
  element('controller').classList.add('hidden');
  element('tvMenu').classList.add('hidden');
  element('cancelPair').classList.add('hidden');
  const buttons = ['up', 'down', 'left', 'right', 'select', 'home', 'back', 'power_toggle',
    'volume_up', 'volume_down', 'mute', 'play_pause']
    .map(name => {
      const button = new Element(name);
      button.dataset = { key: name };
      return button;
    });
  const records = new Map();
  const indexedDB = { open() {
    const database = {
      createObjectStore() {}, close() {},
      transaction() { return { objectStore() { return {
        get(key) { return operation(() => records.get(key)); },
        put(value, key) { return operation(() => records.set(key, value)); },
        delete(key) { return operation(() => records.delete(key)); }
      }; } }; }
    };
    const request = { result: database };
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
    return request;
  } };
  function operation(action) {
    const op = {};
    queueMicrotask(() => { op.result = action(); op.onsuccess?.(); });
    return op;
  }
  const tokens = { '1111111111': { token: 'first-token', tvId: 'tv-a', tvName: 'Living Room' },
    '2222222222': { token: 'second-token', tvId: 'tv-b', tvName: 'Bedroom' } };
  const tvNames = new Map([['tv-a', 'Living Room'], ['tv-b', 'Bedroom']]);
  const commands = [];
  async function fetchFake(url, options) {
    const address = new URL(url);
    const payload = options.body ? JSON.parse(options.body) : {};
    const key = (options.headers.authorization || '').replace('Bearer ', '');
    let response;
    if (address.pathname === '/api/connect') response = tokens[payload.pin] || { error: 'incorrect_pin' };
    else if (address.pathname === '/api/status') {
      const tvId = address.searchParams.get('tvId');
      response = { online: true, busy: false, sameNetwork: true,
        ...(tvId ? { tvId, tvName: tvNames.get(tvId) } : {}) };
    }
    else if (address.pathname === '/api/heartbeat') response = { textPublicKey: '' };
    else if (address.pathname === '/api/command') {
      commands.push({ token: key, key: payload.key }); response = { ok: true };
    } else if (address.pathname === '/api/release') response = { ok: true };
    else response = { error: 'unsupported' };
    return { ok: !response.error, status: response.error ? 401 : 200,
      async json() { return response; } };
  }
  const documentListeners = new Map();
  const windowListeners = new Map();
  const longPressTimers = new Map();
  const repeatTimers = new Map();
  let nextTimer = 100;
  const document = {
    hidden: false, getElementById: element,
    createElement: () => new Element(),
    querySelectorAll: () => buttons,
    addEventListener(name, fn) { documentListeners.set(name, fn); }
  };
  const triggerDocument = name => documentListeners.get(name)?.();
  const triggerWindow = name => windowListeners.get(name)?.();
  const hold = button => {
    button.fire('pointerdown', { pointerId: 1 });
    button.fire('pointerup', { pointerId: 1 });
    button.fire('click', { detail: 1 });
  };
  const context = { document, indexedDB, crypto: webcrypto, TextEncoder, URL,
    Uint8Array, AbortController, fetch: fetchFake, navigator: {},
    window: { indexedDB, crypto: webcrypto, TextEncoder,
      addEventListener(name, fn) { windowListeners.set(name, fn); }, confirm: () => true },
    setTimeout(fn, delay) {
      if (delay === 470) { const id = ++nextTimer; longPressTimers.set(id, fn); return id; }
      return setTimeout(fn, delay);
    },
    clearTimeout(id) { longPressTimers.delete(id); clearTimeout(id); },
    setInterval(fn, delay) {
      if (delay === 220) { const id = ++nextTimer; repeatTimers.set(id, fn); return id; }
      return ++nextTimer;
    },
    clearInterval(id) { repeatTimers.delete(id); },
    console, Date, btoa, atob };
  const code = fs.readFileSync(path.join(__dirname, '../remote/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../remote/index.html'), 'utf8');
  assert.doesNotMatch(html, /TV options|Type on TV|id="devicePanel"|id="keyboardPanel"/);
  vm.runInNewContext(code, context);
  const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
  await flush();
  assert.equal(element('pair').classList.contains('hidden'), false);

  element('pin').value = '1111111111';
  await element('pinForm').fire('submit');
  await flush();
  assert.equal(element('tvPill').querySelector('span').textContent, 'Living Room');
  assert.equal(records.get('trustedTvs').length, 1);

  element('tvPill').fire('click');
  assert.equal(element('tvMenu').children.length, 2);
  element('tvMenu').children[1].fire('click');
  assert.equal(element('pairTitle').textContent, 'Connect another TV');
  element('pin').value = '2222222222';
  await element('pinForm').fire('submit');
  await flush();
  assert.equal(element('tvPill').querySelector('span').textContent, 'Bedroom');
  assert.equal(records.get('trustedTvs').length, 2);
  // TVs publish their models after an app update, without breaking existing
  // phone pairing or changing the stable routing IDs.
  tvNames.set('tv-b', 'Sony BRAVIA 4K VH2 (2)');
  triggerWindow('focus'); await flush();
  assert.equal(element('tvPill').querySelector('span').textContent, 'Sony BRAVIA 4K VH2 (2)');
  assert.equal(records.get('trustedTvs')[1].tvName, 'Sony BRAVIA 4K VH2 (2)');
  tvNames.set('tv-a', 'Sony BRAVIA 4K VH2');

  hold(buttons.find(button => button.dataset.key === 'select'));
  await flush();
  element('tvPill').fire('click');
  assert.equal(element('tvMenu').children.length, 2, 'third TV option must be absent');
  element('tvMenu').children[0].fire('click');
  hold(buttons.find(button => button.dataset.key === 'power_toggle'));
  await flush();
  assert.deepEqual(commands.map(c => ({ ...c })), [
    { token: 'second-token', key: 'select' },
    { token: 'first-token', key: 'power_toggle' }
  ], 'commands must target the selected TV only');
  assert.equal(element('tvPill').querySelector('span').textContent, 'Sony BRAVIA 4K VH2');
  const volume = buttons.find(button => button.dataset.key === 'volume_up');
  volume.fire('pointerdown', { pointerId: 7 });
  await flush();
  assert.equal(commands.filter(c => c.key === 'volume_up').length, 1);
  // Switching apps hides Safari mid-press. Its pending long-press timer and
  // eventual synthetic click must not send a second command on return.
  const pending = [...longPressTimers.values()];
  document.hidden = true; triggerDocument('visibilitychange');
  pending.forEach(fn => fn());
  for (const fn of repeatTimers.values()) fn();
  document.hidden = false; triggerDocument('visibilitychange');
  volume.fire('pointerup', { pointerId: 7 });
  volume.fire('click', { detail: 1 }); volume.fire('click', { detail: 0 });
  await flush();
  assert.equal(commands.filter(c => c.key === 'volume_up').length, 1,
    'an app switch cannot replay or repeat a held key');
  assert.equal(volume.classList.contains('pressed'), false);
  // If auto-repeat has already started, blur must stop subsequent repeats.
  const down = buttons.find(button => button.dataset.key === 'down');
  down.fire('pointerdown', { pointerId: 8 });
  const startRepeating = [...longPressTimers.values()][0];
  startRepeating();
  const repeatOnce = [...repeatTimers.values()][0];
  repeatOnce();
  const sentBeforeBlur = commands.filter(c => c.key === 'down').length;
  triggerWindow('blur'); repeatOnce();
  down.fire('pointerup', { pointerId: 8 });
  down.fire('click', { detail: 1 }); down.fire('click', { detail: 0 });
  await flush();
  assert.equal(commands.filter(c => c.key === 'down').length, sentBeforeBlur,
    'a blurred tab must stop an already-running repeat interval');
  console.log('PASS phone remembers two Sony TVs and routes every command to the selected pill');
  console.log('PASS app switching and tab blur never create duplicate remote key presses');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
