// Vela remote relay. A single SQLite-backed Durable Object serializes the
// each TV's isolated queue and up to four controllers per TV.
// The pairing PIN originates on the TV;
// Cloudflare stores only its salted hash, never a GitHub-configured shared PIN.
// No open LAN port or public TV address.
const SITE = 'https://vudh1.github.io';
const LEASE_MS = 100_000; // Eight possible phone/TV leases; economical 40s heartbeats.
const TV_ONLINE_MS = 25_000;
const UNCLAIMED_MS = 10 * 60_000;
const PAIRING_PIN_MS = 10 * 60_000;
const RESUME_CHALLENGE_MS = 45_000;
const TV_APPROVAL_MS = 90_000;
const MAX_FAILED = 5;
const RATE_WINDOW_MS = 15 * 60_000;
const MAX_CONTROLLERS = 4;
const MAX_TVS = 2;
const KEYS = new Set(['up', 'down', 'left', 'right', 'select', 'back', 'home',
  'volume_up', 'volume_down', 'mute', 'play_pause', 'settings',
  'power_toggle', 'power_off', 'wifi_settings', 'input', 'hdmi1', 'hdmi2', 'hdmi3', 'hdmi4']);

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
function validPublicKey(key) {
  // The Worker stores only the controller's public key. Its non-extractable
  // private key remains in the phone's WebCrypto/IndexedDB storage.
  return !!key && typeof key === 'object' && !Array.isArray(key)
    && key.kty === 'EC' && key.crv === 'P-256'
    && typeof key.x === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(key.x)
    && typeof key.y === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(key.y);
}
function validatedTvName(input) {
  if (typeof input !== 'string' || input.length > 80) return '';
  const name = input.trim().replace(/\s+/g, ' ');
  // Accept a short, ordinary marketing name only. Never store or display
  // serial numbers, control characters, or arbitrary HTML from a TV client.
  return name.length >= 3 && name.length <= 48 && /^[A-Za-z0-9][A-Za-z0-9 ._()+-]*$/.test(name)
    ? name : '';
}
function uniqueTvName(input, root, self) {
  const name = validatedTvName(input);
  if (!name) return self.name;
  return root.tvs.some(tv => tv !== self && tv.name === name) ? name + ' (2)' : name;
}
async function importPublicKey(jwk) {
  return crypto.subtle.importKey('jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}
function signatureBytes(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{128}$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/.{2}/g), h => parseInt(h, 16));
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
    const incomingUrl = new URL(request.url);
    const path = incomingUrl.pathname;
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
    if (!/^\/api\/(?:status|connect|approval-status|challenge|resume|heartbeat|command|release|tv\/(?:enroll|pin|approve|revoke|poll|disable))$/.test(path))
      return json({ error: 'not_found' }, 404, cors);
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
    const upstream = new Request('https://room.internal' + path +
      (path === '/api/status' ? incomingUrl.search : ''), {
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
    const url = new URL(req.url);
    const path = url.pathname;
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
    // Upgrade legacy primary-tv state in place. Neither old TV credentials nor
    // its four independently trusted phones need to pair again.
    const oldTvs = Array.isArray(stored.tvs) ? stored.tvs : stored.tvHash ? [stored] : [];
    const root = { tvs: oldTvs.filter(tv => tv && tv.tvHash &&
      !(tv.pendingUntil && tv.pendingUntil <= now)).slice(0, MAX_TVS).map((tv, i) => {
      const legacyControllers = tv.pairedKey || tv.controllerHash ? [{
        pairedKey: tv.pairedKey || null, pairedKeyId: tv.pairedKeyId || '',
        controllerHash: tv.controllerHash || '', controllerIp: tv.controllerIp || '',
        lease: tv.lease || 0 }] : [];
      return { id: tv.id || 'tv-1', name: tv.name || 'TV ' + (i + 1),
        tvHash: tv.tvHash, tvIp: tv.tvIp || '', tvSeen: tv.tvSeen || 0,
        pinSalt: tv.pinSalt || '', pinHash: tv.pinHash || '',
        pinExpiresAt: tv.pinExpiresAt || tv.pendingUntil || 0,
        pendingUntil: tv.pendingUntil || 0,
        pendingApproval: tv.pendingApproval || null,
        controllers: (Array.isArray(tv.controllers) ? tv.controllers : legacyControllers)
          .filter(c => c && (c.pairedKey || c.controllerHash)).slice(0, MAX_CONTROLLERS)
          .map(c => ({ ...c, id: c.id || randomToken().slice(0, 24) })),
        commands: tv.commands || [], lastCommandAt: tv.lastCommandAt || 0,
        readyUntil: tv.readyUntil || 0, textPublicKey: tv.textPublicKey || '',
        challenges: tv.challenges || [], failures: tv.failures || {},
        globalFailures: tv.globalFailures || [] };
    }) };
    for (const tv of root.tvs) {
      if (tv.pinExpiresAt && tv.pinExpiresAt <= now) {
        tv.pinSalt = ''; tv.pinHash = ''; tv.pinExpiresAt = 0;
      }
      if (tv.pendingApproval && tv.pendingApproval.expires <= now)
        tv.pendingApproval = null;
    }
    const persist = () => this.ctx.storage.put('room', root);
    const tvOnline = tv => !!tv && !!tv.tvHash && tv.tvSeen > now - TV_ONLINE_MS;
    const tvNetwork = tv => tvOnline(tv) && sameHomeNetwork(tv.tvIp, ip);
    const ipHash = await sha256(ip);
    const authToken = bearer(req);
    const tokenHash = authToken ? await sha256(authToken) : '';
    if (path === '/api/status') {
      const requested = url.searchParams.get('tvId');
      if (requested && !/^[a-z0-9-]{1,32}$/.test(requested))
        return json({ error: 'invalid_tv' }, 400);
      const matching = requested ? root.tvs.filter(tv => tv.id === requested) : root.tvs;
      return json({ online: matching.some(tvOnline),
        busy: matching.some(tv => tv.controllers.some(c => c.controllerHash && c.lease > now)),
        sameNetwork: matching.some(tvNetwork),
        ...(requested && matching[0] ? { tvId: matching[0].id, tvName: matching[0].name } : {}) });
    }
    let state = null;
    if (path === '/api/tv/enroll') {
      if (root.tvs.length >= MAX_TVS) return json({ error: 'max_tvs' }, 409);
      // A second TV must join the same home network as the first enrollment.
      if (root.tvs.length && !root.tvs.some(tv => sameHomeNetwork(tv.tvIp, ip)))
        return json({ error: 'different_network' }, 403);
      const used = new Set(root.tvs.map(tv => tv.name));
      const name = used.has('TV 1') ? 'TV 2' : 'TV 1';
      state = { id: randomToken().slice(0, 32), name, tvHash: '', tvIp: '', tvSeen: 0,
        pinSalt: '', pinHash: '', pinExpiresAt: 0, pendingUntil: 0,
        pendingApproval: null,
        controllers: [], commands: [], lastCommandAt: 0, readyUntil: 0,
        textPublicKey: '', challenges: [], failures: {}, globalFailures: [] };
      root.tvs.push(state);
    } else if (path.startsWith('/api/tv/')) {
      state = root.tvs.find(tv => tokenHash && sameString(tv.tvHash, tokenHash));
      if (!state) return json({ error: 'unauthorized' }, 401);
    } else if (path === '/api/connect') {
      // A Private Relay phone can present the correct one-time PIN while its
      // public IP differs. Match the salted PIN before deciding whether the
      // TV must explicitly approve this different-network controller.
      for (const tv of root.tvs) {
        if (!tvOnline(tv) || !tv.pinHash || !/^\d{10}$/.test(data.pin || '')) continue;
        if (sameString(await sha256(tv.pinSalt + ':' + data.pin), tv.pinHash)) {
          state = tv; break;
        }
      }
      if (!state) state = root.tvs.find(tv => tvNetwork(tv) && tv.pinHash)
        || root.tvs.find(tv => tvOnline(tv) && tv.pinHash) || root.tvs[0];
    } else if (path === '/api/approval-status') {
      const proofHash = typeof data.approvalToken === 'string' && /^[a-f0-9]{64}$/.test(data.approvalToken)
        ? await sha256(data.approvalToken) : '';
      state = root.tvs.find(tv => tv.pendingApproval && proofHash
        && sameString(tv.pendingApproval.proofHash, proofHash)
        && sameString(tv.pendingApproval.id, data.requestId));
    } else if (path === '/api/challenge') {
      state = root.tvs.find(tv => tv.controllers.some(c => c.pairedKeyId && c.pairedKeyId === data.keyId));
      if (!state && data.keyId === undefined) {
        const candidates = root.tvs.filter(tv => tv.controllers.some(c => c.pairedKey));
        if (candidates.length === 1 && candidates[0].controllers.length === 1) state = candidates[0];
      }
      if (!state) state = root.tvs.find(tvNetwork) || root.tvs[0];
    } else if (path === '/api/resume') {
      const hash = typeof data.challenge === 'string' && /^[a-f0-9]{64}$/i.test(data.challenge)
        ? await sha256(data.challenge) : '';
      state = root.tvs.find(tv => tv.challenges.some(ch =>
        (ch.ipHash === ipHash || (ch.ipHash === '' && ch.trustedRelay === true))
        && sameString(ch.hash, hash)));
    } else {
      state = root.tvs.find(tv => tv.controllers.some(c => tokenHash && sameString(c.controllerHash, tokenHash)));
    }
    if (!state) return json({ error: path === '/api/connect' ? 'tv_offline' : 'session_expired' },
      path === '/api/connect' ? 503 : 401);
    // Do not retain old attacker IP hashes forever in Durable Object storage.
    for (const key of Object.keys(state.failures)) {
      state.failures[key] = state.failures[key].filter(t => t > now - RATE_WINDOW_MS);
      if (!state.failures[key].length) delete state.failures[key];
    }
    const online = !!state.tvHash && state.tvSeen > now - TV_ONLINE_MS;
    const active = state.controllers.some(c => !!c.controllerHash && c.lease > now);
    const sameNetwork = online && sameHomeNetwork(state.tvIp, ip);
    const rateKey = ipHash;
    const times = state.failures[rateKey] || [];
    state.globalFailures = state.globalFailures.filter(t => t > now - RATE_WINDOW_MS);
    state.challenges = state.challenges.filter(ch => ch.expires > now).slice(-12);

    if (path === '/api/approval-status') {
      const pending = state.pendingApproval;
      if (!pending || pending.expires <= now) return json({ error: 'approval_expired' }, 410);
      // The short-lived approval proof is not a bearer credential. Even if
      // that proof leaks from a phone, its non-extractable key must sign the
      // exact approval request before the Worker releases a controller token.
      const proof = signatureBytes(data.signature);
      let ownsKey = false;
      if (proof) {
        try {
          const key = await importPublicKey(pending.publicKey);
          ownsKey = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
            key, proof, new TextEncoder().encode('vela-approve-v1:'
              + pending.id + ':' + data.approvalToken));
        } catch (_) { /* An invalid signature never advances approval. */ }
      }
      if (!ownsKey) return json({ error: 'session_expired' }, 401);
      if (pending.decision === 'rejected') {
        state.pendingApproval = null; await persist();
        return json({ error: 'approval_denied' }, 403);
      }
      if (pending.decision !== 'approved') return json({ approvalPending: true }, 202);
      if (!online || state.controllers.length >= MAX_CONTROLLERS) {
        state.pendingApproval = null; await persist();
        return json({ error: online ? 'max_controllers' : 'tv_offline' }, online ? 409 : 503);
      }
      if (state.controllers.some(c => c.pairedKeyId === pending.keyId)) {
        state.pendingApproval = null; await persist();
        return json({ error: 'already_paired' }, 409);
      }
      const token = randomToken();
      state.controllers.push({ id: randomToken().slice(0, 24),
        pairedKey: pending.publicKey, pairedKeyId: pending.keyId,
        controllerHash: await sha256(token), controllerIp: ip,
        trustedRelay: true, lease: now + LEASE_MS });
      state.pendingUntil = 0;
      state.pendingApproval = null;
      await persist();
      return json({ token, tvId: state.id, tvName: state.name,
        trustedRelay: true, leaseSeconds: LEASE_MS / 1000 });
    }

    if (path === '/api/tv/enroll') {
      if (typeof data.tvToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.tvToken))
        return json({ error: 'invalid_token' }, 400);
      if (typeof data.pin !== 'string' || !/^\d{10}$/.test(data.pin))
        return json({ error: 'invalid_pin' }, 400);
      // First enrollment is a one-TV claim, not an authorization to replace
      // an existing TV. Changing its PIN requires the enrolled TV's token.
      // The secret PIN alone never authorizes TV takeover.
      if (state.tvHash) return json({ error: 'already_enrolled' }, 409);
      state.tvHash = await sha256(data.tvToken);
      state.name = uniqueTvName(data.tvName, root, state);
      state.textPublicKey = '';
      state.tvIp = ip;
      state.tvSeen = now;
      state.pendingUntil = now + UNCLAIMED_MS;
      state.pinSalt = randomToken();
      state.pinHash = await sha256(state.pinSalt + ':' + data.pin);
      state.pinExpiresAt = now + PAIRING_PIN_MS;
      await persist();
      return json({ ok: true, tvId: state.id, tvName: state.name });
    }
    if (path === '/api/connect') {
      if (!online) return json({ error: 'tv_offline' }, 503);
      if (!state.pinHash || !state.pinSalt)
        return json({ error: 'pairing_required' }, 409);
      if (state.controllers.length >= MAX_CONTROLLERS)
        return json({ error: 'max_controllers' }, 409);
      if (times.length >= MAX_FAILED || state.globalFailures.length >= 40)
        return json({ error: 'locked', retryAfterSeconds: 900 }, 429);
      const pinHash = typeof data.pin === 'string' && /^\d{10}$/.test(data.pin)
        ? await sha256(state.pinSalt + ':' + data.pin) : '';
      if (!sameString(pinHash, state.pinHash)) {
        state.failures[rateKey] = [...times, now];
        state.globalFailures.push(now);
        await persist();
        return json({ error: 'incorrect_pin' }, 401);
      }
      // Legacy clients may still pair using a PIN only, but modern clients
      // register a public key for PIN-free return after sleep or tab restart.
      let verifiedKey = null;
      if (data.publicKey !== undefined) {
        if (!validPublicKey(data.publicKey)) return json({ error: 'invalid_controller_key' }, 400);
        try { await importPublicKey(data.publicKey); }
        catch (_) { return json({ error: 'invalid_controller_key' }, 400); }
        verifiedKey = { kty: 'EC', crv: 'P-256', x: data.publicKey.x, y: data.publicKey.y };
      }
      const keyId = verifiedKey ? await sha256(verifiedKey.x + ':' + verifiedKey.y) : '';
      if (keyId && state.controllers.some(c => c.pairedKeyId === keyId))
        return json({ error: 'already_paired' }, 409);
      // Older web clients would interpret a 202 approval request as a normal
      // lease and incorrectly claim success. They must opt into the new flow.
      if (!sameNetwork && data.approvalProtocol !== 1)
        return json({ error: 'different_network' }, 403);
      delete state.failures[rateKey];
      // Pairing codes authorize exactly one registration, not a permanent
      // fallback credential after the lease has expired.
      state.pinSalt = ''; state.pinHash = ''; state.pinExpiresAt = 0;
      if (!sameNetwork) {
        // A PIN from outside the home's visible public network is never
        // sufficient. A signed phone identity and an explicit Sony TV button
        // press are both required before this phone can issue commands.
        if (!verifiedKey) return json({ error: 'controller_key_required' }, 403);
        const approvalToken = randomToken();
        const requestId = randomToken().slice(0, 24);
        state.pendingApproval = { id: requestId, proofHash: await sha256(approvalToken),
          publicKey: verifiedKey, keyId, decision: 'waiting',
          expires: now + TV_APPROVAL_MS };
        // An approval may take 90s, but must not shorten the TV's original
        // ten-minute unclaimed enrollment grace period.
        if (state.pendingUntil) state.pendingUntil = Math.max(state.pendingUntil, now + TV_APPROVAL_MS);
        await persist();
        return json({ approvalRequired: true, approvalToken, requestId,
          approvalSeconds: TV_APPROVAL_MS / 1000 }, 202);
      }
      state.pendingUntil = 0;
      const token = randomToken();
      state.controllers.push({ id: randomToken().slice(0, 24),
        pairedKey: verifiedKey, pairedKeyId: keyId,
        controllerHash: await sha256(token), controllerIp: ip, lease: now + LEASE_MS });
      await persist();
      return json({ token, tvId: state.id, tvName: state.name,
        trustedRelay: false, leaseSeconds: LEASE_MS / 1000 });
    }
    if (path === '/api/challenge') {
      if (!online) return json({ error: 'tv_offline' }, 503);
      if (times.length >= MAX_FAILED || state.globalFailures.length >= 40)
        return json({ error: 'locked', retryAfterSeconds: 900 }, 429);
      const requestedKey = typeof data.keyId === 'string' && /^[a-f0-9]{64}$/.test(data.keyId)
        ? data.keyId : '';
      // Omitted keyId remains compatible with the former single-phone client.
      const candidate = requestedKey ? state.controllers.find(c => c.pairedKeyId === requestedKey)
        : state.controllers.length === 1 ? state.controllers[0] : null;
      if (!candidate || !candidate.pairedKey)
        return json({ error: 'pairing_required' }, 409);
      if (!sameNetwork && candidate.trustedRelay !== true)
        return json({ error: 'different_network' }, 403);
      const challenge = randomToken();
      state.challenges.push({ hash: await sha256(challenge),
        ipHash: candidate.trustedRelay === true ? '' : rateKey,
        trustedRelay: candidate.trustedRelay === true,
        keyId: candidate.pairedKeyId, expires: now + RESUME_CHALLENGE_MS });
      state.challenges = state.challenges.slice(-12);
      await persist();
      return json({ challenge, keyId: candidate.pairedKeyId,
        expiresSeconds: RESUME_CHALLENGE_MS / 1000 });
    }
    if (path === '/api/resume') {
      if (!online) return json({ error: 'tv_offline' }, 503);
      if (times.length >= MAX_FAILED || state.globalFailures.length >= 40)
        return json({ error: 'locked', retryAfterSeconds: 900 }, 429);
      const bytes = signatureBytes(data.signature);
      const hash = typeof data.challenge === 'string' && /^[a-f0-9]{64}$/i.test(data.challenge)
        ? await sha256(data.challenge) : '';
      const index = state.challenges.findIndex(ch =>
        (ch.ipHash === rateKey || (ch.ipHash === '' && ch.trustedRelay === true))
        && sameString(ch.hash, hash));
      if (!bytes || index < 0) return json({ error: 'session_expired' }, 401);
      // Single-use, short-lived challenge. A stolen signature cannot be replayed.
      const [usedChallenge] = state.challenges.splice(index, 1);
      const candidate = state.controllers.find(c => c.pairedKeyId === usedChallenge.keyId);
      if (!candidate || (!sameNetwork && candidate.trustedRelay !== true)) {
        await persist();
        return json({ error: 'different_network' }, 403);
      }
      let verified = false;
      try {
        const key = await importPublicKey(candidate.pairedKey);
        verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
          key, bytes, new TextEncoder().encode('vela-remote-v1:' + data.challenge));
      } catch (_) { /* Treat malformed signature as authentication failure. */ }
      if (!verified) {
        state.failures[rateKey] = [...times, now]; state.globalFailures.push(now);
        await persist();
        return json({ error: 'session_expired' }, 401);
      }
      delete state.failures[rateKey];
      const token = randomToken();
      // Commands from the superseded lease must not run after reconnection.
      state.commands = state.commands.filter(c => c.owner !== candidate.controllerHash);
      candidate.controllerHash = await sha256(token);
      candidate.controllerIp = ip;
      candidate.lease = now + LEASE_MS;
      // A returning phone must not cancel the other phones' queued controls.
      await persist();
      return json({ token, tvId: state.id, tvName: state.name,
        trustedRelay: candidate.trustedRelay === true,
        leaseSeconds: LEASE_MS / 1000 });
    }
    if (path.startsWith('/api/tv/')) {
      const token = bearer(req);
      if (!token || !state.tvHash || !sameString(await sha256(token), state.tvHash))
        return json({ error: 'unauthorized' }, 401);
      if (path === '/api/tv/pin') {
        if (typeof data.pin !== 'string' || !/^\d{10}$/.test(data.pin))
          return json({ error: 'invalid_pin' }, 400);
        if (!sameHomeNetwork(state.tvIp, ip)) {
          // A PIN rotation must not bypass the same network-change reset
          // performed by the regular TV poll path.
          state.controllers = []; state.commands = []; state.challenges = [];
          state.readyUntil = 0;
        }
        if (state.controllers.length >= MAX_CONTROLLERS)
          return json({ error: 'max_controllers' }, 409);
        state.pinSalt = randomToken();
        state.pinHash = await sha256(state.pinSalt + ':' + data.pin);
        state.pinExpiresAt = now + PAIRING_PIN_MS;
        state.pendingApproval = null;
        if (state.pendingUntil) state.pendingUntil = now + UNCLAIMED_MS;
        // Adding the next trusted phone must never disconnect existing ones.
        state.tvIp = ip; state.tvSeen = now;
        await persist();
        return json({ ok: true, tvId: state.id, pairedCount: state.controllers.length });
      }
      if (path === '/api/tv/disable') {
        root.tvs = root.tvs.filter(tv => tv !== state);
        if (root.tvs.length) await persist();
        else await this.ctx.storage.delete('room');
        return json({ ok: true });
      }
      if (path === '/api/tv/approve') {
        if (!tvNetwork(state)) return json({ error: 'tv_network_changed' }, 409);
        if (typeof data.requestId !== 'string' || !/^[a-f0-9]{24}$/.test(data.requestId)
            || typeof data.approved !== 'boolean')
          return json({ error: 'invalid_approval' }, 400);
        if (!state.pendingApproval || state.pendingApproval.id !== data.requestId
            || state.pendingApproval.expires <= now
            || state.pendingApproval.decision !== 'waiting')
          return json({ error: 'approval_expired' }, 409);
        state.pendingApproval.decision = data.approved ? 'approved' : 'rejected';
        await persist();
        return json({ ok: true });
      }
      if (path === '/api/tv/revoke') {
        if (typeof data.controllerId !== 'string' || !/^[a-f0-9]{24}$/.test(data.controllerId))
          return json({ error: 'invalid_controller' }, 400);
        const removed = state.controllers.find(c => c.id === data.controllerId);
        if (!removed) return json({ error: 'controller_not_found' }, 404);
        state.controllers = state.controllers.filter(c => c !== removed);
        state.commands = state.commands.filter(c => c.owner !== removed.controllerHash);
        state.challenges = state.challenges.filter(ch => ch.keyId !== removed.pairedKeyId);
        await persist();
        return json({ ok: true, pairedCount: state.controllers.length });
      }
      if (!sameHomeNetwork(state.tvIp, ip)) {
        // Network changed: all phone proofs must be re-established by new PINs.
        state.controllers = []; state.commands = []; state.readyUntil = 0;
        state.challenges = []; state.pinSalt = ''; state.pinHash = ''; state.pinExpiresAt = 0;
        state.pendingApproval = null;
      }
      state.tvIp = ip;
      state.tvSeen = now;
      state.name = uniqueTvName(data.tvName, root, state);
      // The enrolled TV, and only the TV, publishes its local encryption key.
      // The server cannot decrypt typed text; only the paired controller sees
      // this public key and only the Sony device holds the wrapped private key.
      if (typeof data.textPublicKey === 'string' &&
          /^[A-Za-z0-9+/]{100,200}={0,2}$/.test(data.textPublicKey))
        state.textPublicKey = data.textPublicKey;
      const commands = state.commands.filter(c => c.at > now - 6_000)
        .map(({ owner, ...command }) => command); // Never expose session hashes to the TV.
      state.commands = [];
      await persist();
      const anyActive = state.controllers.some(c => !!c.controllerHash && c.lease > now);
      return json({ active: anyActive,
        pinPending: !!state.pinHash || !!(state.pendingApproval
          && state.pendingApproval.decision === 'waiting'),
        tvId: state.id,
        pairedCount: state.controllers.length,
        pairedPhones: state.controllers.map(c => ({ id: c.id, trustedRelay: c.trustedRelay === true })),
        pendingApprovalId: state.pendingApproval && state.pendingApproval.decision === 'waiting'
          ? state.pendingApproval.id : '',
        // Briefly speed up polling after real interaction or a newly opened
        // controller. An untouched phone must not consume fast polls all day.
        fast: anyActive && (state.lastCommandAt > now - 12_000 || state.readyUntil > now),
        commands });
    }
    const token = authToken;
    const controller = state.controllers.find(c => tokenHash && c.lease > now
      && sameString(tokenHash, c.controllerHash)
      && (c.trustedRelay === true || sameHomeNetwork(ip, c.controllerIp)));
    if (!controller || (!sameNetwork && controller.trustedRelay !== true))
      return json({ error: 'session_expired' }, 401);
    if (path === '/api/release') {
      // Disconnect removes only the requesting phone, not the other three.
      state.controllers = state.controllers.filter(c => c !== controller);
      state.commands = state.commands.filter(c => c.owner !== tokenHash);
      state.challenges = state.challenges.filter(ch => ch.keyId !== controller.pairedKeyId);
      await persist();
      return json({ ok: true });
    }
    controller.lease = now + LEASE_MS;
    if (path === '/api/heartbeat' && data.ready === true) state.readyUntil = now + 12_000;
    if (path === '/api/command') {
      if (data.key !== 'type_text' && !KEYS.has(data.key)) return json({ error: 'invalid_key' }, 400);
      if (data.key === 'type_text') {
        const payload = data.payload;
        if (Object.keys(data).some(key => key !== 'key' && key !== 'payload')
            || !state.textPublicKey || !payload || typeof payload !== 'object' || Array.isArray(payload)
            || Object.keys(payload).some(key => !['ephemeral', 'iv', 'cipher'].includes(key))
            || typeof payload.ephemeral !== 'string' || !/^[A-Za-z0-9+/]{100,200}={0,2}$/.test(payload.ephemeral)
            || typeof payload.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(payload.iv)
            || typeof payload.cipher !== 'string' || !/^[A-Za-z0-9+/]{24,440}={0,2}$/.test(payload.cipher))
          return json({ error: 'invalid_encrypted_text' }, 400);
      }
      // Never carry stale inputs into a future controller session.
      state.commands = state.commands.filter(c => c.at > now - 6_000).slice(-15);
      state.commands.push({ key: data.key, ...(data.key === 'type_text' ? { payload: {
        ephemeral: data.payload.ephemeral, iv: data.payload.iv, cipher: data.payload.cipher } } : {}),
        at: now, id: randomToken().slice(0, 12), owner: tokenHash });
      state.lastCommandAt = now;
    }
    await persist();
    return json({ ok: true, tvId: state.id, tvName: state.name,
      leaseSeconds: LEASE_MS / 1000,
      ...(path === '/api/heartbeat' && state.textPublicKey ? { textPublicKey: state.textPublicKey } : {}) });
  }
}
