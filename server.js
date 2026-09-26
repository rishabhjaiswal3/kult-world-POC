'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./engine');
const G = require('./growth');
const Chain = require('./chain');
const Season = require('./season');
const OG = require('./og');
const { JsonStore } = require('./store');
const { SQLiteStore } = require('./sqlite-store');
const Intelligence = require('./intelligence');
const Identity = require('./identity');
const MarketArena = require('./market-arena');
const { createOkxAdapter, OkxAgentKitError } = require('./okx-agent-kit');
const XLayerMarket = require('./xlayer-market');
const PerpsGame = require('./perps-game');
const OkxAI = require('./okx-ai');
const Pulse = require('./pulse-engine');
const A2ASim = require('./a2a-marketplace');
const A2ABridge = require('./a2a-goat-bridge');
const WorldRuntime = require('./world-runtime');
const { version: VERSION } = require('./package.json');

const PORT = Number(process.env.PORT || 8060);
const PRODUCTION = process.env.NODE_ENV === 'production';
const DATA_FILE = process.env.KULT_DATA_FILE || path.join(__dirname, 'data', 'kult-world.json');
const DATA_DB = process.env.KULT_DATA_DB || (PRODUCTION ? '/var/data/kult-world.sqlite' : path.join(__dirname, 'data', 'kult-world.sqlite'));
const PERSISTENCE_MODE = String(process.env.KULT_PERSISTENCE || (PRODUCTION ? 'sqlite' : 'json')).toLowerCase();
const STEP_MINUTES = Number(process.env.KULT_STEP_MINUTES || 60);
const MAX_CATCHUP = Math.min(24, Number(process.env.KULT_MAX_CATCHUP_STEPS || 12));
const STATIC = path.join(__dirname, 'static');
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || `http://localhost:${PORT}`).replace(/\/$/, '');
const SERVER_RPC_URL = process.env.ROBINHOOD_RPC_URL || 'https://rpc.testnet.chain.robinhood.com/rpc';
const BROWSER_RPC_URL = process.env.ROBINHOOD_BROWSER_RPC_URL || 'https://rpc.testnet.chain.robinhood.com/rpc';
const registryCandidate = String(process.env.KULT_REGISTRY_ADDRESS || '');
const REGISTRY_ADDRESS = /^0x[a-fA-F0-9]{40}$/.test(registryCandidate) && !/^0x0{40}$/i.test(registryCandidate) ? registryCandidate.toLowerCase() : null;
const ADMIN_TOKEN = String(process.env.KULT_ADMIN_TOKEN || '');
const SECURE_COOKIE = PRODUCTION || String(process.env.KULT_SECURE_COOKIE || '').toLowerCase() === 'true';
const COOKIE_NAME = SECURE_COOKIE ? '__Host-kw_session' : 'kw_session';
const TRUST_PROXY = String(process.env.TRUST_PROXY || '').toLowerCase() === 'true';
const requestedConfirmations = Number(process.env.KULT_MIN_CONFIRMATIONS || 1);
const MIN_CONFIRMATIONS = Number.isInteger(requestedConfirmations) && requestedConfirmations > 0 ? requestedConfirmations : 1;
const SEASON_PHASE = Season.PHASES.has(process.env.KULT_SEASON_PHASE) ? process.env.KULT_SEASON_PHASE : 'WORLD_OPEN';
const SEASON_COMMIT_TX = /^0x[a-fA-F0-9]{64}$/.test(String(process.env.KULT_SEASON_COMMIT_TX || '')) ? String(process.env.KULT_SEASON_COMMIT_TX).toLowerCase() : null;
const PROOF_RAIL_ENABLED = String(process.env.KULT_PROOF_RAIL_ENABLED || '').toLowerCase() === 'true';
const MARKET_ADAPTER_MODE = String(process.env.KULT_MARKET_ADAPTER || 'sim').toLowerCase();
const PULSE_REFERENCE_MODE = String(process.env.KULT_PULSE_REFERENCE_ADAPTER || 'sim').toLowerCase();
const PULSE_ACCELERATED = String(process.env.KULT_PULSE_ACCELERATED || '').toLowerCase() === 'true';
const WAIT_ACCELERATED = String(process.env.KULT_WAIT_ACCELERATED || '').toLowerCase() === 'true';
const ALLOW_TEST_ACCELERATION = String(process.env.KULT_ALLOW_TEST_ACCELERATION || '').toLowerCase() === 'true';
const REQUEST_LOGS = PRODUCTION || String(process.env.KULT_REQUEST_LOGS || '').toLowerCase() === 'true';
const REQUEST_TIMEOUT_MS = Math.max(10_000, Math.min(120_000, Number(process.env.KULT_REQUEST_TIMEOUT_MS || 30_000)));
const STARTED_AT = Date.now();
let draining = false;
let inflightRequests = 0;

if (PRODUCTION) {
  const missing = [];
  let validOrigin = false;
  try { const parsedOrigin = new URL(PUBLIC_ORIGIN); validOrigin = parsedOrigin.protocol === 'https:' && parsedOrigin.origin === PUBLIC_ORIGIN; } catch (_) {}
  if (!validOrigin) missing.push('PUBLIC_ORIGIN (exact https origin)');
  if (PROOF_RAIL_ENABLED && !process.env.ROBINHOOD_RPC_URL) missing.push('ROBINHOOD_RPC_URL (required when KULT_PROOF_RAIL_ENABLED=true)');
  if (PROOF_RAIL_ENABLED && !REGISTRY_ADDRESS) missing.push('KULT_REGISTRY_ADDRESS (required when KULT_PROOF_RAIL_ENABLED=true)');
  if (PROOF_RAIL_ENABLED && !SEASON_COMMIT_TX) missing.push('KULT_SEASON_COMMIT_TX (required when KULT_PROOF_RAIL_ENABLED=true)');
  if (ADMIN_TOKEN.length < 32) missing.push('KULT_ADMIN_TOKEN (32+ chars)');
  if (PERSISTENCE_MODE === 'json' && String(process.env.KULT_ALLOW_JSON_PRODUCTION || '').toLowerCase() !== 'true') missing.push('KULT_PERSISTENCE=sqlite (JSON is controlled-beta only)');
  if (!['json','sqlite'].includes(PERSISTENCE_MODE)) missing.push('KULT_PERSISTENCE (json or sqlite)');
  if (!['sim','agent-kit'].includes(MARKET_ADAPTER_MODE)) missing.push('KULT_MARKET_ADAPTER (sim or agent-kit)');
  if (PULSE_REFERENCE_MODE !== 'sim') missing.push('KULT_PULSE_REFERENCE_ADAPTER=sim (v6.5 Pulse is simulation-only until a reviewed BNB adapter ships)');
  if ((PULSE_ACCELERATED || WAIT_ACCELERATED) && !ALLOW_TEST_ACCELERATION) missing.push('disable accelerated Pulse/WAIT timing in production (or set KULT_ALLOW_TEST_ACCELERATION=true for an isolated test deployment)');
  missing.push(...A2ABridge.validateProduction());
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(', ')}`);
}

const ROBINHOOD = {
  name: 'Robinhood Chain Testnet', chainId: Chain.CHAIN_ID, chainIdHex: Chain.CHAIN_ID_HEX,
  rpcUrl: BROWSER_RPC_URL, explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
  faucetUrl: 'https://faucet.testnet.chain.robinhood.com',
  currency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, registryAddress: REGISTRY_ADDRESS, proofRailEnabled:PROOF_RAIL_ENABLED,
};
function seasonView() { return Season.publicSeason({ phase: SEASON_PHASE, commitTx: SEASON_COMMIT_TX, explorerUrl: ROBINHOOD.explorerUrl }); }
const store = PERSISTENCE_MODE === 'sqlite' ? new SQLiteStore(DATA_DB) : new JsonStore(DATA_FILE);
const marketAdapter = createOkxAdapter({ mode:MARKET_ADAPTER_MODE });
const pulseReferenceAdapter = createOkxAdapter({ mode:PULSE_REFERENCE_MODE });
const rawMarketAccess = String(process.env.KULT_MARKET_ACCESS || (PRODUCTION ? 'disabled' : 'enabled')).toLowerCase();
const MARKET_ACCESS = ['enabled','paused','disabled'].includes(rawMarketAccess) ? rawMarketAccess : (PRODUCTION ? 'disabled' : 'enabled');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    try { out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch (_) {}
  }
  return out;
}
function newSessionToken() { return crypto.randomBytes(32).toString('base64url'); }
function validSessionToken(token) { return /^[A-Za-z0-9_-]{43}$/.test(String(token || '')); }
function ownerIdForToken(token) { return `ow_${crypto.createHash('sha256').update(token).digest('hex')}`; }
function setSessionCookie(res, token) { res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${SECURE_COOKIE ? '; Secure' : ''}`); }
function blankOwner() { const now = Date.now(); return { createdAt: now, updatedAt: now, lastSeenAt: now, agent: null, recoveryHash: null, analytics: {} }; }
function resolveSession(req, res, pathname = '/') {
  const gateway = Identity.verifyGateway(req, pathname);
  if (gateway) {
    return { id: gateway.ownerId, token: null, identityMode: gateway.mode, owner: store.getOwner(gateway.ownerId) || blankOwner() };
  }
  const tokenFromCookie = parseCookies(req)[COOKIE_NAME];
  const token = validSessionToken(tokenFromCookie) ? tokenFromCookie : newSessionToken();
  if (token !== tokenFromCookie) setSessionCookie(res, token);
  const id = ownerIdForToken(token);
  return { id, token, identityMode: 'session', owner: store.getOwner(id) || blankOwner() };
}

