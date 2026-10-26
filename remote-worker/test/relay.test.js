import test from 'node:test';
import assert from 'node:assert/strict';
import relay, { RemoteRoom } from '../src/index.js';

const TV_IP = '203.0.113.8';
const OTHER_IP = '198.51.100.27';
const SITE = 'https://vudh1.github.io';
const PIN = '8472059136';
const NEXT_PIN = '3901748265';
const TV_TOKEN = 'ab'.repeat(32);
class Storage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
}
function setup() {
  const env = {};
  const storage = new Storage();
  const room = new RemoteRoom({ storage }, env);
  env.REMOTE_ROOM = { idFromName: name => name, get: () => room };
  return { env, storage };
}
async function call(env, route, { ip = TV_IP, origin = SITE, data, token, method } = {}) {
  const req = new Request('https://velatv-remote.vudhone.workers.dev' + route, {
    method: method || (data === undefined ? 'GET' : 'POST'),
    headers: { 'cf-connecting-ip': ip,
      ...(origin ? { origin } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(data ? { 'content-type': 'application/json' } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const res = await relay.fetch(req, env);
  return { status: res.status, body: await res.json() };
}
async function enroll(env, pin = PIN, tvToken = TV_TOKEN, ip = TV_IP) {
  return call(env, '/api/tv/enroll', { ip, origin: null, data: { pin, tvToken } });
}
async function rotate(env, pin = NEXT_PIN, token = TV_TOKEN) {
  return call(env, '/api/tv/pin', { origin: null, data: { pin }, token });
}
async function poll(env, ip = TV_IP, token = TV_TOKEN) {
  return call(env, '/api/tv/poll', { ip, origin: null, data: {}, token });
}
async function controllerIdentity() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey,
    publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } };
}
async function identityId(identity) {
  const value = identity.publicKey.x + ':' + identity.publicKey.y;
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
}
async function resumeWith(env, identity, challenge, ip = TV_IP) {
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey, new TextEncoder().encode('vela-remote-v1:' + challenge));
  return call(env, '/api/resume', { ip,
    data: { challenge, signature: Buffer.from(signature).toString('hex') } });
}

test('needs no GitHub or Cloudflare PIN secret; rejects browser-origin TV claims', async () => {
  const { env } = setup();
  assert.deepEqual((await call(env, '/api/status')).body,
    { online: false, busy: false, sameNetwork: false });
  assert.equal((await call(env, '/api/status', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(env, '/api/tv/enroll', {
    data: { pin: PIN, tvToken: TV_TOKEN } })).status, 403);
  assert.equal((await call(env, '/api/connect', { data: { pin: PIN } })).status, 503);
});

test('TV-generated PIN is salted and hashed; one TV cannot replace another', async () => {
  const { env, storage } = setup();
  assert.equal((await enroll(env, '123', TV_TOKEN)).status, 400);
  assert.equal((await enroll(env, PIN, 'not-a-token')).status, 400);
  assert.equal((await enroll(env)).status, 200);
  const stored = await storage.get('room');
  assert.equal(stored.tvs[0].pinSalt.length, 64);
  assert.equal(stored.tvs[0].pinHash.length, 64);
  assert.equal(JSON.stringify(stored).includes(PIN), false);
  assert.equal(JSON.stringify(stored).includes(TV_TOKEN), false);
  assert.equal((await enroll(env, NEXT_PIN, 'cd'.repeat(32))).status, 200);
  assert.equal((await enroll(env, '3901748299', 'ef'.repeat(32))).status, 409);
  assert.equal((await rotate(env, NEXT_PIN, 'ef'.repeat(32))).status, 401);
  assert.equal((await call(env, '/api/status')).body.online, true);
});

test('two Sony TVs share one relay, but keep PINs, phones and commands isolated', async () => {
  const { env, storage } = setup();
  const TV_TWO = 'cd'.repeat(32);
  const tv1 = await enroll(env);
  const tv2 = await enroll(env, NEXT_PIN, TV_TWO);
  assert.equal(tv1.status, 200); assert.equal(tv2.status, 200);
  assert.notEqual(tv1.body.tvId, tv2.body.tvId);
  assert.deepEqual([tv1.body.tvName, tv2.body.tvName], ['TV 1', 'TV 2']);
  assert.equal((await enroll(env, '5555555555', 'ef'.repeat(32))).body.error, 'max_tvs');
  const oneIdentity = await controllerIdentity(), twoIdentity = await controllerIdentity();
  const one = await call(env, '/api/connect', { data: { pin: PIN, publicKey: oneIdentity.publicKey } });
  const two = await call(env, '/api/connect', { data: { pin: NEXT_PIN, publicKey: twoIdentity.publicKey } });
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  assert.equal(one.body.tvId, tv1.body.tvId);
  assert.equal(two.body.tvId, tv2.body.tvId);
  assert.equal((await call(env, '/api/status?tvId=' + tv1.body.tvId)).body.tvName, 'TV 1');
  assert.equal((await call(env, '/api/status?tvId=' + tv2.body.tvId)).body.tvName, 'TV 2');
  await Promise.all([
    call(env, '/api/command', { token: one.body.token, data: { key: 'up' } }),
    call(env, '/api/command', { token: two.body.token, data: { key: 'down' } })
  ]);
  assert.deepEqual((await poll(env)).body.commands.map(c => c.key), ['up']);
  assert.deepEqual((await poll(env, TV_IP, TV_TWO)).body.commands.map(c => c.key), ['down']);
  assert.equal((await storage.get('room')).tvs.length, 2);
  const challenge = await call(env, '/api/challenge', { data: { keyId: await identityId(twoIdentity) } });
  assert.equal(challenge.status, 200);
  const renewed = await resumeWith(env, twoIdentity, challenge.body.challenge);
  assert.equal(renewed.body.tvId, tv2.body.tvId);
  assert.equal((await call(env, '/api/tv/disable', { origin: null, token: TV_TOKEN, data: {} })).status, 200);
  assert.equal((await call(env, '/api/heartbeat', { token: renewed.body.token, data: {} })).status, 200);
  assert.equal((await poll(env)).status, 401);
  assert.equal((await poll(env, TV_IP, TV_TWO)).status, 200);
  assert.equal((await storage.get('room')).tvs.length, 1);
});

test('only enrolled TVs can publish short model labels; existing phones update without re-pairing', async () => {
  const { env, storage } = setup();
  const otherToken = 'cd'.repeat(32);
  const first = await enroll(env);
  const second = await enroll(env, NEXT_PIN, otherToken);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const paired = await call(env, '/api/connect', { data: { pin: PIN } });
  assert.equal(paired.status, 200);
  assert.equal((await call(env, '/api/tv/poll', { origin: null, data: {
    tvName: 'Injected Phone Name' }, token: paired.body.token })).status, 401);
  assert.equal((await call(env, '/api/tv/poll', { origin: null, data: {
    tvName: 'Sony BRAVIA 4K VH2' }, token: TV_TOKEN })).status, 200);
  assert.equal((await call(env, '/api/tv/poll', { origin: null, data: {
    tvName: 'Sony BRAVIA 4K VH2' }, token: otherToken })).status, 200);
  assert.equal((await call(env, '/api/status?tvId=' + first.body.tvId)).body.tvName,
    'Sony BRAVIA 4K VH2');
  assert.equal((await call(env, '/api/status?tvId=' + second.body.tvId)).body.tvName,
    'Sony BRAVIA 4K VH2 (2)');
  assert.equal((await call(env, '/api/tv/poll', { origin: null, data: {
    tvName: '<script>alert(1)</script>' }, token: TV_TOKEN })).status, 200);
  assert.equal((await call(env, '/api/status?tvId=' + first.body.tvId)).body.tvName,
    'Sony BRAVIA 4K VH2', 'invalid names must not overwrite a legitimate label');
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token: paired.body.token })).status, 200,
    'model updates cannot revoke an existing paired phone');
  assert.equal((await storage.get('room')).tvs[0].controllers.length, 1);
});

