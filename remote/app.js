(() => {
  'use strict';
  // This is the only approved API origin. Never accept an arbitrary URL that
  // could receive the user's PIN or remote session.
  const API = 'https://velatv-remote.vudhone.workers.dev';
  const $ = id => document.getElementById(id);
  const state = { token: '', busy: false, online: false, sameNetwork: false };
  let holdTimer, repeatTimer, pingTimer, statusTimer;
  function message(text) { $('error').textContent = text; }
  async function request(path, payload, token = '') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7500);
    try {
      const response = await fetch(API + path, {
        method: payload === undefined ? 'GET' : 'POST',
        mode: 'cors', cache: 'no-store', credentials: 'omit',
        headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: 'Bearer ' + token } : {}) },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || 'unavailable'), { status: response.status });
      return data;
    } finally { clearTimeout(timeout); }
  }
  function showConnection() {
    $('network').className = 'network' + (state.online ? state.busy ? ' busy' : ' online' : '');
    $('network').querySelector('span').textContent = !state.online ? 'TV offline' : state.token ? 'Connected'
      : state.busy ? 'Remote in use' : 'TV available';
  }
  async function status() {
    try {
      const data = await request('/api/status');
      state.online = !!data.online; state.busy = !!data.busy;
      state.sameNetwork = !!data.sameNetwork;
      showConnection();
    } catch (_) {
      state.online = false; showConnection();
    }
  }
  function disconnected(reason = '') {
    state.token = '';
    $('controller').classList.add('hidden');
    $('pair').classList.remove('hidden');
    $('pin').value = '';
    message(reason);
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    status();
  }
  const errors = {
    incorrect_pin: 'Incorrect PIN. Check the private PIN you set for Vela.',
    different_network: 'Your phone and TV must use the same home Internet connection. Turn off your VPN or mobile data.',
    tv_offline: 'Vela TV is offline. Open Vela and check Remote settings.',
    in_use: 'Another device is using this remote. It must disconnect first, or you can wait about 22 seconds.',
    locked: 'Too many attempts. Wait 15 minutes before trying again.',
    not_configured: 'Remote setup is not finished on Cloudflare.',
    already_enrolled: 'A different TV is already registered.',
    session_expired: 'Remote session ended. Enter your PIN to reconnect.'
  };
  $('pinForm').addEventListener('submit', async event => {
    event.preventDefault();
    const pin = $('pin').value;
    if (!/^\d{8,12}$/.test(pin)) { message('Enter your 8–12 digit PIN.'); return; }
    if (!state.online) { message('TV is offline. Check the connection first.'); return; }
    if (!state.sameNetwork) { message(errors.different_network); return; }
    $('connect').disabled = true;
    message('');
    try {
      const data = await request('/api/connect', { pin });
      state.token = data.token;
      $('pin').value = ''; // PIN is never persisted or logged.
      $('pair').classList.add('hidden');
      $('controller').classList.remove('hidden');
      showConnection();
      pingTimer = setInterval(async () => {
        if (!state.token) return;
        try { await request('/api/heartbeat', {}, state.token); }
        catch (error) { if (error.status === 401) disconnected(errors.session_expired); }
      }, 7000);
    } catch (error) { message(errors[error.message] || 'Connection failed. Try again in a moment.'); }
    finally { $('pin').value = ''; $('connect').disabled = false; }
  });
  async function send(key) {
    if (!state.token) return;
    if (navigator.vibrate) navigator.vibrate(9);
    try { await request('/api/command', { key }, state.token); }
    catch (error) {
      if (error.status === 401) disconnected(errors.session_expired);
      else $('remoteInfo').textContent = 'TV did not receive this command. Check the connection.';
    }
  }
  document.querySelectorAll('[data-key]').forEach(button => {
    const key = button.dataset.key;
    let fired = false;
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !state.token) return;
      fired = true; button.classList.add('pressed'); send(key);
      if (['up','down','left','right','volume_up','volume_down'].includes(key)) {
        holdTimer = setTimeout(() => { repeatTimer = setInterval(() => send(key), 220); }, 470);
      }
    });
    const cancel = () => { clearTimeout(holdTimer); clearInterval(repeatTimer); button.classList.remove('pressed'); };
    button.addEventListener('pointerup', cancel);
    button.addEventListener('pointercancel', cancel);
    button.addEventListener('pointerleave', cancel);
    button.addEventListener('click', event => {
      if (event.detail === 0 || !fired) send(key); // keyboard activation
      fired = false;
    });
  });
  $('release').addEventListener('click', async () => {
    const token = state.token;
    disconnected('');
    try { await request('/api/release', {}, token); } catch (_) { /* Lease expires automatically. */ }
  });
  window.addEventListener('pagehide', () => {
    if (state.token) fetch(API + '/api/release', { method:'POST',keepalive:true,
      headers:{'content-type':'application/json',authorization:'Bearer '+state.token},body:'{}' }).catch(()=>{});
  });
  status();
  statusTimer = setInterval(status, 8000);
})();
