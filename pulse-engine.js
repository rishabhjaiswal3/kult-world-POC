'use strict';

const crypto = require('crypto');
const MarketArena = require('./market-arena');
const PerpsGame = require('./perps-game');

const INSTRUMENTS = Object.freeze({ BTC:'BTC-USDT-SWAP', ETH:'ETH-USDT-SWAP', SOL:'SOL-USDT-SWAP' });
const HORIZONS = Object.freeze([5, 15, 60]);
const WAIT_BAND_BPS = Object.freeze({ 5: 12, 15: 20, 60: 35 });

function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowFrom(options) { return Number(options?.now ?? Date.now()); }
function configuredDurationMs(horizonMinutes, options = {}) {
  if (Number(options.durationMs) > 0) return Number(options.durationMs);
  const accelerated = options.accelerated === true || String(process.env.KULT_PULSE_ACCELERATED || '').toLowerCase() === 'true';
  if (!accelerated) return horizonMinutes * 60_000;
  const base = Math.max(8_000, Number(process.env.KULT_PULSE_ACCELERATED_BASE_MS || 10_000));
  return base * (horizonMinutes === 5 ? 1 : horizonMinutes === 15 ? 2 : 4);
}

function ensurePulse(owner) {
  owner.pulse ||= {
    version: 1,
    environment: 'BNB_PULSE_TEST',
    mode: 'server_simulation',
    active: null,
    history: [],
    stats: { rounds:0, correct:0, incorrect:0, flat:0, followed:0, overrides:0, waits:0, agentCorrect:0, userCorrect:0, trustScore:50 },
    createdAt: Date.now(),
  };
  owner.pulse.history ||= [];
  owner.pulse.stats ||= { rounds:0, correct:0, incorrect:0, flat:0, followed:0, overrides:0, waits:0, agentCorrect:0, userCorrect:0, trustScore:50 };
  return owner.pulse;
}

function publicPulse(owner) {
  const p = ensurePulse(owner);
  return {
    environment: p.environment,
    mode: p.mode,
    active: p.active ? clone(p.active) : null,
    history: p.history.slice(0, 12).map(clone),
    stats: clone(p.stats),
    horizons: HORIZONS,
    instruments: INSTRUMENTS,
    accelerated: String(process.env.KULT_PULSE_ACCELERATED || '').toLowerCase() === 'true',
  };
}

function validateRoundInput(symbol, horizon) {
  const canonical = String(symbol || 'BTC').toUpperCase();
  const minutes = Number(horizon || 5);
  if (!INSTRUMENTS[canonical]) return { error:'Unsupported Pulse market.', code:'invalid_market' };
  if (!HORIZONS.includes(minutes)) return { error:'Pulse horizon must be 5, 15, or 60 minutes.', code:'invalid_horizon' };
  return { symbol:canonical, instId:INSTRUMENTS[canonical], horizonMinutes:minutes };
}

