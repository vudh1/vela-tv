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
  const tvNames = new Map([['tv-a', 'Living Room'], ['tv-b', 'Bedroom'],
    ['tv-c', 'Sony BRAVIA with Private Relay']]);
  const enrolledTvs = new Set(['tv-a', 'tv-b', 'tv-c']);
  const offlineTvs = new Set();
  const commands = [], releasedTokens = [];
  let approvalChecks = 0, expireRelay = false, failNextRelease = false;
  let releaseHeldApproval = null;
  async function fetchFake(url, options) {
    const address = new URL(url);
    const payload = options.body ? JSON.parse(options.body) : {};
    const key = (options.headers.authorization || '').replace('Bearer ', '');
    let response;
    if (address.pathname === '/api/connect') response = payload.pin === '4444444444'
      ? { approvalRequired: true, approvalToken: 'e'.repeat(64), requestId: 'd'.repeat(24), approvalSeconds: 90 }
      : payload.pin === '3333333333'
      ? { approvalRequired: true, approvalToken: 'a'.repeat(64), requestId: 'b'.repeat(24), approvalSeconds: 90 }
      : tokens[payload.pin] || { error: 'incorrect_pin' };
    else if (address.pathname === '/api/approval-status') response = payload.requestId === 'd'.repeat(24)
      ? await new Promise(resolve => { releaseHeldApproval = () => resolve({ token: 'orphan-token',
        tvId: 'tv-d', tvName: 'Unselected TV', trustedRelay: true }); })
      : ++approvalChecks < 2 ? { approvalPending: true }
        : { token: 'relay-token', tvId: 'tv-c',
          tvName: 'Sony BRAVIA with Private Relay', trustedRelay: true };
    else if (address.pathname === '/api/status') {
      const tvId = address.searchParams.get('tvId');
      const exists = !tvId || enrolledTvs.has(tvId);
      response = { online: exists && !offlineTvs.has(tvId), busy: false,
        sameNetwork: exists && tvId !== 'tv-c',
        ...(tvId && exists ? { tvId, tvName: tvNames.get(tvId) } : {}) };
    }
    else if (address.pathname === '/api/heartbeat') response = expireRelay && key === 'relay-token'
      ? { error: 'session_expired' } : { textPublicKey: '' };
    else if (address.pathname === '/api/challenge') response = {
      challenge: 'c'.repeat(64), keyId: payload.keyId };
    else if (address.pathname === '/api/resume') response = {
      token: 'renewed-relay-token', tvId: 'tv-c',
      tvName: 'Sony BRAVIA with Private Relay', trustedRelay: true };
    else if (address.pathname === '/api/command') {
      commands.push({ token: key, key: payload.key }); response = { ok: true };
    } else if (address.pathname === '/api/release') {
      response = failNextRelease ? { error: 'unavailable' } : { ok: true };
      if (!failNextRelease) releasedTokens.push(key);
      failNextRelease = false;
    }
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
      if (delay === 2500) return setTimeout(fn, 0); // Fast-forward TV approval checks.
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
  assert.equal(down.attributes.get('aria-pressed'), 'false',
    'cancelling a gesture clears accessible pressed feedback');
  // Safari can complete pointerup before app switching, then replay an
  // accessibility-style click after return. This was not covered by the old
  // activePress-only background guard.
  const left = buttons.find(button => button.dataset.key === 'left');
  left.fire('pointerdown', { pointerId: 9 });
  left.fire('pointerup', { pointerId: 9 });
  const leftCount = commands.filter(c => c.key === 'left').length;
  document.hidden = true; triggerDocument('visibilitychange');
  document.hidden = false; triggerDocument('visibilitychange');
  left.fire('click', { detail: 0 });
  await flush();
  assert.equal(commands.filter(c => c.key === 'left').length, leftCount,
    'a delayed synthetic click after completed pointerup cannot duplicate a press');
  // Private Relay keeps Safari on a different IP. A correct PIN alone must
  // wait for explicit TV approval; the resulting phone identity is persistent.
  await element('release').fire('click'); await flush(); // Frees one TV slot.
  element('tvPill').fire('click');
  element('tvMenu').children[1].fire('click');
  element('pin').value = '3333333333';
  await element('pinForm').fire('submit'); await flush();
  assert.equal(approvalChecks, 2, 'the phone waits for TV approval without submitting another PIN');
  assert.equal(element('tvPill').querySelector('span').textContent,
    'Sony BRAVIA with Private Relay');
  assert.equal(records.get('trustedTvs').find(r => r.tvId === 'tv-c').trustedRelay, true);
  expireRelay = true;
  triggerWindow('focus'); await flush();
  assert.equal(records.get('trustedTvs').find(r => r.tvId === 'tv-c').trustedRelay, true,
    'a signed phone can resume even when sameNetwork=false');
  hold(buttons.find(button => button.dataset.key === 'select')); await flush();
  assert.ok(commands.some(c => c.token === 'renewed-relay-token' && c.key === 'select'));
  // A failed network release must preserve the non-extractable identity so
  // an owner can sign in again and remove the pairing later.
  failNextRelease = true;
  await element('release').fire('click'); await flush();
  assert.equal(records.get('trustedTvs').length, 2);
  assert.match(element('error').textContent, /Could not confirm disconnect/);
  await element('release').fire('click'); await flush();
  assert.equal(records.get('trustedTvs').length, 1);
  assert.equal(element('tvPill').querySelector('span').textContent, 'Sony BRAVIA 4K VH2 (2)');
  // The owner cancels pairing while an approved response is still in flight.
  // The Worker may already have minted a token, so the phone must release it.
  element('tvPill').fire('click');
  element('tvMenu').children[1].fire('click');
  element('pin').value = '4444444444';
  const cancelledPair = element('pinForm').fire('submit');
  await flush();
  assert.equal(typeof releaseHeldApproval, 'function');
  element('cancelPair').fire('click');
  releaseHeldApproval();
  await cancelledPair; await flush();
  assert.ok(releasedTokens.includes('orphan-token'), 'cancelling a claim releases its bearer lease');
  assert.equal(records.get('trustedTvs').length, 1);
  // The TV going offline must not erase the recovery credential.
  offlineTvs.add('tv-b');
  triggerWindow('focus'); await flush();
  assert.equal(records.get('trustedTvs').length, 1);
  // Disabling/re-enrolling the TV removes its ID from the relay; the phone
  // must immediately clear the pill and persisted key.
  enrolledTvs.delete('tv-b');
  triggerWindow('focus'); await flush();
  assert.equal(records.has('trustedTvs'), false);
  assert.equal(element('controller').classList.contains('hidden'), true);
  console.log('PASS phone remembers two Sony TVs and routes every command to the selected pill');
  console.log('PASS app switching and tab blur never create duplicate remote key presses');
  console.log('PASS Private Relay waits for TV approval and resumes using a stored signing key');
  console.log('PASS failed disconnect preserves trust; TV revocation clears phone trust');
  console.log('PASS cancelled TV approval cannot strand a newly authorized lease');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