function cleanName(value) { return String(value || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 16) || 'NORI'; }
function codeHash(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }
function newRecoveryCode() { return crypto.randomBytes(18).toString('base64url'); }
function safeEqual(a, b) { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy':'same-origin',
    'X-DNS-Prefetch-Control':'off', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://cdn.jsdelivr.net https://unpkg.com; connect-src 'self' https://cdn.jsdelivr.net https://unpkg.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    ...(PRODUCTION ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}
function json(res, status, data, extra = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...securityHeaders(), ...extra });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let source = ''; let bytes = 0; let settled = false;
    const fail = error => { if (settled) return; settled = true; reject(error); };
    req.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 32_768) { fail(new Error('body too large')); req.destroy(); return; }
      source += chunk;
    });
    req.on('end', () => { if (settled) return; settled = true; if (!source) return resolve({}); try { resolve(JSON.parse(source)); } catch (_) { reject(new Error('invalid json')); } });
    req.on('error', fail);
  });
}
function requestHasBody(req) { const length=Number(req.headers['content-length']||0); return length>0 || Boolean(req.headers['transfer-encoding']); }
function isJsonRequest(req) { return String(req.headers['content-type']||'').toLowerCase().split(';')[0].trim() === 'application/json'; }
function mime(file) { return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' })[path.extname(file).toLowerCase()] || 'application/octet-stream'; }

const rateBuckets = new Map();
let rateChecks = 0;
function requestIp(req) { return TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown' : req.socket.remoteAddress || 'unknown'; }
function consumeBucket(key, limit, windowMs = 60_000) {
  const now = Date.now(); let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) bucket = { start: now, count: 0 };
  bucket.count += 1; rateBuckets.set(key, bucket);
  if (++rateChecks % 500 === 0) for (const [bucketKey, value] of rateBuckets) if (now - value.start > windowMs * 2) rateBuckets.delete(bucketKey);
  return bucket.count > limit;
}
function limited(req, ownerId, sensitive = false) { const lane = sensitive ? 'sensitive' : 'general'; if (consumeBucket(`ip:${lane}:${requestIp(req)}`, sensitive ? 12 : 150)) return true; return ownerId ? consumeBucket(`owner:${lane}:${ownerId}`, sensitive ? 20 : 100) : false; }
function allowedOrigin(req) { const origin = req.headers.origin; if (!origin) return !PRODUCTION; try { return new URL(origin).origin === new URL(PUBLIC_ORIGIN).origin; } catch (_) { return false; } }
function save(id, owner) { owner.updatedAt = Date.now(); owner.lastSeenAt = Date.now(); owner.analytics ||= {}; store.setOwner(id, owner); }
function catchup(owner) { return owner.agent ? E.catchUp(owner.agent, { now: Date.now(), stepMinutes: STEP_MINUTES, maxSteps: MAX_CATCHUP }) : []; }
function requireAgent(owner, res) { if (owner.agent) return true; json(res, 400, { error: 'Adopt an Agent first.', code: 'agent_required' }); return false; }
function apiError(res, status, error, code) { return json(res, status, { error, ...(code ? { code } : {}) }); }
function adminAuthorized(req) { const token=String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); return Boolean(ADMIN_TOKEN && safeEqual(token, ADMIN_TOKEN)); }
function readinessView() {
  let persistence={ok:true,persistence:PERSISTENCE_MODE};
  try { if (typeof store.integrityCheck === 'function') persistence=store.integrityCheck(); }
  catch (error) { persistence={ok:false,persistence:PERSISTENCE_MODE,error:error.message}; }
  const ready=!draining && persistence.ok !== false;
  return { ready, draining, inflightRequests, uptimeMs:Date.now()-STARTED_AT, persistence, releaseScope:'public-beta-demo', liveMoney:false, horizontalScaling:false, marketAdapter:MARKET_ADAPTER_MODE, marketAccess:effectiveMarketAccess(), a2a:{mode:A2ABridge.publicMode(),configured:A2ABridge.mode()!=='external'||Boolean(A2ABridge.apiBase()&&A2ABridge.appUrl())} };
}
function recoveryView() {
  const lease=marketLeaseState();
  if (!lease) return { lease:null, battle:null };
  const owner=lease.ownerId ? store.getOwner(lease.ownerId) : null; const battle=owner?.marketArena?.active;
  return { lease, battle:battle ? { id:battle.id,status:battle.status,instId:battle.instId,clOrdId:battle.execution?.clOrdId||null,ordId:battle.execution?.ordId||null,error:battle.execution?.error||battle.close?.error||null } : null, ownerFound:Boolean(owner?.agent) };
}
function decodeSegment(value) { try { return decodeURIComponent(value); } catch (_) { return null; } }
function proofFor(agent, proofId) { return (agent.proofs || []).find(proof => proof.id === proofId) || null; }
function assignCensus(agent) {
  if (agent.census?.number) return agent.census;
  const world = store.getWorld();
  world.census ||= { seasonId:'01', next:1, issued:{} };
  world.census.issued ||= {};
  if (world.census.issued[agent.id]) { agent.census = world.census.issued[agent.id]; return agent.census; }
  const n = Math.max(1, Number(world.census.next || 1));
  const census = { number:`GEN-01-${String(n).padStart(4,'0')}`, seasonId:'01', status:'REGISTERED', issuedAt:Date.now(), note:'Arrival marker only; not value, scarcity, yield, ranking or capability.' };
  world.census.next = n + 1; world.census.issued[agent.id] = census; world.updatedAt = Date.now(); store.setWorld(world); agent.census = census; return census;
}
function effectiveMarketAccess() {
  const severity={ enabled:0, paused:1, disabled:2 };
  const world=store.getWorld(), persisted=String(world.marketAccess?.status || '').toLowerCase();
  const app=['enabled','paused','disabled'].includes(persisted) ? persisted : 'enabled';
  return severity[MARKET_ACCESS] >= severity[app] ? MARKET_ACCESS : app;
}
function marketLeaseResource() { return `okx-demo:${marketAdapter.profile || 'default'}`; }
function marketLeaseState() { return store.getLease?.(marketLeaseResource()) || MarketArena.executionLeaseState(); }
function marketHooks(ownerId, owner) {
  return {
    persist: async () => save(ownerId, owner),
    acquireLease: async battleId => store.tryAcquireLease ? store.tryAcquireLease(marketLeaseResource(), battleId, ownerId) : true,
    releaseLease: async battleId => store.releaseLease ? store.releaseLease(marketLeaseResource(), battleId) : true,
  };
}
const ownerLockTails=new Map();
async function acquireOwnerLock(ownerId) {
  const key=String(ownerId), previous=ownerLockTails.get(key)||Promise.resolve(); let releaseCurrent;
  const current=new Promise(resolve=>{releaseCurrent=resolve;}); const tail=previous.then(()=>current); ownerLockTails.set(key,tail);
  await previous; let released=false;
  return () => { if(released)return; released=true; releaseCurrent(); if(ownerLockTails.get(key)===tail) ownerLockTails.delete(key); };
}
function runtimeView(owner) { return WorldRuntime.runtime(owner,{ marketVisible:marketAdapter.demoOnly===true&&effectiveMarketAccess()!=='disabled', marketAdapter:process.env.KULT_MARKET_ADAPTER||'sim', marketAccess:effectiveMarketAccess(), a2a:A2ABridge.publicState(owner) }); }
function marketGate(owner, action) {
  if (marketAdapter.demoOnly !== true) return { ok:false, code:'live_execution_disabled', error:'KULT Perp Wars requires a demo-only execution adapter.' };
  return MarketArena.requireMarketPermission(owner, action, effectiveMarketAccess());
}
function publicProof(proof) {
  const issuerVerified = Boolean(proof.verifiedIssuer || proof.issuerType === 'verified-issuer');
  const anchored = Boolean(proof.anchored);
  return {
    id: proof.id, receiptId: proof.receiptId || null, evidenceHash: proof.evidenceHash || null,
    title: proof.title, cap: proof.cap, outcome: proof.outcome, difficulty: proof.difficulty,
    createdAt: proof.createdAt, anchored, issuerType: issuerVerified ? 'authorized-issuer' : anchored ? 'self-attested' : 'kult-recorded',
    issuerVerified, txHash: anchored ? proof.txHash : null, blockNumber: anchored ? proof.blockNumber : null,
    confirmations: anchored ? proof.confirmations : null, anchoredAt: anchored ? proof.anchoredAt : null,
    status: issuerVerified ? 'ISSUER_VERIFIED' : anchored ? 'ANCHORED' : 'RECORDED',
  };
}
function publicPassport(agent) {
  const view = E.publicAgent(agent);
  const proofs = (agent.proofs || []).slice(0, 30).map(publicProof);
  const anchoredProofs = proofs.filter(proof => proof.anchored);
  return {
    id: view.id, name: view.name, persona: view.persona, trait: view.trait, color: view.color, accent: view.accent,
    blurb: view.blurb, line: view.line, born: view.born, overall: view.overall, capabilities: view.capabilities,
    arenaRank: view.arenaRank, streak: view.streak, missionsCompleted: view.missionsCompleted, missionWins: view.missionWins, evolution: view.evolution,
    walletVerified: view.walletVerified, milestones: view.milestones, census:view.census,
    proofs, anchoredProofs,
    verification: {
      seasonId: Season.MANIFEST.seasonId, seasonManifestHash: Season.manifestHash,
      recorded: proofs.length, anchored: anchoredProofs.length,
      issuerVerified: proofs.filter(proof => proof.issuerVerified).length,
      walletBound: Boolean(view.walletVerified),
    },
  };
}
function findPublicAgent(agentId) { const agent = store.listAgents().find(candidate => candidate.id === agentId); return agent && agent.publicProfile ? agent : null; }
function findPublicOwner(agentId) { const entry = store.listOwners().find(([, candidate]) => candidate?.agent?.id === agentId && candidate.agent.publicProfile); return entry ? entry[1] : null; }
function okxAiOwner(currentOwner, requestedAgentId) {
  const agentId = String(requestedAgentId || '');
  if (currentOwner?.agent && (!agentId || currentOwner.agent.id === agentId)) return { owner:currentOwner, access:'owner' };
  if (!agentId) return null;
  const publicOwner = findPublicOwner(agentId);
  return publicOwner ? { owner:publicOwner, access:'public-agent' } : null;
}
function townSquare() {
  const world = store.getWorld();
  const latestMoments = Object.values(world.shareCards || {}).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 6).map(G.publicCard);
  const challenges = Object.values(world.challenges || {}).filter(challenge => !challenge.expiresAt || challenge.expiresAt > Date.now()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 6).map(G.publicChallenge);
  return { season: seasonView(), world: store.publicWorld(), latestMoments, challenges, creators: G.listCreators(store, 6) };
}

