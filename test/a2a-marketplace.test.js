'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine');
const A2A=require('../a2a-marketplace');

test('A2A hire spends only demo credit, persists a receipt and creates world-experience memory',()=>{
  const owner={agent:E.newAgent('ATHENA','ATHENA','explore',1700000000000)};
  const before=Object.values(owner.agent.capability).reduce((n,c)=>n+Number(c.n||0),0);
  const out=A2A.hire(owner,owner.agent,'risk',{now:1700000001000});
  assert.equal(out.receipt.settlement,'simulated');
  assert.equal(out.a2a.demoBalanceUsd,.96);
  assert.match(out.receipt.output.summary,/risk policy|commitment/i);
  assert.equal(owner.agent.memory.at(-1).type,'a2a-service');
  assert.equal(owner.agent.memory.at(-1).trustClass,'WORLD_EXPERIENCE');
  const after=Object.values(owner.agent.capability).reduce((n,c)=>n+Number(c.n||0),0);
  assert.equal(after,before,'simulated A2A service must not manufacture verified capability evidence');
});

test('A2A rejects unknown services without spending demo credit',()=>{
  const owner={agent:E.newAgent('NORI','NORI','explore',1700000000000)};
  const initial=A2A.publicA2A(owner).demoBalanceUsd;
  const out=A2A.hire(owner,owner.agent,'not-real');
  assert.equal(out.code,'service_not_found');
  assert.equal(A2A.publicA2A(owner).demoBalanceUsd,initial);
});
