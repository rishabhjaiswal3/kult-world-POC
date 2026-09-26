'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');
const Perps = require('../perps-game');
const Market = require('../market-arena');
const OkxAI = require('../okx-ai');
const { SimAdapter } = require('../okx-agent-kit');

test('Perp Wars initializes persistent Citadel state and rival roster', () => {
  const owner = { agent: E.newAgent('AEGIS-07', 'AEGIS-07', 'learn', 1700000000000) };
  const state = Perps.publicPerps(owner);
  assert.equal(state.rating, 1000);
  assert.equal(state.citadelLevel, 1);
  assert.ok(state.rivals.length >= 5);
  assert.equal(state.skills.risk, 1);
});

test('Perp Wars prepares an independent rival policy and awards progression after a resolved raid', async () => {
  const owner = { agent: E.newAgent('NORI', 'NORI', 'explore', 1700000000000) };
  let offset = 0, now = 1700000000000;
  const adapter = new SimAdapter({ clock: () => now, priceOffset: () => offset });
  const prepared = await Market.prepare(owner, owner.agent, adapter, 'BTC', { rivalId:'athena' });
  assert.equal(prepared.battle.rival.id, 'athena');
  assert.ok(['long','short','wait'].includes(prepared.battle.rival.action));
  assert.ok(prepared.battle.nori.thesis.length > 20);
  if (prepared.battle.nori.action === 'wait') {
    const abstained = await Market.abstain(owner, owner.agent, prepared.battle.id);
    assert.equal(abstained.battle.status, 'abstained');
    assert.equal(abstained.battle.result.noTrade, true);
    return;
  }
  const executed = await Market.execute(owner, owner.agent, adapter, prepared.battle.id);
  offset = executed.battle.nori.side === 'long' ? 0.01 : -0.01;
  now += 20000;
  await Market.close(owner, owner.agent, adapter, prepared.battle.id);
  const resolved = await Market.resolve(owner, owner.agent, adapter, prepared.battle.id);
  assert.equal(resolved.battle.status, 'resolved');
  assert.ok(['win','loss','draw'].includes(resolved.battle.result.duelOutcome));
  assert.ok(Number.isFinite(resolved.battle.result.progression.ratingDelta));
  assert.ok(resolved.arena.perps.loot > 0);
  assert.match(resolved.battle.result.receiptSchema, /KULT_PERP_WARS_V1/);
});

test('OKX.AI manifest exposes KULT agentic market services on X Layer', () => {
  const manifest = OkxAI.serviceManifest('https://example.com');
  assert.equal(manifest.network.chainId, 196);
  assert.ok(manifest.services.some(x => x.id === 'kult.market.read'));
  assert.ok(manifest.services.every(x => x.endpoint.startsWith('https://example.com/')));
});
