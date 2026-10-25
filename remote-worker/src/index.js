// Vela remote relay. A single SQLite-backed Durable Object serializes the
// controller lease and TV command queue. No open LAN port or public TV address.
const SITE = 'https://vudh1.github.io';
const LEASE_MS = 22_000;
const TV_ONLINE_MS = 25_000;
const MAX_FAILED = 5;
const RATE_WINDOW_MS = 15 * 60_000;
const KEYS = new Set(['up', 'down', 'left', 'right', 'select', 'back', 'home',
  'volume_up', 'volume_down', 'mute', 'play_pause']);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }
  });
}
function randomToken() {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(value) {
  const data = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
    b => b.toString(16).padStart(2, '0')).join('');
}
function sameString(a, b) {
  // No early return for mismatched lengths or characters.
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function ipv6LanPrefix(ip) {
  // Public IPv6 addresses commonly rotate their interface-id within a home
  // /64. Comparing the complete address would incorrectly reject a phone and
  // TV on the same Wi-Fi. A PIN and exclusive lease remain mandatory.
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(':')) return '';
  const pieces = ip.toLowerCase().split('::');
  if (pieces.length > 2) return '';
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(':') : [];
  if (left.some(x => !x || x.length > 4) || right.some(x => !x || x.length > 4)) return '';
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 2 && missing < 1) || (pieces.length === 1 && missing !== 0)) return '';
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (words.length !== 8) return '';
  return words.slice(0, 4).map(x => x.padStart(4, '0')).join(':');
}
function sameHomeNetwork(a, b) {
  return a === b || (!!ipv6LanPrefix(a) && ipv6LanPrefix(a) === ipv6LanPrefix(b));
}
function bearer(req) {
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(req.headers.get('authorization') || '');
  return match ? match[1].toLowerCase() : '';
}
async function limitedBody(request, maxBytes) {
  if (!request.body) return '{}';
  const reader = request.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  } finally { reader.releaseLock(); }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    const path = new URL(request.url).pathname;
    const isTv = path.startsWith('/api/tv/');
    const cors = { 'access-control-allow-origin': SITE,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600', 'vary': 'Origin' };
    // TV Java networking does not send Origin. Browsers must be from the exact
    // GitHub Pages origin; neither wildcards nor credentials are allowed.
    if (origin && origin !== SITE) return json({ error: 'origin' }, 403);
    if (isTv && origin) return json({ error: 'tv_only' }, 403, cors);
    if (request.method === 'OPTIONS')
      return origin === SITE ? new Response(null, { status: 204, headers: cors })
        : json({ error: 'origin' }, 403);
    if (!/^\/api\/(?:status|connect|heartbeat|command|release|tv\/(?:enroll|poll|disable))$/.test(path))
      return json({ error: 'not_found' }, 404, cors);
    if (!env.REMOTE_PIN || !/^\d{8,12}$/.test(env.REMOTE_PIN))
      return json({ error: 'not_configured' }, 503, cors);
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip) return json({ error: 'network_unavailable' }, 403, cors);
    if (request.method !== (path === '/api/status' ? 'GET' : 'POST'))
      return json({ error: 'method' }, 405, cors);
    if (Number(request.headers.get('content-length') || 0) > 2048)
      return json({ error: 'request_too_large' }, 413, cors);
    const body = request.method === 'POST' ? await limitedBody(request, 2048) : undefined;
    if (body === null) return json({ error: 'request_too_large' }, 413, cors);
    const room = env.REMOTE_ROOM.get(env.REMOTE_ROOM.idFromName('primary-tv'));
    // IP is forwarded internally only. Never trust caller-supplied IP fields.
    const upstream = new Request('https://room.internal' + path, {
      method: request.method,
      headers: { authorization: request.headers.get('authorization') || '',
        'x-verified-ip': ip },
      body
    });
    const result = await room.fetch(upstream);
    const headers = new Headers(result.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(result.body, { status: result.status, headers });
  }
};

