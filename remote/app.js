(() => {
  'use strict';
  // No PINs or bearer leases are persisted. A trusted phone keeps a
  // non-extractable signing key in IndexedDB for PIN-free reconnection.
  const API = 'https://velatv-remote.vudhone.workers.dev';
  const $ = id => document.getElementById(id);
  const state = { token: '', busy: false, online: false, sameNetwork: false,
    textPublicKey: '', tvId: '', tvName: '' };
  // Only the selected TV is controlled. Each phone can retain two independent
  // non-extractable identities; commands never fan out to both TVs.
  let remotes = [], selectedRemote = null, addingTv = false;
  let holdTimer, repeatTimer, pingTimer, statusTimer;
  let activePress = null;
  let suppressGhostClickUntil = 0;
  function stopHeldKey(lostFocus = false) {
    // iOS may synthesize the original tap's click after Safari resumes.
    // Pointerdown already sent that command; ignore late accessibility-like
    // detail=0 clicks for this abandoned gesture.
    if (lostFocus && activePress) suppressGhostClickUntil = Date.now() + 2500;
    clearTimeout(holdTimer); clearInterval(repeatTimer);
    holdTimer = null; repeatTimer = null;
    if (activePress) activePress.button.classList.remove('pressed');
    activePress = null;
  }
  const resumeTasks = new WeakMap();
  let manuallyDisconnected = false;
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
  async function saveRemotes() {
    const trusted = remotes.filter(r => r.identity).map(r => ({
      tvId: r.tvId, tvName: r.tvName, identity: r.identity }));
    await storedKey('trustedTvs', trusted.length ? trusted : null);
  }
  function snapshot() {
    if (selectedRemote) Object.assign(selectedRemote, {
      token: state.token, textPublicKey: state.textPublicKey,
      online: state.online, busy: state.busy, sameNetwork: state.sameNetwork });
  }
  function drawTvPicker() {
    const pill = $('tvPill'), menu = $('tvMenu');
    pill.querySelector('span').textContent = state.tvName || 'Choose TV';
    menu.replaceChildren();
    remotes.forEach(remote => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'tv-choice';
      button.textContent = remote.tvName || 'Vela TV';
      if (remote === selectedRemote) button.classList.add('selected');
      button.addEventListener('click', () => selectTv(remote));
      menu.appendChild(button);
    });
    if (remotes.length < 2) {
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'tv-choice add-tv';
      add.textContent = '+ Connect Another TV';
      add.addEventListener('click', () => showPair(true));
      menu.appendChild(add);
    }
  }
  function showPair(addAnother = false) {
    addingTv = addAnother;
    $('tvMenu').classList.add('hidden'); $('tvPill').setAttribute('aria-expanded', 'false');
    $('controller').classList.add('hidden'); $('pair').classList.remove('hidden');
    $('pairTitle').textContent = addAnother ? 'Connect another TV' : 'Connect to Vela';
    $('cancelPair').classList.toggle('hidden', !addAnother || !remotes.length);
    message('');
  }
  function selectTv(remote) {
    stopHeldKey();
    snapshot(); selectedRemote = remote;
    state.tvId = remote.tvId || ''; state.tvName = remote.tvName || 'Vela TV';
    state.token = remote.token || ''; state.textPublicKey = remote.textPublicKey || '';
    state.online = !!remote.online; state.busy = !!remote.busy;
    state.sameNetwork = !!remote.sameNetwork;
    addingTv = false;
    $('pair').classList.add('hidden'); $('controller').classList.remove('hidden');
    $('tvMenu').classList.add('hidden'); $('tvPill').setAttribute('aria-expanded', 'false');
    lastOpenedAt = Date.now(); drawTvPicker(); showConnection();
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(heartbeat, 40000);
    heartbeat(); status();
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
  async function setConnected(token, tvId, tvName, identity) {
    snapshot();
    let remote = remotes.find(r => r.tvId && r.tvId === tvId);
    if (!remote && identity) remote = remotes.find(r => r.identity?.publicKey?.x === identity.publicKey.x);
    if (!remote) {
      if (remotes.length >= 2) { message('This phone already has two TVs. Disconnect one first.'); return; }
      remote = { tvId: tvId || 'tv-1', tvName: tvName || 'TV 1', identity,
        token: '', online: true, busy: true, sameNetwork: true, textPublicKey: '' };
      remotes.push(remote);
    }
    remote.tvId = tvId || remote.tvId || 'tv-1';
    remote.tvName = tvName || remote.tvName || 'Vela TV';
    if (identity) remote.identity = identity;
    remote.token = token; remote.online = true; remote.busy = true; remote.sameNetwork = true;
    // Persist both TV identities before deleting the legacy migration slots.
    // A failed IndexedDB write must never discard the only recovery key.
    try { await saveRemotes(); await clearKeys(); }
    catch (_) { /* A live lease still works until this browser session ends. */ }
    selectedRemote = null; // Old selection was already snapshotted above.
    selectTv(remote);
    manuallyDisconnected = false;
    lastOpenedAt = Date.now();
    $('pin').value = '';
    message(''); showConnection();
  }
  function disconnected(reason = '') {
    state.token = '';
    state.textPublicKey = '';
    if (selectedRemote) selectedRemote.token = '';
    $('pin').value = ''; message(reason); showConnection();
  }
  const errors = {
    incorrect_pin: 'Incorrect PIN. Check the 10-digit code shown in Vela TV settings.',
    different_network: 'Your phone and TV must use the same home Internet connection. Turn off your VPN or mobile data.',
    tv_offline: 'Vela TV is offline. Open Vela and check Remote settings.',
    max_tvs: 'Two Sony TVs are already registered. Disable remote on a TV before adding another.',
    max_controllers: 'Four remotes are already paired. Disconnect one or reset remote access on the TV.',
    already_paired: 'This phone is already paired. Reopen the remote to reconnect.',
    locked: 'Too many attempts. Wait 15 minutes before trying again.',
    pairing_required: 'Choose Add Another Remote in Vela TV settings for a new pairing PIN.',
    already_enrolled: 'A different TV is already registered.',
    session_expired: 'Connection interrupted. Reconnecting to Vela TV…'
  };
  async function resume() {
    const remote = selectedRemote;
    if (!remote || state.token || manuallyDisconnected || !state.online || !state.sameNetwork) return;
    if (resumeTasks.has(remote)) return resumeTasks.get(remote);
    if (Date.now() - (remote.lastResumeAttempt || 0) < 5500) return;
    remote.lastResumeAttempt = Date.now();
    const promise = (async () => {
      if (!hasTrustedStorage()) return;
      if (!remote.identity) return;
      const identities = [remote.identity];
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
        remote.token = data.token;
        remote.tvId = data.tvId || remote.tvId || 'tv-1';
        remote.tvName = data.tvName || remote.tvName || 'TV 1';
        await saveRemotes();
        await clearKeys();
        if (remote === selectedRemote) await setConnected(data.token, remote.tvId, remote.tvName, identity);
        return;
      }
      if (remote === selectedRemote) message(errors.pairing_required);
    })().catch(error => {
      if (remote !== selectedRemote) return;
      if (error.message === 'pairing_required') {
        message(errors.pairing_required);
      } else if (error.message === 'locked') message(errors.locked);
      else if (error.message === 'different_network') message(errors.different_network);
      else if (error.message === 'session_expired') message('Reconnection expired. Trying again…');
    }).finally(() => { resumeTasks.delete(remote); });
    resumeTasks.set(remote, promise);
    return promise;
  }
  async function status() {
    try {
      const selected = selectedRemote;
      const data = await request('/api/status' + (selected?.tvId ? '?tvId=' + encodeURIComponent(selected.tvId) : ''));
      if (selected !== selectedRemote) return;
      state.online = !!data.online; state.busy = !!data.busy;
      state.sameNetwork = !!data.sameNetwork;
      showConnection();
      if (!state.token && selected) await resume();
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
      if (state.token === token) state.textPublicKey = response.textPublicKey || '';
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
    // The PIN selects the TV server-side; the currently selected TV may be off.
    $('connect').disabled = true; message('');
    try {
      let identity = null;
      try { if (hasTrustedStorage()) identity = await newIdentity(); }
      catch (_) { /* Private browsing might disable IndexedDB. */ }
      const data = await request('/api/connect', { pin,
        ...(identity ? { publicKey: identity.publicKey } : {}) });
      await setConnected(data.token, data.tvId, data.tvName, identity);
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
    let lastPointerDown = 0;
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false || !state.token || document.hidden) return;
      stopHeldKey();
      const press = { button, key, pointerId: event.pointerId,
        remote: selectedRemote, token: state.token };
      activePress = press;
      lastPointerDown = Date.now();
      button.classList.add('pressed'); send(key);
      if (['up', 'down', 'left', 'right', 'volume_up', 'volume_down'].includes(key)) {
        holdTimer = setTimeout(() => {
          if (activePress !== press || document.hidden || selectedRemote !== press.remote
              || state.token !== press.token) return;
          repeatTimer = setInterval(() => {
            if (activePress !== press || document.hidden || selectedRemote !== press.remote
                || state.token !== press.token) { stopHeldKey(); return; }
            send(key);
          }, 220);
        }, 470);
      }
    });
    const cancel = event => {
      if (activePress && activePress.button === button
          && (event.pointerId === undefined || activePress.pointerId === event.pointerId)) stopHeldKey();
    };
    button.addEventListener('pointerup', cancel); button.addEventListener('pointercancel', cancel);
    button.addEventListener('pointerleave', cancel);
    button.addEventListener('click', event => {
      // The pointerdown already sent one command. A click synthesized after
      // Safari was backgrounded must never send it a second time. Keyboard/
      // assistive activation has detail=0 and does not need a pointerdown.
      if (event.detail === 0 && !document.hidden
          && Date.now() > suppressGhostClickUntil && Date.now() - lastPointerDown > 400) send(key);
    });
  });
  $('release').addEventListener('click', async () => {
    const token = state.token;
    const departing = selectedRemote;
    manuallyDisconnected = true;
    disconnected('Disconnected. Generate a new PIN on Vela TV to pair again.');
    try { await request('/api/release', {}, token); }
    catch (_) { /* The short-lived lease expires automatically. */ }
    remotes = remotes.filter(remote => remote !== departing);
    selectedRemote = null; state.token = '';
    await saveRemotes().catch(() => {});
    if (remotes.length) selectTv(remotes[0]); else showPair();
    manuallyDisconnected = false;
  });
  // Do not release on pagehide: mobile browsers routinely suspend tabs.
  function foreground() {
    lastOpenedAt = Date.now();
    if (state.token) heartbeat();
    status();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHeldKey(true);
    else foreground();
  });
  window.addEventListener('blur', () => stopHeldKey(true));
  window.addEventListener('pagehide', () => stopHeldKey(true));
  window.addEventListener('focus', foreground);
  window.addEventListener('online', status);
  $('tvPill').addEventListener('click', () => {
    const open = $('tvMenu').classList.toggle('hidden');
    $('tvPill').setAttribute('aria-expanded', String(!open));
  });
  $('cancelPair').addEventListener('click', () => { if (selectedRemote) selectTv(selectedRemote); });
  (async () => {
    let saved = await storedKey('trustedTvs').catch(() => null);
    if (!Array.isArray(saved) || !saved.length) {
      const current = await storedKey('current').catch(() => null);
      const pending = await storedKey('pending').catch(() => null);
      saved = (current || pending) ? [{ tvId: '', tvName: 'TV 1', identity: current || pending }] : [];
    }
    remotes = saved.slice(0, 2).filter(r => r.identity && r.identity.privateKey)
      .map(r => ({ ...r, token: '', online: false, busy: false, sameNetwork: false, textPublicKey: '' }));
    if (remotes.length) selectTv(remotes[0]); else { showPair(); status(); }
  })().catch(() => { showPair(); status(); });
  // Connected phones already heartbeat; avoid quadrupling constant Worker
  // status traffic when four controllers stay paired all day.
  statusTimer = setInterval(() => { if (!document.hidden && !state.token) status(); }, 30000);
})();
