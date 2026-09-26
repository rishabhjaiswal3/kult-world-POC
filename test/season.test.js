'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Season = require('../season');

test('Season manifest is deterministic and matches engine progression rules', () => {
  delete require.cache[require.resolve('../season')];
  const again = require('../season');
  assert.equal(Season.manifestHash, again.manifestHash);
  assert.match(Season.manifestHash, /^0x[a-f0-9]{64}$/);
  assert.match(Season.seasonIdHash, /^0x[a-f0-9]{64}$/);
  assert.deepEqual(Season.MANIFEST.capabilityTiers.capable, { minEvidence: 7, minScore: 58 });
  assert.deepEqual(Season.MANIFEST.capabilityTiers.skilled, { minEvidence: 14, minScore: 72 });
  assert.deepEqual(Season.MANIFEST.capabilityTiers.elite, { minEvidence: 24, minScore: 82 });
});

test('public Season only claims on-chain commitment for a valid transaction hash', () => {
  assert.equal(Season.publicSeason({ commitTx: 'bad' }).commitment.status, 'READY_TO_COMMIT');
  const committed = Season.publicSeason({ commitTx: `0x${'a'.repeat(64)}`, explorerUrl: 'https://explorer.example' });
  assert.equal(committed.commitment.status, 'ONCHAIN');
  assert.equal(committed.commitment.explorerUrl, `https://explorer.example/tx/0x${'a'.repeat(64)}`);
});