test('a second TV cannot be enrolled from a different public network', async () => {
  const { env } = setup(); await enroll(env);
  assert.equal((await enroll(env, NEXT_PIN, 'cd'.repeat(32), OTHER_IP)).status, 403);
});

test('same public IP, exclusive controller lease and one-way key queue', async () => {
  const { env } = setup(); await enroll(env);
  assert.deepEqual((await call(env, '/api/status')).body,
    { online: true, busy: false, sameNetwork: true });
  assert.equal((await call(env, '/api/connect', { ip: OTHER_IP, data: { pin: PIN } })).status, 403);
  const [first, second] = await Promise.all([
    call(env, '/api/connect', { data: { pin: PIN } }),
    call(env, '/api/connect', { data: { pin: PIN } })
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const session = first.status === 200 ? first.body.token : second.body.token;
  assert.equal(session.length, 64);
  assert.equal((await call(env, '/api/command', { data: { key: 'factory_reset' }, token: session })).status, 400);
  assert.equal((await call(env, '/api/command', { data: { key: 'left' }, token: session })).status, 200);
  const response = await poll(env);
  assert.equal(response.body.commands.length, 1);
  assert.equal(response.body.commands[0].key, 'left');
  assert.equal((await poll(env)).body.commands.length, 0);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token: session, ip: OTHER_IP })).status, 401);
  assert.equal((await call(env, '/api/release', { data: {}, token: session })).status, 200);
  assert.equal((await call(env, '/api/connect', { data: { pin: PIN } })).status, 409);
  assert.equal((await rotate(env)).status, 200);
  assert.equal((await call(env, '/api/connect', { data: { pin: NEXT_PIN } })).status, 200);
});

