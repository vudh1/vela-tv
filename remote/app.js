(() => {
  'use strict';
  // No PINs or bearer leases are persisted. A trusted phone keeps a
  // non-extractable signing key in IndexedDB for PIN-free reconnection.
  const API = 'https://velatv-remote.vudhone.workers.dev';
  const $ = id => document.getElementById(id);
  const state = { token: '', busy: false, online: false, sameNetwork: false, textPublicKey: '' };
  let holdTimer, repeatTimer, pingTimer, statusTimer, resumePromise;
  let lastResumeAttempt = 0, manuallyDisconnected = false;
  let lastControlAt = 0, lastOpenedAt = 0;
  function message(text) { $('error').textContent = text; }
  function hasTrustedStorage() {
    return !!(window.indexedDB && window.crypto && crypto.subtle && window.TextEncoder);
  }
  async function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('vela-remote-credentials', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function storedKey(slot, next) {
    if (!hasTrustedStorage()) return null;
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('keys', next === undefined ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('keys');
        const operation = next === undefined ? store.get(slot)
          : next === null ? store.delete(slot) : store.put(next, slot);
        operation.onsuccess = () => resolve(operation.result || null);
        operation.onerror = () => reject(operation.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }
  async function clearKeys() {
    await Promise.all([storedKey('current', null), storedKey('pending', null)]);
  }
  function hex(bytes) {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function identityId(key) {
    return hex(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(key.publicKey.x + ':' + key.publicKey.y)));
  }
  async function newIdentity() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' },
      false, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const identity = { privateKey: pair.privateKey,
      publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } };
    // Save before connecting so a browser crash cannot strand a paired key.
    await storedKey('pending', identity);
    return identity;
  }
  async function request(path, payload, token = '') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7500);
    try {
      const response = await fetch(API + path, {
        method: payload === undefined ? 'GET' : 'POST',
        mode: 'cors', cache: 'no-store', credentials: 'omit',
        headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: 'Bearer ' + token } : {}) },
        body: payload === undefined ? undefined : JSON.stringify(payload), signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || 'unavailable'), { status: response.status });
      return data;
    } finally { clearTimeout(timeout); }
  }
  function showConnection() {
    $('network').className = 'network' + (state.online ? state.busy ? ' busy' : ' online' : '');
    $('network').querySelector('span').textContent = !state.online ? 'TV offline' : state.token ? 'Connected'
      : state.busy ? 'Other remotes connected' : 'TV available';
  }
  function setConnected(token) {
    state.token = token; manuallyDisconnected = false;
    lastOpenedAt = Date.now();
    $('pin').value = '';
    $('pair').classList.add('hidden'); $('controller').classList.remove('hidden');
    message(''); showConnection();
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(heartbeat, 20000);
    heartbeat(); // Arm a brief responsiveness window right after pairing/resume.
  }
  function disconnected(reason = '') {
    state.token = '';
    state.textPublicKey = '';
    $('controller').classList.add('hidden'); $('pair').classList.remove('hidden');
    $('pin').value = ''; message(reason); showConnection();
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  }
  const errors = {
    incorrect_pin: 'Incorrect PIN. Check the 10-digit code shown in Vela TV settings.',
    different_network: 'Your phone and TV must use the same home Internet connection. Turn off your VPN or mobile data.',
    tv_offline: 'Vela TV is offline. Open Vela and check Remote settings.',
    max_controllers: 'Four remotes are already paired. Disconnect one or reset remote access on the TV.',
    already_paired: 'This phone is already paired. Reopen the remote to reconnect.',
    locked: 'Too many attempts. Wait 15 minutes before trying again.',
    pairing_required: 'Choose Add Another Remote in Vela TV settings for a new pairing PIN.',
    already_enrolled: 'A different TV is already registered.',
    session_expired: 'Connection interrupted. Reconnecting to Vela TV…'
  };
  async function resume() {
    if (state.token || manuallyDisconnected || !state.online || !state.sameNetwork) return;
    if (resumePromise) return resumePromise;
    if (Date.now() - lastResumeAttempt < 5500) return;
    lastResumeAttempt = Date.now();
    resumePromise = (async () => {
      if (!hasTrustedStorage()) return;
      const [current, pending] = await Promise.all([
        storedKey('current'), storedKey('pending')
      ]);
      if (!current && !pending) return;
      // Every trusted phone has its own server-side identity. Never ask the
      // room to reveal which other phones are paired.
      const identities = [current, pending].filter(Boolean);
      for (const identity of identities) {
        const keyId = await identityId(identity);
        let challenge;
        try { challenge = await request('/api/challenge', { keyId }); }
        catch (error) {
          if (error.message === 'pairing_required') continue;
          throw error;
        }
        if (challenge.keyId !== keyId) continue;
        const signed = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
          identity.privateKey, new TextEncoder().encode('vela-remote-v1:' + challenge.challenge));
        const data = await request('/api/resume', {
          challenge: challenge.challenge, signature: hex(signed)
        });
        if (identity === pending) {
          await storedKey('current', identity); await storedKey('pending', null);
        }
        setConnected(data.token);
        return;
      }
      await clearKeys(); message(errors.pairing_required);
    })().catch(error => {
      if (error.message === 'pairing_required') {
        clearKeys().catch(() => {}); message(errors.pairing_required);
      } else if (error.message === 'locked') message(errors.locked);
      else if (error.message === 'different_network') message(errors.different_network);
      else if (error.message === 'session_expired') message('Reconnection expired. Trying again…');
    }).finally(() => { resumePromise = null; });
    return resumePromise;
  }
  async function status() {
    try {
      const data = await request('/api/status');
      state.online = !!data.online; state.busy = !!data.busy;
      state.sameNetwork = !!data.sameNetwork;
      showConnection();
      if (!state.token) await resume();
    } catch (_) { state.online = false; showConnection(); }
  }
  async function heartbeat() {
    if (!state.token || document.hidden) return;
    const token = state.token;
    // Brief fast-poll bursts only while a person is actually using the
    // controller. Leaving this tab open must not create all-day request cost.
    const ready = !document.hidden && Date.now() - Math.max(lastOpenedAt, lastControlAt) < 12_000;
    try {
      const response = await request('/api/heartbeat', { ready }, token);
      state.textPublicKey = response.textPublicKey || '';
    }
    catch (error) {
      if (error.status === 401 && state.token === token) {
        disconnected(errors.session_expired); await status();
      }
    }
  }
  $('pinForm').addEventListener('submit', async event => {
    event.preventDefault();
    const pin = $('pin').value;
    if (!/^\d{10}$/.test(pin)) { message('Enter the 10-digit PIN generated by your TV.'); return; }
    if (!state.online) { message('TV is offline. Check the connection first.'); return; }
    if (!state.sameNetwork) { message(errors.different_network); return; }
    $('connect').disabled = true; message('');
    try {
      let identity = null;
      try { if (hasTrustedStorage()) identity = await newIdentity(); }
      catch (_) { /* Private browsing might disable IndexedDB. */ }
      const data = await request('/api/connect', { pin,
        ...(identity ? { publicKey: identity.publicKey } : {}) });
      if (identity) {
        try {
          await storedKey('current', identity); await storedKey('pending', null);
        } catch (_) { /* Pending identity can be resumed after a browser crash. */ }
      }
      setConnected(data.token);
    } catch (error) { message(errors[error.message] || 'Connection failed. Try again in a moment.'); }
    finally { $('pin').value = ''; $('connect').disabled = false; }
  });
  async function send(key) {
    if (!state.token) return;
    lastControlAt = Date.now();
    if (navigator.vibrate) navigator.vibrate(9);
    const token = state.token;
    try {
      await request('/api/command', { key }, token);
      if (key === 'power_toggle')
        $('remoteInfo').textContent = 'Power request queued. If the TV goes into standby and disconnects, use its physical remote to wake it.';
    }
    catch (error) {
      if (error.status === 401 && state.token === token) { disconnected(errors.session_expired); status(); }
      else $('remoteInfo').textContent = 'TV did not receive this command. Check the connection.';
    }
  }
  function toggleTool(name) {
    const opening = $(name + 'Panel').classList.contains('hidden');
    for (const panel of ['device', 'keyboard']) {
      $(panel + 'Panel').classList.toggle('hidden', panel !== name || !opening);
      $(panel + 'Toggle').setAttribute('aria-expanded', String(panel === name && opening));
    }
    if (opening && name === 'keyboard') $('remoteText').focus();
  }
  $('deviceToggle').addEventListener('click', () => toggleTool('device'));
  $('keyboardToggle').addEventListener('click', () => toggleTool('keyboard'));
  $('wifiButton').addEventListener('click', () => {
    if (window.confirm('Open Wi-Fi settings on your Sony TV? Changing networks may disconnect this remote.'))
      send('wifi_settings');
  });

  const encode64 = bytes => {
    let raw = '';
    for (const byte of new Uint8Array(bytes)) raw += String.fromCharCode(byte);
    return btoa(raw);
  };
  const decode64 = input => Uint8Array.from(atob(input), character => character.charCodeAt(0));
  async function encryptText(text, publicKey) {
    // Fresh ephemeral ECDH for every submission. Cloudflare receives only
    // opaque ciphertext + ephemeral public key, never the characters typed.
    const tvPublic = await crypto.subtle.importKey('spki', decode64(publicKey),
      { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: tvPublic }, ephemeral.privateKey, 256);
    const keyBytes = await crypto.subtle.digest('SHA-256', secret);
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return { ephemeral: encode64(await crypto.subtle.exportKey('spki', ephemeral.publicKey)),
      iv: encode64(iv), cipher: encode64(encrypted) };
  }
  $('textForm').addEventListener('submit', async event => {
    event.preventDefault();
    const value = $('remoteText').value;
    const plain = new TextEncoder().encode(value);
    if (!value || value.length > 160 || plain.length > 240 || /[\r\n\0]/.test(value)) {
      $('remoteInfo').textContent = 'Enter up to 160 characters of ordinary text.';
      return;
    }
    if (!state.token || !state.textPublicKey) {
      $('remoteInfo').textContent = 'Secure TV keyboard is connecting. Make sure Vela is updated and Accessibility is enabled.';
      await heartbeat();
      return;
    }
    const button = $('sendText');
    button.disabled = true;
    try {
      const payload = await encryptText(value, state.textPublicKey);
      lastControlAt = Date.now();
      await request('/api/command', { key: 'type_text', payload }, state.token);
      $('remoteText').value = '';
      $('remoteInfo').textContent = 'Sent securely. Check the selected text field on the TV.';
    } catch (_) {
      $('remoteInfo').textContent = 'Text not delivered. Try again after selecting a field on TV.';
    } finally { button.disabled = false; }
  });
  document.querySelectorAll('[data-key]').forEach(button => {
    const key = button.dataset.key;
    let fired = false;
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !state.token) return;
      fired = true; button.classList.add('pressed'); send(key);
      if (['up', 'down', 'left', 'right', 'volume_up', 'volume_down'].includes(key)) {
        holdTimer = setTimeout(() => { repeatTimer = setInterval(() => send(key), 220); }, 470);
      }
    });
    const cancel = () => { clearTimeout(holdTimer); clearInterval(repeatTimer); button.classList.remove('pressed'); };
    button.addEventListener('pointerup', cancel); button.addEventListener('pointercancel', cancel);
    button.addEventListener('pointerleave', cancel);
    button.addEventListener('click', event => {
      if (event.detail === 0 || !fired) send(key);
      fired = false;
    });
  });
  $('release').addEventListener('click', async () => {
    const token = state.token;
    manuallyDisconnected = true;
    disconnected('Disconnected. Generate a new PIN on Vela TV to pair again.');
    try { await clearKeys(); } catch (_) { /* Storage can be unavailable. */ }
    try { await request('/api/release', {}, token); }
    catch (_) { /* The short-lived lease expires automatically. */ }
  });
  // Do not release on pagehide: mobile browsers routinely suspend tabs.
  function foreground() {
    lastOpenedAt = Date.now();
    if (state.token) heartbeat();
    status();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) foreground(); });
  window.addEventListener('focus', foreground);
  window.addEventListener('online', status);
  status();
  // Connected phones already heartbeat; avoid quadrupling constant Worker
  // status traffic when four controllers stay paired all day.
  statusTimer = setInterval(() => { if (!document.hidden && !state.token) status(); }, 30000);
})();
