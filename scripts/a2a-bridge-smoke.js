'use strict';
const http=require('http');
const assert=require('node:assert/strict');

async function main(){
  const port=19600+(process.pid%500);
  const seen=[];
  const server=http.createServer(async(req,res)=>{
    let body=''; for await(const chunk of req)body+=chunk;
    seen.push({method:req.method,url:req.url,body,authorization:req.headers.authorization||null});
    res.setHeader('content-type','application/json');
    if(req.url==='/health') return res.end(JSON.stringify({ok:true,service:'a2a'}));
    if(req.method==='POST'&&/^\/jobs\/job-1\/goat\/orders$/.test(req.url)) return res.end(JSON.stringify({orderId:'ord-1',flow:'DELEGATE',calldataSignRequest:{domain:{name:'GOAT'}}}));
    if(req.method==='POST'&&req.url==='/jobs/job-1/goat/orders/ord-1/signature') return res.end(JSON.stringify({orderId:'ord-1',submitted:true}));
    if(req.method==='GET'&&req.url==='/jobs/job-1/goat/orders/ord-1') return res.end(JSON.stringify({orderId:'ord-1',status:'PAID',jobStatus:'ESCROWED'}));
    if(req.method==='GET'&&/^\/goat\/credit\/0x[a-fA-F0-9]{40}$/.test(req.url)) return res.end(JSON.stringify({creditBaseUnits:'0'}));
    res.statusCode=404;res.end(JSON.stringify({error:'not found'}));
  });
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  const old={...process.env};
  try{
    process.env.KULT_A2A_MODE='external';
    process.env.KULT_A2A_API_URL=`http://127.0.0.1:${port}`;
    process.env.KULT_A2A_CHAIN_API_URL=`http://127.0.0.1:${port}`;
    process.env.KULT_A2A_MARKETPLACE_URL='https://app.example.com/marketplace/a2a';
    process.env.KULT_A2A_SERVICE_BEARER='bridge-secret';
    process.env.NODE_ENV='development';
    const B=require('../a2a-goat-bridge');
    const req={headers:{}};
    const order=await B.createOrder(req,'job-1',8453); assert.equal(order.orderId,'ord-1');
    const sig='0x'+'11'.repeat(65);
    const submitted=await B.submitSignature(req,'job-1','ord-1',sig); assert.equal(submitted.submitted,true);
    const status=await B.orderStatus(req,'job-1','ord-1'); assert.equal(status.status,'PAID');
    const payer='0x'+'22'.repeat(20); const credit=await B.credit(req,payer); assert.equal(credit.creditBaseUnits,'0');
    const health=await B.health(req); assert.equal(health.ok,true);
    const st=B.publicState({a2aBridge:{recent:[]}}); assert.equal(st.liveSettlement,true); assert.equal(st.chainId,8453);
    assert.equal(B.marketplaceLaunch({id:'agent-1',name:'Aegis'}).includes('kultAgentId=agent-1'),true);
    assert.equal(seen.every(x=>x.authorization==='Bearer bridge-secret'),true);
    console.log(JSON.stringify({ok:true,bridge:'external',routesTested:4,health:true,chainId:8453},null,2));
  } finally {
    Object.keys(process.env).forEach(k=>{if(!(k in old))delete process.env[k]}); Object.assign(process.env,old);
    await new Promise(r=>server.close(r));
  }
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
