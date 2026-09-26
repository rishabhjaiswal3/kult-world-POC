'use strict';

const crypto = require('crypto');
const E = require('./engine');

const CHALLENGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PUBLIC_RECORDS = 5000;
const RESERVED_HANDLES = new Set(['admin', 'kult', 'kultgames', 'support', 'robinhood', 'system', 'moderator']);

function publicId(prefix) { return `${prefix}_${crypto.randomBytes(16).toString('hex')}`; }
function capability(agent, cap) { return E.publicAgent(agent).capabilities.find(c => c.cap === cap) || null; }

function bestCap(agent) {
  return E.publicAgent(agent).capabilities
    .filter(c => c.n >= 4)
    .sort((a, b) => (b.score - a.score) || (b.n - a.n))[0] || null;
}

function overallScore(agent) {
  const caps = E.publicAgent(agent).capabilities.filter(c => c.n >= 4);
  if (!caps.length) return null;
  const denominator = caps.reduce((n, c) => n + c.n, 0);
  return Math.round(caps.reduce((n, c) => n + c.score * c.n, 0) / denominator);
}

function deriveMoments(agent) {
  const out = [];
  for (const milestone of agent.milestones || []) {
    const stat = capability(agent, milestone.cap);
    if (!stat || stat.n < 7) continue;
    out.push({
      id: `milestone:${milestone.cap}:${milestone.tier}`,
      kind: 'TIER_UP',
      cap: milestone.cap,
      tier: String(milestone.tier).toUpperCase(),
      score: stat.score,
      evidence: stat.n,
      headline: `${agent.name} became ${String(milestone.tier).toUpperCase()} at ${milestone.cap}`,
      sub: `${stat.score}/100 · ${stat.n} recorded outcomes`,
      createdAt: milestone.createdAt,
      weight: 4,
    });
  }
  if ((agent.arenaRank || 0) > 0) out.push({
    id: `arena:${agent.arenaRank}`,
    kind: 'ARENA_RANK',
    rank: agent.arenaRank,
    headline: `${agent.name} reached Arena rank ${agent.arenaRank}`,
    sub: `${agent.missionWins || 0} mission wins`,
    createdAt: Date.now(),
    weight: 5,
  });
  if ((agent.streak || 1) >= 3) out.push({
    id: `streak:${agent.streak}`,
    kind: 'STREAK',
    streak: agent.streak,
    headline: `${agent.name} built a ${agent.streak}-day streak`,
    sub: `returned on ${agent.streak} consecutive UTC days`,
    createdAt: Date.now(),
    weight: 3,
  });
  const win = (agent.proofs || []).find(p => p.outcome === 'success');
  if (win) out.push({
    id: `proof:${win.id}`,
    kind: win.anchored ? 'ANCHORED_PROOF' : 'MISSION_WIN',
    proofId: win.id,
    cap: win.cap,
    title: win.title,
    headline: win.anchored ? `${agent.name} anchored “${win.title}” on Robinhood Chain` : `${agent.name} completed “${win.title}”`,
    sub: win.anchored ? 'On-chain receipt verified' : 'KULT World evidence recorded',
    createdAt: win.createdAt,
    weight: win.anchored ? 6 : 2,
  });
  const seen = new Set();
  return out
    .filter(m => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => (b.weight - a.weight) || (b.createdAt - a.createdAt));
}

function buildShareCard(agent, moment) {
  const benchmark = moment.cap ? capability(agent, moment.cap) : bestCap(agent);
  const evolution = E.evolutionFor(agent);
  return {
    slug: publicId('moment'),
    agentId: agent.id,
    agentName: agent.name,
    persona: agent.persona,
    color: agent.color,
    accent: agent.accent,
    kind: moment.kind,
    headline: moment.headline,
    sub: moment.sub,
    evidence: moment.evidence || benchmark?.n || null,
    score: moment.score || benchmark?.score || null,
    cap: moment.cap || benchmark?.cap || null,
    proofId: moment.proofId || null,
    anchored: moment.kind === 'ANCHORED_PROOF',
    evolution: { id: evolution.id, label: evolution.label, rank: evolution.rank, glyph: evolution.glyph },
    createdAt: Date.now(),
  };
}