async function api(req, res, url) {
  const method = req.method || 'GET'; const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (method === 'OPTIONS') return json(res, 204, {});
  if (url.pathname === '/api/health' && method === 'GET') return json(res, 200, { ok:true, service:'kult-world', version:VERSION, uptimeMs:Date.now()-STARTED_AT, draining, runtime:PRODUCTION?'production':'development', seasonManifestHash:Season.manifestHash, persistence:PERSISTENCE_MODE, marketArena:{ adapter:MARKET_ADAPTER_MODE, demoOnly:marketAdapter.demoOnly===true, access:effectiveMarketAccess(), executionLease:marketLeaseState() } });
  if (url.pathname === '/api/ready' && method === 'GET') { const out=readinessView(); return json(res, out.ready ? 200 : 503, out); }
  if (mutating && draining) return apiError(res, 503, 'KULT World is draining for a deployment or shutdown. Try again shortly.', 'server_draining');
  if (mutating && requestHasBody(req) && !isJsonRequest(req)) return apiError(res, 415, 'Use application/json for API mutations.', 'unsupported_media_type');
  if (mutating && !allowedOrigin(req)) return apiError(res, 403, 'Request origin is not allowed.', 'origin_rejected');

  if (url.pathname === '/api/health/detail' && method === 'GET') return json(res, 200, { ok:true, service:'kult-world', version:VERSION, chainId:Chain.CHAIN_ID, seasonManifestHash:Season.manifestHash, persistence:PERSISTENCE_MODE, intelligence:Intelligence.health(), identity:Identity.health(), proofRail:{enabled:PROOF_RAIL_ENABLED,registryConfigured:Boolean(REGISTRY_ADDRESS),seasonCommitConfigured:Boolean(SEASON_COMMIT_TX)}, marketArena:{ adapter:MARKET_ADAPTER_MODE, demoOnly:marketAdapter.demoOnly===true, access:effectiveMarketAccess(), visible:marketAdapter.demoOnly===true&&effectiveMarketAccess()!=='disabled', executionLease:marketLeaseState() }, pulse:{ mode:'server_simulation', referenceAdapter:pulseReferenceAdapter.profile || 'local-sim', accelerated:PULSE_ACCELERATED }, a2a:{ mode:A2ABridge.publicMode(), liveSettlement:A2ABridge.mode()==='external', ...A2ABridge.addresses() }, runtime:PRODUCTION?'production':'development' });
  if (url.pathname === '/api/a2a/health' && method === 'GET') { const out=await A2ABridge.health(req); return json(res,out.ok?200:503,out); }
  const publicRead = method === 'GET' && ['/api/config', '/api/leaderboard', '/api/creators', '/api/season', '/api/town-square'].includes(url.pathname)
    || method === 'GET' && ['/api/challenge/', '/api/share/', '/api/passport/', '/api/verify/'].some(prefix => url.pathname.startsWith(prefix));
  if (publicRead && consumeBucket(`public:${requestIp(req)}`, 240)) return apiError(res, 429, 'Slow down for a moment.', 'rate_limited');
  if (url.pathname === '/api/config' && method === 'GET') return json(res, 200, { personas: E.PERSONAS, caps: E.CAPS, mandates: E.MANDATES, tierRules: E.TIER_RULES, evolutionStages: E.EVOLUTION_STAGES, districts: E.DISTRICTS, missions: E.MISSIONS, homeItems: E.HOME_ITEMS, npcs: E.NPCS, chain: ROBINHOOD, xlayer: { name:'X Layer Testnet', chainId:XLayerMarket.CHAIN_ID, chainIdHex:XLayerMarket.CHAIN_ID_HEX, rpcUrl:XLayerMarket.RPC_URL, explorerUrl:XLayerMarket.EXPLORER_URL, currency:{name:'OKB',symbol:'OKB',decimals:18}, registryAddress:XLayerMarket.REGISTRY_ADDRESS }, marketArena: { instruments:MarketArena.INSTRUMENTS, policy:MarketArena.POLICY, adapter:MARKET_ADAPTER_MODE, demoOnly:marketAdapter.demoOnly === true, access:effectiveMarketAccess(), visible:marketAdapter.demoOnly === true && effectiveMarketAccess() !== 'disabled' }, pulse:{ instruments:Pulse.INSTRUMENTS, horizons:Pulse.HORIZONS, mode:'server_simulation', referenceAdapter:pulseReferenceAdapter.profile || 'local-sim', accelerated:PULSE_ACCELERATED }, a2a:{ mode:A2ABridge.publicMode(), liveSettlement:A2ABridge.mode()==='external', marketplaceUrl:A2ABridge.appUrl()||null, ...A2ABridge.addresses(), ...(A2ABridge.mode()==='sim'?{services:Object.values(A2ASim.SERVICES)}:{}) }, season: seasonView(), stepMinutes: STEP_MINUTES });
  if (url.pathname === '/api/season' && method === 'GET') return json(res, 200, { season: seasonView() });
  if (url.pathname === '/api/town-square' && method === 'GET') return json(res, 200, townSquare());
  if (url.pathname === '/api/leaderboard' && method === 'GET') { const cap = url.searchParams.get('cap'); return json(res, 200, G.leaderboard(store, store.listAgents(), { cap: E.CAPS.includes(cap) ? cap : null })); }
  if (url.pathname.startsWith('/api/challenge/') && method === 'GET') { const challenge = G.getChallenge(store, decodeSegment(url.pathname.slice('/api/challenge/'.length))); return challenge ? json(res, 200, { challenge: G.publicChallenge(challenge) }) : apiError(res, 404, 'Challenge not found.', 'not_found'); }
  if (url.pathname.startsWith('/api/share/') && method === 'GET') { const card = G.publicCard(store.getWorld().shareCards?.[decodeSegment(url.pathname.slice('/api/share/'.length))]); return card ? json(res, 200, { card }) : apiError(res, 404, 'Moment not found.', 'not_found'); }
  if (url.pathname === '/api/creators' && method === 'GET') return json(res, 200, { creators: G.listCreators(store) });
  if (url.pathname.startsWith('/api/passport/') && method === 'GET') { const agent = findPublicAgent(decodeSegment(url.pathname.slice('/api/passport/'.length))); return agent ? json(res, 200, { passport: publicPassport(agent) }) : apiError(res, 404, 'Public Passport not found.', 'not_found'); }
  if (url.pathname.startsWith('/api/verify/') && method === 'GET') { const agent = findPublicAgent(decodeSegment(url.pathname.slice('/api/verify/'.length))); return agent ? json(res, 200, { verification: publicPassport(agent) }) : apiError(res, 404, 'Public verification record not found.', 'not_found'); }
  if (url.pathname === '/api/admin/metrics' && method === 'GET') { if (limited(req, null, true)) return apiError(res, 429, 'Slow down for a moment.', 'rate_limited'); if (!adminAuthorized(req)) return apiError(res, 401, 'Unauthorized.', 'unauthorized'); return json(res, 200, store.metrics()); }
  if (url.pathname === '/api/admin/market-access' && method === 'POST') {
    if (limited(req, null, true)) return apiError(res, 429, 'Slow down for a moment.', 'rate_limited');
    if (!adminAuthorized(req)) return apiError(res, 401, 'Unauthorized.', 'unauthorized');
    let adminBody = {}; try { adminBody = await readBody(req); } catch (error) { return apiError(res, 400, error.message, 'invalid_request'); }
    const status = String(adminBody.status || '').toLowerCase(); if (!['enabled','paused','disabled'].includes(status)) return apiError(res, 400, 'status must be enabled, paused, or disabled', 'invalid_market_access');
    const world = store.getWorld(); world.marketAccess = { status, updatedAt:Date.now() }; world.updatedAt = Date.now(); store.setWorld(world); store.appendAudit?.({ type:'market.access.changed', payload:{ status } });
    return json(res, 200, { ok:true, requestedStatus:status, effectiveStatus:effectiveMarketAccess(), environmentCeiling:MARKET_ACCESS });
  }
  if (url.pathname === '/api/admin/market-recovery' && method === 'GET') {
    if (limited(req, null, true)) return apiError(res, 429, 'Slow down for a moment.', 'rate_limited');
    if (!adminAuthorized(req)) return apiError(res, 401, 'Unauthorized.', 'unauthorized');
    return json(res, 200, recoveryView());
  }
  if (url.pathname === '/api/admin/market-recovery' && method === 'POST') {
    if (limited(req, null, true)) return apiError(res, 429, 'Slow down for a moment.', 'rate_limited');
    if (!adminAuthorized(req)) return apiError(res, 401, 'Unauthorized.', 'unauthorized');
    let recoveryBody={}; try { recoveryBody=await readBody(req); } catch(error) { return apiError(res,400,error.message,'invalid_request'); }
    if (String(recoveryBody.action || 'reconcile') !== 'reconcile') return apiError(res,400,'Only reconcile is supported.','invalid_recovery_action');
    const lease=marketLeaseState(); if (!lease) return json(res,200,{ok:true,already:true,recovery:recoveryView()});
    const ownerId=String(lease.ownerId || ''); const battleId=String(recoveryBody.battleId || lease.battleId || '');
    if (!ownerId || battleId !== String(lease.battleId || '')) return apiError(res,409,'Recovery request does not match the durable execution lease.','lease_mismatch');
    const release=await acquireOwnerLock(ownerId);
    try {
      const recoveryOwner=store.getOwner(ownerId);
      if (!recoveryOwner?.agent) return apiError(res,409,'Execution lease owner is missing. Do not release the lease automatically; inspect the OKX demo account manually.','recovery_owner_missing');
      const active=recoveryOwner.marketArena?.active;
      if (!active || active.id !== battleId) return apiError(res,409,'Durable lease does not match the persisted active battle. Manual operator review is required.','recovery_battle_mismatch');
      const out=await MarketArena.reconcile(recoveryOwner,recoveryOwner.agent,marketAdapter,battleId,marketHooks(ownerId,recoveryOwner));
      save(ownerId,recoveryOwner); store.appendAudit?.({type:'market.admin.reconciled',agentId:recoveryOwner.agent.id,ownerId,payload:{battleId,ok:!out.error,code:out.code||null}});
      if (out.error) return json(res,409,{error:out.error,code:out.code||'reconcile_required',battle:out.battle||active,recovery:recoveryView()});
      return json(res,200,{ok:true,result:out,recovery:recoveryView()});
    } catch(error) { return apiError(res,error instanceof OkxAgentKitError?503:500,error.message,error.code||'admin_reconcile_failed'); }
    finally { release(); }
  }

  if (url.pathname === '/api/recover' && method === 'POST') {
    if (limited(req, null, true)) return apiError(res, 429, 'Too many recovery attempts. Try again shortly.', 'rate_limited');
    let body; try { body = await readBody(req); } catch (error) { return apiError(res, 400, error.message, 'invalid_request'); }
    const found = store.findOwnerByRecoveryHash(codeHash(body.code || ''));
    if (!found) return apiError(res, 404, 'Recovery key not found.', 'recovery_not_found');
    const [oldId, owner] = found; const nextToken = newSessionToken(); const nextId = ownerIdForToken(nextToken);
    owner.lastSeenAt = Date.now(); store.moveOwner(oldId, nextId, owner); setSessionCookie(res, nextToken);
    return json(res, 200, { ok: true, agent: E.publicAgent(owner.agent) });
  }

  let { id, owner, identityMode } = resolveSession(req, res, url.pathname);
  if (limited(req, id)) return apiError(res, 429, 'Slow down for a moment.', 'rate_limited');
  let body = {}; if (mutating) try { body = await readBody(req); } catch (error) { return apiError(res, 400, error.message, 'invalid_request'); }
  if (mutating || url.pathname === '/api/state') {
    const release=await acquireOwnerLock(id); let once=false; const unlock=()=>{ if(once)return; once=true; release(); };
    res.once('finish',unlock); res.once('close',unlock);
    owner=store.getOwner(id) || owner;
  }

  if (url.pathname === '/api/state' && method === 'GET') {
    if (!owner.agent) return json(res, 200, { adopted: false, world: store.publicWorld() });
    E.normalizeAgent(owner.agent); const offlineEvents = catchup(owner); const reunion = E.ownerReturn(owner.agent); save(id, owner);
    return json(res, 200, { adopted:true, agent:E.publicAgent(owner.agent), world:store.publicWorld(), runtime:runtimeView(owner), offlineEvents: offlineEvents.map(event => ({ type: event.type, text: event.text, place: event.place, district: event.district, cap: event.verified?.cap || event.observed?.cap || null, verified: event.verified || null, observed: event.observed || null })), reunion });
  }
  if (url.pathname === '/api/adopt' && method === 'POST') {
    if (owner.agent) return apiError(res, 409, 'This home already has an Agent.', 'already_adopted');
    const persona = String(body.persona || 'NORI').toUpperCase(); if (!E.PERSONAS[persona]) return apiError(res, 400, 'Unknown persona.', 'invalid_persona');
    const name = cleanName(body.name || persona); owner.agent = E.newAgent(name, persona, String(body.mandate || 'explore').toLowerCase());
    assignCensus(owner.agent);
    const recoveryCode = newRecoveryCode(); owner.recoveryHash = codeHash(recoveryCode); owner.analytics = { adoptedAt: Date.now(), recapOpens: 0 }; save(id, owner);
    store.appendAudit?.({ type: 'agent.adopted', agentId: owner.agent.id, ownerId: id, payload: { persona, mandate: owner.agent.mandate, identityMode } });
    return json(res, 200, { adopted: true, agent: E.publicAgent(owner.agent), recoveryCode, welcome: `${name} moved into a small place of its own. ${name} is ${owner.agent.blurb}.` });
  }
  if (url.pathname === '/api/live' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    const steps = Math.min(Math.max(Number.parseInt(body.steps || 1, 10) || 1, 1), 5);
    const events = [];
    for (let index = 0; index < steps; index++) {
      const decision = await Intelligence.chooseWorldAction(owner.agent, { currentDistrict: String(body.currentDistrict || '') || null });
      const event = E.step(owner.agent, Date.now() + index, decision);
      events.push(event);
      store.appendAudit?.({ type: 'world.experience', agentId: owner.agent.id, ownerId: id, payload: { district: event.district, type: event.type, decisionSource: event.decision?.source || 'world-engine' } });
    }
    save(id, owner);
    return json(res, 200, { events, agent: E.publicAgent(owner.agent), identityMode });
  }
  if (url.pathname === '/api/mission' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    const out = E.runMission(owner.agent, String(body.mission || ''), String(body.choice || '')); if (out.error) return apiError(res, 400, out.error, 'mission_rejected');
    const raw = `${owner.agent.id}|${out.proof.id}|${out.proof.mission}|${out.proof.outcome}|${out.proof.difficulty}|${out.proof.createdAt}`;
    out.proof.receiptId = `0x${crypto.createHash('sha256').update(out.proof.id).digest('hex')}`; out.proof.agentId = `0x${crypto.createHash('sha256').update(owner.agent.id).digest('hex')}`; out.proof.evidenceHash = `0x${crypto.createHash('sha256').update(raw).digest('hex')}`; Object.assign(proofFor(owner.agent, out.proof.id), out.proof);
    if (out.success && out.world) { const world = store.getWorld(); world.observatory = Math.min(10_000, Number(world.observatory || 0) + out.world); world.contributorAgents ||= {}; world.contributorAgents[owner.agent.id] ||= Date.now(); world.contributors = Object.keys(world.contributorAgents).length; world.updatedAt = Date.now(); store.setWorld(world); }
    owner.analytics ||= {}; owner.analytics.firstMissionAt ||= Date.now(); out.agentState = E.publicAgent(owner.agent); out.worldState = store.publicWorld(); save(id, owner); store.appendAudit?.({ type: 'mission.outcome', agentId: owner.agent.id, ownerId: id, payload: { proofId: out.proof.id, receiptId: out.proof.receiptId, cap: out.proof.cap, outcome: out.proof.outcome, difficulty: out.proof.difficulty } }); return json(res, 200, out);
  }
  if (url.pathname === '/api/mandate' && method === 'POST') { if (!requireAgent(owner, res)) return; const out = E.setMandate(owner.agent, String(body.mandate || '').toLowerCase()); if (out.error) return apiError(res, 400, out.error, 'invalid_mandate'); save(id, owner); return json(res, 200, out); }
  if (url.pathname === '/api/focus' && method === 'POST') { if (!requireAgent(owner, res)) return; const cap = String(body.cap || '').toLowerCase(); const out = cap === 'none' ? E.clearFocus(owner.agent) : E.setFocus(owner.agent, cap); if (out.error) return apiError(res, 400, out.error, 'invalid_capability'); save(id, owner); return json(res, 200, out); }
  if (url.pathname === '/api/encourage' && method === 'POST') { if (!requireAgent(owner, res)) return; const tone = ['checkin', 'proud', 'rest'].includes(body.tone) ? body.tone : 'checkin'; const out = E.encourage(owner.agent, tone); save(id, owner); return json(res, 200, out); }
  if ((url.pathname === '/api/gift' || url.pathname === '/api/home/buy') && method === 'POST') { if (!requireAgent(owner, res)) return; const out = E.buyHomeItem(owner.agent, String(body.item || '')); if (out.error) return apiError(res, 400, out.error, 'purchase_rejected'); owner.analytics ||= {}; owner.analytics.homeCustomizedAt ||= Date.now(); save(id, owner); return json(res, 200, out); }
  if (url.pathname === '/api/wallet' && method === 'POST') { if (!requireAgent(owner, res)) return; const out = E.linkWallet(owner.agent, String(body.address || '')); if (out.error) return apiError(res, 400, out.error, 'invalid_wallet'); save(id, owner); return json(res, 200, out); }
  if (url.pathname === '/api/proof/calldata' && method === 'POST') {
    if (!requireAgent(owner, res)) return; if (!PROOF_RAIL_ENABLED) return apiError(res, 503, 'The on-chain proof rail is disabled for this deployment.', 'proof_rail_disabled'); if (!REGISTRY_ADDRESS) return apiError(res, 503, 'The experience registry is not configured yet.', 'registry_unavailable'); if (!owner.agent.walletAddress) return apiError(res, 400, 'Connect a wallet first.', 'wallet_required');
    const proof = proofFor(owner.agent, String(body.proofId || '')); if (!proof) return apiError(res, 404, 'Proof not found.', 'proof_not_found');
    try { return json(res, 200, { to: REGISTRY_ADDRESS, data: Chain.encodeAnchorCalldata(proof), value: '0x0', chain: ROBINHOOD, proofId: proof.id }); }
    catch (error) { if (error instanceof Chain.ChainVerificationError) return apiError(res, 400, error.message, error.code); throw error; }
  }
  if (url.pathname === '/api/proof/anchored' && method === 'POST') {
    if (!requireAgent(owner, res)) return; if (!PROOF_RAIL_ENABLED) return apiError(res,503,'The on-chain proof rail is disabled for this deployment.','proof_rail_disabled'); const proof = proofFor(owner.agent, String(body.proofId || '')); if (!proof) return apiError(res, 404, 'Proof not found.', 'proof_not_found'); const txHash = String(body.txHash || '');
    if (proof.anchored) { if (String(proof.txHash).toLowerCase() !== txHash.toLowerCase()) return apiError(res, 409, 'This proof is already anchored by another transaction.', 'already_anchored'); return json(res, 200, { ok: true, already: true, agentState: E.publicAgent(owner.agent) }); }
    try {
      const verified = await Chain.verifyAnchorTransaction({ rpcUrl: SERVER_RPC_URL, registryAddress: REGISTRY_ADDRESS, walletAddress: owner.agent.walletAddress, txHash, expectedData: Chain.encodeAnchorCalldata(proof), minConfirmations: MIN_CONFIRMATIONS });
      const out = E.markProofAnchored(owner.agent, proof.id, txHash, verified); save(id, owner); store.appendAudit?.({ type: 'proof.anchored', agentId: owner.agent.id, ownerId: id, payload: { proofId: proof.id, txHash, blockNumber: verified.blockNumber || null } }); return json(res, 200, out);
    } catch (error) {
      if (error instanceof Chain.ChainVerificationError) return apiError(res, error.code === 'tx_pending' ? 409 : error.code === 'rpc_unavailable' ? 503 : 400, error.message, error.code);
      throw error;
    }
  }
  if (url.pathname === '/api/recovery/rotate' && method === 'POST') { if (!requireAgent(owner, res)) return; const recoveryCode = newRecoveryCode(); owner.recoveryHash = codeHash(recoveryCode); save(id, owner); return json(res, 200, { recoveryCode }); }
  if (url.pathname === '/api/restart' && method === 'POST') {
    if (!requireAgent(owner, res)) return; if (String(body.confirm || '').trim() !== owner.agent.name) return apiError(res, 400, 'Type the Agent name exactly to start over.', 'confirmation_failed');
    const oldAgentId = owner.agent.id; const world = store.getWorld(); delete world.creators?.[oldAgentId]; for (const creator of Object.values(world.creators || {})) if (creator.followerAgentIds?.[oldAgentId]) delete creator.followerAgentIds[oldAgentId]; world.updatedAt = Date.now(); store.setWorld(world);
    owner.agent = null; owner.recoveryHash = null; owner.analytics = {}; save(id, owner); return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/world/runtime' && method === 'GET') {
    if (!requireAgent(owner,res)) return;
    return json(res,200,{ runtime:runtimeView(owner), agentState:E.publicAgent(owner.agent) });
  }
  if (url.pathname === '/api/integrations' && method === 'GET') {
    return json(res,200,{
      ok:true,
      version:VERSION,
      frontend:{ servedByBackend:true, threeWorld:true, marketUi:true },
      persistence:{ mode:PERSISTENCE_MODE, durable:PERSISTENCE_MODE==='sqlite' },
      agent:{ runtime:'/api/world/runtime', persistent:true },
      market:{
        provider:'OKX', adapter:MARKET_ADAPTER_MODE, demoOnly:marketAdapter.demoOnly===true,
        access:effectiveMarketAccess(),
        xlayer:{ network:String(process.env.KULT_XLAYER_NETWORK||'testnet'), registryConfigured:Boolean(process.env.KULT_XLAYER_REGISTRY_ADDRESS) },
        okxAi:{ manifest:'/api/okx-ai/manifest', services:'/api/okx-ai/services' }
      },
      pulse:{ adapter:PULSE_REFERENCE_MODE, settlement:'server-simulated', liveBnb:false },
      a2a:{ settlement:A2ABridge.mode()==='external'?'GOAT Flow → Base USDC escrow':A2ABridge.mode()==='sim'?'server-simulated':'disabled', paidSettlement:A2ABridge.mode()==='external', mode:A2ABridge.publicMode(), marketplaceUrl:A2ABridge.appUrl()||null, ...A2ABridge.addresses() },
      proofRail:{ enabled:PROOF_RAIL_ENABLED, registryConfigured:Boolean(REGISTRY_ADDRESS) },
      certification:{ scope:'public-beta-demo', liveMoney:false, horizontalScaling:false }
    });
  }
  if (url.pathname === '/api/pulse/state' && method === 'GET') {
    if (!requireAgent(owner,res)) return;
    return json(res,200,{ pulse:Pulse.publicPulse(owner), agentState:E.publicAgent(owner.agent) });
  }
  if (url.pathname === '/api/pulse/prepare' && method === 'POST') {
    if (!requireAgent(owner,res)) return;
    try {
      const out=await Pulse.prepare(owner,owner.agent,pulseReferenceAdapter,body.symbol,body.horizon); if(out.error)return apiError(res,409,out.error,out.code);
      save(id,owner); store.appendAudit?.({type:'pulse.prepared',agentId:owner.agent.id,ownerId:id,payload:{roundId:out.round.id,symbol:out.round.symbol,horizonMinutes:out.round.horizonMinutes,source:out.round.referenceSource}});
      return json(res,200,{...out,agentState:E.publicAgent(owner.agent),runtime:runtimeView(owner)});
    } catch(error){ return apiError(res,503,error.message,error.code||'pulse_prepare_failed'); }
  }
  if (url.pathname === '/api/pulse/commit' && method === 'POST') {
    if (!requireAgent(owner,res)) return;
    const out=Pulse.commit(owner,owner.agent,String(body.roundId||''),String(body.choice||'follow')); if(out.error)return apiError(res,409,out.error,out.code);
    save(id,owner); store.appendAudit?.({type:'pulse.committed',agentId:owner.agent.id,ownerId:id,payload:{roundId:out.round.id,action:out.round.userDecision?.action,followed:out.round.userDecision?.followed}});
    return json(res,200,{...out,agentState:E.publicAgent(owner.agent),runtime:runtimeView(owner)});
  }
  if (url.pathname === '/api/pulse/resolve' && method === 'POST') {
    if (!requireAgent(owner,res)) return;
    try {
      const out=await Pulse.resolve(owner,owner.agent,pulseReferenceAdapter,String(body.roundId||'')); if(out.error)return apiError(res,out.code==='pulse_round_running'?409:400,out.error,out.code);
      save(id,owner); store.appendAudit?.({type:'pulse.resolved',agentId:owner.agent.id,ownerId:id,payload:{roundId:out.round.id,symbol:out.round.symbol,horizonMinutes:out.round.horizonMinutes,userOutcome:out.round.result?.userOutcome,agentOutcome:out.round.result?.agentOutcome}});
      return json(res,200,{...out,agentState:E.publicAgent(owner.agent),runtime:runtimeView(owner)});
    } catch(error){ return apiError(res,503,error.message,error.code||'pulse_resolve_failed'); }
  }
  if (url.pathname === '/api/pulse/cancel' && method === 'POST') {
    if (!requireAgent(owner,res)) return; const out=Pulse.cancel(owner,String(body.roundId||'')); if(out.error)return apiError(res,409,out.error,out.code); save(id,owner); return json(res,200,out);
  }
  if (url.pathname === '/api/a2a/state' && method === 'GET') {
    if (!requireAgent(owner,res)) return;
    const a2a=A2ABridge.publicState(owner);
    return json(res,200,{a2a:{...a2a,launchUrl:A2ABridge.marketplaceLaunch(owner.agent)},agentState:E.publicAgent(owner.agent)});
  }
  if (url.pathname === '/api/a2a/hire' && method === 'POST') {
    if (!requireAgent(owner,res)) return; if(limited(req,id,true))return apiError(res,429,'Too many Agent service actions. Slow down.','rate_limited');
    if(A2ABridge.mode()!=='sim') return apiError(res,410,'Direct simulated hire is disabled. Use the real A2A marketplace flow.','real_a2a_required');
    const out=A2ASim.hire(owner,owner.agent,String(body.serviceId||'')); if(out.error)return apiError(res,409,out.error,out.code); save(id,owner);
    store.appendAudit?.({type:'a2a.service.completed',agentId:owner.agent.id,ownerId:id,payload:{receiptId:out.receipt.id,serviceId:out.receipt.serviceId,provider:out.receipt.provider,priceUsd:out.receipt.priceUsd,settlement:'simulated'}});
    return json(res,200,{...out,agentState:E.publicAgent(owner.agent),runtime:runtimeView(owner)});
  }
  const a2aOrderCreate=url.pathname.match(/^\/api\/a2a\/jobs\/([^/]+)\/goat\/orders$/);
  if(a2aOrderCreate && method==='POST') {
    if(!requireAgent(owner,res)) return; if(limited(req,id,true))return apiError(res,429,'Too many A2A funding actions. Slow down.','rate_limited');
    if(A2ABridge.mode()!=='external') return apiError(res,503,'Real A2A bridge is not enabled.','a2a_not_enabled');
    try{ const out=await A2ABridge.createOrder(req,decodeSegment(a2aOrderCreate[1]),body.payChainId); A2ABridge.remember(owner,{type:'goat.order.created',jobId:decodeSegment(a2aOrderCreate[1]),orderId:out.orderId||null}); save(id,owner); store.appendAudit?.({type:'a2a.goat.order.created',agentId:owner.agent.id,ownerId:id,payload:{jobId:decodeSegment(a2aOrderCreate[1]),orderId:out.orderId||null}}); return json(res,200,out); }
    catch(error){ return apiError(res,error.status||502,error.message,error.code||'a2a_order_failed'); }
  }
  const a2aSignature=url.pathname.match(/^\/api\/a2a\/jobs\/([^/]+)\/goat\/orders\/([^/]+)\/signature$/);
  if(a2aSignature && method==='POST') {
    if(!requireAgent(owner,res)) return; if(limited(req,id,true))return apiError(res,429,'Too many A2A funding actions. Slow down.','rate_limited');
    if(A2ABridge.mode()!=='external') return apiError(res,503,'Real A2A bridge is not enabled.','a2a_not_enabled');
    try{ const jobId=decodeSegment(a2aSignature[1]),orderId=decodeSegment(a2aSignature[2]); const out=await A2ABridge.submitSignature(req,jobId,orderId,body.signature); A2ABridge.remember(owner,{type:'goat.signature.submitted',jobId,orderId}); save(id,owner); store.appendAudit?.({type:'a2a.goat.signature.submitted',agentId:owner.agent.id,ownerId:id,payload:{jobId,orderId}}); return json(res,200,out); }
    catch(error){ return apiError(res,error.status||502,error.message,error.code||'a2a_signature_failed'); }
  }
  const a2aOrderStatus=url.pathname.match(/^\/api\/a2a\/jobs\/([^/]+)\/goat\/orders\/([^/]+)$/);
  if(a2aOrderStatus && method==='GET') {
    if(!requireAgent(owner,res)) return; if(A2ABridge.mode()!=='external') return apiError(res,503,'Real A2A bridge is not enabled.','a2a_not_enabled');
    try{ return json(res,200,await A2ABridge.orderStatus(req,decodeSegment(a2aOrderStatus[1]),decodeSegment(a2aOrderStatus[2]))); }
    catch(error){ return apiError(res,error.status||502,error.message,error.code||'a2a_status_failed'); }
  }
  const a2aCredit=url.pathname.match(/^\/api\/a2a\/goat\/credit\/(0x[a-fA-F0-9]{40})$/);
  if(a2aCredit && method==='GET') {
    if(!requireAgent(owner,res)) return; if(A2ABridge.mode()!=='external') return apiError(res,503,'Real A2A bridge is not enabled.','a2a_not_enabled');
    try{ return json(res,200,await A2ABridge.credit(req,a2aCredit[1])); }
    catch(error){ return apiError(res,error.status||502,error.message,error.code||'a2a_credit_failed'); }
  }
  if (url.pathname === '/api/okx-ai/manifest' && method === 'GET') {
    return json(res, 200, OkxAI.serviceManifest(PUBLIC_ORIGIN));
  }
  if (url.pathname === '/api/okx-ai/services' && method === 'GET') {
    return json(res, 200, { provider:'KULT Games', network:OkxAI.OKX_AI_NETWORK, services:OkxAI.publicCatalog() });
  }
  if (url.pathname === '/api/okx-ai/agent-profile' && ['GET','POST'].includes(method)) {
    const requestedAgentId = method === 'GET' ? url.searchParams.get('agentId') : body.agentId;
    const context = okxAiOwner(owner, requestedAgentId);
    if (!context) return apiError(res, 404, 'Public KULT Agent not found. Publish the Agent Passport or call from the owner session.', 'public_agent_not_found');
    const target = context.owner;
    return json(res, 200, {
      service:'kult.agent.market-profile', access:context.access,
      agent:{ id:target.agent.id, name:target.agent.name, persona:target.agent.persona },
      market:PerpsGame.publicPerps(target),
      ...(context.access === 'owner' ? { arena:MarketArena.publicArena(target) } : {}),
    });
  }
  if (url.pathname === '/api/okx-ai/market-read' && method === 'POST') {
    const context = okxAiOwner(owner, body.agentId);
    if (!context) return apiError(res, 404, 'Public KULT Agent not found. Publish the Agent Passport or call from the owner session.', 'public_agent_not_found');
    const target = context.owner;
    const symbol = String(body.symbol || 'BTC').toUpperCase();
    const instId = MarketArena.INSTRUMENTS[symbol];
    if (!instId) return apiError(res, 400, 'Unsupported market.', 'invalid_market');
    try {
      const snapshot = await marketAdapter.marketSnapshot(instId);
      const signals = MarketArena.deriveSignals(snapshot);
      const decision = PerpsGame.buildPlayerDecision(target.agent, target, signals);
      return json(res, 200, {
        service:'kult.market.read', access:context.access, symbol, instId, source:snapshot.source,
        decision:{ style:decision.style, action:decision.action, side:decision.side, signalStrength:decision.signalStrength, thesis:decision.thesis, riskBand:decision.riskBand, memorySamples:decision.memory?.samples || 0 },
        market:{ last:signals.last, funding:signals.funding, spreadBps:signals.spreadBps, momentum15m:signals.momentum15m, momentum30m:signals.momentum30m },
        agent:{ id:target.agent.id, name:target.agent.name },
      });
    } catch (error) { return apiError(res, 503, error.message, error.code || 'okx_unavailable'); }
  }
  if (url.pathname === '/api/okx-ai/raid-evaluate' && method === 'POST') {
    const context = okxAiOwner(owner, body.agentId);
    if (!context) return apiError(res, 404, 'Public KULT Agent not found. Publish the Agent Passport or call from the owner session.', 'public_agent_not_found');
    const target = context.owner;
    const arena = MarketArena.arenaState(target);
    const battleId = String(body.battleId || '');
    const battle = arena.battles.find(item => item.id === battleId) || (arena.active?.id === battleId ? arena.active : null);
    if (!battle?.result) return apiError(res, 404, 'Resolved raid not found.', 'battle_not_found');
    return json(res, 200, { service:'kult.perp.raid-evaluate', access:context.access, agentId:target.agent.id, battleId, result:battle.result, rival:battle.rival, progression:battle.result.progression || null, reflection:battle.result.reflection || null });
  }
  if (url.pathname === '/api/market/health' && method === 'GET') {
    const health = await marketAdapter.health();
    const gate = marketGate(owner, 'read');
    return json(res, health.ok ? 200 : 503, { ...health, policy: MarketArena.POLICY, permission: { ...MarketArena.permissionState(owner), effectiveStatus: gate.status || effectiveMarketAccess() }, access: effectiveMarketAccess(), visible: marketAdapter.demoOnly === true && effectiveMarketAccess() !== 'disabled', xlayer: { chainId: XLayerMarket.CHAIN_ID, network:XLayerMarket.NETWORK, registryConfigured: Boolean(XLayerMarket.REGISTRY_ADDRESS) }, executionLease:marketLeaseState(), product:'KULT Perp Wars' });
  }
  if (url.pathname === '/api/market/ready' && method === 'GET') {
    const health = await marketAdapter.health();
    let account = null; let accountOk = false; let accountError = null; const openPositions=[];
    if (health.ok) {
      try {
        const snapshots=await Promise.all(Object.values(MarketArena.INSTRUMENTS).map(instId=>marketAdapter.accountSnapshot(instId)));
        account=snapshots[0]||null; accountOk=Number(account?.equity||0)>0;
        for(let i=0;i<snapshots.length;i++) for(const position of snapshots[i]?.positions||[]) if(Math.abs(Number(position.pos??position.position??position.sz)||0)>0) openPositions.push({instId:Object.values(MarketArena.INSTRUMENTS)[i],pos:Number(position.pos??position.position??position.sz)||0,ordId:position.ordId||null,clOrdId:position.clOrdId||null});
      } catch (error) { accountError=error.message; }
    }
    const lease=marketLeaseState(); const flat=openPositions.length===0;
    const ready=Boolean(health.ok && (marketAdapter.profile==='local-sim' || (accountOk && flat && !lease)));
    return json(res, ready ? 200 : 503, { ready, health, account:{ ok:accountOk, equity:account?.equity || null, positionMode:account?.positionMode || null, accountLevel:account?.accountLevel || null, flat, openPositions, error:accountError }, xlayer:{ network:XLayerMarket.NETWORK, chainId:XLayerMarket.CHAIN_ID, registryConfigured:Boolean(XLayerMarket.REGISTRY_ADDRESS) }, okxAI:{ services:OkxAI.publicCatalog().length }, executionLease:lease });
  }
  if (url.pathname === '/api/market/state' && method === 'GET') {
    if (!requireAgent(owner, res)) return;
    return json(res, 200, { arena: MarketArena.publicArena(owner), policy: MarketArena.POLICY, permission: { ...MarketArena.permissionState(owner), effectiveStatus: marketGate(owner,'read').status || effectiveMarketAccess() }, agentState:E.publicAgent(owner.agent), instruments: MarketArena.INSTRUMENTS, adapter: MARKET_ADAPTER_MODE, xlayer: { network:XLayerMarket.NETWORK, chainId:XLayerMarket.CHAIN_ID, chainIdHex:XLayerMarket.CHAIN_ID_HEX, rpcUrl:XLayerMarket.RPC_URL, explorerUrl:XLayerMarket.EXPLORER_URL, registryAddress:XLayerMarket.REGISTRY_ADDRESS }, okxAI:OkxAI.serviceManifest(PUBLIC_ORIGIN), executionLease:marketLeaseState() });
  }
  if (url.pathname === '/api/market/snapshot' && method === 'GET') {
    if (!requireAgent(owner, res)) return;
    const symbol = String(url.searchParams.get('symbol') || 'BTC').toUpperCase();
    const instId = MarketArena.INSTRUMENTS[symbol];
    if (!instId) return apiError(res, 400, 'Unsupported market.', 'invalid_market');
    try { const snapshot = await marketAdapter.marketSnapshot(instId); return json(res, 200, { symbol, snapshot }); }
    catch (error) { return apiError(res, 503, error.message, error.code || 'okx_unavailable'); }
  }
  if (url.pathname === '/api/market/battle/prepare' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    { const gate = marketGate(owner, 'prepare'); if (!gate.ok) return apiError(res, 403, gate.error, gate.code); }
    try {
      const out = await MarketArena.prepare(owner, owner.agent, marketAdapter, body.symbol, { rivalId: String(body.rivalId || '') || null });
      if (out.error) return apiError(res, 409, out.error, out.code);
      save(id, owner); store.appendAudit?.({ type:'market.battle.prepared', agentId:owner.agent.id, ownerId:id, payload:{ battleId:out.battle.id, instId:out.battle.instId, side:out.battle.nori.side, rivalId:out.battle.rival?.id || null, adapter:out.battle.marketSource } });
      return json(res, 200, { ...out, agentState:E.publicAgent(owner.agent) });
    } catch (error) { return apiError(res, error instanceof OkxAgentKitError ? 503 : 500, error.message, error.code || 'market_prepare_failed'); }
  }
  if (url.pathname === '/api/market/battle/execute' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    { const gate = marketGate(owner, 'execute'); if (!gate.ok) return apiError(res, 403, gate.error, gate.code); }
    if (limited(req, id, true)) return apiError(res, 429, 'Too many trade actions. Slow down.', 'rate_limited');
    try {
      const out = await MarketArena.execute(owner, owner.agent, marketAdapter, String(body.battleId || ''), marketHooks(id,owner));
      if (out.error) return apiError(res, 409, out.error, out.code);
      save(id, owner); store.appendAudit?.({ type:'market.demo.executed', agentId:owner.agent.id, ownerId:id, payload:{ battleId:out.battle.id, instId:out.battle.instId, ordId:out.battle.execution?.ordId, side:out.battle.execution?.side, notionalUsd:out.battle.notionalUsd } });
      return json(res, 200, { ...out, agentState:E.publicAgent(owner.agent) });
    } catch (error) { return apiError(res, error instanceof OkxAgentKitError ? 503 : 500, error.message, error.code || 'market_execute_failed'); }
  }
  if (url.pathname === '/api/market/battle/abstain' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    try {
      const out = await MarketArena.abstain(owner, owner.agent, marketAdapter, String(body.battleId || ''), { ...marketHooks(id,owner), accelerated:String(process.env.KULT_WAIT_ACCELERATED||'').toLowerCase()==='true' });
      if (out.error) return apiError(res, 409, out.error, out.code);
      save(id, owner); store.appendAudit?.({ type:'market.raid.abstained', agentId:owner.agent.id, ownerId:id, payload:{ battleId:out.battle.id, instId:out.battle.instId, rivalId:out.battle.rival?.id || null } });
      return json(res, 200, { ...out, agentState:E.publicAgent(owner.agent) });
    } catch (error) { return apiError(res, 500, error.message, error.code || 'market_abstain_failed'); }
  }
  if (url.pathname === '/api/market/battle/close' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    if (limited(req, id, true)) return apiError(res, 429, 'Too many trade actions. Slow down.', 'rate_limited');
    try {
      const out = await MarketArena.close(owner, owner.agent, marketAdapter, String(body.battleId || ''), marketHooks(id,owner));
      if (out.error) return apiError(res, 409, out.error, out.code);
      save(id, owner); store.appendAudit?.({ type:'market.demo.closed', agentId:owner.agent.id, ownerId:id, payload:{ battleId:out.battle.id, instId:out.battle.instId, closeOrdId:out.battle.close?.ordId || null } });
      return json(res, 200, { ...out, agentState:E.publicAgent(owner.agent) });
    } catch (error) { return apiError(res, error instanceof OkxAgentKitError ? 503 : 500, error.message, error.code || 'market_close_failed'); }
  }
  if (url.pathname === '/api/market/battle/reconcile' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    try {
      const out = await MarketArena.reconcile(owner, owner.agent, marketAdapter, String(body.battleId || ''), marketHooks(id,owner));
      if (out.error) return apiError(res, 409, out.error, out.code);
      save(id, owner); return json(res, 200, { ...out, agentState:E.publicAgent(owner.agent) });
    } catch (error) { return apiError(res, error instanceof OkxAgentKitError ? 503 : 500, error.message, error.code || 'market_reconcile_failed'); }
  }
  if (url.pathname === '/api/market/battle/resolve' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    if (limited(req, id, true)) return apiError(res, 429, 'Too many trade actions. Slow down.', 'rate_limited');
    try {
      const out = await MarketArena.resolve(owner, owner.agent, marketAdapter, String(body.battleId || ''), marketHooks(id,owner));
      if (out.error) return apiError(res, 409, out.error, out.code);
      save(id, owner); store.appendAudit?.({ type:'market.demo.resolved', agentId:owner.agent.id, ownerId:id, payload:{ battleId:out.battle.id, instId:out.battle.instId, outcome:out.battle.result?.outcome, pnlUsd:out.battle.result?.pnlUsd, tradeHash:out.battle.result?.tradeHash } });
      return json(res, 200, { ...out, agentState:E.publicAgent(owner.agent) });
    } catch (error) { return apiError(res, error instanceof OkxAgentKitError ? 503 : 500, error.message, error.code || 'market_resolve_failed'); }
  }
  if (url.pathname === '/api/market/battle/cancel' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    const out = MarketArena.cancel(owner, String(body.battleId || '')); if (out.error) return apiError(res, 409, out.error, out.code); save(id, owner); return json(res, 200, out);
  }
  if (url.pathname === '/api/market/xlayer/calldata' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    const battle = MarketArena.arenaState(owner).battles.find(x => x.id === String(body.battleId || ''));
    if (!battle?.result) return apiError(res, 404, 'Resolved battle not found.', 'battle_not_found');
    if (battle.marketSource !== 'OKX_AGENT_TRADE_KIT' || battle.result?.noTrade) return apiError(res, 409, 'Only executed and reconciled OKX Demo Trading battles can be anchored on X Layer.', 'receipt_not_eligible');
    if (!XLayerMarket.REGISTRY_ADDRESS) return apiError(res, 503, 'X Layer Market Registry is not configured.', 'registry_unavailable');
    const data = XLayerMarket.encodeBattleReceipt({ battleId:battle.id, agentId:owner.agent.id, tradeHash:battle.result.tradeHash, outcome:(battle.result.duelOutcome || battle.result.outcome), returnPct:battle.result.returnPct });
    return json(res, 200, { chainId:XLayerMarket.CHAIN_ID, chainIdHex:XLayerMarket.CHAIN_ID_HEX, to:XLayerMarket.REGISTRY_ADDRESS, value:'0x0', data, explorerUrl:XLayerMarket.EXPLORER_URL });
  }
  if (url.pathname === '/api/market/xlayer/anchored' && method === 'POST') {
    if (!requireAgent(owner, res)) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(String(owner.agent.walletAddress || ''))) return apiError(res, 400, 'Connect an EVM wallet first.', 'wallet_required');
    const arena = MarketArena.arenaState(owner); const battle = arena.battles.find(x => x.id === String(body.battleId || ''));
    if (!battle?.result) return apiError(res, 404, 'Resolved battle not found.', 'battle_not_found');
    if (battle.marketSource !== 'OKX_AGENT_TRADE_KIT' || battle.result?.noTrade) return apiError(res, 409, 'Only executed and reconciled OKX Demo Trading battles can be anchored on X Layer.', 'receipt_not_eligible');
    try {
      const data = XLayerMarket.encodeBattleReceipt({ battleId:battle.id, agentId:owner.agent.id, tradeHash:battle.result.tradeHash, outcome:(battle.result.duelOutcome || battle.result.outcome), returnPct:battle.result.returnPct });
      const txHash = String(body.txHash || '').toLowerCase();
      const existing = arena.xlayerReceipts.find(item => item.battleId === battle.id);
      if (existing) {
        if (existing.txHash !== txHash) return apiError(res, 409, 'This battle already has a different X Layer receipt.', 'already_anchored');
        return json(res, 200, { ok:true, already:true, receipt:existing, arena:MarketArena.publicArena(owner) });
      }
      const verified = await XLayerMarket.verify({ txHash, walletAddress:owner.agent.walletAddress, expectedData:data });
      arena.xlayerReceipts.unshift({ battleId:battle.id, txHash, anchoredAt:Date.now(), blockNumber:verified.blockNumber }); arena.xlayerReceipts=arena.xlayerReceipts.slice(0,30); save(id, owner);
      store.appendAudit?.({ type:'market.xlayer.anchored', agentId:owner.agent.id, ownerId:id, payload:{battleId:battle.id,txHash} });
      return json(res, 200, { ok:true, receipt:arena.xlayerReceipts[0], arena:MarketArena.publicArena(owner) });
    } catch(error) { return apiError(res, error.code==='tx_pending'?409:400, error.message, error.code || 'xlayer_verification_failed'); }
  }

  if (url.pathname === '/api/moments' && method === 'GET') { if (!requireAgent(owner, res)) return; return json(res, 200, { moments: G.deriveMoments(owner.agent) }); }
  if (url.pathname === '/api/share' && method === 'POST') { if (!requireAgent(owner, res)) return; const moments = G.deriveMoments(owner.agent); const moment = moments.find(item => item.id === body.momentId) || moments.find(item => item.kind === body.kind) || moments[0]; if (!moment) return apiError(res, 400, 'Earn a real moment before sharing one.', 'moment_required'); const card = G.storeShareCard(store, G.buildShareCard(owner.agent, moment)); return json(res, 200, { card, shareUrl: `${PUBLIC_ORIGIN}/s/${card.slug}` }); }
  if (url.pathname === '/api/challenge' && method === 'POST') { if (!requireAgent(owner, res)) return; const cap = E.CAPS.includes(String(body.cap || '').toLowerCase()) ? String(body.cap).toLowerCase() : null; const challenge = G.createChallenge(store, owner.agent, cap); if (challenge.error) return apiError(res, 400, challenge.error, 'challenge_unavailable'); return json(res, 200, { challenge, challengeUrl: `${PUBLIC_ORIGIN}/c/${challenge.id}` }); }
  if (url.pathname === '/api/challenge/accept' && method === 'POST') { if (!requireAgent(owner, res)) return; const out = G.acceptChallenge(store, String(body.challengeId || ''), owner.agent); if (out.error) return apiError(res, 400, out.error, 'challenge_rejected'); return json(res, 200, out); }
  if (url.pathname === '/api/challenge/resolve' && method === 'POST') { if (!requireAgent(owner, res)) return; const out = G.resolveChallenge(store, String(body.challengeId || ''), owner.agent); if (out.error) return apiError(res, 400, out.error, 'challenge_rejected'); return json(res, 200, out); }
  if (url.pathname === '/api/creator/register' && method === 'POST') { if (!requireAgent(owner, res)) return; const out = G.registerCreatorAgent(store, owner.agent, body.handle); if (out.error) return apiError(res, 400, out.error, 'creator_rejected'); save(id, owner); return json(res, 200, out); }
  if (url.pathname === '/api/creator/follow' && method === 'POST') { if (!requireAgent(owner, res)) return; const out = G.followCreator(store, String(body.agentId || ''), owner.agent); if (out.error) return apiError(res, 400, out.error, 'follow_rejected'); return json(res, 200, out); }
  if (url.pathname === '/api/passport/publish' && method === 'POST') { if (!requireAgent(owner, res)) return; E.setPublicProfile(owner.agent, body.public !== false); save(id, owner); return json(res, 200, { ok: true, public: owner.agent.publicProfile, passportUrl: `${PUBLIC_ORIGIN}/passport/${owner.agent.id}`, agentState: E.publicAgent(owner.agent) }); }
  if (url.pathname === '/api/recap/open' && method === 'POST') { if (!requireAgent(owner, res)) return; owner.analytics ||= {}; owner.analytics.recapOpens = (owner.analytics.recapOpens || 0) + 1; owner.analytics.lastRecapAt = Date.now(); save(id, owner); return json(res, 200, { ok: true }); }
  return apiError(res, 404, 'Not found.', 'not_found');
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function publicPage({ title, eyebrow, headline, detail, stats = [], cta = '/', ctaLabel = 'Enter KULT World', secondaryCta = null, secondaryLabel = null, canonicalPath = '/', ogImage = '/og/season.png', extra = '' }) {
  const safeTitle = escapeHtml(title); const description = escapeHtml(detail); const imageUrl = String(ogImage).startsWith('http') ? String(ogImage) : `${PUBLIC_ORIGIN}${ogImage}`;
  const statMarkup = stats.map(stat => `<div class="public-stat"><b>${escapeHtml(stat.value)}</b><span>${escapeHtml(stat.label)}</span></div>`).join('');
  const secondary = secondaryCta ? `<a class="public-secondary" href="${escapeHtml(secondaryCta)}">${escapeHtml(secondaryLabel || 'View details')} →</a>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><meta name="description" content="${description}"><meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${description}"><meta property="og:type" content="website"><meta property="og:image" content="${escapeHtml(imageUrl)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${safeTitle}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${escapeHtml(imageUrl)}"><link rel="canonical" href="${escapeHtml(`${PUBLIC_ORIGIN}${canonicalPath}`)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/public.css"></head><body><main class="public-shell"><a class="wordmark" href="/">KULT <span>WORLD</span></a><section class="public-card"><div class="public-orbit"></div><p class="public-eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(headline)}</h1><p class="public-detail">${description}</p>${statMarkup ? `<div class="public-stats">${statMarkup}</div>` : ''}<div class="public-actions"><a class="public-cta" href="${escapeHtml(cta)}">${escapeHtml(ctaLabel)} <span>→</span></a>${secondary}</div>${extra}<p class="public-proof">Every evolution is earned · Every proof is verifiable · Robinhood Chain</p></section></main></body></html>`;
}
function sendHtml(res, status, html) { const body = Buffer.from(html); res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=60', ...securityHeaders() }); res.end(body); }
function sendPng(res, status, body) { res.writeHead(status, { 'Content-Type': 'image/png', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400', ...securityHeaders() }); res.end(body); }
function ogPath(kind, id = '') { return `/og/${kind}${id ? `/${encodeURIComponent(id)}` : ''}.png`; }
function proofMarkup(passport) {
  const rows = passport.proofs.map(proof => `<article class="verify-row"><div class="verify-status ${proof.status.toLowerCase()}">${escapeHtml(proof.status.replaceAll('_', ' '))}</div><div><b>${escapeHtml(proof.title)}</b><span>${escapeHtml(proof.cap)} · ${escapeHtml(proof.outcome)} · difficulty ${escapeHtml(proof.difficulty)}</span><code>${escapeHtml(proof.evidenceHash || 'Evidence hash pending')}</code></div>${proof.txHash ? `<a href="${escapeHtml(`${ROBINHOOD.explorerUrl}/tx/${proof.txHash}`)}" target="_blank" rel="noreferrer">TX ↗</a>` : '<em>LOCAL</em>'}</article>`).join('');
  return `<section class="verify-panel"><div class="verify-head"><div><small>SEASON RULES COMMITMENT</small><code>${escapeHtml(passport.verification.seasonManifestHash)}</code></div><a href="/season/01">View manifest →</a></div><div class="verify-list">${rows || '<div class="verify-empty">No public receipts have been created yet.</div>'}</div><p class="verify-note">Recorded means KULT stored the outcome. Anchored means its evidence hash was published by the Agent wallet. Issuer verified is reserved for an authorized external issuer.</p></section>`;
}
function serveOgRoute(res, url) {
  let data;
  const momentMatch = /^\/og\/moment\/([^/]+)\.png$/.exec(url.pathname);
  const passportMatch = /^\/og\/passport\/([^/]+)\.png$/.exec(url.pathname);
  const challengeMatch = /^\/og\/challenge\/([^/]+)\.png$/.exec(url.pathname);
  if (momentMatch) {
    const card = G.publicCard(store.getWorld().shareCards?.[decodeSegment(momentMatch[1])]); if (!card) return sendPng(res, 404, OG.renderCard({ eyebrow: 'LOST SIGNAL', title: 'MOMENT NOT FOUND' }));
    data = { eyebrow: card.anchored ? 'ONCHAIN AGENT MOMENT' : `${card.evolution?.label || 'EARNED'} AGENT MOMENT`, title: card.headline, detail: card.sub, accent: card.color, accent2: card.accent, stats: [{ value: card.score ?? '-', label: card.cap || 'score' }, { value: card.evidence ?? '-', label: 'outcomes' }, { value: card.anchored ? 'ANCHORED' : 'RECORDED', label: 'proof' }] };
  } else if (passportMatch) {
    const agent = findPublicAgent(decodeSegment(passportMatch[1])); if (!agent) return sendPng(res, 404, OG.renderCard({ eyebrow: 'PRIVATE PASSPORT', title: 'THIS AGENT IS PRIVATE' }));
    const passport = publicPassport(agent); const best = [...passport.capabilities].sort((a, b) => b.score - a.score)[0];
    data = { eyebrow: `${passport.persona} AGENT PASSPORT`, title: `${passport.name} IS ${passport.evolution.label}`, detail: passport.blurb, accent: passport.color, accent2: passport.accent, stats: [{ value: passport.overall ?? '-', label: 'overall' }, { value: best?.score ?? '-', label: best?.cap || 'capability' }, { value: passport.verification.anchored, label: 'anchored proofs' }] };
  } else if (challengeMatch) {
    const challenge = G.getChallenge(store, decodeSegment(challengeMatch[1])); if (!challenge) return sendPng(res, 404, OG.renderCard({ eyebrow: 'CHALLENGE CLOSED', title: 'THE SIGNAL HAS FADED' }));
    const view = G.publicChallenge(challenge); data = { eyebrow: 'OPEN AGENT CHALLENGE', title: `CAN YOU BEAT ${view.challengerAgentName}`, detail: `${view.cap} benchmark backed by ${view.targetEvidence} outcomes`, accent: view.color, stats: [{ value: view.targetScore, label: `${view.cap} target` }, { value: view.accepted, label: 'accepted' }, { value: view.beaten, label: 'beat it' }] };
  } else if (url.pathname === '/og/season.png') {
    const town = townSquare(); data = { eyebrow: 'KULT WORLD SEASON 01', title: Season.MANIFEST.title, detail: Season.MANIFEST.promise, stats: [{ value: town.world.contributors, label: 'contributors' }, { value: town.world.creatorCount, label: 'creators' }, { value: town.season.commitment.status === 'ONCHAIN' ? 'ONCHAIN' : 'COMMIT', label: 'season rules' }] };
  } else return false;
  return sendPng(res, 200, OG.renderCard(data));
}
function servePublicRoute(res, url) {
  if (url.pathname.startsWith('/s/')) {
    const card = G.publicCard(store.getWorld().shareCards?.[decodeSegment(url.pathname.slice(3))]);
    if (!card) return sendHtml(res, 404, publicPage({ title: 'Moment not found · KULT World', eyebrow: 'LOST SIGNAL', headline: 'This moment is no longer here.', detail: 'Enter KULT World and create a new story.', ctaLabel: 'Enter the World' }));
    return sendHtml(res, 200, publicPage({ title: `${card.agentName} · KULT World`, eyebrow: card.anchored ? 'ON-CHAIN MOMENT' : `${card.evolution?.label || 'EARNED'} AGENT MOMENT`, headline: card.headline, detail: card.sub, stats: [{ value: card.score ?? '—', label: card.cap ? `${card.cap} score` : 'score' }, { value: card.evidence ?? '—', label: 'outcomes' }, { value: card.anchored ? 'ANCHORED' : 'RECORDED', label: 'proof' }], cta: '/', ctaLabel: 'Raise your own Agent', secondaryCta: `/passport/${encodeURIComponent(card.agentId)}`, secondaryLabel: 'View Agent Passport', canonicalPath: `/s/${encodeURIComponent(card.slug)}`, ogImage: ogPath('moment', card.slug) }));
  }
  if (url.pathname.startsWith('/c/')) {
    const challenge = G.getChallenge(store, decodeSegment(url.pathname.slice(3)));
    if (!challenge) return sendHtml(res, 404, publicPage({ title: 'Challenge not found · KULT World', eyebrow: 'CHALLENGE CLOSED', headline: 'That signal has faded.', detail: 'A new rival is waiting in KULT World.' }));
    const view = G.publicChallenge(challenge);
    return sendHtml(res, 200, publicPage({ title: `${view.challengerAgentName}'s challenge · KULT World`, eyebrow: view.expired ? 'CHALLENGE ENDED' : 'OPEN CHALLENGE', headline: `Can your Agent beat ${view.challengerAgentName}?`, detail: `Prove a ${view.cap} score above ${view.targetScore} with at least four recorded outcomes.`, stats: [{ value: view.targetScore, label: `${view.cap} target` }, { value: view.accepted, label: 'accepted' }, { value: view.beaten, label: 'beat it' }], cta: view.expired ? '/' : `/?challenge=${encodeURIComponent(view.id)}`, ctaLabel: view.expired ? 'Find a new challenge' : 'Accept the challenge', canonicalPath: `/c/${encodeURIComponent(view.id)}`, ogImage: ogPath('challenge', view.id) }));
  }
  if (url.pathname.startsWith('/passport/')) {
    const agent = findPublicAgent(decodeSegment(url.pathname.slice('/passport/'.length)));
    if (!agent) return sendHtml(res, 404, publicPage({ title: 'Private Passport · KULT World', eyebrow: 'PRIVATE PASSPORT', headline: 'This Agent has not published yet.', detail: 'Agent owners decide when their growth becomes public.' }));
    const passport = publicPassport(agent); const best = [...passport.capabilities].sort((a, b) => b.score - a.score)[0];
    return sendHtml(res, 200, publicPage({ title: `${passport.name}'s Agent Passport · KULT World`, eyebrow: `${passport.persona} · ${passport.evolution.label.toUpperCase()} AGENT`, headline: `${passport.name} is becoming ${passport.trait}.`, detail: passport.blurb, stats: [{ value: passport.overall ?? '—', label: 'overall' }, { value: best?.score ?? '—', label: best ? best.cap : 'best capability' }, { value: passport.anchoredProofs.length, label: 'on-chain proofs' }], cta: '/', ctaLabel: 'Raise your own Agent', secondaryCta: `/verify/${encodeURIComponent(passport.id)}`, secondaryLabel: 'Verify evidence', canonicalPath: `/passport/${encodeURIComponent(passport.id)}`, ogImage: ogPath('passport', passport.id) }));
  }
  if (url.pathname.startsWith('/verify/')) {
    const agent = findPublicAgent(decodeSegment(url.pathname.slice('/verify/'.length)));
    if (!agent) return sendHtml(res, 404, publicPage({ title: 'Verification unavailable · KULT World', eyebrow: 'PRIVATE RECORD', headline: 'This evidence history is not public.', detail: 'Agent owners choose when to publish their Passport and proof history.' }));
    const passport = publicPassport(agent);
    return sendHtml(res, 200, publicPage({ title: `Verify ${passport.name} · KULT World`, eyebrow: 'PUBLIC PROVENANCE', headline: `${passport.name}'s history can be checked.`, detail: 'Every visible status has a precise meaning. Recorded evidence stays distinct from self-attested anchors and authorized issuer receipts.', stats: [{ value: passport.verification.recorded, label: 'recorded' }, { value: passport.verification.anchored, label: 'anchored' }, { value: passport.verification.issuerVerified, label: 'issuer verified' }], cta: `/passport/${encodeURIComponent(passport.id)}`, ctaLabel: 'View Passport', secondaryCta: '/season/01', secondaryLabel: 'Inspect season rules', canonicalPath: `/verify/${encodeURIComponent(passport.id)}`, ogImage: ogPath('passport', passport.id), extra: proofMarkup(passport) }));
  }
  if (url.pathname === '/season/01') {
    const town = townSquare(); const season = town.season;
    const extra = `<section class="season-manifest"><div><small>IMMUTABLE RULES HASH</small><code>${escapeHtml(season.manifestHash)}</code></div><div class="season-rules">${season.rules.map(rule => `<p>✓ ${escapeHtml(rule)}</p>`).join('')}</div>${season.commitment.explorerUrl ? `<a href="${escapeHtml(season.commitment.explorerUrl)}" target="_blank" rel="noreferrer">Inspect commitment transaction ↗</a>` : '<em>Commit this manifest before public launch.</em>'}</section>`;
    return sendHtml(res, 200, publicPage({ title: 'Season 01 · KULT World', eyebrow: `SEASON 01 · ${season.phase.replaceAll('_', ' ')}`, headline: season.title, detail: season.promise, stats: [{ value: town.world.contributors, label: 'contributors' }, { value: town.world.creatorCount, label: 'public creators' }, { value: season.commitment.status, label: 'rules commitment' }], cta: '/', ctaLabel: 'Enter KULT World', canonicalPath: '/season/01', ogImage: ogPath('season'), extra }));
  }
  return false;
}
function serveStatic(req, res, url) {
  let rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''); rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, ''); let file = path.join(STATIC, rel);
  if (!file.startsWith(STATIC)) return apiError(res, 403, 'Forbidden.', 'forbidden'); if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(STATIC, 'index.html');
  const body = fs.readFileSync(file); const immutable = /\.[a-f0-9]{8,}\./.test(path.basename(file)); const cache = file.endsWith('.html') ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  res.writeHead(200, { 'Content-Type': mime(file), 'Content-Length': body.length, 'Cache-Control': PRODUCTION ? cache : 'no-cache', ...securityHeaders() }); res.end(body);
}
const server = http.createServer(async (req, res) => {
  const started=Date.now(); inflightRequests += 1;
  const requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(String(req.headers['x-request-id'] || '')) ? String(req.headers['x-request-id']) : crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  let pathname='/'; try { pathname=new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; } catch (_) {}
  res.once('finish',()=>{ inflightRequests=Math.max(0,inflightRequests-1); if(REQUEST_LOGS) console.log(JSON.stringify({type:'http',requestId,method:req.method||'GET',path:pathname,status:res.statusCode,durationMs:Date.now()-started})); });
  res.once('close',()=>{ if(!res.writableFinished) inflightRequests=Math.max(0,inflightRequests-1); });
  try { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); if (url.pathname.startsWith('/api/')) return await api(req, res, url); if (['GET', 'HEAD'].includes(req.method || 'GET') && /^\/og\//.test(url.pathname)) { const sent = serveOgRoute(res, url); if (sent !== false) return sent; } if (['GET', 'HEAD'].includes(req.method || 'GET') && (/^\/s\//.test(url.pathname) || /^\/c\//.test(url.pathname) || /^\/passport\//.test(url.pathname) || /^\/verify\//.test(url.pathname) || url.pathname === '/season/01')) return servePublicRoute(res, url); return serveStatic(req, res, url); }
  catch (error) { console.error(JSON.stringify({type:'server_error',requestId,error:error.message,stack:PRODUCTION?undefined:error.stack})); if (!res.headersSent) apiError(res, 500, 'Internal server error.', 'internal_error'); else res.end(); }
});
server.requestTimeout=REQUEST_TIMEOUT_MS; server.headersTimeout=Math.min(REQUEST_TIMEOUT_MS,15_000); server.keepAliveTimeout=5_000; server.maxRequestsPerSocket=100;
if (require.main === module) {
  const integrity=typeof store.integrityCheck==='function' ? store.integrityCheck() : {ok:true};
  if(integrity.ok===false) throw new Error(`Persistence integrity check failed: ${integrity.error || integrity.check || 'unknown'}`);
  server.listen(PORT, () => console.log(JSON.stringify({type:'startup',service:'kult-world',version:VERSION,port:PORT,persistence:PERSISTENCE_MODE,intelligence:Intelligence.health().mode,marketAdapter:MARKET_ADAPTER_MODE,marketAccess:effectiveMarketAccess(),releaseScope:'public-beta-demo'})));
  const shutdown = signal => {
    if(draining)return; draining=true;
    console.log(JSON.stringify({type:'shutdown',signal,inflightRequests}));
    const timer = setTimeout(() => { try { server.closeAllConnections?.(); } catch (_) {} process.exit(1); }, 12_000); timer.unref();
    server.close(() => { try { store.checkpoint?.('TRUNCATE'); store.close?.(); } catch (_) {} clearTimeout(timer); process.exit(0); });
    try { server.closeIdleConnections?.(); } catch (_) {}
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
module.exports = { server, store, ownerIdForToken, newSessionToken, publicPassport, publicProof, townSquare, readinessView, recoveryView };
