'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');
const Market = require('../market-arena');
const { SimAdapter } = require('../okx-agent-kit');

function evidenceCount(agent) {
  return Object.values(agent.capability).reduce((sum, cap) => sum + Number(cap.n || 0), 0);
}

test('Market Arena runs prepare -> explicit execute -> resolve end to end without minting Passport capability', async () => {
  const owner = { agent: E.newAgent('NORI', 'NORI', 'explore', 1700000000000) };
  let offset = 0;
  let now = 1700000000000;
  const adapter = new SimAdapter({ clock: () => now, priceOffset: () => offset });
  const beforeEvidence = evidenceCount(owner.agent);

  const prepared = await Market.prepare(owner, owner.agent, adapter, 'BTC');
  assert.equal(prepared.battle.status, 'prepared');
  assert.equal(prepared.battle.notionalUsd, 500);
  assert.equal(prepared.battle.policy.demoOnly, true);
  assert.equal(prepared.battle.sizeMode, 'quote_ccy');

  const executed = await Market.execute(owner, owner.agent, adapter, prepared.battle.id);
  assert.equal(executed.battle.status, 'active');
  assert.equal(executed.battle.execution.rawStatus, 'reconciled');

  const early = await Market.resolve(owner, owner.agent, adapter, prepared.battle.id);
  assert.equal(early.code, 'position_still_open');

  // Move price in NORI's direction, explicitly close, then resolve.
  offset = executed.battle.nori.side === 'long' ? 0.01 : -0.01;
  now += 20000;
  const closed = await Market.close(owner, owner.agent, adapter, prepared.battle.id);
  assert.equal(closed.battle.status, 'closed');
  const resolved = await Market.resolve(owner, owner.agent, adapter, prepared.battle.id);
  assert.equal(resolved.battle.status, 'resolved');
  assert.equal(resolved.battle.result.outcome, 'win');
  assert.equal(resolved.battle.result.executionReconciled, true);
  assert.equal(owner.marketArena.wins, 1);
  assert.equal(evidenceCount(owner.agent), beforeEvidence, 'market simulation must not create verified capability evidence');
  assert.equal(owner.agent.memory.at(-1).type, 'market-arena');
  assert.equal(owner.agent.memory.at(-1).trustClass, 'WORLD_EXPERIENCE');
});

test('Market Arena enforces the daily loss cap before preparing another order', async () => {
  const owner = { agent: E.newAgent('NORI', 'NORI', 'explore', 1700000000000) };
  const adapter = new SimAdapter({ clock: () => 1700000000000 });
  const arena = Market.arenaState(owner);
  arena.daily.startingEquity = 10000;
  arena.daily.realizedPnlUsd = -401;
  const out = await Market.prepare(owner, owner.agent, adapter, 'BTC');
  assert.equal(out.code, 'daily_loss_cap');
});

test('Market Arena rejects any non-demo execution adapter', async () => {
  const owner = { agent: E.newAgent('NORI', 'NORI', 'explore', 1700000000000) };
  const sim = new SimAdapter({ clock: () => 1700000000000 });
  const prepared = await Market.prepare(owner, owner.agent, sim, 'ETH');
  const unsafe = { demoOnly: false, accountSnapshot: async () => ({ equity: 10000, positions: [] }) };
  const out = await Market.execute(owner, owner.agent, unsafe, prepared.battle.id);
  assert.equal(out.code, 'live_execution_disabled');
});


test('Market permission pause blocks new positions but does not block safe closure', async () => {
  const owner = { agent: E.newAgent('NORI', 'NORI', 'explore', 1700000000000) };
  const adapter = new SimAdapter({ clock: () => 1700000000000 });
  const prepared = await Market.prepare(owner, owner.agent, adapter, 'BTC');
  const executed = await Market.execute(owner, owner.agent, adapter, prepared.battle.id);
  assert.equal(executed.battle.status, 'active');
  Market.permissionState(owner, 'paused');
  assert.equal(Market.requireMarketPermission(owner, 'prepare', 'enabled').code, 'market_paused');
  assert.equal(Market.requireMarketPermission(owner, 'execute', 'enabled').code, 'market_paused');
  assert.equal(Market.requireMarketPermission(owner, 'close', 'enabled').ok, true);
  const closed = await Market.close(owner, owner.agent, adapter, prepared.battle.id);
  assert.equal(closed.battle.status, 'closed');
});

