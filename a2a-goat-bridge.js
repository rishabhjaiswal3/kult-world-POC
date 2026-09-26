'use strict';

const LEGACY = require('./a2a-marketplace');

const BASE_CHAIN_ID = 8453;
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ERC8004_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const DEFAULT_ESCROW = '0xE4F7cB9aAf7dC9f800Cb3C1ea2c26696B2CEBEa3';
const DEFAULT_RECEIVER = '0xD1fc9b992AEa52f8d91c6B49A3FDe21Cf3Ed307E';

class A2ABridgeError extends Error {
  constructor(message, code='a2a_bridge_error', status=502, detail=null) {
    super(message); this.name='A2ABridgeError'; this.code=code; this.status=status; this.detail=detail;
  }
}

function bool(name, fallback=false) {
  const raw=process.env[name]; if(raw===undefined) return fallback;
  return ['1','true','yes','on'].includes(String(raw).toLowerCase());
}
function trimSlash(v){ return String(v||'').replace(/\/+$/, ''); }
function validAddress(v){ return /^0x[a-fA-F0-9]{40}$/.test(String(v||'')); }
function mode(){
  const configured=String(process.env.KULT_A2A_MODE || (process.env.NODE_ENV==='production'?'external':'sim')).toLowerCase();
  return ['external','sim','disabled'].includes(configured)?configured:'disabled';
}
function publicMode(){ const m=mode(); return m==='external'?'goat-base-external':m==='sim'?'simulated_settlement':'disabled'; }
function apiBase(){ return trimSlash(process.env.KULT_A2A_API_URL); }
function chainApiBase(){ return trimSlash(process.env.KULT_A2A_CHAIN_API_URL || process.env.KULT_A2A_API_URL); }
function appUrl(){ return trimSlash(process.env.KULT_A2A_MARKETPLACE_URL); }
function timeoutMs(){ return Math.max(2_000,Math.min(30_000,Number(process.env.KULT_A2A_TIMEOUT_MS||10_000))); }
function addresses(){ return {
  chainId:BASE_CHAIN_ID,
  usdc: validAddress(process.env.KULT_A2A_USDC_ADDRESS)?process.env.KULT_A2A_USDC_ADDRESS:BASE_USDC,
  erc8004Registry: validAddress(process.env.KULT_A2A_ERC8004_REGISTRY)?process.env.KULT_A2A_ERC8004_REGISTRY:ERC8004_REGISTRY,
  escrow: validAddress(process.env.KULT_A2A_ESCROW_ADDRESS)?process.env.KULT_A2A_ESCROW_ADDRESS:DEFAULT_ESCROW,
  receiver: validAddress(process.env.KULT_A2A_RECEIVER_ADDRESS)?process.env.KULT_A2A_RECEIVER_ADDRESS:DEFAULT_RECEIVER,
}; }
function validateProduction(){
  if(process.env.NODE_ENV!=='production') return [];
  const problems=[]; const m=mode();
  if(m==='sim') problems.push('KULT_A2A_MODE=external or disabled (simulated A2A is not allowed in production v6.5)');
  if(m==='external') {
    if(!apiBase()) problems.push('KULT_A2A_API_URL');
    if(!appUrl()) problems.push('KULT_A2A_MARKETPLACE_URL');
    try { if(apiBase() && new URL(apiBase()).protocol!=='https:') problems.push('KULT_A2A_API_URL must use https in production'); } catch(_) { problems.push('KULT_A2A_API_URL must be a valid URL'); }
    try { if(appUrl() && new URL(appUrl()).protocol!=='https:') problems.push('KULT_A2A_MARKETPLACE_URL must use https in production'); } catch(_) { problems.push('KULT_A2A_MARKETPLACE_URL must be a valid URL'); }
  }
  return problems;
}
function remember(owner, event){
  owner.a2aBridge ||= { recent:[] };
  owner.a2aBridge.recent ||= [];
  owner.a2aBridge.recent.unshift({ ...event, at:event.at||Date.now() });
  owner.a2aBridge.recent=owner.a2aBridge.recent.slice(0,20);
}
function publicState(owner){
  const m=mode();
  if(m==='sim') return { ...LEGACY.publicA2A(owner), integration:'legacy-sim', liveSettlement:false };
  return {
    mode:m==='external'?'goat-base-external':'disabled',
    integration:'a2a-goat-marketplace',
    liveSettlement:m==='external',
    chain:'Base',
    ...addresses(),
    apiConfigured:Boolean(apiBase()),
    marketplaceUrl:appUrl()||null,
    recent:(owner?.a2aBridge?.recent||[]).slice(0,12),
    routes:{
      createOrder:'/api/a2a/jobs/:jobId/goat/orders',
      submitSignature:'/api/a2a/jobs/:jobId/goat/orders/:orderId/signature',
      orderStatus:'/api/a2a/jobs/:jobId/goat/orders/:orderId',
      credit:'/api/a2a/goat/credit/:payer',
    },
  };
}
function inboundHeaders(req){
  const out={ accept:'application/json' };
  const serviceBearer=String(process.env.KULT_A2A_SERVICE_BEARER||'').trim();
  if(serviceBearer) out.authorization=`Bearer ${serviceBearer}`;
  else if(bool('KULT_A2A_FORWARD_AUTHORIZATION',false) && req?.headers?.authorization) out.authorization=String(req.headers.authorization);
  if(bool('KULT_A2A_FORWARD_COOKIE',false) && req?.headers?.cookie) out.cookie=String(req.headers.cookie);
  if(req?.headers?.['x-request-id']) out['x-request-id']=String(req.headers['x-request-id']);
  return out;
}
async function upstream(base, pathname, {method='GET', body, req}={}){
  if(!base) throw new A2ABridgeError('A2A marketplace API is not configured.','a2a_not_configured',503);
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs());
  const headers=inboundHeaders(req); if(body!==undefined) headers['content-type']='application/json';
  try{
    const response=await fetch(`${base}${pathname}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:controller.signal});
    const text=await response.text(); let data={}; try{ data=text?JSON.parse(text):{}; }catch(_){ data={ error:text||`A2A upstream returned ${response.status}` }; }
    if(!response.ok) throw new A2ABridgeError(data.error||`A2A upstream returned ${response.status}`,'a2a_upstream_error',response.status,data);
    return data;
  } catch(error){
    if(error instanceof A2ABridgeError) throw error;
    if(error?.name==='AbortError') throw new A2ABridgeError('A2A marketplace timed out.','a2a_timeout',504);
    throw new A2ABridgeError(`A2A marketplace unavailable: ${error.message}`,'a2a_unavailable',503);
  } finally { clearTimeout(timer); }
}
function safeSegment(v,label){ const s=String(v||''); if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(s)) throw new A2ABridgeError(`Invalid ${label}.`,'invalid_a2a_identifier',400); return encodeURIComponent(s); }
function safeAddress(v){ if(!validAddress(v)) throw new A2ABridgeError('Invalid payer address.','invalid_payer',400); return v; }
async function createOrder(req, jobId, payChainId){ return upstream(apiBase(),`/jobs/${safeSegment(jobId,'jobId')}/goat/orders`,{method:'POST',body:payChainId===undefined?{}:{payChainId},req}); }
async function submitSignature(req, jobId, orderId, signature){ if(!/^0x[0-9a-fA-F]{130}$/.test(String(signature||''))) throw new A2ABridgeError('Invalid EIP-712 signature.','invalid_signature',400); return upstream(apiBase(),`/jobs/${safeSegment(jobId,'jobId')}/goat/orders/${safeSegment(orderId,'orderId')}/signature`,{method:'POST',body:{signature},req}); }
async function orderStatus(req, jobId, orderId){ return upstream(apiBase(),`/jobs/${safeSegment(jobId,'jobId')}/goat/orders/${safeSegment(orderId,'orderId')}`,{method:'GET',req}); }
async function credit(req,payer){ return upstream(chainApiBase(),`/goat/credit/${encodeURIComponent(safeAddress(payer))}`,{method:'GET',req}); }
async function health(req){
  if(mode()!=='external') return { ok:mode()!=='disabled', mode:mode(), configured:mode()==='sim' };
  if(!apiBase()) return {ok:false,mode:'external',configured:false};
  const path=String(process.env.KULT_A2A_HEALTH_PATH||'/health');
  try{ const data=await upstream(apiBase(),path,{method:'GET',req}); return {ok:true,mode:'external',configured:true,data}; }
  catch(error){ return {ok:false,mode:'external',configured:true,error:error.message,code:error.code}; }
}
function marketplaceLaunch(agent){
  const base=appUrl(); if(!base) return null;
  try{ const u=new URL(base); if(agent?.id) u.searchParams.set('kultAgentId',agent.id); if(agent?.name) u.searchParams.set('kultAgentName',agent.name); u.searchParams.set('source','kult-world'); return u.toString(); }catch(_){ return base; }
}

module.exports={ A2ABridgeError, BASE_CHAIN_ID, BASE_USDC, ERC8004_REGISTRY, DEFAULT_ESCROW, DEFAULT_RECEIVER, mode, publicMode, apiBase, appUrl, addresses, validateProduction, publicState, createOrder, submitSignature, orderStatus, credit, health, remember, marketplaceLaunch };
