'use strict';
const { createOkxAdapter } = require('../okx-agent-kit');
const { INSTRUMENTS } = require('../market-arena');

(async () => {
  const adapter = createOkxAdapter();
  const health = await adapter.health();
  if (!health.ok) {
    console.error(JSON.stringify({ ok:false, stage:'health', ...health }, null, 2));
    process.exit(1);
  }
  const instruments=Object.values(INSTRUMENTS);
  const [market, ...accounts]=await Promise.all([
    adapter.marketSnapshot(INSTRUMENTS.BTC),
    ...instruments.map(instId=>adapter.accountSnapshot(instId)),
  ]);
  const openPositions=[];
  for(let i=0;i<accounts.length;i++) for(const position of accounts[i].positions||[]) {
    const pos=Number(position.pos??position.position??position.sz)||0;
    if(Math.abs(pos)>0) openPositions.push({instId:instruments[i],pos,ordId:position.ordId||null,clOrdId:position.clOrdId||null});
  }
  const account=accounts[0]||{};
  const result={
    ok:openPositions.length===0,
    stage:openPositions.length?'account_not_flat':'ready',
    adapter:health.adapter,
    demoOnly:health.demoOnly,
    profile:health.profile,
    btcLast:market.ticker.last,
    fundingRate:market.funding.rate,
    equity:account.equity,
    positionMode:account.positionMode,
    accountLevel:account.accountLevel||null,
    checkedInstruments:instruments,
    openPositions,
    writesPerformed:0,
  };
  console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exit(2);
})().catch(error=>{
  console.error(JSON.stringify({ok:false,code:error.code||'preflight_failed',error:error.message},null,2));
  process.exit(1);
});
