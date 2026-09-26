'use strict';

const crypto = require('crypto');
const PerpsGame = require('./perps-game');

const INSTRUMENTS = {
  BTC: 'BTC-USDT-SWAP',
  ETH: 'ETH-USDT-SWAP',
  SOL: 'SOL-USDT-SWAP',
};

const POLICY = Object.freeze({
  maxLeverage: 3,
  maxPositionPct: 0.05,
  maxPositionUsd: 500,
  minPositionUsd: 10,
  dailyLossPct: 0.04,
  marginMode: 'cross',
  sizeMode: 'quote_ccy',
  instruments: Object.values(INSTRUMENTS),
  demoOnly: true,
  explicitExecutionConfirmation: true,
  oneActiveBattle: true,
  preparedTtlMs: 60_000,
  waitObservationMs: 5 * 60_000,
});

// Direct module calls (tests/local simulation) use an in-process fallback lease.
// Server execution injects durable store-backed lease hooks. Leases never expire
// merely because time passed: they are released only after a verified flat state.
let executionLease = null;

function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function hashId(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function utcDay(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isAgentKit(adapter) { return adapter?.profile !== 'local-sim'; }
function acquireExecutionLease(battleId) {
  if (executionLease && executionLease.battleId !== battleId) return false;
  executionLease = executionLease || { battleId, acquiredAt: Date.now() };
  executionLease.heartbeatAt = Date.now();
  return true;
}
function releaseExecutionLease(battleId) { if (executionLease?.battleId === battleId) executionLease = null; }
function executionLeaseState() { return executionLease ? clone(executionLease) : null; }
async function hookPersist(hooks, stage, battle) { if (typeof hooks?.persist === 'function') await hooks.persist(stage, battle); }
async function hookAcquire(hooks, battleId) {
  if (typeof hooks?.acquireLease === 'function') return Boolean(await hooks.acquireLease(battleId));
  return acquireExecutionLease(battleId);
}
async function hookRelease(hooks, battleId) {
  if (typeof hooks?.releaseLease === 'function') return Boolean(await hooks.releaseLease(battleId));
  releaseExecutionLease(battleId); return true;
}

function permissionState(owner, requested = null) {
  owner.marketPermission ||= {
    domain: 'market_demo',
    status: 'enabled',
    demoOnly: true,
    publicCapabilityEffect: 'none',
    updatedAt: Date.now(),
  };
  if (requested && ['enabled','paused','disabled'].includes(requested)) {
    owner.marketPermission.status = requested;
    owner.marketPermission.updatedAt = Date.now();
  }
  return clone(owner.marketPermission);
}

function requireMarketPermission(owner, action, serverStatus = 'enabled') {
  const local = permissionState(owner);
  // Environment status is a ceiling. Application state can only further
  // restrict access, never override an operator pause/disable.
  const severity = { enabled: 0, paused: 1, disabled: 2 };
  const server = ['enabled','paused','disabled'].includes(serverStatus) ? serverStatus : 'disabled';
  const status = severity[server] >= severity[local.status] ? server : local.status;
  if (status === 'disabled') return { ok:false, code:'market_disabled', error:'Perp Wars is disabled for this deployment.' };
  if (status === 'paused' && ['prepare','execute'].includes(action)) return { ok:false, code:'market_paused', error:'Perp Wars is paused. New demo positions are blocked; existing positions may still be closed and reconciled.' };
  return { ok:true, status, permission:local };
}

function normalizeCandles(candles) {
  return (candles || []).map(row => {
    if (Array.isArray(row)) return { ts: num(row[0]), open: num(row[1]), high: num(row[2]), low: num(row[3]), close: num(row[4]) };
    return { ts: num(row.ts), open: num(row.o ?? row.open), high: num(row.h ?? row.high), low: num(row.l ?? row.low), close: num(row.c ?? row.close) };
  }).filter(x => x.close > 0).sort((a, b) => a.ts - b.ts);
}

function deriveSignals(snapshot) {
  const candles = normalizeCandles(snapshot.candles);
  const last = snapshot.ticker.last || candles.at(-1)?.close || 0;
  // A 30m lookback on 5m candles is six intervals. Older builds used the full
  // 12-candle sample while labelling it 30m; keep the label honest here.
  const thirtyIndex = Math.max(0, candles.length - 7);
  const fifteenIndex = Math.max(0, candles.length - 4);
  const thirty = candles[thirtyIndex]?.close || candles[0]?.close || last;
  const fifteen = candles[fifteenIndex]?.close || thirty;
  const momentum30m = thirty ? (last / thirty - 1) : 0;
  const momentum15m = fifteen ? (last / fifteen - 1) : 0;
  const funding = num(snapshot.funding?.rate);
  const bid = num(snapshot.ticker?.bid), ask = num(snapshot.ticker?.ask);
  const spreadBps = bid && ask ? ((ask - bid) / ((ask + bid) / 2)) * 10000 : 0;
  const crowding = Math.max(-1, Math.min(1, funding / 0.0005));
  const trend = Math.max(-1, Math.min(1, momentum30m / 0.012));
  const shortTrend = Math.max(-1, Math.min(1, momentum15m / 0.006));
  const score = trend * .6 + shortTrend * .35 - crowding * .15;
  const noriSide = score >= 0 ? 'long' : 'short';
  const shadowSide = noriSide === 'long' ? 'short' : 'long';
  const confidence = Math.round(Math.max(54, Math.min(82, 58 + Math.abs(score) * 24)));
  const shadowConfidence = Math.round(Math.max(52, Math.min(76, 56 + Math.abs(crowding) * 14)));
  return { last, momentum30m, momentum15m, funding, spreadBps, score, noriSide, shadowSide, confidence, shadowConfidence };
}

function arenaState(owner) {
  owner.marketArena ||= {
    wins: 0, losses: 0, draws: 0,
    marketReasoning: 40, riskDiscipline: 70,
    battles: [], active: null, xlayerReceipts: [],
    daily: { day: utcDay(), realizedPnlUsd: 0, startingEquity: null },
    createdAt: Date.now(),
  };
  owner.marketArena.battles ||= [];
  owner.marketArena.xlayerReceipts ||= [];
  owner.marketArena.daily ||= { day: utcDay(), realizedPnlUsd: 0, startingEquity: null };
  if (owner.marketArena.daily.day !== utcDay()) owner.marketArena.daily = { day: utcDay(), realizedPnlUsd: 0, startingEquity: null };
  PerpsGame.ensurePerps(owner);
  return owner.marketArena;
}

function publicArena(owner) {
  const a = arenaState(owner);
  return {
    wins: a.wins, losses: a.losses, draws: a.draws,
    marketReasoning: a.marketReasoning, riskDiscipline: a.riskDiscipline,
    active: a.active,
    battles: a.battles.slice(0, 12),
    xlayerReceipts: a.xlayerReceipts.slice(0, 12),
    daily: clone(a.daily),
    perps: PerpsGame.publicPerps(owner),
  };
}

function policyCheck(arena, equity) {
  if (!POLICY.demoOnly) return { ok: false, error: 'Demo-only policy is disabled.', code: 'policy_error' };
  const daily = arena.daily;
  if (daily.startingEquity == null) daily.startingEquity = equity;
  const base = Math.max(1, num(daily.startingEquity, equity));
  const lossLimitUsd = base * POLICY.dailyLossPct;
  if (num(daily.realizedPnlUsd) <= -lossLimitUsd) {
    return { ok: false, error: `Daily KULT Perp Wars loss cap reached ($${lossLimitUsd.toFixed(2)}). Try again tomorrow.`, code: 'daily_loss_cap' };
  }
  return { ok: true, lossLimitUsd, dailyRealizedPnlUsd: num(daily.realizedPnlUsd) };
}

function equityFor(adapter, account) {
  if (num(account?.equity) > 0) return num(account.equity);
  if (isAgentKit(adapter)) return 0;
  return 10000;
}

async function prepare(owner, agent, adapter, symbol, options = {}) {
  const canonicalSymbol = String(symbol || 'BTC').toUpperCase();
  const instId = INSTRUMENTS[canonicalSymbol];
  if (!instId) return { error: 'Unsupported market.', code: 'invalid_market' };
  const arena = arenaState(owner);
  if (arena.active && !['resolved', 'cancelled', 'abstained', 'rejected'].includes(arena.active.status)) return { error: 'Resolve or close the current raid first.', code: 'battle_active' };

  const [snapshot, account] = await Promise.all([adapter.marketSnapshot(instId), adapter.accountSnapshot(instId)]);
  const open = (account.positions || []).filter(p => String(p.instId || '') === instId && Math.abs(num(p.pos ?? p.position ?? p.sz)) > 0);
  if (open.length) return { error: `${instId} already has an open demo position. Close it in OKX before starting a new KULT raid.`, code: 'existing_position' };

  const equity = equityFor(adapter, account);
  if (!(equity > 0)) return { error: 'OKX demo-account equity is unavailable. Execution is blocked until account state can be verified.', code: 'account_equity_unavailable' };
  const policy = policyCheck(arena, equity);
  if (!policy.ok) return policy;
  const notionalUsd = Math.max(POLICY.minPositionUsd, Math.min(POLICY.maxPositionUsd, Math.floor(equity * POLICY.maxPositionPct * 100) / 100));
  const signals = deriveSignals(snapshot);
  if (!(signals.last > 0)) return { error: 'No usable OKX market price was returned.', code: 'market_price_unavailable' };
  if (signals.spreadBps > 50) return { error: `Market spread is too wide (${signals.spreadBps.toFixed(2)} bps).`, code: 'spread_guard' };

  const rival = PerpsGame.chooseRival(owner, options.rivalId);
  const playerDecision = PerpsGame.buildPlayerDecision(agent, owner, signals);
  const rivalDecision = PerpsGame.buildRivalDecision(rival.id, signals);
  const preparedAt = Date.now();
  const battle = {
    id: `mb_${preparedAt.toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    status: 'prepared', symbol: canonicalSymbol, instId,
    createdAt: preparedAt, preparedAt, expiresAt: preparedAt + POLICY.preparedTtlMs,
    marketSource: snapshot.source,
    equity, notionalUsd, leverage: POLICY.maxLeverage, marginMode: POLICY.marginMode, sizeMode: POLICY.sizeMode,
    positionMode: account.positionMode || 'net_mode',
    entryReference: signals.last, funding: signals.funding, spreadBps: signals.spreadBps,
    signals: { momentum30m: signals.momentum30m, momentum15m: signals.momentum15m, funding: signals.funding, spreadBps: signals.spreadBps, score: signals.score },
    nori: { ...playerDecision, side: playerDecision.side || signals.noriSide },
    shadow: { side: rivalDecision.side || signals.shadowSide, confidence: rivalDecision.signalStrength, thesis: rivalDecision.thesis },
    rival: rivalDecision,
    policy: { ...POLICY, dailyLossLimitUsd: policy.lossLimitUsd, dailyRealizedPnlUsd: policy.dailyRealizedPnlUsd },
    agentId: agent.id, agentName: agent.name,
    execution: null, result: null,
  };
  arena.active = battle;
  return { battle, arena: publicArena(owner), snapshot: { ticker: snapshot.ticker, funding: snapshot.funding, source: snapshot.source } };
}

async function execute(owner, agent, adapter, battleId, hooks = {}) {
  const arena = arenaState(owner), b = arena.active;
  if (!b || b.id !== battleId) return { error: 'Raid not found.', code: 'battle_not_found' };
  if (b.status !== 'prepared') return { error: 'Raid is not ready to execute.', code: 'battle_state' };
  if (Date.now() > num(b.expiresAt)) return { error: 'The prepared market thesis expired. Prepare again with fresh market data.', code: 'battle_expired' };
  if (!POLICY.demoOnly || adapter.demoOnly !== true) return { error: 'Live trading is disabled in this build.', code: 'live_execution_disabled' };
  if (b.agentId !== agent.id) return { error: 'Raid does not belong to this Agent.', code: 'agent_mismatch' };
  if (b.nori?.action === 'wait') return { error: 'Your Agent recommends WAIT. Start the observation round instead of executing.', code: 'agent_recommends_wait' };

  // Read-only checks happen before an execution intent is written.
  const account = await adapter.accountSnapshot(b.instId);
  const equity = equityFor(adapter, account);
  if (!(equity > 0)) return { error: 'OKX demo-account equity is unavailable. Execution is blocked.', code: 'account_equity_unavailable' };
  const policy = policyCheck(arena, equity); if (!policy.ok) return policy;
  const currentOpen = (account.positions || []).filter(p => String(p.instId || '') === b.instId && Math.abs(num(p.pos ?? p.position ?? p.sz)) > 0);
  if (currentOpen.length) return { error: `${b.instId} already has an open demo position.`, code: 'existing_position' };
  const fresh = await adapter.marketSnapshot(b.instId);
  const freshSignals = deriveSignals(fresh);
  if (freshSignals.spreadBps > 50) return { error: `Market spread widened to ${freshSignals.spreadBps.toFixed(2)} bps. Prepare again later.`, code: 'spread_guard' };
  const moveBps = b.entryReference ? Math.abs(freshSignals.last / b.entryReference - 1) * 10000 : 0;
  if (moveBps > 50) return { error: `Market moved ${moveBps.toFixed(1)} bps since preparation. Refresh the Agent thesis first.`, code: 'stale_thesis' };

  if (isAgentKit(adapter) && !(await hookAcquire(hooks, b.id))) return { error: 'The shared OKX demo execution rail is busy with another raid. Reconcile it before starting a new position.', code: 'execution_rail_busy' };

  b.status = 'executing';
  b.execution ||= {};
  b.execution.clOrdId = b.execution.clOrdId || `kult${hashId(b.id).slice(0, 20)}`;
  b.execution.intentAt = Date.now();
  b.execution.intentPersisted = true;
  try {
    // Critical saga boundary: this exact intent marker must be durable before the external write.
    await hookPersist(hooks, 'executing', b);
    const side = b.nori.side === 'long' ? 'buy' : 'sell';
    const placed = await adapter.placeSwap({
      instId: b.instId, side, notionalUsd: b.notionalUsd,
      positionMode: b.positionMode, leverage: b.leverage, clientId: b.execution.clOrdId,
    });
    if (placed.sCode && String(placed.sCode) !== '0') {
      b.status = 'rejected'; b.execution.error = placed.sMsg || 'OKX rejected the demo order.'; b.rejectedAt=Date.now();
      arena.battles.unshift(clone(b)); arena.battles=arena.battles.slice(0,30); arena.active=null;
      await hookPersist(hooks, 'rejected', b); if (isAgentKit(adapter)) await hookRelease(hooks, b.id);
      return { error:b.execution.error, code:'order_rejected', arena:publicArena(owner) };
    }
    if (!placed.reconciled) {
      b.status = 'recovery_required'; b.execution.error = 'Demo order could not be reconciled with an exact order/position.';
      await hookPersist(hooks, 'recovery_required', b);
      return { error:b.execution.error, code:'execution_unreconciled' };
    }
    const snapshot = await adapter.marketSnapshot(b.instId);
    const entryPrice = num(placed.entryPrice, snapshot.ticker.last);
    if (!(entryPrice > 0)) {
      b.status='recovery_required'; b.execution.error='Unable to confirm entry fill price.'; await hookPersist(hooks,'recovery_required',b);
      return { error:b.execution.error, code:'entry_price_unavailable' };
    }
    b.status = 'active'; b.executedAt = Date.now();
    b.execution = { ...b.execution, adapter:snapshot.source, ordId:placed.ordId, clOrdId:placed.clOrdId || b.execution.clOrdId, side, entryPrice, rawStatus:'reconciled' };
    await hookPersist(hooks, 'active', b);
    return { battle:b, arena:publicArena(owner) };
  } catch (error) {
    b.status = 'recovery_required'; b.execution.error = error.message;
    try { await hookPersist(hooks, 'recovery_required', b); } catch (_) {}
    // Do not release a real-account lease after an ambiguous external failure.
    if (!isAgentKit(adapter)) await hookRelease(hooks, b.id);
    throw error;
  }
}

async function abstain(owner, agent, adapter, battleId, options = {}) {
  const arena = arenaState(owner), b = arena.active;
  if (!b || b.id !== battleId) return { error: 'Raid not found.', code: 'battle_not_found' };
  if (b.status !== 'prepared') return { error: 'Only a prepared raid can enter WAIT observation.', code: 'battle_state' };
  if (b.agentId !== agent.id) return { error: 'Raid does not belong to this Agent.', code: 'agent_mismatch' };
  const now = Number(options.now ?? Date.now());
  const accelerated = options.accelerated === true || String(process.env.KULT_WAIT_ACCELERATED || '').toLowerCase() === 'true';
  const durationMs = Number(options.durationMs) > 0 ? Number(options.durationMs) : accelerated ? Math.max(8_000, Number(process.env.KULT_WAIT_ACCELERATED_MS || 12_000)) : POLICY.waitObservationMs;
  b.nori.action = 'wait'; b.nori.side = null;
  b.status = 'observing'; b.observationStartedAt = now; b.observationEndsAt = now + durationMs;
  b.observation = { durationMs, entryPrice:num(b.entryReference), rivalAction:b.rival?.action || 'wait' };
  await hookPersist(options, 'observing', b);
  return { battle:b, arena:publicArena(owner), observation:{ endsAt:b.observationEndsAt, durationMs } };
}

async function close(owner, agent, adapter, battleId, hooks = {}) {
  const arena = arenaState(owner), b = arena.active;
  if (!b || b.id !== battleId) return { error: 'Raid not found.', code: 'battle_not_found' };
  if (b.status !== 'active') return { error: 'Only an active demo position can be closed.', code: 'battle_state' };
  if (b.agentId !== agent.id) return { error: 'Raid does not belong to this Agent.', code: 'agent_mismatch' };
  if (adapter.demoOnly !== true) return { error: 'Live trading is disabled in this build.', code: 'live_execution_disabled' };
  b.status = 'closing'; b.closeIntentAt = Date.now();
  await hookPersist(hooks, 'closing', b);
  try {
    const closed = await adapter.closeSwap({ instId:b.instId, positionMode:b.positionMode, side:b.execution.side });
    if (!closed.positionClosed) {
      b.status='recovery_required'; b.close={ ...(b.close||{}), error:'Demo position did not reconcile as closed.' }; await hookPersist(hooks,'recovery_required',b);
      return { error:b.close.error, code:'position_still_open' };
    }
    b.status='closed'; b.closedAt=Date.now(); b.close={ ordId:closed.ordId||null, exitPrice:num(closed.exitPrice), reconciled:Boolean(closed.reconciled), positionClosed:true };
    await hookPersist(hooks,'closed',b); if (isAgentKit(adapter)) await hookRelease(hooks,b.id);
    return { battle:b, arena:publicArena(owner) };
  } catch(error) {
    b.status='recovery_required'; b.close={ ...(b.close||{}), error:error.message }; try { await hookPersist(hooks,'recovery_required',b); } catch(_) {}
    throw error;
  }
}

async function reconcile(owner, agent, adapter, battleId, hooks = {}) {
  const arena = arenaState(owner), b = arena.active;
  if (!b || b.id !== battleId) return { error:'Raid not found.', code:'battle_not_found' };
  if (!['active','closed','executing','closing','recovery_required'].includes(b.status)) return { error:'Raid is not awaiting position reconciliation.', code:'battle_state' };
  if (b.agentId !== agent.id) return { error:'Raid does not belong to this Agent.', code:'agent_mismatch' };

  let attribution = null;
  if (b.execution?.clOrdId && typeof adapter.reconcileOrder === 'function') {
    try { attribution = await adapter.reconcileOrder({ instId:b.instId, clOrdId:b.execution.clOrdId, ordId:b.execution.ordId || null }); } catch (_) { attribution = null; }
  }
  const account = await adapter.accountSnapshot(b.instId);
  const open = (account.positions || []).filter(p => String(p.instId || '') === b.instId && Math.abs(num(p.pos ?? p.position ?? p.sz)) > 0);
  if (open.length) {
    if (isAgentKit(adapter) && !attribution?.found) {
      b.status='recovery_required'; b.execution ||= {}; b.execution.error='An open position exists but exact clOrdId/ordId attribution is not confirmed.'; await hookPersist(hooks,'recovery_required',b);
      return { error:b.execution.error, code:'execution_attribution_unconfirmed', battle:b };
    }
    b.status='active';
    if (attribution?.ordId) b.execution.ordId=attribution.ordId;
    if (attribution?.entryPrice) b.execution.entryPrice=attribution.entryPrice;
    if (isAgentKit(adapter)) await hookAcquire(hooks,b.id);
    await hookPersist(hooks,'active',b);
    return { error:'OKX Demo still reports an open position.', code:'position_still_open', battle:b };
  }

  if (isAgentKit(adapter) && ['executing','recovery_required'].includes(b.status) && b.execution?.intentPersisted && !attribution?.found) {
    b.status='recovery_required'; b.execution.error='The account is flat, but the execution intent cannot be matched to an exact OKX order.'; await hookPersist(hooks,'recovery_required',b);
    return { error:b.execution.error, code:'execution_attribution_unconfirmed', battle:b };
  }
  if (b.status !== 'closed') {
    const snapshot=await adapter.marketSnapshot(b.instId); b.status='closed'; b.closedAt=Date.now();
    b.close={ ordId:b.close?.ordId||null, exitPrice:num(b.close?.exitPrice,snapshot.ticker.last), reconciled:true, positionClosed:true, recovered:true, attribution:attribution?.found?'exact-order':'flat-account' };
  }
  await hookPersist(hooks,'closed',b); if (isAgentKit(adapter)) await hookRelease(hooks,b.id);
  return { battle:b, arena:publicArena(owner), reconciled:true, attribution:attribution?.found?'exact-order':'flat-account' };
}

async function resolve(owner, agent, adapter, battleId, hooks = {}) {
  const arena = arenaState(owner), b = arena.active;
  if (!b || b.id !== battleId) return { error:'Raid not found.', code:'battle_not_found' };
  if (b.agentId !== agent.id) return { error:'Raid does not belong to this Agent.', code:'agent_mismatch' };

  // WAIT is a timed observation battle: the player stays flat while the rival's
  // virtual policy is evaluated over the same market horizon. No instant draw.
  if (b.status === 'observing') {
    const now=Date.now();
    if (now < num(b.observationEndsAt)) return { error:'WAIT observation is still running.', code:'observation_running', remainingMs:num(b.observationEndsAt)-now, battle:b };
    const after=await adapter.marketSnapshot(b.instId); const entry=num(b.entryReference), exitPrice=num(after.ticker?.last);
    if (!(entry>0 && exitPrice>0)) return { error:'Unable to settle WAIT observation.', code:'market_price_unavailable' };
    const rivalPnl=PerpsGame.virtualPnl(b.rival,entry,exitPrice,b.notionalUsd); const playerPnl=0;
    const progression=PerpsGame.progressBattle(owner,b,playerPnl,rivalPnl); const duelOutcome=progression.duelOutcome;
    if (duelOutcome==='win') arena.wins++; else if (duelOutcome==='loss') arena.losses++; else arena.draws++;
    arena.riskDiscipline=Math.min(100,arena.riskDiscipline+(duelOutcome==='win'?2:1)); arena.marketReasoning=Math.min(100,arena.marketReasoning+1);
    b.status='resolved'; b.resolvedAt=now; b.result={ outcome:duelOutcome, duelOutcome, entryPrice:entry, exitPrice, pnlUsd:0, rivalPnlUsd:rivalPnl, returnPct:0, tradeHash:`0x${hashId(`${b.id}|WAIT_OBSERVATION|${entry}|${exitPrice}|${rivalPnl.toFixed(8)}`)}`, receiptSchema:'KULT_WAIT_OBSERVATION_V1', executionReconciled:true, noTrade:true, passportCapabilityChanged:false, worldEvolutionChanged:false, progression, reflection:PerpsGame.reflection(b,progression) };
    arena.battles.unshift(clone(b)); arena.battles=arena.battles.slice(0,30); arena.active=null;
    agent.memory ||= []; agent.memory.push({ type:'market-arena',place:'Market Citadel',district:'market',cap:'analysis',trustClass:'WORLD_EXPERIENCE',outcome:duelOutcome,createdAt:now,context:{ symbol:b.symbol,action:'wait',rivalAction:b.rival?.action,entryPrice:entry,exitPrice },text:`${agent.name} chose WAIT in a ${b.symbol} Perp Wars observation. ${b.rival?.name||'The rival'} ${duelOutcome==='win'?'lost edge while the Agent stayed flat':duelOutcome==='loss'?'captured more edge than staying flat':'finished effectively even with staying flat'}.` }); agent.memory=agent.memory.slice(-80);
    await hookPersist(hooks,'resolved',b);
    return { battle:b, arena:publicArena(owner), agentMemoryAdded:true };
  }

  if (['active','closing','executing','recovery_required'].includes(b.status)) return { error:'Position may still be open. Close and reconcile the OKX Demo position before resolving.', code:'position_still_open' };
  if (b.status !== 'closed') return { error:'Only a closed, reconciled raid can be resolved.', code:'battle_state' };
  if (adapter.demoOnly !== true) return { error:'Live trading is disabled in this build.', code:'live_execution_disabled' };

  const account=await adapter.accountSnapshot(b.instId); const open=(account.positions||[]).filter(p=>String(p.instId||'')===b.instId&&Math.abs(num(p.pos??p.position??p.sz))>0);
  if(open.length) return { error:'Position is still open. Resolution cannot finalize.', code:'position_still_open' };
  const after=await adapter.marketSnapshot(b.instId); const exitPrice=num(b.close?.exitPrice,after.ticker.last); const entry=num(b.execution.entryPrice||b.entryReference),direction=b.nori.side==='long'?1:-1;
  if(!(entry>0&&exitPrice>0)) return { error:'Unable to confirm execution prices.', code:'execution_price_unavailable' };
  const ret=direction*(exitPrice-entry)/entry,pnlUsd=b.notionalUsd*ret,rivalPnl=PerpsGame.virtualPnl(b.rival,entry,exitPrice,b.notionalUsd);
  let outcome='draw'; if(pnlUsd>Math.max(.01,b.notionalUsd*.00005)) outcome='win'; else if(pnlUsd<-Math.max(.01,b.notionalUsd*.00005)) outcome='loss';
  if(outcome==='win') arena.wins++; else if(outcome==='loss') arena.losses++; else arena.draws++;
  arena.marketReasoning=Math.min(100,arena.marketReasoning+(outcome==='win'?4:2)); arena.riskDiscipline=Math.min(100,arena.riskDiscipline+(outcome==='loss'?0:1)); arena.daily.realizedPnlUsd=num(arena.daily.realizedPnlUsd)+pnlUsd;
  const progression=PerpsGame.progressBattle(owner,b,pnlUsd,rivalPnl),reflect=PerpsGame.reflection(b,progression),tradeHash=`0x${hashId(`KULT_PERP_WARS_V1|${b.id}|${b.execution.ordId}|${b.execution.clOrdId}|${entry}|${exitPrice}|${pnlUsd.toFixed(8)}|${rivalPnl.toFixed(8)}`)}`;
  b.status='resolved'; b.resolvedAt=Date.now(); b.result={ outcome,duelOutcome:progression.duelOutcome,entryPrice:entry,exitPrice,pnlUsd,returnPct:ret*100,rivalPnlUsd:rivalPnl,shadowPnlUsd:rivalPnl,tradeHash,receiptSchema:'KULT_PERP_WARS_V1',executionReconciled:true,passportCapabilityChanged:false,worldEvolutionChanged:false,progression,reflection:reflect };
  arena.battles.unshift(clone(b)); arena.battles=arena.battles.slice(0,30); arena.active=null; await hookRelease(hooks,b.id);
  agent.memory ||= []; agent.memory.push({ type:'market-arena',place:'Market Citadel',district:'market',cap:'analysis',trustClass:'WORLD_EXPERIENCE',outcome,createdAt:Date.now(),context:{ symbol:b.symbol,side:b.nori.side,entryPrice:entry,exitPrice,marketSource:b.marketSource },text:`${agent.name} ${progression.duelOutcome==='win'?'won':progression.duelOutcome==='loss'?'lost':'drew'} a ${b.symbol} Perp Wars raid against ${b.rival?.name||'a rival'} after committing a ${b.nori.side} thesis. Simulated PnL: ${pnlUsd>=0?'+':''}$${pnlUsd.toFixed(2)}. Reflection: ${reflect}` }); agent.memory=agent.memory.slice(-80);
  await hookPersist(hooks,'resolved',b);
  return { battle:b,arena:publicArena(owner),agentMemoryAdded:true };
}

function cancel(owner, battleId) {
  const a = arenaState(owner), b = a.active;
  if (!b || b.id !== battleId) return { error: 'Raid not found.', code: 'battle_not_found' };
  if (['active','executing','closing','recovery_required'].includes(b.status)) return { error: 'Active/recovering demo exposure must be reconciled, not cancelled.', code: 'position_open' };
  b.status = 'cancelled'; b.cancelledAt = Date.now();
  a.battles.unshift(clone(b)); a.battles = a.battles.slice(0, 30); a.active = null;
  releaseExecutionLease(b.id);
  return { battle: b, arena: publicArena(owner) };
}

module.exports = {
  INSTRUMENTS, POLICY, deriveSignals, arenaState, publicArena,
  policyCheck, prepare, execute, abstain, close, reconcile, resolve, cancel,
  permissionState, requireMarketPermission, hashId, utcDay,
  executionLeaseState,
};