test('settings is an explicit command; short active bursts do not run forever', async () => {
  const { env } = setup(); await enroll(env);
  const connected = await call(env, '/api/connect', { data: { pin: PIN } });
  const token = connected.body.token;
  assert.equal((await poll(env)).body.fast, false);
  assert.equal((await call(env, '/api/heartbeat', { data: { ready: true }, token })).status, 200);
  assert.equal((await poll(env)).body.fast, true);
  const clock = Date.now;
  Date.now = () => clock() + 13_000;
  try { assert.equal((await poll(env)).body.fast, false); }
  finally { Date.now = clock; }
  assert.equal((await call(env, '/api/command', { data: { key: 'settings' }, token })).status, 200);
  const response = await poll(env);
  assert.equal(response.body.fast, true);
  assert.deepEqual(response.body.commands.map(c => c.key), ['settings']);
  assert.equal((await poll(env)).body.commands.length, 0);
});

test('Sony power toggle is paired-only, scoped and queued exactly once', async () => {
  const { env } = setup(); await enroll(env);
  assert.equal((await call(env, '/api/command', { data: { key: 'power_toggle' } })).status, 401);
  const paired = await call(env, '/api/connect', { data: { pin: PIN } });
  assert.equal(paired.status, 200);
  assert.equal((await call(env, '/api/command', { data: { key: 'power_toggle' },
    token: paired.body.token, ip: OTHER_IP })).status, 401);
  assert.equal((await call(env, '/api/command', { data: { key: 'power_toggle' },
    token: paired.body.token })).status, 200);
  assert.deepEqual((await poll(env)).body.commands.map(c => c.key), ['power_toggle']);
  assert.equal((await poll(env)).body.commands.length, 0);
});

test('TV-only text key, encrypted-only text relay, no plaintext stored or returned', async () => {
  const { env, storage } = setup(); await enroll(env);
  const connected = await call(env, '/api/connect', { data: { pin: PIN } });
  const token = connected.body.token;
  assert.equal((await call(env, '/api/command', { data: { key: 'type_text', text: 'secret' }, token })).status, 400);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token })).body.textPublicKey, undefined);
  const textPublicKey = 'A'.repeat(124);
  assert.equal((await poll(env)).status, 200);
  const updated = await call(env, '/api/tv/poll', { origin: null, token: TV_TOKEN,
    data: { textPublicKey } });
  assert.equal(updated.status, 200);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token })).body.textPublicKey, textPublicKey);
  const payload = { ephemeral: 'B'.repeat(124), iv: 'C'.repeat(16), cipher: 'D'.repeat(44) };
  assert.equal((await call(env, '/api/command', { data: { key: 'type_text', payload, text: 'secret' }, token })).status, 400);
  assert.equal((await call(env, '/api/command', { data: { key: 'type_text', payload }, token })).status, 200);
  const queued = await poll(env);
  assert.deepEqual(queued.body.commands.map(c => c.key), ['type_text']);
  assert.deepEqual(queued.body.commands[0].payload, payload);
  assert.equal(JSON.stringify(await storage.get('room')).includes('secret'), false);
  assert.equal((await poll(env)).body.commands.length, 0);
  assert.equal((await call(env, '/api/command', { data: { key: 'type_text', payload: {
    ephemeral: 'x', iv: 'x', cipher: 'x' } }, token })).status, 400);
});

