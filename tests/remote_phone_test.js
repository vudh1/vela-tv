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
  for (const name of ['devicePanel', 'keyboardPanel', 'cancelPair'])
    element(name).classList.add('hidden');
  const buttons = ['up', 'down', 'left', 'right', 'select', 'home', 'back', 'power_toggle',
    'volume_up', 'volume_down', 'mute', 'play_pause', 'hdmi1', 'hdmi2', 'hdmi3', 'hdmi4']
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
  const commands = [];
  async function fetchFake(url, options) {
    const address = new URL(url);
    const payload = options.body ? JSON.parse(options.body) : {};
    const key = (options.headers.authorization || '').replace('Bearer ', '');
    let response;
    if (address.pathname === '/api/connect') response = tokens[payload.pin] || { error: 'incorrect_pin' };
    else if (address.pathname === '/api/status') response = { online: true, busy: false, sameNetwork: true };
    else if (address.pathname === '/api/heartbeat') response = { textPublicKey: '' };
    else if (address.pathname === '/api/command') {
      commands.push({ token: key, key: payload.key }); response = { ok: true };
    } else if (address.pathname === '/api/release') response = { ok: true };
    else response = { error: 'unsupported' };
    return { ok: !response.error, status: response.error ? 401 : 200,
      async json() { return response; } };
  }
  const document = {
    hidden: false, getElementById: element,
    createElement: () => new Element(),
    querySelectorAll: () => buttons,
    addEventListener() {}
  };
  const context = { document, indexedDB, crypto: webcrypto, TextEncoder, URL,
    Uint8Array, AbortController, fetch: fetchFake, navigator: {},
    window: { indexedDB, crypto: webcrypto, TextEncoder, addEventListener() {}, confirm: () => true },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    console, Date, btoa, atob };
  const code = fs.readFileSync(path.join(__dirname, '../remote/app.js'), 'utf8');
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

  buttons.find(button => button.dataset.key === 'select').fire('click');
  await flush();
  element('tvPill').fire('click');
  assert.equal(element('tvMenu').children.length, 2, 'third TV option must be absent');
  element('tvMenu').children[0].fire('click');
  buttons.find(button => button.dataset.key === 'power_toggle').fire('click');
  await flush();
  assert.deepEqual(commands.map(c => ({ ...c })), [
    { token: 'second-token', key: 'select' },
    { token: 'first-token', key: 'power_toggle' }
  ], 'commands must target the selected TV only');
  assert.equal(element('tvPill').querySelector('span').textContent, 'Living Room');
  console.log('PASS phone remembers two Sony TVs and routes every command to the selected pill');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
