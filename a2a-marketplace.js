'use strict';

const crypto = require('crypto');

const SERVICES = Object.freeze({
  orderflow: Object.freeze({ id:'orderflow', provider:'SHADOW-221', name:'Order Flow Intelligence', capability:'analysis', priceUsd:0.03, reputation:4.8, description:'Interprets spread, momentum and positioning into a structured market note.' }),
  risk: Object.freeze({ id:'risk', provider:'AEGIS-102', name:'Risk Calibration', capability:'strategy', priceUsd:0.04, reputation:4.9, description:'Challenges sizing, confidence and failure conditions before commitment.' }),
  counterfactual: Object.freeze({ id:'counterfactual', provider:'ATHENA-914', name:'Counterfactual Review', capability:'analysis', priceUsd:0.02, reputation:4.7, description:'Builds the strongest opposing scenario so the buyer can stress-test its thesis.' }),
});

function clone(value){ return JSON.parse(JSON.stringify(value)); }
function ensureA2A(owner){
  owner.a2a ||= { version:1, mode:'simulated_settlement', demoBalanceUsd:1.00, hires:[], createdAt:Date.now() };
  owner.a2a.hires ||= [];
  if (!Number.isFinite(Number(owner.a2a.demoBalanceUsd))) owner.a2a.demoBalanceUsd = 1.00;
  return owner.a2a;
}
function publicA2A(owner){
  const a=ensureA2A(owner);
  return { mode:a.mode, demoBalanceUsd:Number(a.demoBalanceUsd), services:Object.values(SERVICES).map(clone), hires:a.hires.slice(0,16).map(clone) };
}
function serviceResult(service, agent){
  const name=agent.name || 'Agent';
  if(service.id==='orderflow') return { summary:`${name} should require spread stability and a second momentum confirmation before increasing conviction.`, tags:['spread','momentum','confirmation'], confidence:72 };
  if(service.id==='risk') return { summary:`Keep the next commitment inside the existing KULT risk policy and treat low-confidence setups as observation opportunities.`, tags:['risk','calibration','wait'], confidence:86 };
  return { summary:`The strongest opposing case is that current momentum is already priced in; invalidate the thesis if confirmation fails rather than increasing leverage.`, tags:['counterfactual','invalidation','discipline'], confidence:79 };
}
function hire(owner, agent, serviceId, options={}){
  const state=ensureA2A(owner), service=SERVICES[String(serviceId||'').toLowerCase()];
  if(!service) return { error:'Unknown Agent service.', code:'service_not_found' };
  const price=Number(service.priceUsd);
  if(state.demoBalanceUsd + 1e-9 < price) return { error:'Demo service balance is too low.', code:'demo_balance_low' };
  const now=Number(options.now ?? Date.now());
  state.demoBalanceUsd=Number((state.demoBalanceUsd-price).toFixed(2));
  const output=serviceResult(service,agent);
  const receipt={ id:`a2a_${now.toString(36)}_${crypto.randomBytes(4).toString('hex')}`, serviceId:service.id, provider:service.provider, name:service.name, priceUsd:price, settlement:'simulated', status:'completed', requestedAt:now, completedAt:now, output };
  state.hires.unshift(receipt); state.hires=state.hires.slice(0,40);
  agent.memory ||= [];
  agent.memory.push({ type:'a2a-service', place:'A2A Exchange', district:'a2a', cap:service.capability, trustClass:'WORLD_EXPERIENCE', outcome:'completed', createdAt:now, context:{ serviceId:service.id, provider:service.provider, settlement:'simulated' }, text:`${agent.name} hired ${service.provider} for ${service.name}. The simulated service returned: ${output.summary}` });
  agent.memory=agent.memory.slice(-80);
  return { receipt:clone(receipt), a2a:publicA2A(owner), agentMemoryAdded:true };
}
module.exports={ SERVICES, ensureA2A, publicA2A, hire };