test('wrong PIN attempts lock out, without blocking TV-signed PIN regeneration', async () => {
  const { env } = setup(); await enroll(env);
  for (let i = 0; i < 5; i++)
    assert.equal((await call(env, '/api/connect', { data: { pin: '0000000000' } })).status, 401);
  assert.equal((await call(env, '/api/connect', { data: { pin: PIN } })).status, 429);
  assert.equal((await rotate(env)).status, 200);
});

test('adding a phone preserves existing controller leases and pending commands', async () => {
  const { env, storage } = setup(); await enroll(env);
  const connected = await call(env, '/api/connect', { data: { pin: PIN } });
  const token = connected.body.token;
  await call(env, '/api/command', { data: { key: 'up' }, token });
  assert.equal((await rotate(env)).status, 200);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token })).status, 200);
  assert.deepEqual((await poll(env)).body.commands.map(c => c.key), ['up']);
  // The previous one-time code was consumed; a fresh TV-issued code is required.
  assert.equal((await call(env, '/api/connect', { data: { pin: PIN } })).status, 401);
  const second = await call(env, '/api/connect', { data: { pin: NEXT_PIN } });
  assert.equal(second.status, 200);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token })).status, 200);
  assert.equal((await storage.get('room')).tvs[0].controllers.length, 2);
  assert.equal(JSON.stringify(await storage.get('room')).includes(NEXT_PIN), false);
});

test('an unused add-phone code expires without revoking existing trusted phones', async () => {
  const { env } = setup(); await enroll(env);
  const identity = await controllerIdentity();
  const first = await call(env, '/api/connect', { data: { pin: PIN, publicKey: identity.publicKey } });
  assert.equal(first.status, 200);
  assert.equal((await rotate(env)).status, 200);
  const clock = Date.now;
  Date.now = () => clock() + 10 * 60_000 + 1;
  try {
    await poll(env); // Refresh TV presence after an idle interval.
    assert.equal((await call(env, '/api/connect', { data: { pin: NEXT_PIN } })).status, 409);
    const id = await identityId(identity);
    const challenge = await call(env, '/api/challenge', { data: { keyId: id } });
    assert.equal(challenge.status, 200);
    assert.equal((await resumeWith(env, identity, challenge.body.challenge)).status, 200);
  } finally { Date.now = clock; }
});

test('four distinct phones control one TV simultaneously with isolated credentials', async () => {
  const { env, storage } = setup(); await enroll(env);
  const identities = [], tokens = [];
  const keys = ['up', 'down', 'left', 'right'];
  for (let i = 0; i < 4; i++) {
    const pin = i === 0 ? PIN : String(7301000000 + i);
    if (i > 0) assert.equal((await rotate(env, pin)).status, 200);
    const identity = await controllerIdentity();
    const paired = await call(env, '/api/connect', { data: { pin, publicKey: identity.publicKey } });
    assert.equal(paired.status, 200);
    identities.push(identity); tokens.push(paired.body.token);
    const tv = await poll(env);
    assert.equal(tv.body.pairedCount, i + 1);
    assert.equal(tv.body.pinPending, false);
  }
  assert.equal((await rotate(env, NEXT_PIN)).status, 409, 'Fifth phone requires removing a slot');
  await Promise.all(tokens.map((token, i) => call(env, '/api/command', {
    data: { key: keys[i] }, token }).then(r => assert.equal(r.status, 200))));
  assert.deepEqual((await poll(env)).body.commands.map(c => c.key).sort(), keys.sort());
  assert.equal((await storage.get('room')).tvs[0].controllers.length, 4);

  // A fresh token for phone A must not interrupt B/C/D.
  const keyId = await identityId(identities[0]);
  const challenge = await call(env, '/api/challenge', { data: { keyId } });
  assert.equal(challenge.status, 200);
  const resumed = await resumeWith(env, identities[0], challenge.body.challenge);
  assert.equal(resumed.status, 200);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token: tokens[0] })).status, 401);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token: tokens[1] })).status, 200);

  // Disconnecting B removes B's authorization and queued keys only.
  assert.equal((await call(env, '/api/command', { data: { key: 'down' }, token: tokens[1] })).status, 200);
  assert.equal((await call(env, '/api/command', { data: { key: 'right' }, token: tokens[3] })).status, 200);
  assert.equal((await call(env, '/api/release', { data: {}, token: tokens[1] })).status, 200);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token: tokens[1] })).status, 401);
  assert.deepEqual((await poll(env)).body.commands.map(c => c.key), ['right']);
  assert.equal((await storage.get('room')).tvs[0].controllers.length, 3);
  assert.equal((await rotate(env, NEXT_PIN)).status, 200, 'Released slot may pair a replacement');
  assert.equal((await poll(env)).body.pinPending, true, 'TV PIN dialog remains open while another phone is active');
  const replacement = await controllerIdentity();
  assert.equal((await call(env, '/api/connect', { data: { pin: NEXT_PIN, publicKey: replacement.publicKey } })).status, 200);
  assert.equal((await poll(env)).body.pinPending, false);
});

