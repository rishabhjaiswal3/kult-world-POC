'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const port = 18800 + (process.pid % 700);
const base = `http://127.0.0.1:${port}`;
const publicOrigin = `https://127.0.0.1:${port}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kult-fullstack-v64-'));
const db = path.join(tmp, 'kult.sqlite');
const env = {
  ...process.env,
  NODE_ENV: 'production', PORT: String(port), PUBLIC_ORIGIN: publicOrigin, TRUST_PROXY: 'false',
  KULT_PERSISTENCE: 'sqlite', KULT_DATA_DB: db,
  KULT_MARKET_ADAPTER: 'sim', KULT_MARKET_ACCESS: 'enabled',
  KULT_PULSE_REFERENCE_ADAPTER: 'sim', KULT_PULSE_ACCELERATED: 'false', KULT_WAIT_ACCELERATED: 'false',
  KULT_REQUEST_LOGS: 'false', KULT_ADMIN_TOKEN: 'kult-fullstack-e2e-admin-token-0123456789',
  KULT_A2A_MODE: 'disabled', KULT_PROOF_RAIL_ENABLED: 'false', KULT_XLAYER_NETWORK: 'testnet'
};
let child=null,cookie='';
function start(){return new Promise((resolve,reject)=>{child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});let settled=false;const timer=setTimeout(()=>{if(!settled)reject(new Error('server startup timeout'))},8000);const check=async()=>{try{const r=await fetch(`${base}/api/health`);if(r.ok){settled=true;clearTimeout(timer);return resolve()}}catch(_){}if(!settled)setTimeout(check,100)};child.once('exit',code=>{if(!settled){settled=true;clearTimeout(timer);reject(new Error(`server exited during startup (${code})`))}});check()})}
async function stop(){if(!child||child.exitCode!==null)return;const proc=child;await new Promise(resolve=>{const t=setTimeout(()=>{try{proc.kill('SIGKILL')}catch(_){}resolve()},5000);proc.once('exit',()=>{clearTimeout(t);resolve()});proc.kill('SIGTERM')});child=null}
async function raw(pathname){const r=await fetch(`${base}${pathname}`,{headers:cookie?{Cookie:cookie}:{}});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const text=await r.text();if(!r.ok)throw new Error(`GET ${pathname} -> ${r.status}`);return text}
async function api(method,pathname,body,expected=200){const headers={Accept:'application/json'};if(cookie)headers.Cookie=cookie;if(!['GET','HEAD'].includes(method)){headers.Origin=publicOrigin;headers['Content-Type']='application/json'}const r=await fetch(`${base}${pathname}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch(_){throw new Error(`${method} ${pathname} non-JSON`)}if(r.status!==expected)throw new Error(`${method} ${pathname}: expected ${expected}, got ${r.status}: ${JSON.stringify(data)}`);return data}
async function main(){try{
  await start();
  const home=await raw('/'); if(!/KULT WORLD/i.test(home))throw new Error('frontend shell not served');
  const app=await raw('/app.js'); if(!/api\/world\/runtime/.test(app))throw new Error('frontend not wired to world runtime');
  const world3d=await raw('/world3d.js'); if(!/three/i.test(world3d))throw new Error('Three.js world module missing');
  const marketJs=await raw('/market.js'); if(!/api\/market\/battle\/prepare/.test(marketJs))throw new Error('market frontend not wired to backend');
  const integrations=await api('GET','/api/integrations'); if(!integrations.frontend?.servedByBackend||integrations.certification?.liveMoney!==false)throw new Error('integration status failed');
  const ready=await api('GET','/api/ready'); if(!ready.ready)throw new Error('readiness failed');
  const adopted=await api('POST','/api/adopt',{name:'Aegis',persona:'AEGIS',mandate:'learn'}); if(!adopted.agent?.id)throw new Error('adoption failed');
  const runtime=await api('GET','/api/world/runtime'); if(!runtime.runtime||!runtime.agentState)throw new Error('world runtime failed');
  const pulse=await api('POST','/api/pulse/prepare',{symbol:'BTC',horizon:5}); await api('POST','/api/pulse/commit',{roundId:pulse.round.id,choice:'follow'});
  const a2aState=await api('GET','/api/a2a/state'); if(a2aState.a2a?.mode!=='disabled')throw new Error('A2A disable boundary failed');
  const prepared=await api('POST','/api/market/battle/prepare',{symbol:'BTC'}); const battle=prepared.battle; if(!battle?.id)throw new Error('market prepare failed');
  if(battle.nori?.action==='wait'){const observing=await api('POST','/api/market/battle/abstain',{battleId:battle.id});if(observing.battle?.status!=='observing')throw new Error('WAIT failed')}
  else {const executed=await api('POST','/api/market/battle/execute',{battleId:battle.id});if(executed.battle?.status!=='active')throw new Error('execute failed');const closed=await api('POST','/api/market/battle/close',{battleId:battle.id});if(closed.battle?.status!=='closed')throw new Error('close failed');const resolved=await api('POST','/api/market/battle/resolve',{battleId:battle.id});if(resolved.battle?.status!=='resolved')throw new Error('resolve failed')}
  const before=await api('GET','/api/state'); await stop(); await start(); const after=await api('GET','/api/state'); if(!after.adopted||after.agent?.id!==before.agent?.id)throw new Error('restart persistence failed');
  const a2a=await api('GET','/api/a2a/state'); if(a2a.a2a?.mode!=='disabled')throw new Error('A2A state changed across restart');
  console.log(JSON.stringify({ok:true,version:require('../package.json').version,frontendServedByBackend:true,worldRuntime:true,pulseIntegrated:true,a2aBridgeVerifiedSeparately:true,perpWarsIntegrated:true,sqliteRestartPersistence:true,releaseScope:'public-beta-demo'},null,2));
} finally {await stop().catch(()=>{});fs.rmSync(tmp,{recursive:true,force:true})}}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
