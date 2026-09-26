'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('../engine');
const Intelligence = require('../intelligence');

function totalEvidence(agent) {
  return Object.values(agent.capability).reduce((n, cap) => n + Number(cap.n || 0), 0);
}

test('autonomous World life creates lived experience but never capability evidence', () => {
  const agent = E.newAgent('NORI', 'NORI', 'explore', 1700000000000);
  const before = totalEvidence(agent);
  const event = E.step(agent, 1700000100000, { source: 'test', district: 'commons', action: 'socialize', reason: 'bounded test' });
  assert.equal(totalEvidence(agent), before);
  assert.equal(event.observed.trustClass, 'WORLD_EXPERIENCE');
  assert.equal(event.verified, undefined);
  assert.equal(agent.memory.at(-1).type, 'experience');
});

test('deterministic intelligence always returns allowlisted actions', () => {
  const agent = E.newAgent('ATHENA', 'ATHENA', 'learn', 1700000000000);
  const decision = Intelligence.deterministicDecision(agent);
  assert.ok(Intelligence.ALLOWED_DISTRICTS.includes(decision.district));
  assert.ok(Intelligence.ALLOWED_ACTIONS.includes(decision.action));
});

test('Three.js production layer is present with an accessible DOM fallback', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'static', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'static', 'world3d.js'), 'utf8');
  assert.match(html, /id="world3dCanvas"/);
  assert.match(html, /data-district="home"/);
  assert.match(html, /data-district="market"/);
  assert.match(html, /id="marketView"/);
  assert.match(js, /three@0\.185\.0/);
  assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /new THREE\.Raycaster/);
  assert.match(js, /districtButtons\.get\(key\)\?\.click/);
  assert.match(js, /world3dControls/);
  assert.match(js, /projectDomLabels/);
  assert.match(js, /buildMarket/);
  const marketJs = fs.readFileSync(path.join(__dirname, '..', 'static', 'market.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');
  assert.match(marketJs, /market\/battle\/close/);
  assert.match(marketJs, /New raids paused/);
  const perps3d = fs.readFileSync(path.join(__dirname, '..', 'static', 'perps3d.js'), 'utf8');
  assert.match(html, /id="perps3dCanvas"/);
  assert.match(perps3d, /three@0\.185\.0/);
  assert.match(perps3d, /kult:perps-state/);
  assert.match(appJs, /applyMarketVisibility/);
});
