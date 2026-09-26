'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const port = 18060 + (process.pid % 500);
const base = `http://127.0.0.1:${port}`;
const publicOrigin = `https://127.0.0.1:${port}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kult-v63-'));
const db = path.join(tmp, 'kult.sqlite');
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(port),
  PUBLIC_ORIGIN: publicOrigin,
  TRUST_PROXY: 'false',
  KULT_PERSISTENCE: 'sqlite',
  KULT_DATA_DB: db,
  KULT_MARKET_ADAPTER: 'sim',
  KULT_MARKET_ACCESS: 'enabled',
  KULT_PULSE_REFERENCE_ADAPTER: 'sim',
  KULT_PULSE_ACCELERATED: 'false',
  KULT_WAIT_ACCELERATED: 'false',
  KULT_REQUEST_LOGS: 'false',
  KULT_ADMIN_TOKEN: 'kult-production-smoke-admin-token-0123456789',
  KULT_A2A_MODE: 'disabled', KULT_PROOF_RAIL_ENABLED: 'false',
  KULT_XLAYER_NETWORK: 'testnet',
};

let child = null;
let cookie = '';

function start() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    const timer = setTimeout(() => { if (!settled) reject(new Error('server startup timeout')); }, 8000);
    const check = async () => {
      try {
        const r = await fetch(`${base}/api/health`);
        if (r.ok) {
          settled = true; clearTimeout(timer); resolve();
          return;
        }
      } catch (_) {}
      if (!settled) setTimeout(check, 100);
    };
    child.once('exit', code => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`server exited during startup (${code})`)); } });
    check();
  });
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  const proc = child;
  await new Promise(resolve => {
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} resolve(); }, 5000);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    proc.kill('SIGTERM');
  });
  child = null;
}

async function request(method, pathname, body, expected = 200) {
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (!['GET', 'HEAD'].includes(method)) {
    headers.Origin = publicOrigin;
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { throw new Error(`${method} ${pathname} returned non-JSON: ${text.slice(0,160)}`); }
  if (response.status !== expected) throw new Error(`${method} ${pathname}: expected ${expected}, got ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  try {
    await start();
    const ready = await request('GET', '/api/ready');
    if (!ready.ready || ready.persistence?.ok === false) throw new Error('readiness failed');

    const adopted = await request('POST', '/api/adopt', { name: 'Aegis', persona: 'AEGIS', mandate: 'learn' });
    if (!adopted.agent?.id) throw new Error('adoption failed');

    await request('GET', '/api/world/runtime');
    const pulse = await request('POST', '/api/pulse/prepare', { symbol: 'BTC', horizon: 5 });
    await request('POST', '/api/pulse/commit', { roundId: pulse.round.id, choice: 'follow' });
    const a2aBefore = await request('GET', '/api/a2a/state');
    if (a2aBefore.a2a?.mode !== 'disabled') throw new Error('A2A disable boundary failed');

    const prepared = await request('POST', '/api/market/battle/prepare', { symbol: 'BTC' });
    const battle = prepared.battle;
    if (!battle?.id) throw new Error('market prepare failed');
    if (battle.nori?.action === 'wait') {
      const observing = await request('POST', '/api/market/battle/abstain', { battleId: battle.id });
      if (observing.battle?.status !== 'observing') throw new Error('WAIT observation failed');
    } else {
      const executed = await request('POST', '/api/market/battle/execute', { battleId: battle.id });
      if (executed.battle?.status !== 'active') throw new Error('market execute failed');
      const closed = await request('POST', '/api/market/battle/close', { battleId: battle.id });
      if (closed.battle?.status !== 'closed') throw new Error('market close failed');
      const resolved = await request('POST', '/api/market/battle/resolve', { battleId: battle.id });
      if (resolved.battle?.status !== 'resolved') throw new Error('market resolve failed');
    }

    const beforeRestart = await request('GET', '/api/state');
    if (!beforeRestart.adopted) throw new Error('state missing before restart');
    await stop();

    await start();
    const afterRestart = await request('GET', '/api/state');
    if (!afterRestart.adopted || afterRestart.agent?.id !== adopted.agent.id) throw new Error('owner state did not survive restart');
    const a2a = await request('GET', '/api/a2a/state');
    if (a2a.a2a?.mode !== 'disabled') throw new Error('A2A state changed across restart');
    const ready2 = await request('GET', '/api/ready');
    if (!ready2.ready) throw new Error('server not ready after restart');

    console.log(JSON.stringify({
      ok: true,
      version: require('../package.json').version,
      persistence: ready2.persistence,
      agentId: adopted.agent.id,
      pulseStatus: 'running-persisted',
      a2aMode: a2a.a2a.mode,
      marketStatus: battle.nori?.action === 'wait' ? 'observing-persisted' : 'resolved',
      restartPersistence: true,
      releaseScope: ready2.releaseScope,
    }, null, 2));
  } finally {
    await stop().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