async function prepare(owner, agent, adapter, symbol, horizon, options = {}) {
  const valid = validateRoundInput(symbol, horizon); if (valid.error) return valid;
  const pulse = ensurePulse(owner);
  if (pulse.active && !['resolved','cancelled','expired'].includes(pulse.active.status)) return { error:'Finish the current Pulse round first.', code:'pulse_round_active' };
  const snapshot = await adapter.marketSnapshot(valid.instId);
  const signals = MarketArena.deriveSignals(snapshot);
  if (!(signals.last > 0)) return { error:'No usable reference price was returned.', code:'market_price_unavailable' };
  const decision = PerpsGame.buildPlayerDecision(agent, owner, signals);
  const startedAt = nowFrom(options);
  const durationMs = configuredDurationMs(valid.horizonMinutes, options);
  const round = {
    id:`pr_${startedAt.toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    status:'prepared',
    environment:'BNB_PULSE_TEST',
    execution:'simulation_only',
    symbol:valid.symbol,
    instId:valid.instId,
    horizonMinutes:valid.horizonMinutes,
    startPrice:signals.last,
    referenceSource:snapshot.source,
    preparedAt:startedAt,
    startsAt:null,
    endsAt:null,
    durationMs,
    agentDecision:{ action:decision.action, confidence:decision.signalStrength, thesis:decision.thesis, style:decision.style, riskBand:decision.riskBand },
    userDecision:null,
    result:null,
    signals:{ momentum15m:signals.momentum15m, momentum30m:signals.momentum30m, funding:signals.funding, spreadBps:signals.spreadBps, score:signals.score },
  };
  pulse.active = round;
  return { round:clone(round), pulse:publicPulse(owner) };
}

function normalizeChoice(round, choice) {
  const raw = String(choice || 'follow').toLowerCase();
  if (raw === 'follow') return round.agentDecision.action;
  if (['long','short','wait'].includes(raw)) return raw;
  return null;
}

function commit(owner, agent, roundId, choice, options = {}) {
  const pulse = ensurePulse(owner), round = pulse.active;
  if (!round || round.id !== roundId) return { error:'Pulse round not found.', code:'pulse_round_not_found' };
  if (round.status !== 'prepared') return { error:'Pulse round is not awaiting a decision.', code:'pulse_round_state' };
  const action = normalizeChoice(round, choice);
  if (!action) return { error:'Decision must be follow, long, short, or wait.', code:'invalid_decision' };
  const now = nowFrom(options);
  round.status = 'running';
  round.startsAt = now;
  round.endsAt = now + num(round.durationMs, round.horizonMinutes * 60_000);
  round.userDecision = {
    choice:String(choice || 'follow').toLowerCase(),
    action,
    followed: String(choice || 'follow').toLowerCase() === 'follow',
    overridden: String(choice || 'follow').toLowerCase() !== 'follow' && action !== round.agentDecision.action,
    committedAt:now,
  };
  return { round:clone(round), pulse:publicPulse(owner) };
}

function decisionOutcome(action, returnBps, waitBandBps) {
  if (Math.abs(returnBps) <= waitBandBps) return action === 'wait' ? 'correct' : 'flat';
  if (action === 'wait') return 'incorrect';
  if (returnBps > waitBandBps) return action === 'long' ? 'correct' : 'incorrect';
  return action === 'short' ? 'correct' : 'incorrect';
}

function applyStats(stats, round) {
  stats.rounds += 1;
  const outcome = round.result.userOutcome;
  if (outcome === 'correct') stats.correct += 1;
  else if (outcome === 'incorrect') stats.incorrect += 1;
  else stats.flat += 1;
  if (round.userDecision.followed) stats.followed += 1;
  if (round.userDecision.overridden) stats.overrides += 1;
  if (round.userDecision.action === 'wait') stats.waits += 1;
  if (round.result.agentOutcome === 'correct') stats.agentCorrect += 1;
  if (round.result.userOutcome === 'correct') stats.userCorrect += 1;
  const comparable = Math.max(1, stats.agentCorrect + stats.userCorrect);
  stats.trustScore = Math.max(0, Math.min(100, Math.round(50 + ((stats.agentCorrect - stats.userCorrect) / comparable) * 25 + (stats.followed / Math.max(1, stats.rounds)) * 10)));
}

async function resolve(owner, agent, adapter, roundId, options = {}) {
  const pulse = ensurePulse(owner), round = pulse.active;
  if (!round || round.id !== roundId) return { error:'Pulse round not found.', code:'pulse_round_not_found' };
  if (round.status !== 'running') return { error:'Pulse round is not running.', code:'pulse_round_state' };
  const now = nowFrom(options);
  if (now < round.endsAt && options.force !== true) return { error:'Pulse round is still running.', code:'pulse_round_running', remainingMs:round.endsAt-now, round:clone(round) };
  const snapshot = await adapter.marketSnapshot(round.instId);
  const endPrice = num(snapshot.ticker?.last);
  if (!(endPrice > 0)) return { error:'No usable settlement price was returned.', code:'market_price_unavailable' };
  const returnPct = (endPrice / round.startPrice - 1) * 100;
  const returnBps = returnPct * 100;
  const waitBandBps = WAIT_BAND_BPS[round.horizonMinutes] || 20;
  const userOutcome = decisionOutcome(round.userDecision.action, returnBps, waitBandBps);
  const agentOutcome = decisionOutcome(round.agentDecision.action, returnBps, waitBandBps);
  round.status = 'resolved';
  round.resolvedAt = now;
  round.result = {
    endPrice,
    returnPct,
    returnBps,
    waitBandBps,
    userOutcome,
    agentOutcome,
    agreement: round.userDecision.action === round.agentDecision.action,
    execution:'simulation_only',
  };
  applyStats(pulse.stats, round);
  pulse.history.unshift(clone(round)); pulse.history = pulse.history.slice(0, 40); pulse.active = null;

  agent.memory ||= [];
  agent.memory.push({
    type:'pulse-round', place:'Pulse District', district:'pulse', cap:'analysis', trustClass:'WORLD_EXPERIENCE',
    outcome:userOutcome, createdAt:now,
    context:{ symbol:round.symbol, horizonMinutes:round.horizonMinutes, referenceSource:round.referenceSource, returnBps, agentAction:round.agentDecision.action, userAction:round.userDecision.action },
    text:`${agent.name} completed a ${round.horizonMinutes}m ${round.symbol} Pulse simulation. Agent call: ${round.agentDecision.action.toUpperCase()}; player action: ${round.userDecision.action.toUpperCase()}; market move: ${returnBps >= 0 ? '+' : ''}${returnBps.toFixed(1)} bps; decision outcome: ${userOutcome}.`,
  });
  agent.memory = agent.memory.slice(-80);
  return { round:clone(round), pulse:publicPulse(owner), agentMemoryAdded:true };
}

function cancel(owner, roundId) {
  const pulse = ensurePulse(owner), round = pulse.active;
  if (!round || round.id !== roundId) return { error:'Pulse round not found.', code:'pulse_round_not_found' };
  if (round.status !== 'prepared') return { error:'Only an uncommitted Pulse round can be cancelled.', code:'pulse_round_state' };
  round.status='cancelled'; round.cancelledAt=Date.now(); pulse.history.unshift(clone(round)); pulse.history=pulse.history.slice(0,40); pulse.active=null;
  return { round:clone(round), pulse:publicPulse(owner) };
}

module.exports = { INSTRUMENTS, HORIZONS, WAIT_BAND_BPS, ensurePulse, publicPulse, prepare, commit, resolve, cancel, decisionOutcome, configuredDurationMs };
