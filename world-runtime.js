'use strict';
const E = require('./engine');
const PerpsGame = require('./perps-game');
const Pulse = require('./pulse-engine');

function score(agent){
  const pub=E.publicAgent(agent);
  if(Number.isFinite(Number(pub.overall))) return Number(pub.overall);
  const capabilities=pub.capabilities || [];
  const evidence=capabilities.reduce((sum,c)=>sum+Number(c.n||0),0);
  const avg=capabilities.length ? capabilities.reduce((sum,c)=>sum+Number(c.score||0),0)/capabilities.length : 0;
  return Math.round(1000 + avg*2 + evidence*3 + Number(pub.reputation||0)*2);
}
function runtime(owner, options={}){
  if(!owner.agent) return { adopted:false };
  const agent=E.publicAgent(owner.agent);
  const perps=PerpsGame.publicPerps(owner);
  const pulse=Pulse.publicPulse(owner);
  const a2a=options.a2a || { mode:'disabled', liveSettlement:false, recent:[] };
  return {
    adopted:true,
    generatedAt:Date.now(),
    agent:{ id:agent.id,name:agent.name,persona:agent.persona,evolution:agent.evolution, intelligence:score(owner.agent), memoryCount:(owner.agent.memory||[]).length, recentMemory:agent.recentMemory||[], capabilities:agent.capabilities||[], reputation:agent.reputation||0 },
    districts:{
      agentlab:{ status:'live', label:'Agent Tower', detail:'Persistent identity, memory and evidence.' },
      arena:{ status:'live', label:'AI Arena', detail:'Competitive Agent proving ground.' },
      market:{ status:options.marketVisible===false?'offline':'live', label:'Market Citadel', detail:options.marketAdapter==='agent-kit'?'OKX Demo Trading connected.':'Server simulator connected.', adapter:options.marketAdapter||'sim', access:options.marketAccess||'enabled' },
      pulse:{ status:'test', label:'Pulse District', detail:'Server-owned timed market rounds; no BNB real-money execution.', mode:pulse.mode, active:Boolean(pulse.active) },
      a2a:{ status:a2a.liveSettlement?'live':a2a.mode==='simulated_settlement'?'test':'offline', label:'A2A Exchange', detail:a2a.liveSettlement?'Real Agent-to-Agent settlement through GOAT Flow and Base USDC escrow.':a2a.mode==='simulated_settlement'?'Development simulation only.':'A2A marketplace is disabled.', mode:a2a.mode },
      portal:{ status:'live', label:'Portal Hub', detail:'KULT experiences feed the same Agent Core.' },
    },
    market:{ rating:perps.rating,title:perps.title,citadelLevel:perps.citadelLevel,skills:perps.skills },
    pulse:{ stats:pulse.stats, active:pulse.active, recent:pulse.history.slice(0,5), accelerated:pulse.accelerated },
    a2a:{ mode:a2a.mode, liveSettlement:Boolean(a2a.liveSettlement), chain:a2a.chain||null, chainId:a2a.chainId||null, escrow:a2a.escrow||null, receiver:a2a.receiver||null, marketplaceUrl:a2a.marketplaceUrl||null, recent:(a2a.recent||a2a.hires||[]).slice(0,5), services:a2a.services||[] },
  };
}
module.exports={ runtime, score };