test('migrates the previously trusted single phone without losing its signed session', async () => {
  const { env, storage } = setup(); await enroll(env);
  const identity = await controllerIdentity();
  const paired = await call(env, '/api/connect', { data: { pin: PIN, publicKey: identity.publicKey } });
  const stored = await storage.get('room');
  const legacy = structuredClone(stored.tvs[0]);
  const [old] = legacy.controllers;
  Object.assign(legacy, old);
  delete legacy.controllers;
  await storage.put('room', legacy);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token: paired.body.token })).status, 200);
  const challenge = await call(env, '/api/challenge', { data: {} });
  assert.equal(challenge.status, 200);
  assert.equal((await resumeWith(env, identity, challenge.body.challenge)).status, 200);
  assert.equal((await storage.get('room')).tvs[0].controllers.length, 1);
});

test('unconfirmed first-time enrollment expires after 10 minutes to limit squatting', async () => {
  const { env } = setup(); await enroll(env);
  const originalClock = Date.now;
  Date.now = () => originalClock() + 10 * 60_000 + 1;
  try {
    assert.equal((await poll(env)).status, 401);
    assert.equal((await call(env, '/api/status')).body.online, false);
    assert.equal((await enroll(env, NEXT_PIN, 'cd'.repeat(32))).status, 200);
  } finally { Date.now = originalClock; }
});

test('a new TV network invalidates the old controller lease', async () => {
  const { env } = setup(); await enroll(env);
  const connected = await call(env, '/api/connect', { data: { pin: PIN } });
  assert.equal((await poll(env, OTHER_IP)).status, 200);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token: connected.body.token })).status, 401);
  assert.equal((await call(env, '/api/status', { ip: OTHER_IP })).body.sameNetwork, true);
});

test('TV can revoke all sessions and no API routes permit arbitrary commands', async () => {
  const { env } = setup(); await enroll(env);
  const connected = await call(env, '/api/connect', { data: { pin: PIN } });
  assert.equal((await call(env, '/api/tv/disable', { origin: null, data: {}, token: TV_TOKEN })).status, 200);
  assert.equal((await call(env, '/api/command', { token: connected.body.token, data: { key: 'up' } })).status, 401);
  assert.equal((await poll(env)).status, 401);
  assert.equal((await call(env, '/api/anything', { data: {} })).status, 404);
});

test('lease expires without heartbeat; stale controller cannot be revived', async () => {
  const { env } = setup(); await enroll(env);
  const first = await call(env, '/api/connect', { data: { pin: PIN } });
  const originalClock = Date.now;
  Date.now = () => originalClock() + 120_000;
  try {
    assert.equal((await call(env, '/api/command', { token: first.body.token,
      data: { key: 'select' } })).status, 401);
    await poll(env);
    assert.equal((await call(env, '/api/connect', { data: { pin: PIN } })).status, 409);
    await rotate(env);
    const second = await call(env, '/api/connect', { data: { pin: NEXT_PIN } });
    assert.equal(second.status, 200);
    assert.notEqual(second.body.token, first.body.token);
  } finally { Date.now = originalClock; }
});

