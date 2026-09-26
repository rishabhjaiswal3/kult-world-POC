'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine');
const Pulse=require('../pulse-engine');
const {SimAdapter}=require('../okx-agent-kit');

function owner(){ return {agent:E.newAgent('AEGIS','AEGIS','explore',1700000000000)}; }

test('Pulse persists a timed decision lifecycle and adds contextual memory only on settlement', async()=>{
  const o=owner(); let offset=0, now=1700000000000;
  const adapter=new SimAdapter({clock:()=>now,priceOffset:()=>offset});
  const prepared=await Pulse.prepare(o,o.agent,adapter,'BTC',5,{now,durationMs:1000});
  assert.equal(prepared.round.status,'prepared');
  assert.equal(o.agent.memory.length,0);
  const committed=Pulse.commit(o,o.agent,prepared.round.id,'long',{now});
  assert.equal(committed.round.status,'running');
  const early=await Pulse.resolve(o,o.agent,adapter,prepared.round.id,{now:now+500});
  assert.equal(early.code,'pulse_round_running');
  offset=.01; now+=1500;
  const settled=await Pulse.resolve(o,o.agent,adapter,prepared.round.id,{now});
  assert.equal(settled.round.status,'resolved');
  assert.equal(settled.round.result.userOutcome,'correct');
  assert.equal(o.pulse.stats.rounds,1);
  assert.equal(o.agent.memory.at(-1).type,'pulse-round');
  assert.equal(o.agent.memory.at(-1).context.horizonMinutes,5);
  assert.equal(o.agent.memory.at(-1).context.symbol,'BTC');
});

test('Pulse WAIT is judged against a volatility band rather than rewarded automatically', async()=>{
  const o=owner(); let offset=0, now=1700000000000;
  const adapter=new SimAdapter({clock:()=>now,priceOffset:()=>offset});
  let p=await Pulse.prepare(o,o.agent,adapter,'ETH',5,{now,durationMs:1000});
  Pulse.commit(o,o.agent,p.round.id,'wait',{now});
  now+=1100;
  let r=await Pulse.resolve(o,o.agent,adapter,p.round.id,{now});
  assert.equal(r.round.result.userOutcome,'correct','flat market should reward intelligent abstention');
  now+=1000; offset=0;
  p=await Pulse.prepare(o,o.agent,adapter,'ETH',5,{now,durationMs:1000});
  Pulse.commit(o,o.agent,p.round.id,'wait',{now});
  offset=.01; now+=1100;
  r=await Pulse.resolve(o,o.agent,adapter,p.round.id,{now});
  assert.equal(r.round.result.userOutcome,'incorrect','large market move should make WAIT lose the round');
});
