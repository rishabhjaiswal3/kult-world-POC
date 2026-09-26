'use strict';

const crypto = require('node:crypto');

const PHASES = new Set(['COMING_SOON', 'FOUNDERS', 'PROVENANCE_LIVE', 'WORLD_OPEN']);

const MANIFEST = Object.freeze({
  schema: 'kult.world.season-manifest.v1',
  seasonId: 'KULT_WORLD_SEASON_01',
  title: 'The World Is Waking',
  promise: 'Every evolution is earned. Every capability is evidenced. Every proof is verifiable.',
  capabilityDomains: ['analysis', 'creativity', 'strategy', 'social'],
  capabilityTiers: {
    emerging: { minEvidence: 1, minScore: 0 },
    capable: { minEvidence: 7, minScore: 58 },
    skilled: { minEvidence: 14, minScore: 72 },
    elite: { minEvidence: 24, minScore: 82 },
  },
  rules: [
    'Only recorded outcomes change capability.',
    'Failed attempts remain part of the evidence history.',
    'Purchases, follows, wallet balances and token ownership never increase capability.',
    'Public Passports are opt-in and never expose private memory or mission choices.',
    'Self-attested and authorized-issuer receipts remain visibly distinct.',
    'Robinhood Chain anchors integrity and provenance; it does not judge an off-chain outcome.',
  ],
  chapters: [
    { id: 'wake', label: 'The World Wakes', detail: 'Adopt an identity and choose its first direction.' },
    { id: 'prove', label: 'Proof Before Hype', detail: 'Complete missions and build an honest evidence history.' },
    { id: 'evolve', label: 'Earned Evolution', detail: 'Capability changes the Agent, home, badge and public card.' },
    { id: 'open', label: 'The Commons Opens', detail: 'Publish, challenge and discover other proven Agents.' },
  ],
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const canonicalManifest = canonical(MANIFEST);
const manifestHash = `0x${crypto.createHash('sha256').update(canonicalManifest).digest('hex')}`;
const seasonIdHash = `0x${crypto.createHash('sha256').update(MANIFEST.seasonId).digest('hex')}`;

function publicSeason({ phase = 'WORLD_OPEN', commitTx = null, explorerUrl = '' } = {}) {
  const safePhase = PHASES.has(phase) ? phase : 'WORLD_OPEN';
  const safeTx = /^0x[a-fA-F0-9]{64}$/.test(String(commitTx || '')) ? String(commitTx).toLowerCase() : null;
  return {
    ...MANIFEST,
    phase: safePhase,
    manifestHash,
    seasonIdHash,
    commitment: {
      status: safeTx ? 'ONCHAIN' : 'READY_TO_COMMIT',
      txHash: safeTx,
      explorerUrl: safeTx && explorerUrl ? `${String(explorerUrl).replace(/\/$/, '')}/tx/${safeTx}` : null,
    },
  };
}

module.exports = { MANIFEST, PHASES, canonical, canonicalManifest, manifestHash, seasonIdHash, publicSeason };