test('IPv6 /64 household prefix permits differing private interface addresses', async () => {
  const { env } = setup();
  const tvIp = '2001:db8:45:78::a501';
  const phoneIp = '2001:0db8:0045:0078::b110';
  const elsewhere = '2001:db8:45:79::b110';
  assert.equal((await enroll(env, PIN, TV_TOKEN, tvIp)).status, 200);
  assert.equal((await call(env, '/api/status', { ip: phoneIp })).body.sameNetwork, true);
  assert.equal((await call(env, '/api/status', { ip: elsewhere })).body.sameNetwork, false);
  assert.equal((await call(env, '/api/connect', { ip: phoneIp, data: { pin: PIN } })).status, 200);
});

test('trusted controller can return after sleep and reload with no PIN', async () => {
  const { env, storage } = setup(); await enroll(env);
  const identity = await controllerIdentity();
  const first = await call(env, '/api/connect', { data: { pin: PIN, publicKey: identity.publicKey } });
  assert.equal(first.status, 200);
  const saved = await storage.get('room');
  assert.deepEqual(saved.tvs[0].controllers[0].pairedKey, identity.publicKey);
  assert.equal(saved.tvs[0].controllers[0].pairedKeyId.length, 64);
  assert.equal(saved.tvs[0].pinHash, '');
  assert.equal(saved.tvs[0].pinSalt, '');
  assert.equal(JSON.stringify(saved).includes(PIN), false);
  const clock = Date.now;
  Date.now = () => clock() + 120_000;
  try {
    assert.equal((await call(env, '/api/heartbeat', { data: {}, token: first.body.token })).status, 401);
    await poll(env); // TV is still online on the same network.
    const challenge = await call(env, '/api/challenge', { data: {} });
    assert.equal(challenge.status, 200);
    assert.equal(challenge.body.keyId, saved.tvs[0].controllers[0].pairedKeyId);
    const second = await resumeWith(env, identity, challenge.body.challenge);
    assert.equal(second.status, 200);
    assert.notEqual(second.body.token, first.body.token);
    assert.equal((await call(env, '/api/command', { data: { key: 'select' },
      token: second.body.token })).status, 200);
    assert.equal((await call(env, '/api/resume', { data: {
      challenge: challenge.body.challenge, signature: '00'.repeat(64) } })).status, 401);
  } finally { Date.now = clock; }
});

test('reconnection rejects other networks, tampered signatures and expired challenges', async () => {
  const { env } = setup(); await enroll(env);
  const trusted = await controllerIdentity();
  const stranger = await controllerIdentity();
  assert.equal((await call(env, '/api/connect', { data: { pin: PIN,
    publicKey: { ...trusted.publicKey, x: '!' } } })).status, 400);
  assert.equal((await call(env, '/api/connect', { data: { pin: PIN,
    publicKey: trusted.publicKey } })).status, 200);
  assert.equal((await call(env, '/api/challenge', { ip: OTHER_IP, data: {} })).status, 403);
  const first = await call(env, '/api/challenge', { data: {} });
  assert.equal((await resumeWith(env, stranger, first.body.challenge)).status, 401);
  assert.equal((await resumeWith(env, trusted, first.body.challenge)).status, 401);
  const second = await call(env, '/api/challenge', { data: {} });
  const clock = Date.now;
  Date.now = () => clock() + 46_000;
  try {
    await poll(env);
    assert.equal((await resumeWith(env, trusted, second.body.challenge)).status, 401);
  } finally { Date.now = clock; }
});

test('explicit disconnect removes only its phone; network change revokes all', async () => {
  const { env } = setup(); await enroll(env);
  const identity = await controllerIdentity();
  let session = await call(env, '/api/connect', { data: { pin: PIN, publicKey: identity.publicKey } });
  assert.equal((await call(env, '/api/release', { data: {}, token: session.body.token })).status, 200);
  assert.equal((await call(env, '/api/challenge', { data: {} })).status, 409);
  assert.equal((await rotate(env)).status, 200);
  session = await call(env, '/api/connect', { data: { pin: NEXT_PIN, publicKey: identity.publicKey } });
  assert.equal(session.status, 200);
  assert.equal((await rotate(env, PIN)).status, 200);
  assert.equal((await call(env, '/api/heartbeat', { token: session.body.token, data: {} })).status, 200);
  const other = await controllerIdentity();
  assert.equal((await call(env, '/api/connect', { data: { pin: PIN, publicKey: other.publicKey } })).status, 200);
  await poll(env, OTHER_IP);
  assert.equal((await call(env, '/api/challenge', { ip: OTHER_IP, data: {} })).status, 409);
});
