'use strict';
const http=require('http');
const {spawn}=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');

const a2aPort=20100+(process.pid%400);
const kultPort=20500+(process.pid%400);
const a2aBase=`http://127.0.0.1:${a2aPort}`;
const kultBase=`http://127.0.0.1:${kultPort}`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kult-a2a-e2e-'));
let upstream=null,child=null,cookie='';
async function startUpstream(){
  upstream=http.createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    res.setHeader('content-type','application/json');
    if(req.url==='/health')return res.end(JSON.stringify({ok:true}));
    if(req.method==='POST'&&req.url==='/jobs/job-42/goat/orders')return res.end(JSON.stringify({orderId:'ord-42',flow:'DELEGATE',calldataSignRequest:{domain:{name:'GOAT'}}}));
    if(req.method==='POST'&&req.url==='/jobs/job-42/goat/orders/ord-42/signature')return res.end(JSON.stringify({orderId:'ord-42',submitted:true}));
    if(req.method==='GET'&&req.url==='/jobs/job-42/goat/orders/ord-42')return res.end(JSON.stringify({orderId:'ord-42',status:'PAID',jobStatus:'ESCROWED'}));
    if(req.method==='GET'&&/^\/goat\/credit\/0x[a-fA-F0-9]{40}$/.test(req.url))return res.end(JSON.stringify({creditBaseUnits:'0'}));
    res.statusCode=404;res.end(JSON.stringify({error:'not found'}));
  });
  await new Promise(r=>upstream.listen(a2aPort,'127.0.0.1',r));
}
async function startKult(){
  const env={...process.env,NODE_ENV:'development',PORT:String(kultPort),PUBLIC_ORIGIN:kultBase,KULT_PERSISTENCE:'sqlite',KULT_DATA_DB:path.join(tmp,'kult.sqlite'),KULT_MARKET_ADAPTER:'sim',KULT_MARKET_ACCESS:'enabled',KULT_PULSE_REFERENCE_ADAPTER:'sim',KULT_A2A_MODE:'external',KULT_A2A_API_URL:a2aBase,KULT_A2A_CHAIN_API_URL:a2aBase,KULT_A2A_MARKETPLACE_URL:'https://app.example.com/marketplace/a2a',KULT_REQUEST_LOGS:'false'};
  child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let done=false;const t=setTimeout(()=>{if(!done)reject(new Error('KULT startup timeout'))},8000);const poll=async()=>{try{const r=await fetch(`${kultBase}/api/health`);if(r.ok){done=true;clearTimeout(t);return resolve()}}catch(_){}if(!done)setTimeout(poll,100)};child.once('exit',c=>{if(!done){done=true;clearTimeout(t);reject(new Error(`KULT exited ${c}`))}});poll()});
}
async function stop(){if(child&&child.exitCode===null)await new Promise(r=>{const t=setTimeout(()=>{try{child.kill('SIGKILL')}catch(_){}r()},3000);child.once('exit',()=>{clearTimeout(t);r()});child.kill('SIGTERM')});child=null;if(upstream)await new Promise(r=>upstream.close(r));upstream=null;fs.rmSync(tmp,{recursive:true,force:true})}
async function api(method,p,body,expected=200){const headers={Accept:'application/json'};if(cookie)headers.Cookie=cookie;if(!['GET','HEAD'].includes(method)){headers.Origin=kultBase;headers['Content-Type']='application/json'}const r=await fetch(`${kultBase}${p}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const d=await r.json();if(r.status!==expected)throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(d)}`);return d}
async function main(){try{
  await startUpstream();await startKult();
  await api('POST','/api/adopt',{name:'Aegis',persona:'AEGIS',mandate:'learn'});
  const state=await api('GET','/api/a2a/state');if(!state.a2a?.liveSettlement||!state.a2a?.launchUrl)throw new Error('real A2A state not exposed');
  const health=await api('GET','/api/a2a/health');if(!health.ok)throw new Error('A2A health failed');
  const order=await api('POST','/api/a2a/jobs/job-42/goat/orders',{payChainId:8453});if(order.orderId!=='ord-42')throw new Error('order bridge failed');
  const sig='0x'+'11'.repeat(65);const submitted=await api('POST','/api/a2a/jobs/job-42/goat/orders/ord-42/signature',{signature:sig});if(!submitted.submitted)throw new Error('signature bridge failed');
  const status=await api('GET','/api/a2a/jobs/job-42/goat/orders/ord-42');if(status.status!=='PAID')throw new Error('status bridge failed');
  const payer='0x'+'22'.repeat(20);const credit=await api('GET',`/api/a2a/goat/credit/${payer}`);if(credit.creditBaseUnits!=='0')throw new Error('credit bridge failed');
  const after=await api('GET','/api/a2a/state');if((after.a2a?.recent||[]).length<2)throw new Error('KULT A2A audit memory missing');
  console.log(JSON.stringify({ok:true,serverBridge:true,marketplaceLaunch:true,health:true,goatOrder:true,signature:true,status:true,credit:true,recentBridgeEvents:after.a2a.recent.length},null,2));
}finally{await stop()}}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
