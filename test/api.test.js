'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}
function close(server) { return new Promise(resolve => server.close(resolve)); }
function cookieFrom(response) { return String(response.headers.get('set-cookie') || '').split(';')[0]; }
async function request(base, route, { method = 'GET', body, cookie, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, data, cookie: cookieFrom(response) || cookie };
}

test('launch API isolates sessions, rotates recovery, and verifies Robinhood receipts', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kult-world-api-'));
  const registry = `0x${'a'.repeat(40)}`;
  const walletAddress = `0x${'1'.repeat(40)}`;
  const txHash = `0x${'2'.repeat(64)}`;
  let transactionInput = `0x${'0'.repeat(258)}`;

  const rpcServer = http.createServer((req, res) => {
    let source = '';
    req.on('data', chunk => { source += chunk; });
    req.on('end', () => {
      const payload = JSON.parse(source);
      const results = {
        eth_chainId: '0xb626',
        eth_getTransactionByHash: { hash: txHash, from: walletAddress, to: registry, input: transactionInput },
        eth_getTransactionReceipt: { transactionHash: txHash, status: '0x1', blockNumber: '0x10' },
        eth_blockNumber: '0x12',
      };
      const body = JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: results[payload.method] });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
  });
  await listen(rpcServer);

  process.env.KULT_DATA_FILE = path.join(tempDir, 'world.json');
  process.env.KULT_SECURE_COOKIE = 'false';
  process.env.KULT_PROOF_RAIL_ENABLED = 'true';
  process.env.KULT_REGISTRY_ADDRESS = registry;
  process.env.KULT_MARKET_ADAPTER = 'sim';
  process.env.KULT_MARKET_ACCESS = 'enabled';
  process.env.KULT_ADMIN_TOKEN = 'test-admin-token-abcdefghijklmnopqrstuvwxyz';
  process.env.ROBINHOOD_RPC_URL = `http://127.0.0.1:${rpcServer.address().port}`;
  const { server, store, ownerIdForToken } = require('../server');
  await listen(server);
  t.after(async () => { await close(server); await close(rpcServer); fs.rmSync(tempDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await request(base, '/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.data.ok, true);
  assert.match(health.data.seasonManifestHash, /^0x[a-f0-9]{64}$/);
  assert.equal(store.listOwners().length, 0, 'health checks must not allocate owners');

  const ready = await request(base, '/api/ready');
  assert.equal(ready.response.status, 200);
  assert.equal(ready.data.ready, true);
  assert.equal(ready.data.persistence.ok, true);
  assert.equal(ready.data.releaseScope, 'public-beta-demo');

  const config = await request(base, '/api/config');
  assert.equal(config.response.status, 200);
  assert.equal(config.data.pulse.mode, 'server_simulation');
  assert.equal(config.data.a2a.mode, 'simulated_settlement');
  assert.ok(config.data.a2a.services.length >= 3);

  const season = await request(base, '/api/season');
  assert.equal(season.response.status, 200);
  assert.equal(season.data.season.title, 'The World Is Waking');
  const town = await request(base, '/api/town-square');
  assert.equal(town.response.status, 200);
  assert.ok(Array.isArray(town.data.latestMoments));
  const seasonPage = await request(base, '/season/01');
  assert.equal(seasonPage.response.status, 200);
  assert.match(seasonPage.data, /IMMUTABLE RULES HASH/);
  const seasonOg = await fetch(`${base}/og/season.png`);
  assert.equal(seasonOg.status, 200);
  assert.equal(seasonOg.headers.get('content-type'), 'image/png');
  assert.ok((await seasonOg.arrayBuffer()).byteLength > 10_000);

  let session = await request(base, '/api/state');
  assert.equal(session.data.adopted, false);
  assert.match(session.cookie, /^kw_session=/);
  assert.equal(store.listOwners().length, 0, 'anonymous state reads stay ephemeral');
  const rawToken = session.cookie.slice('kw_session='.length);

  session = await request(base, '/api/adopt', { method: 'POST', cookie: session.cookie, body: { persona: 'NORI', name: 'Nori', mandate: 'explore' } });
  assert.equal(session.response.status, 200);
  assert.equal(session.data.agent.name, 'Nori');
  assert.match(session.data.agent.census.number, /^GEN-01-\d{4}$/);
  const censusNumber = session.data.agent.census.number;
  const recoveryCode = session.data.recoveryCode;
  const oldCookie = session.cookie;
  const storedOwnerId = store.listOwners()[0][0];
  assert.equal(storedOwnerId, ownerIdForToken(rawToken));
  assert.ok(!JSON.stringify(store.getWorld()).includes(rawToken), 'session bearer must never leak into shared world state');

  const runtimeInitial = await request(base, '/api/world/runtime', { cookie: oldCookie });
  assert.equal(runtimeInitial.response.status, 200);
  assert.equal(runtimeInitial.data.runtime.agent.id, session.data.agent.id);
  assert.equal(runtimeInitial.data.runtime.districts.pulse.mode, 'server_simulation');

  const pulsePrepared = await request(base, '/api/pulse/prepare', { method:'POST', cookie:oldCookie, body:{symbol:'BTC',horizon:5} });
  assert.equal(pulsePrepared.response.status, 200);
  assert.equal(pulsePrepared.data.round.status, 'prepared');
  const pulseCommitted = await request(base, '/api/pulse/commit', { method:'POST', cookie:oldCookie, body:{roundId:pulsePrepared.data.round.id,choice:'wait'} });
  assert.equal(pulseCommitted.response.status, 200);
  assert.equal(pulseCommitted.data.round.status, 'running');
  const pulseOwner=store.getOwner(storedOwnerId); pulseOwner.pulse.active.endsAt=Date.now()-1; store.setOwner(storedOwnerId,pulseOwner);
  const pulseResolved = await request(base, '/api/pulse/resolve', { method:'POST', cookie:oldCookie, body:{roundId:pulsePrepared.data.round.id} });
  assert.equal(pulseResolved.response.status, 200);
  assert.equal(pulseResolved.data.round.status, 'resolved');
  assert.equal(pulseResolved.data.round.result.execution, 'simulation_only');

  const a2aBefore = await request(base, '/api/a2a/state', { cookie:oldCookie });
  assert.equal(a2aBefore.response.status, 200);
  const a2aHire = await request(base, '/api/a2a/hire', { method:'POST', cookie:oldCookie, body:{serviceId:'risk'} });
  assert.equal(a2aHire.response.status, 200);
  assert.equal(a2aHire.data.receipt.settlement, 'simulated');
  assert.equal(a2aHire.data.a2a.demoBalanceUsd, .96);

  const marketHealth = await request(base, '/api/market/health', { cookie: oldCookie });
  assert.equal(marketHealth.response.status, 200);
  assert.equal(marketHealth.data.adapter, 'sim');
  assert.equal(marketHealth.data.demoOnly, true);
  const marketSnapshot = await request(base, '/api/market/snapshot?symbol=BTC', { cookie: oldCookie });
  assert.equal(marketSnapshot.response.status, 200);
  assert.equal(marketSnapshot.data.snapshot.source, 'LOCAL_SIM');
  const marketPrepared = await request(base, '/api/market/battle/prepare', { method: 'POST', cookie: oldCookie, body: { symbol: 'BTC', leverage: 99, notionalUsd: 99999 } });
  assert.equal(marketPrepared.response.status, 200);
  assert.equal(marketPrepared.data.battle.status, 'prepared');
  assert.equal(marketPrepared.data.battle.notionalUsd, 500);
  assert.equal(marketPrepared.data.battle.leverage, 3, 'browser-picked leverage must be ignored');
  assert.equal(marketPrepared.data.battle.agentId, session.data.agent.id);
  const marketExecuted = await request(base, '/api/market/battle/execute', { method: 'POST', cookie: oldCookie, body: { battleId: marketPrepared.data.battle.id } });
  assert.equal(marketExecuted.response.status, 200);
  assert.equal(marketExecuted.data.battle.status, 'active');
  const resolveEarly = await request(base, '/api/market/battle/resolve', { method: 'POST', cookie: oldCookie, body: { battleId: marketPrepared.data.battle.id } });
  assert.equal(resolveEarly.response.status, 409);
  assert.equal(resolveEarly.data.code, 'position_still_open');
  const marketClosed = await request(base, '/api/market/battle/close', { method: 'POST', cookie: oldCookie, body: { battleId: marketPrepared.data.battle.id } });
  assert.equal(marketClosed.response.status, 200);
  assert.equal(marketClosed.data.battle.status, 'closed');
  const marketResolved = await request(base, '/api/market/battle/resolve', { method: 'POST', cookie: oldCookie, body: { battleId: marketPrepared.data.battle.id } });
  assert.equal(marketResolved.response.status, 200);
  assert.equal(marketResolved.data.battle.status, 'resolved');
  assert.equal(marketResolved.data.agentMemoryAdded, true);
  assert.equal(marketResolved.data.battle.result.passportCapabilityChanged, false);
  assert.equal(marketResolved.data.agentState.census.number, censusNumber);
  const marketState = await request(base, '/api/market/state', { cookie: oldCookie });
  assert.equal(marketState.data.arena.battles.length, 1);
  assert.equal(marketState.data.arena.active, null);
  assert.equal(marketState.data.agentState.id, session.data.agent.id);
  assert.equal(marketState.data.agentState.census.number, censusNumber);

  const paused = await fetch(base + '/api/admin/market-access', { method:'POST', headers:{ 'content-type':'application/json', authorization:'Bearer test-admin-token-abcdefghijklmnopqrstuvwxyz' }, body:JSON.stringify({status:'paused'}) });
  assert.equal(paused.status, 200);
  const blockedPrepare = await request(base, '/api/market/battle/prepare', { method:'POST', cookie:oldCookie, body:{symbol:'BTC'} });
  assert.equal(blockedPrepare.response.status, 403);
  assert.equal(blockedPrepare.data.code, 'market_paused');
  const enabled = await fetch(base + '/api/admin/market-access', { method:'POST', headers:{ 'content-type':'application/json', authorization:'Bearer test-admin-token-abcdefghijklmnopqrstuvwxyz' }, body:JSON.stringify({status:'enabled'}) });
  assert.equal(enabled.status, 200);

  const evilOrigin = await request(base, '/api/focus', { method: 'POST', cookie: oldCookie, origin: 'https://evil.example', body: { cap: 'analysis' } });
  assert.equal(evilOrigin.response.status, 403);

  const mission = await request(base, '/api/mission', { method: 'POST', cookie: oldCookie, body: { mission: 'game_qa', choice: 'loop' } });
  assert.equal(mission.response.status, 200);
  assert.match(mission.data.proof.evidenceHash, /^0x[a-f0-9]{64}$/);
  const proofId = mission.data.proof.id;

  const wallet = await request(base, '/api/wallet', { method: 'POST', cookie: oldCookie, body: { address: walletAddress } });
  assert.equal(wallet.data.agentState.walletVerified, false, 'claiming a wallet is not verification');
  const calldata = await request(base, '/api/proof/calldata', { method: 'POST', cookie: oldCookie, body: { proofId } });
  assert.equal(calldata.response.status, 200);
  assert.equal(calldata.data.to, registry);
  assert.equal((calldata.data.data.length - 2) / 2, 129);

  const rejected = await request(base, '/api/proof/anchored', { method: 'POST', cookie: oldCookie, body: { proofId, txHash } });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.data.code, 'wrong_evidence', 'an arbitrary successful transaction cannot claim a receipt');

  transactionInput = calldata.data.data;
  const anchored = await request(base, '/api/proof/anchored', { method: 'POST', cookie: oldCookie, body: { proofId, txHash } });
  assert.equal(anchored.response.status, 200);
  assert.equal(anchored.data.agentState.walletVerified, true);
  assert.equal(anchored.data.agentState.proofs[0].confirmations, 3);

  const publish = await request(base, '/api/passport/publish', { method: 'POST', cookie: oldCookie, body: { public: true } });
  assert.equal(publish.data.public, true);

  const okxAiManifest = await request(base, '/api/okx-ai/manifest');
  assert.equal(okxAiManifest.response.status, 200);
  assert.equal(okxAiManifest.data.serviceType, 'A2MCP');
  const publicMarketProfile = await request(base, `/api/okx-ai/agent-profile?agentId=${encodeURIComponent(session.data.agent.id)}`);
  assert.equal(publicMarketProfile.response.status, 200);
  assert.equal(publicMarketProfile.data.access, 'public-agent');
  assert.equal(publicMarketProfile.data.arena, undefined, 'external OKX.AI profile must not expose private arena state');
  const publicMarketRead = await request(base, '/api/okx-ai/market-read', { method:'POST', body:{ agentId:session.data.agent.id, symbol:'BTC' } });
  assert.equal(publicMarketRead.response.status, 200);
  assert.equal(publicMarketRead.data.service, 'kult.market.read');
  assert.ok(['long','short','wait'].includes(publicMarketRead.data.decision.action));
  const publicRaidEvaluation = await request(base, '/api/okx-ai/raid-evaluate', { method:'POST', body:{ agentId:session.data.agent.id, battleId:marketPrepared.data.battle.id } });
  assert.equal(publicRaidEvaluation.response.status, 200);
  assert.equal(publicRaidEvaluation.data.battleId, marketPrepared.data.battle.id);
  const publicPassport = await request(base, `/api/passport/${encodeURIComponent(session.data.agent.id)}`);
  assert.equal(publicPassport.response.status, 200);
  assert.equal(publicPassport.data.passport.anchoredProofs.length, 1);
  assert.equal(publicPassport.data.passport.verification.anchored, 1);
  assert.equal(publicPassport.data.passport.evolution.id, 'emerging');
  assert.equal(publicPassport.data.passport.walletAddress, undefined, 'public Passport is explicitly whitelisted');
  const passportPage = await request(base, `/passport/${encodeURIComponent(session.data.agent.id)}`);
  assert.equal(passportPage.response.status, 200);
  assert.match(passportPage.data, /Nori&#39;s Agent Passport/);
  assert.match(passportPage.data, /\/og\/passport\//);
  const verificationApi = await request(base, `/api/verify/${encodeURIComponent(session.data.agent.id)}`);
  assert.equal(verificationApi.response.status, 200);
  assert.equal(verificationApi.data.verification.proofs[0].status, 'ANCHORED');
  const verificationPage = await request(base, `/verify/${encodeURIComponent(session.data.agent.id)}`);
  assert.equal(verificationPage.response.status, 200);
  assert.match(verificationPage.data, /PUBLIC PROVENANCE/);

  const ownerCount = store.listOwners().length;
  const recovered = await request(base, '/api/recover', { method: 'POST', body: { code: recoveryCode } });
  assert.equal(recovered.response.status, 200);
  assert.match(recovered.cookie, /^kw_session=/);
  assert.notEqual(recovered.cookie, oldCookie, 'recovery must rotate the bearer session');
  assert.equal(store.listOwners().length, ownerCount);

  const oldState = await request(base, '/api/state', { cookie: oldCookie });
  assert.equal(oldState.data.adopted, false, 'old session is revoked after recovery');
  const recoveredState = await request(base, '/api/state', { cookie: recovered.cookie });
  assert.equal(recoveredState.data.agent.id, session.data.agent.id);

  const publicState = await request(base, '/api/state');
  assert.deepEqual(Object.keys(publicState.data.world).sort(), ['activeChallenges', 'contributors', 'creatorCount', 'observatory', 'updatedAt'].sort());
});