export class RemoteRoom {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.queue = Promise.resolve(); }

  fetch(req) {
    // Crypto operations are asynchronous. Explicit serialization is needed so
    // two simultaneous PIN submissions cannot both obtain the exclusive lease.
    const next = this.queue.then(() => this.process(req));
    this.queue = next.catch(() => {});
    return next;
  }

  async process(req) {
    const path = new URL(req.url).pathname;
    const ip = req.headers.get('x-verified-ip') || '';
    const now = Date.now();
    let data = {};
    if (req.method === 'POST') {
      try { data = await req.json(); }
      catch (_) { return json({ error: 'invalid_json' }, 400); }
      if (!data || typeof data !== 'object' || Array.isArray(data))
        return json({ error: 'invalid_json' }, 400);
    }
    const stored = await this.ctx.storage.get('room') || {};
    const state = { tvHash: stored.tvHash || '', tvIp: stored.tvIp || '',
      tvSeen: stored.tvSeen || 0, controllerHash: stored.controllerHash || '',
      controllerIp: stored.controllerIp || '', lease: stored.lease || 0,
      commands: stored.commands || [], lastCommandAt: stored.lastCommandAt || 0,
      failures: stored.failures || {},
      globalFailures: stored.globalFailures || [] };
    // Do not retain old attacker IP hashes forever in Durable Object storage.
    for (const key of Object.keys(state.failures)) {
      state.failures[key] = state.failures[key].filter(t => t > now - RATE_WINDOW_MS);
      if (!state.failures[key].length) delete state.failures[key];
    }
    const online = !!state.tvHash && state.tvSeen > now - TV_ONLINE_MS;
    const active = !!state.controllerHash && state.lease > now;
    const sameNetwork = online && sameHomeNetwork(state.tvIp, ip);
    const persist = () => this.ctx.storage.put('room', state);
    const rateKey = await sha256(ip);
    const times = state.failures[rateKey] || [];
    state.globalFailures = state.globalFailures.filter(t => t > now - RATE_WINDOW_MS);
    if (path === '/api/status')
      return json({ online, busy: active, sameNetwork });

    if (path === '/api/connect' || path === '/api/tv/enroll') {
      if (times.length >= MAX_FAILED || state.globalFailures.length >= 40)
        return json({ error: 'locked', retryAfterSeconds: 900 }, 429);
      if (typeof data.pin !== 'string' || !/^\d{8,12}$/.test(data.pin) ||
          !sameString(data.pin, this.env.REMOTE_PIN)) {
        state.failures[rateKey] = [...times, now];
        state.globalFailures.push(now);
        await persist();
        return json({ error: 'incorrect_pin' }, 401);
      }
      delete state.failures[rateKey];
      if (path === '/api/tv/enroll') {
        if (typeof data.tvToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.tvToken))
          return json({ error: 'invalid_token' }, 400);
        const hashed = await sha256(data.tvToken);
        // Once enrolled, another client with only the PIN cannot replace TV.
        if (state.tvHash && !sameString(state.tvHash, hashed))
          return json({ error: 'already_enrolled' }, 409);
        state.tvHash = hashed;
        state.tvIp = ip;
        state.tvSeen = now;
        await persist();
        return json({ ok: true });
      }
      if (!online) return json({ error: 'tv_offline' }, 503);
      if (!sameNetwork) return json({ error: 'different_network' }, 403);
      if (active) return json({ error: 'in_use' }, 409);
      const token = randomToken();
      state.controllerHash = await sha256(token);
      state.controllerIp = ip;
      state.lease = now + LEASE_MS;
      state.commands = [];
      await persist();
      return json({ token, leaseSeconds: LEASE_MS / 1000 });
    }
    if (path.startsWith('/api/tv/')) {
      const token = bearer(req);
      if (!token || !state.tvHash || !sameString(await sha256(token), state.tvHash))
        return json({ error: 'unauthorized' }, 401);
      if (path === '/api/tv/disable') {
        await this.ctx.storage.delete('room');
        return json({ ok: true });
      }
      if (!sameHomeNetwork(state.tvIp, ip)) {
        // Network changed; invalidate the old controller's authorization.
        state.controllerHash = ''; state.lease = 0; state.commands = [];
      }
      state.tvIp = ip;
      state.tvSeen = now;
      const commands = state.commands.filter(c => c.at > now - 6_000);
      state.commands = [];
      await persist();
      return json({ active: !!state.controllerHash && state.lease > now,
        fast: state.lastCommandAt > now - 4_000,
        commands });
    }
    const token = bearer(req);
    if (!token || !active || !sameString(await sha256(token), state.controllerHash)
        || !sameHomeNetwork(ip, state.controllerIp) || !sameNetwork)
      return json({ error: 'session_expired' }, 401);
    if (path === '/api/release') {
      state.controllerHash = ''; state.lease = 0; state.commands = [];
      await persist();
      return json({ ok: true });
    }
    state.lease = now + LEASE_MS;
    if (path === '/api/command') {
      if (!KEYS.has(data.key)) return json({ error: 'invalid_key' }, 400);
      // Never carry stale inputs into a future controller session.
      state.commands = state.commands.filter(c => c.at > now - 6_000).slice(-15);
      state.commands.push({ key: data.key, at: now, id: randomToken().slice(0, 12) });
      state.lastCommandAt = now;
    }
    await persist();
    return json({ ok: true, leaseSeconds: LEASE_MS / 1000 });
  }
}
