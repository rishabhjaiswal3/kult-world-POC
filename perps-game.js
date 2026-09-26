'use strict';

const RIVALS = Object.freeze({
  shadow09: {
    id: 'shadow09', name: 'SHADOW-09', glyph: 'S', title: 'Counterfactual Hunter',
    rating: 1080, style: 'adaptive', accent: '#8b7cff',
    description: 'Balances trend against crowding and attacks overconfident reads.',
  },
  berserker: {
    id: 'berserker', name: 'BERSERKER', glyph: 'B', title: 'Momentum Raider',
    rating: 1160, style: 'momentum', accent: '#ff7b6b',
    description: 'Aggressive trend follower. Strong when momentum persists, vulnerable to reversals.',
  },
  athena: {
    id: 'athena', name: 'ATHENA', glyph: 'A', title: 'Evidence Architect',
    rating: 1210, style: 'confirmation', accent: '#6fd8ff',
    description: 'Demands confirmation across signals and will abstain when the evidence conflicts.',
  },
  aegis07: {
    id: 'aegis07', name: 'AEGIS-07', glyph: 'A7', title: 'Risk Sentinel',
    rating: 1260, style: 'risk', accent: '#72f1b8',
    description: 'Protects capital first. Trades smaller conviction windows and rewards clean invalidation.',
  },
  voidwalker: {
    id: 'voidwalker', name: 'VOIDWALKER', glyph: 'V', title: 'Crowd Reversal',
    rating: 1190, style: 'contrarian', accent: '#d491ff',
    description: 'Looks for crowded positioning, stretched funding and failed breakouts.',
  },
});

const SKILL_KEYS = Object.freeze([
  'momentum', 'risk', 'orderflow', 'contrarian', 'calibration', 'memory',
]);

function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n) || 0)); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function pct(n) { return Number.isFinite(Number(n)) ? Number(n) : 0; }

function ensurePerps(owner) {
  owner.marketArena ||= {};
  owner.marketArena.perpsGame ||= {
    season: 'S01',
    title: 'Unranked Raider',
    rating: 1000,
    seasonPoints: 0,
    loot: 0,
    territory: 1,
    citadelLevel: 1,
    raidStreak: 0,
    bestRaidStreak: 0,
    decisions: 0,
    abstentions: 0,
    rivalWins: {},
    skills: {
      momentum: 1,
      risk: 1,
      orderflow: 1,
      contrarian: 1,
      calibration: 1,
      memory: 1,
    },
    lastRivalId: 'shadow09',
    unlockedRivals: ['shadow09', 'berserker', 'athena', 'aegis07', 'voidwalker'],
    recentLoot: [],
    createdAt: Date.now(),
  };
  const state = owner.marketArena.perpsGame;
  state.skills ||= {};
  for (const key of SKILL_KEYS) state.skills[key] = clamp(state.skills[key] || 1, 1, 20);
  state.rivalWins ||= {};
  state.unlockedRivals ||= Object.keys(RIVALS);
  state.recentLoot ||= [];
  return state;
}

function rankTitle(rating) {
  if (rating >= 1500) return 'Mythic Market Warden';
  if (rating >= 1350) return 'Citadel Commander';
  if (rating >= 1225) return 'Alpha Raider';
  if (rating >= 1125) return 'Signal Hunter';
  if (rating >= 1050) return 'Market Scout';
  return 'Unranked Raider';
}

function citadelLevelFor(state) {
  const byRating = 1 + Math.floor(Math.max(0, state.rating - 1000) / 125);
  const byPoints = 1 + Math.floor(Math.max(0, state.seasonPoints) / 250);
  return clamp(Math.max(byRating, byPoints), 1, 8);
}

function publicPerps(owner) {
  const state = ensurePerps(owner);
  state.citadelLevel = citadelLevelFor(state);
  state.title = rankTitle(state.rating);
  return {
    season: state.season,
    title: state.title,
    rating: Math.round(state.rating),
    seasonPoints: Math.round(state.seasonPoints),
    loot: Math.round(state.loot),
    territory: state.territory,
    citadelLevel: state.citadelLevel,
    raidStreak: state.raidStreak,
    bestRaidStreak: state.bestRaidStreak,
    decisions: state.decisions,
    abstentions: state.abstentions,
    skills: clone(state.skills),
    rivalWins: clone(state.rivalWins),
    lastRivalId: state.lastRivalId,
    rivals: state.unlockedRivals.map(id => RIVALS[id]).filter(Boolean).map(clone),
    recentLoot: state.recentLoot.slice(0, 8).map(clone),
  };
}