function pruneRecord(record, max = MAX_PUBLIC_RECORDS) {
  const entries = Object.entries(record);
  if (entries.length <= max) return;
  entries.sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
  for (const [key] of entries.slice(0, entries.length - max)) delete record[key];
}

function storeShareCard(store, card) {
  const world = store.getWorld();
  world.shareCards ||= {};
  world.shareCards[card.slug] = card;
  pruneRecord(world.shareCards);
  world.updatedAt = Date.now();
  store.setWorld(world);
  return card;
}

function publicCard(card) {
  if (!card) return null;
  return { ...card };
}

function createChallenge(store, agent, cap) {
  const stat = capability(agent, cap || bestCap(agent)?.cap);
  if (!stat || stat.n < 4) return { error: 'earn at least four outcomes in one capability before creating a challenge' };
  const challenge = {
    id: publicId('challenge'),
    cap: stat.cap,
    targetScore: stat.score,
    targetEvidence: stat.n,
    targetArenaRank: agent.arenaRank || 0,
    challengerAgentName: agent.name,
    challengerAgentId: agent.id,
    challengerPersona: agent.persona,
    color: agent.color,
    acceptedBy: {},
    beatenBy: {},
    createdAt: Date.now(),
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  const world = store.getWorld();
  world.challenges ||= {};
  world.challenges[challenge.id] = challenge;
  pruneRecord(world.challenges);
  world.updatedAt = Date.now();
  store.setWorld(world);
  return publicChallenge(challenge);
}

function publicChallenge(challenge) {
  if (!challenge) return null;
  return {
    id: challenge.id,
    cap: challenge.cap,
    targetScore: challenge.targetScore,
    targetEvidence: challenge.targetEvidence,
    targetArenaRank: challenge.targetArenaRank,
    challengerAgentName: challenge.challengerAgentName,
    challengerAgentId: challenge.challengerAgentId,
    challengerPersona: challenge.challengerPersona,
    color: challenge.color,
    accepted: Object.keys(challenge.acceptedBy || {}).length,
    beaten: Object.keys(challenge.beatenBy || {}).length,
    createdAt: challenge.createdAt,
    expiresAt: challenge.expiresAt,
    expired: Boolean(challenge.expiresAt && challenge.expiresAt <= Date.now()),
  };
}

function getChallenge(store, id) { return store.getWorld().challenges?.[id] || null; }

function acceptChallenge(store, id, agent) {
  const world = store.getWorld();
  const challenge = world.challenges?.[id];
  if (!challenge) return { error: 'challenge not found' };
  if (challenge.expiresAt <= Date.now()) return { error: 'challenge expired' };
  if (challenge.challengerAgentId === agent.id) return { error: 'an Agent cannot challenge itself' };
  challenge.acceptedBy ||= {};
  challenge.acceptedBy[agent.id] ||= Date.now();
  world.updatedAt = Date.now();
  store.setWorld(world);
  return { ok: true, challenge: publicChallenge(challenge) };
}

function resolveChallenge(store, id, agent) {
  const world = store.getWorld();
  const challenge = world.challenges?.[id];
  if (!challenge) return { error: 'challenge not found' };
  if (challenge.expiresAt <= Date.now()) return { error: 'challenge expired' };
  if (!challenge.acceptedBy?.[agent.id]) return { error: 'accept this challenge before resolving it' };
  const stat = capability(agent, challenge.cap);
  if (!stat || stat.n < 4) return { beaten: false, reason: 'insufficient_evidence', need: 4 - (stat?.n || 0), cap: challenge.cap };
  const beaten = stat.score > challenge.targetScore;
  challenge.beatenBy ||= {};
  if (beaten) challenge.beatenBy[agent.id] ||= Date.now();
  world.updatedAt = Date.now();
  store.setWorld(world);
  return { beaten, challengerScore: stat.score, targetScore: challenge.targetScore, cap: challenge.cap, challenge: publicChallenge(challenge) };
}

function normalizeHandle(handle) { return String(handle || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20); }

function registerCreatorAgent(store, agent, handle) {
  const clean = normalizeHandle(handle);
  if (clean.length < 3) return { error: 'handle must be at least three characters' };
  if (RESERVED_HANDLES.has(clean.toLowerCase())) return { error: 'handle is reserved' };
  const world = store.getWorld();
  world.creators ||= {};
  const collision = Object.values(world.creators).some(c => c.agentId !== agent.id && c.handle.toLowerCase() === clean.toLowerCase());
  if (collision) return { error: 'handle taken' };
  const previous = world.creators[agent.id];
  const evolution = E.evolutionFor(agent);
  world.creators[agent.id] = {
    agentId: agent.id,
    agentName: agent.name,
    persona: agent.persona,
    color: agent.color,
    accent: agent.accent,
    evolution: { id: evolution.id, label: evolution.label, rank: evolution.rank },
    handle: clean,
    followerAgentIds: previous?.followerAgentIds || {},
    followers: Object.keys(previous?.followerAgentIds || {}).length,
    createdAt: previous?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  agent.publicProfile = true;
  world.updatedAt = Date.now();
  store.setWorld(world);
  return { ok: true, creator: publicCreator(world.creators[agent.id]) };
}

function publicCreator(creator) {
  return {
    agentId: creator.agentId,
    agentName: creator.agentName,
    persona: creator.persona,
    color: creator.color,
    accent: creator.accent,
    evolution: creator.evolution || { id: 'emerging', label: 'Emerging', rank: 0 },
    handle: creator.handle,
    followers: Object.keys(creator.followerAgentIds || {}).length,
    createdAt: creator.createdAt,
  };
}

function followCreator(store, creatorAgentId, followerAgent) {
  const world = store.getWorld();
  const creator = world.creators?.[creatorAgentId];
  if (!creator) return { error: 'creator Agent not found' };
  if (creatorAgentId === followerAgent.id) return { error: 'an Agent cannot follow itself' };
  creator.followerAgentIds ||= {};
  const already = Boolean(creator.followerAgentIds[followerAgent.id]);
  creator.followerAgentIds[followerAgent.id] ||= Date.now();
  creator.followers = Object.keys(creator.followerAgentIds).length;
  world.updatedAt = Date.now();
  store.setWorld(world);
  return { ok: true, already, followers: creator.followers };
}

function listCreators(store, limit = 50) {
  return Object.values(store.getWorld().creators || {})
    .map(publicCreator)
    .sort((a, b) => (b.followers - a.followers) || (a.createdAt - b.createdAt))
    .slice(0, limit);
}

function leaderboard(store, allAgents, { cap = null, limit = 25 } = {}) {
  const rows = [];
  for (const agent of allAgents.filter(a => a.publicProfile)) {
    const publicAgent = E.publicAgent(agent);
    const caps = publicAgent.capabilities;
    const evidence = caps.reduce((n, c) => n + c.n, 0);
    const provisional = evidence < 12;
    const stat = cap ? caps.find(c => c.cap === cap) : null;
    const rankScore = cap ? (stat?.n >= 4 ? stat.score : null) : overallScore(agent);
    if (cap && rankScore == null) continue;
    const anchored = (agent.proofs || []).filter(p => p.anchored).length;
    const creator = store.getWorld().creators?.[agent.id];
    rows.push({
      agentId: agent.id,
      name: agent.name,
      persona: agent.persona,
      color: agent.color,
      accent: agent.accent,
      evolution: publicAgent.evolution,
      overall: overallScore(agent),
      cap: cap || null,
      capScore: cap ? rankScore : null,
      arenaRank: agent.arenaRank || 0,
      evidence,
      anchored,
      provisional,
      bornAt: agent.born || null,
      creator: creator ? publicCreator(creator) : null,
      _rank: (rankScore ?? 0) + Math.min(anchored, 5) + (agent.arenaRank || 0),
    });
  }
  const clean = row => { const { _rank, ...publicRow } = row; return publicRow; };
  const proven = rows.filter(r => !r.provisional).sort((a, b) => b._rank - a._rank);
  const provisional = rows.filter(r => r.provisional).sort((a, b) => b.evidence - a.evidence);
  return {
    cap: cap || 'overall',
    proven: proven.slice(0, limit).map((row, index) => ({ position: index + 1, ...clean(row) })),
    provisional: provisional.slice(0, 10).map(clean),
    totalRanked: proven.length,
  };
}

module.exports = {
  deriveMoments,
  buildShareCard,
  storeShareCard,
  publicCard,
  overallScore,
  bestCap,
  createChallenge,
  publicChallenge,
  getChallenge,
  acceptChallenge,
  resolveChallenge,
  registerCreatorAgent,
  followCreator,
  listCreators,
  leaderboard,
};
