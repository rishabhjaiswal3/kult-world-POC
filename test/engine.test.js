const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine');

test('autonomous life never manufactures owner bond',()=>{
  const a=E.newAgent('NORI','NORI','explore',1),bond=a.needs.bond;
  for(let i=0;i<20;i++)E.step(a,1000+i);
  assert.equal(a.needs.bond,bond);
});

test('focus changes direction without granting skill or evidence',()=>{
  const a=E.newAgent('ATHENA','ATHENA','learn',1),before=a._trueSkill.analysis;
  assert.equal(E.setFocus(a,'analysis',100000000).ok,true);
  assert.equal(a._trueSkill.analysis,before);
  assert.equal(E.publicAgent(a).capabilities.find(c=>c.cap==='analysis').n,0);
});

test('mission attempts create evidence, proof and bounded rewards',()=>{
  const a=E.newAgent('AEGIS','AEGIS','compete',1),credits=a.credits;
  const result=E.runMission(a,'arena_trial','wait',2);
  assert.equal(result.ok,true);
  assert.equal(a.missionsCompleted,1);
  assert.equal(a.proofs.length,1);
  assert.equal(E.publicAgent(a).capabilities.find(c=>c.cap==='strategy').n,1);
  assert.ok(a.credits===credits||a.credits===credits+E.MISSIONS.arena_trial.credits);
});

test('home purchases cost credits and never create capability evidence',()=>{
  const a=E.newAgent('PIXEL','PIXEL','create',1),before=a.credits;
  const evidence=E.publicAgent(a).capabilities.reduce((n,c)=>n+c.n,0);
  assert.equal(E.buyHomeItem(a,'makerDesk',2).ok,true);
  assert.equal(a.credits,before-E.HOME_ITEMS.makerDesk.cost);
  assert.equal(E.buyHomeItem(a,'makerDesk',3).error,'already owned');
  assert.equal(E.publicAgent(a).capabilities.reduce((n,c)=>n+c.n,0),evidence);
});

test('wallet validation and proof anchoring state reject bad input',()=>{
  const a=E.newAgent('MOSS','MOSS','explore',1);
  assert.ok(E.linkWallet(a,'bad').error);
  assert.equal(E.linkWallet(a,'0x1111111111111111111111111111111111111111').ok,true);
  assert.ok(E.markProofAnchored(a,'missing','0x0').error);
});

test('wallet ownership stays unverified until a real receipt is anchored',()=>{
  const a=E.newAgent('MOSS','MOSS','explore',1);
  a.needs.energy=100;
  const mission=E.runMission(a,'welcome_shift','listen',2);
  const first='0x1111111111111111111111111111111111111111';
  const second='0x2222222222222222222222222222222222222222';
  E.linkWallet(a,first);
  assert.equal(a.walletVerified,false);
  E.markProofAnchored(a,mission.proof.id,`0x${'a'.repeat(64)}`,{blockNumber:12,confirmations:2});
  assert.equal(a.walletVerified,true);
  E.linkWallet(a,second);
  assert.equal(a.walletVerified,false,'changing the claimed wallet clears verification');
});

test('return streak advances once per UTC day and resets after a gap',()=>{
  const day=86_400_000;
  const a=E.newAgent('AEGIS','AEGIS','explore',day+1);
  E.ownerReturn(a,day*2+1);
  assert.equal(a.streak,2);
  E.ownerReturn(a,day*2+2000);
  assert.equal(a.streak,2,'repeat opens on the same day do not inflate streak');
  E.ownerReturn(a,day*5+1);
  assert.equal(a.streak,1);
});

test('visible evolution uses the same canonical capability tiers',()=>{
  const a=E.newAgent('NORI','NORI','explore',1);
  assert.equal(E.evolutionFor(a).id,'emerging');
  a.capability.analysis={success:7,fail:0,n:7};
  assert.equal(E.capabilityView(a).find(c=>c.cap==='analysis').tier,'capable');
  assert.equal(E.evolutionFor(a).id,'capable');
  a.capability.analysis={success:14,fail:0,n:14};
  assert.equal(E.evolutionFor(a).id,'skilled');
  a.capability.analysis={success:24,fail:0,n:24};
  assert.equal(E.evolutionFor(a).id,'elite');
});
