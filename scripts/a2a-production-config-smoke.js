'use strict';
const {spawn}=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');
const port=21100+(process.pid%300);
const base=`http://127.0.0.1:${port}`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kult-a2a-prod-'));
const env={...process.env,NODE_ENV:'production',PORT:String(port),PUBLIC_ORIGIN:'https://world.example.test',KULT_PERSISTENCE:'sqlite',KULT_DATA_DB:path.join(tmp,'kult.sqlite'),KULT_ADMIN_TOKEN:'kult-a2a-production-smoke-token-0123456789',KULT_MARKET_ADAPTER:'sim',KULT_MARKET_ACCESS:'enabled',KULT_PULSE_REFERENCE_ADAPTER:'sim',KULT_A2A_MODE:'external',KULT_A2A_API_URL:'https://a2a-api.example.test',KULT_A2A_CHAIN_API_URL:'https://a2a-chain.example.test',KULT_A2A_MARKETPLACE_URL:'https://a2a.example.test/marketplace/a2a',KULT_PROOF_RAIL_ENABLED:'false',KULT_REQUEST_LOGS:'false'};
let child;
async function stop(){if(child&&child.exitCode===null)await new Promise(r=>{const t=setTimeout(()=>{try{child.kill('SIGKILL')}catch(_){}r()},3000);child.once('exit',()=>{clearTimeout(t);r()});child.kill('SIGTERM')});fs.rmSync(tmp,{recursive:true,force:true})}
async function main(){try{
 child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{let done=false;const t=setTimeout(()=>{if(!done)reject(new Error('production external-A2A startup timeout'))},8000);const poll=async()=>{try{const r=await fetch(`${base}/api/health`);if(r.ok){done=true;clearTimeout(t);return resolve()}}catch(_){}if(!done)setTimeout(poll,100)};child.once('exit',c=>{if(!done){done=true;clearTimeout(t);reject(new Error(`server exited ${c}`))}});poll()});
 const r=await fetch(`${base}/api/integrations`);const d=await r.json();if(!r.ok)throw new Error('integrations endpoint failed');if(d.a2a?.mode!=='goat-base-external'||d.a2a?.paidSettlement!==true)throw new Error(`unexpected A2A production config: ${JSON.stringify(d.a2a)}`);
 console.log(JSON.stringify({ok:true,production:true,a2aMode:d.a2a.mode,paidSettlement:d.a2a.paidSettlement,escrow:d.a2a.escrow,receiver:d.a2a.receiver},null,2));
}finally{await stop()}}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
