import test from 'node:test';
import assert from 'node:assert/strict';
import relay, { RemoteRoom } from '../src/index.js';

const TV_IP = '203.0.113.8';
const OTHER_IP = '198.51.100.27';
const SITE = 'https://vudh1.github.io';
const PIN = '84720591';
const TV_TOKEN = 'ab'.repeat(32);
class Storage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
}
function setup() {
  const env = { REMOTE_PIN: PIN };
  const room = new RemoteRoom({ storage: new Storage() }, env);
  env.REMOTE_ROOM = { idFromName: name => name, get: () => room };
  return env;
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
  return { status: res.status, body: await res.json(), headers: res.headers };
}
async function enroll(env) {
  const answer = await call(env, '/api/tv/enroll', { origin: null, data: { pin: PIN, tvToken: TV_TOKEN } });
  assert.equal(answer.status, 200);
}
test('fails closed when PIN is missing; rejects foreign origins', async () => {
  const env = setup(); delete env.REMOTE_PIN;
  assert.equal((await call(env, '/api/status')).status, 503);
  env.REMOTE_PIN = PIN;
  assert.equal((await call(env, '/api/status', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(env, '/api/tv/enroll', { data: { pin: PIN, tvToken: TV_TOKEN } })).status, 403);
});
test('enrollment, same public IP, single lease and one-way queue', async () => {
  const env = setup(); await enroll(env);
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
  assert.equal((await call(env, '/api/command', { data: { key: 'power_off' }, token: session })).status, 400);
  assert.equal((await call(env, '/api/command', { data: { key: 'left' }, token: session })).status, 200);
  const poll = await call(env, '/api/tv/poll', { origin: null, data: {}, token: TV_TOKEN });
  assert.equal(poll.body.commands.length, 1);
  assert.equal(poll.body.commands[0].key, 'left');
  assert.equal((await call(env, '/api/tv/poll', { origin: null, data: {}, token: TV_TOKEN })).body.commands.length, 0);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token: session, ip: OTHER_IP })).status, 401);
  assert.equal((await call(env, '/api/release', { data: {}, token: session })).status, 200);
  assert.equal((await call(env, '/api/connect', { data: { pin: PIN } })).status, 200);
});
test('PIN failures lock out and another TV cannot hijack an enrollment', async () => {
  const env = setup(); await enroll(env);
  const mismatch = await call(env, '/api/tv/enroll', { origin: null,
    data: { pin: PIN, tvToken: 'cd'.repeat(32) } });
  assert.equal(mismatch.status, 409);
  for (let i = 0; i < 5; i++)
    assert.equal((await call(env, '/api/connect', { data: { pin: '00000000' } })).status, 401);
  assert.equal((await call(env, '/api/connect', { data: { pin: PIN } })).status, 429);
});
test('a new TV network invalidates the old controller lease', async () => {
  const env = setup(); await enroll(env);
  const { body } = await call(env, '/api/connect', { data: { pin: PIN } });
  assert.equal((await call(env, '/api/tv/poll', { origin: null, ip: OTHER_IP,
    data: {}, token: TV_TOKEN })).status, 200);
  assert.equal((await call(env, '/api/heartbeat', { data: {}, token: body.token })).status, 401);
  assert.equal((await call(env, '/api/status', { ip: OTHER_IP })).body.sameNetwork, true);
});
test('TV can revoke all sessions; exposed routes are narrowly allowlisted', async () => {
  const env = setup(); await enroll(env);
  const { body } = await call(env, '/api/connect', { data: { pin: PIN } });
  assert.equal((await call(env, '/api/tv/disable', { origin: null, data: {}, token: TV_TOKEN })).status, 200);
  assert.equal((await call(env, '/api/command', { token: body.token, data: { key: 'up' } })).status, 401);
  assert.equal((await call(env, '/api/tv/poll', { origin: null, data: {}, token: TV_TOKEN })).status, 401);
  assert.equal((await call(env, '/api/anything', { data: {} })).status, 404);
});
test('lease expires without heartbeat; stale controller cannot be revived', async () => {
  const env = setup(); await enroll(env);
  const first = await call(env, '/api/connect', { data: { pin: PIN } });
  const originalClock = Date.now;
  Date.now = () => originalClock() + 30_000;
  try {
    assert.equal((await call(env, '/api/command', { token: first.body.token,
      data: { key: 'select' } })).status, 401);
    // The TV must establish an online heartbeat again after time advances.
    await call(env, '/api/tv/poll', { origin: null, data: {}, token: TV_TOKEN });
    const second = await call(env, '/api/connect', { data: { pin: PIN } });
    assert.equal(second.status, 200);
    assert.notEqual(second.body.token, first.body.token);
  } finally { Date.now = originalClock; }
});
test('IPv6 /64 household prefix works with private interface addresses', async () => {
  const env = setup();
  const tvIp = '2001:db8:45:78::a501';
  const phoneIp = '2001:0db8:0045:0078::b110';
  const elsewhere = '2001:db8:45:79::b110';
  assert.equal((await call(env, '/api/tv/enroll', { origin: null, ip: tvIp,
    data: { pin: PIN, tvToken: TV_TOKEN } })).status, 200);
  assert.equal((await call(env, '/api/status', { ip: phoneIp })).body.sameNetwork, true);
  assert.equal((await call(env, '/api/status', { ip: elsewhere })).body.sameNetwork, false);
  assert.equal((await call(env, '/api/connect', { ip: phoneIp, data: { pin: PIN } })).status, 200);
});
