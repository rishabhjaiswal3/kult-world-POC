'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const OG = require('../og');

test('dynamic share renderer emits a valid 1200x630 PNG', () => {
  const image = OG.renderCard({ eyebrow: 'AGENT PASSPORT', title: 'NORI BECAME CAPABLE', detail: 'EARNED THROUGH REAL OUTCOMES', stats: [{ value: 82, label: 'analysis' }] });
  assert.ok(image.length > 10_000);
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});