test('market loss becomes memory but does not change Passport capability or World evolution', async () => {
  const owner = { agent: E.newAgent('NORI', 'NORI', 'explore', 1700000000000) };
  let offset = 0, now = 1700000000000;
  const adapter = new SimAdapter({ clock: () => now, priceOffset: () => offset });
  const beforeEvidence = evidenceCount(owner.agent);
  const beforeEvolution = E.evolutionFor(owner.agent).id;
  const prepared = await Market.prepare(owner, owner.agent, adapter, 'BTC');
  await Market.execute(owner, owner.agent, adapter, prepared.battle.id);
  offset = prepared.battle.nori.side === 'long' ? -0.01 : 0.01;
  now += 20000;
  await Market.close(owner, owner.agent, adapter, prepared.battle.id);
  const resolved = await Market.resolve(owner, owner.agent, adapter, prepared.battle.id);
  assert.equal(resolved.battle.result.outcome, 'loss');
  assert.equal(evidenceCount(owner.agent), beforeEvidence);
  assert.equal(E.evolutionFor(owner.agent).id, beforeEvolution);
  assert.equal(owner.agent.memory.at(-1).trustClass, 'WORLD_EXPERIENCE');
  assert.equal(resolved.battle.result.passportCapabilityChanged, false);
  assert.equal(resolved.battle.result.worldEvolutionChanged, false);
});

test('WAIT becomes a timed observation and cannot mint an instant draw reward', async()=>{
  const owner={agent:E.newAgent('NORI','NORI','explore',1700000000000)};
  let offset=0;
  const adapter=new SimAdapter({clock:()=>1700000000000,priceOffset:()=>offset});
  const p=await Market.prepare(owner,owner.agent,adapter,'BTC');
  const before=Market.publicArena(owner).perps.rating;
  const observing=await Market.abstain(owner,owner.agent,adapter,p.battle.id,{now:Date.now(),durationMs:1000});
  assert.equal(observing.battle.status,'observing');
  assert.equal(Market.publicArena(owner).perps.rating,before);
  const early=await Market.resolve(owner,owner.agent,adapter,p.battle.id);
  assert.equal(early.code,'observation_running');
  owner.marketArena.active.observationEndsAt=Date.now()-1;
  offset=.01;
  const resolved=await Market.resolve(owner,owner.agent,adapter,p.battle.id);
  assert.equal(resolved.battle.status,'resolved');
  assert.equal(resolved.battle.result.noTrade,true);
  assert.ok(['win','loss','draw'].includes(resolved.battle.result.duelOutcome));
});

test('execution intent is persisted before the external order side effect', async()=>{
  const owner={agent:E.newAgent('NORI','NORI','explore',1700000000000)};
  const sim=new SimAdapter({clock:()=>1700000000000});
  const p=await Market.prepare(owner,owner.agent,sim,'BTC');
  const stages=[];
  let sideEffectSawDurableIntent=false;
  const adapter={
    profile:'agent-kit-test', demoOnly:true,
    async accountSnapshot(){return {equity:10000,positionMode:'net_mode',positions:[]};},
    async marketSnapshot(){return sim.marketSnapshot('BTC-USDT-SWAP');},
    async placeSwap(){sideEffectSawDurableIntent=stages.includes('executing')&&owner.marketArena.active.execution.intentPersisted===true;return {reconciled:true,ordId:'ord-1',clOrdId:owner.marketArena.active.execution.clOrdId,entryPrice:60000};}
  };
  const out=await Market.execute(owner,owner.agent,adapter,p.battle.id,{persist:async stage=>stages.push(stage),acquireLease:async()=>true,releaseLease:async()=>true});
  assert.equal(out.battle.status,'active');
  assert.equal(sideEffectSawDurableIntent,true);
  assert.deepEqual(stages.slice(0,2),['executing','active']);
});

test('ambiguous Agent Kit execution failure enters recovery and retains the account lease', async()=>{
  const owner={agent:E.newAgent('NORI','NORI','explore',1700000000000)};
  const sim=new SimAdapter({clock:()=>1700000000000});
  const p=await Market.prepare(owner,owner.agent,sim,'ETH');
  let releases=0;
  const adapter={profile:'agent-kit-test',demoOnly:true,
    async accountSnapshot(){return {equity:10000,positionMode:'net_mode',positions:[]};},
    async marketSnapshot(){return sim.marketSnapshot('ETH-USDT-SWAP');},
    async placeSwap(){throw new Error('transport lost after write');}
  };
  await assert.rejects(()=>Market.execute(owner,owner.agent,adapter,p.battle.id,{persist:async()=>{},acquireLease:async()=>true,releaseLease:async()=>{releases++;return true;}}),/transport lost/);
  assert.equal(owner.marketArena.active.status,'recovery_required');
  assert.equal(owner.marketArena.active.execution.intentPersisted,true);
  assert.equal(releases,0,'ambiguous real-account failure must retain the lease');
});

test('deployment market access is an absolute ceiling over owner settings',()=>{
  const owner={agent:E.newAgent('NORI','NORI','explore',1700000000000)};
  Market.permissionState(owner,'enabled');
  assert.equal(Market.requireMarketPermission(owner,'prepare','disabled').code,'market_disabled');
  assert.equal(Market.requireMarketPermission(owner,'prepare','paused').code,'market_paused');
  assert.equal(Market.requireMarketPermission(owner,'close','paused').ok,true);
});