function recentMarketMemory(agent) {
  const memories = Array.isArray(agent?.memory) ? agent.memory.filter(m => m?.type === 'market-arena').slice(-12) : [];
  let longWins = 0, longLosses = 0, shortWins = 0, shortLosses = 0;
  for (const m of memories) {
    const text = String(m.text || '').toLowerCase();
    const isLong = text.includes(' long '), isShort = text.includes(' short ');
    if (isLong && m.outcome === 'win') longWins++;
    if (isLong && m.outcome === 'loss') longLosses++;
    if (isShort && m.outcome === 'win') shortWins++;
    if (isShort && m.outcome === 'loss') shortLosses++;
  }
  const longBias = (longWins - longLosses) * 0.025;
  const shortBias = (shortWins - shortLosses) * -0.025;
  return {
    samples: memories.length,
    longWins, longLosses, shortWins, shortLosses,
    directionalAdjustment: clamp(longBias + shortBias, -0.12, 0.12),
  };
}

function agentStyle(agent) {
  const source = `${agent?.persona || ''} ${agent?.mandate || ''} ${agent?.name || ''}`.toLowerCase();
  if (/aegis|protect|care|guardian|risk/.test(source)) return 'risk';
  if (/berserk|bold|build|momentum|explore/.test(source)) return 'momentum';
  if (/athena|analysis|learn|research|curious/.test(source)) return 'confirmation';
  if (/void|contrarian|surprise|rebel/.test(source)) return 'contrarian';
  return 'adaptive';
}

function actionFromScore(score, waitBand = 0.11) {
  if (Math.abs(score) < waitBand) return 'wait';
  return score > 0 ? 'long' : 'short';
}

function reasonParts(signals) {
  const parts = [];
  if (Math.abs(signals.momentum15m) >= 0.001) parts.push(`${signals.momentum15m >= 0 ? 'positive' : 'negative'} near-term momentum`);
  if (Math.abs(signals.funding) >= 0.00015) parts.push(`${signals.funding > 0 ? 'long' : 'short'} funding crowding`);
  if (signals.spreadBps > 12) parts.push('elevated spread');
  else parts.push('clean execution spread');
  return parts;
}

function buildPlayerDecision(agent, owner, signals) {
  const perps = ensurePerps(owner);
  const memory = recentMarketMemory(agent);
  const style = agentStyle(agent);
  let score = Number(signals.score || 0) + memory.directionalAdjustment;
  let waitBand = 0.105;
  if (style === 'momentum') score += Math.sign(signals.momentum15m || signals.momentum30m || 1) * 0.07;
  if (style === 'confirmation') waitBand = 0.17;
  if (style === 'risk') waitBand = 0.19;
  if (style === 'contrarian') score -= clamp((signals.funding / 0.0005) * 0.09, -0.11, 0.11);
  const riskSkill = perps.skills.risk || 1;
  if (signals.spreadBps > 30 && riskSkill >= 3) waitBand += 0.08;
  const action = actionFromScore(score, waitBand);
  const signalStrength = Math.round(clamp(55 + Math.abs(score) * 31 + memory.samples * 0.35, 52, 88));
  const parts = reasonParts(signals);
  const memoryText = memory.samples ? `Memory recalled ${memory.samples} prior market episodes.` : 'No prior market episode was strong enough to anchor this read.';
  const thesis = action === 'wait'
    ? `WAIT. ${parts.join(', ')} do not create enough asymmetry for this Agent's current risk profile. ${memoryText}`
    : `${action.toUpperCase()} bias from ${parts.join(', ')}. ${memoryText}`;
  return {
    style, action, side: action === 'wait' ? null : action,
    score, signalStrength, confidence: signalStrength, thesis,
    memory, riskBand: style === 'risk' ? 'LOW' : style === 'momentum' ? 'HIGH' : 'MEDIUM',
  };
}

