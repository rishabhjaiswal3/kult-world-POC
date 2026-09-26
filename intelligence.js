'use strict';

const crypto = require('crypto');

const ENABLED = String(process.env.KULT_0G_ENABLED || '').toLowerCase() === 'true';
const ENDPOINT = String(process.env.KULT_0G_COMPUTE_ENDPOINT || '').trim();
const API_KEY = String(process.env.KULT_0G_API_KEY || '').trim();
const TIMEOUT_MS = Math.min(8_000, Math.max(750, Number(process.env.KULT_0G_TIMEOUT_MS || 2500)));

const ALLOWED_DISTRICTS = ['commons', 'work', 'forge', 'arena', 'observatory', 'home'];
const ALLOWED_ACTIONS = ['explore', 'reflect', 'practice', 'create', 'compete', 'socialize', 'rest'];

function stableIndex(seed, n) {
  const hex = crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % Math.max(1, n);
}

function deterministicDecision(agent) {
  const mandateMap = {
    explore: ['commons', 'observatory', 'forge', 'work'],
    learn: ['work', 'observatory', 'arena', 'forge'],
    create: ['forge', 'commons', 'work'],
    compete: ['arena', 'work', 'commons'],
    earn: ['work', 'observatory', 'commons'],
  };
  const actionMap = {
    explore: 'explore', learn: 'practice', create: 'create', compete: 'compete', earn: 'practice',
  };
  const choices = mandateMap[agent?.mandate] || mandateMap.explore;
  const district = agent?.needs?.energy < 24 ? 'home' : choices[stableIndex(`${agent?.id}|${agent?.tick}|${agent?.mandate}`, choices.length)];
  return {
    source: 'deterministic-fallback',
    district,
    action: district === 'home' ? 'rest' : actionMap[agent?.mandate] || 'explore',
    reason: district === 'home' ? 'Energy is low, so the safe bounded action is rest.' : `Mandate ${agent?.mandate || 'explore'} weighted this district highest.`,
  };
}

function safeDecision(value, agent) {
  if (!value || typeof value !== 'object') return deterministicDecision(agent);
  const district = ALLOWED_DISTRICTS.includes(value.district) ? value.district : null;
  const action = ALLOWED_ACTIONS.includes(value.action) ? value.action : null;
  if (!district || !action) return deterministicDecision(agent);
  return {
    source: '0g-compute',
    district,
    action,
    reason: String(value.reason || '').replace(/[\r\n]+/g, ' ').slice(0, 240) || 'Bounded 0G decision.',
  };
}

async function chooseWorldAction(agent, context = {}) {
  if (!ENABLED || !ENDPOINT) return deterministicDecision(agent);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const payload = {
      schema: 'kult.world-decision.v1',
      agent: {
        id: agent.id,
        persona: agent.persona,
        mandate: agent.mandate,
        focus: agent.focus,
        trait: agent.trait,
        needs: agent.needs,
        relationships: Object.fromEntries(Object.entries(agent.relationships || {}).map(([key, value]) => [key, { closeness: value.closeness || 0 }])),
        recentMemory: (agent.memory || []).slice(-6).map(memory => ({ type: memory.type, place: memory.place, text: memory.text, createdAt: memory.createdAt })),
      },
      world: {
        allowedDistricts: ALLOWED_DISTRICTS,
        allowedActions: ALLOWED_ACTIONS,
        currentDistrict: context.currentDistrict || null,
      },
      rules: [
        'Choose exactly one allowed district and one allowed action.',
        'Never move money, sign transactions, publish externally, change permissions, or create verified capability evidence.',
        'Return compact JSON only: {district, action, reason}.',
      ],
    };
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`0G compute returned ${response.status}`);
    const body = await response.json();
    const candidate = body?.decision || body?.output || body;
    return safeDecision(candidate, agent);
  } catch (_) {
    return deterministicDecision(agent);
  } finally {
    clearTimeout(timer);
  }
}

function health() {
  return {
    enabled: ENABLED,
    configured: Boolean(ENDPOINT),
    mode: ENABLED && ENDPOINT ? '0G_WITH_DETERMINISTIC_FALLBACK' : 'DETERMINISTIC',
    timeoutMs: TIMEOUT_MS,
  };
}

module.exports = { chooseWorldAction, deterministicDecision, health, ALLOWED_DISTRICTS, ALLOWED_ACTIONS };