function rivalScore(rival, signals) {
  let score = Number(signals.score || 0);
  if (rival.style === 'momentum') score = signals.momentum30m * 52 + signals.momentum15m * 70;
  if (rival.style === 'confirmation') {
    const sameDirection = Math.sign(signals.momentum30m) === Math.sign(signals.momentum15m);
    score = sameDirection ? signals.score * 1.15 : signals.score * 0.22;
  }
  if (rival.style === 'risk') score = signals.score * (signals.spreadBps > 18 ? 0.35 : 0.72);
  if (rival.style === 'contrarian') score = -signals.score * 0.55 - clamp(signals.funding / 0.0005, -1, 1) * 0.34;
  if (rival.style === 'adaptive') score = signals.score * -0.45 - clamp(signals.funding / 0.0005, -1, 1) * 0.15;
  return clamp(score, -1.25, 1.25);
}

function buildRivalDecision(rivalId, signals) {
  const rival = RIVALS[rivalId] || RIVALS.shadow09;
  const score = rivalScore(rival, signals);
  let waitBand = 0.12;
  if (rival.style === 'confirmation') waitBand = 0.18;
  if (rival.style === 'risk') waitBand = 0.22;
  const action = actionFromScore(score, waitBand);
  const signalStrength = Math.round(clamp(54 + Math.abs(score) * 30, 51, 87));
  const parts = reasonParts(signals);
  const verb = rival.style === 'contrarian' ? 'fades' : rival.style === 'risk' ? 'filters' : rival.style === 'momentum' ? 'presses' : 'tests';
  const thesis = action === 'wait'
    ? `${rival.name} waits: its ${rival.style} policy sees conflicting evidence across ${parts.join(', ')}.`
    : `${rival.name} ${verb} the setup into a ${action.toUpperCase()} raid using ${parts.join(', ')}.`;
  return { ...clone(rival), action, side: action === 'wait' ? null : action, score, signalStrength, confidence: signalStrength, thesis };
}

function chooseRival(owner, requestedId) {
  const state = ensurePerps(owner);
  if (requestedId && state.unlockedRivals.includes(requestedId) && RIVALS[requestedId]) {
    state.lastRivalId = requestedId;
    return RIVALS[requestedId];
  }
  const ids = state.unlockedRivals.filter(id => RIVALS[id]);
  const currentIndex = Math.max(0, ids.indexOf(state.lastRivalId));
  const next = ids[(currentIndex + Math.max(1, state.decisions || 0)) % ids.length] || 'shadow09';
  state.lastRivalId = next;
  return RIVALS[next];
}

function virtualPnl(decision, entry, exit, notionalUsd) {
  if (!decision || decision.action === 'wait') return 0;
  const direction = decision.action === 'long' ? 1 : -1;
  return notionalUsd * direction * ((exit - entry) / entry);
}

function expectedScore(playerRating, rivalRating) {
  return 1 / (1 + 10 ** ((rivalRating - playerRating) / 400));
}

function progressBattle(owner, battle, playerPnl, rivalPnl) {
  const state = ensurePerps(owner);
  const rival = RIVALS[battle.rival?.id] || RIVALS.shadow09;
  const epsilon = Math.max(0.01, Number(battle.notionalUsd || 0) * 0.00005);
  let duelOutcome = 'draw';
  if (playerPnl > rivalPnl + epsilon) duelOutcome = 'win';
  if (playerPnl < rivalPnl - epsilon) duelOutcome = 'loss';

  state.decisions += 1;
  if (battle.nori?.action === 'wait') state.abstentions += 1;
  const actual = duelOutcome === 'win' ? 1 : duelOutcome === 'draw' ? 0.5 : 0;
  const expected = expectedScore(state.rating, rival.rating);
  const k = 28;
  const ratingDelta = Math.round(k * (actual - expected));
  state.rating = clamp(state.rating + ratingDelta, 700, 2200);

  const disciplineBonus = battle.nori?.action === 'wait' && Math.abs(rivalPnl) > epsilon ? 8 : 0;
  const lootDelta = duelOutcome === 'win' ? 28 + disciplineBonus : duelOutcome === 'draw' ? 10 + disciplineBonus : 5;
  const seasonDelta = duelOutcome === 'win' ? 36 + Math.max(0, Math.round((rival.rating - 1000) / 35)) : duelOutcome === 'draw' ? 14 : 6;
  state.loot += lootDelta;
  state.seasonPoints += seasonDelta;
  state.raidStreak = duelOutcome === 'win' ? state.raidStreak + 1 : 0;
  state.bestRaidStreak = Math.max(state.bestRaidStreak, state.raidStreak);
  if (duelOutcome === 'win') state.rivalWins[rival.id] = (state.rivalWins[rival.id] || 0) + 1;

  const skillChanges = { momentum: 0, risk: 0, orderflow: 0, contrarian: 0, calibration: 0, memory: 0 };
  const action = battle.nori?.action || battle.nori?.side;
  if (action === 'wait') { skillChanges.risk += 1; skillChanges.calibration += 1; }
  else {
    skillChanges.momentum += Math.abs(Number(battle.signals?.momentum15m || 0)) > 0.001 ? 1 : 0;
    skillChanges.orderflow += Number(battle.spreadBps || 0) <= 15 ? 1 : 0;
    skillChanges.contrarian += Math.sign(Number(battle.funding || 0)) !== (action === 'long' ? 1 : -1) ? 1 : 0;
    skillChanges.risk += duelOutcome !== 'loss' ? 1 : 0;
    skillChanges.calibration += battle.nori?.signalStrength <= 75 || duelOutcome === 'win' ? 1 : 0;
    skillChanges.memory += battle.nori?.memory?.samples ? 1 : 0;
  }
  for (const [key, delta] of Object.entries(skillChanges)) {
    if (!delta) continue;
    const progress = (state[`${key}Xp`] || 0) + delta;
    state[`${key}Xp`] = progress;
    const newLevel = 1 + Math.floor(progress / 3);
    state.skills[key] = clamp(Math.max(state.skills[key] || 1, newLevel), 1, 20);
  }

  const previousCitadel = state.citadelLevel;
  state.citadelLevel = citadelLevelFor(state);
  if (state.citadelLevel > previousCitadel) state.territory = Math.min(12, state.territory + 1);
  state.title = rankTitle(state.rating);

  const lootEvent = {
    at: Date.now(), battleId: battle.id, rivalId: rival.id, rivalName: rival.name,
    outcome: duelOutcome, loot: lootDelta, seasonPoints: seasonDelta, ratingDelta,
  };
  state.recentLoot.unshift(lootEvent);
  state.recentLoot = state.recentLoot.slice(0, 12);

  return {
    duelOutcome, ratingDelta, lootDelta, seasonDelta,
    playerPnl, rivalPnl, citadelLevel: state.citadelLevel,
    title: state.title, skillChanges,
  };
}

function reflection(battle, progression) {
  const player = battle.nori || {};
  const rival = battle.rival || {};
  const choice = (player.action || player.side || 'wait').toUpperCase();
  const result = progression.duelOutcome;
  if (player.action === 'wait') {
    return result === 'win'
      ? `I protected optionality. ${rival.name || 'The rival'} committed while my evidence stayed conflicted; waiting was the stronger raid.`
      : `I waited because the setup was weak. The rival captured more edge this time, but the decision preserved risk discipline.`;
  }
  if (result === 'win') return `My ${choice} thesis outperformed ${rival.name || 'the rival'}. I should retain the setup conditions, not just the PnL.`;
  if (result === 'loss') return `${rival.name || 'The rival'} beat my ${choice} thesis. I need to recalibrate the signal strength and remember which evidence failed first.`;
  return `The ${choice} thesis matched the rival closely. The next edge has to come from better timing or better evidence, not more leverage.`;
}

module.exports = {
  RIVALS, SKILL_KEYS, ensurePerps, publicPerps, chooseRival,
  buildPlayerDecision, buildRivalDecision, virtualPnl, progressBattle,
  reflection, rankTitle, citadelLevelFor, recentMarketMemory, agentStyle,
};
