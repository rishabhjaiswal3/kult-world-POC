(() => {
  'use strict';
  const root = document.getElementById('marketView');
  if (!root) return;
  const $ = selector => root.querySelector(selector);
  const $$ = selector => [...root.querySelectorAll(selector)];
  const m = {
    symbol:'BTC', rivalId:'shadow09', arena:null, active:null, config:null,
    health:null, permission:null, wallet:null, busy:false, poll:null,
  };

  async function req(url, opts={}) {
    const response = await fetch(url, {
      method: opts.method || 'GET',
      headers: {'Content-Type':'application/json'},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await response.json().catch(() => ({error:'Invalid server response'}));
    if (!response.ok) {
      const error = new Error(data.error || 'Request failed');
      error.code = data.code; error.status = response.status; error.data = data;
      throw error;
    }
    return data;
  }

  function say(text, type='') {
    if (typeof toast === 'function') return toast(text, type);
    const el = document.getElementById('toast');
    if (el) { el.textContent=text; el.className=`toast show ${type}`; setTimeout(()=>el.className='toast',2600); }
  }
  function money(value, digits=2) { const n=Number(value); return Number.isFinite(n) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:digits}).format(n) : '—'; }
  function px(value) { const n=Number(value); if(!Number.isFinite(n))return'—'; return n>=1000?n.toLocaleString(undefined,{maximumFractionDigits:2}):n.toLocaleString(undefined,{maximumFractionDigits:4}); }
  function pct(value, digits=3) { const n=Number(value); return Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(digits)}%`:'—'; }
  function short(value){const s=String(value||'');return s.length>14?`${s.slice(0,8)}…${s.slice(-5)}`:s;}
  function roman(n){return ['I','II','III','IV','V','VI','VII','VIII'][Math.max(0,Math.min(7,Number(n||1)-1))]||String(n||1);}
  function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}

  function latestResolved() {
    return (m.arena?.battles || []).find(b => b?.status === 'resolved' && b?.result && !b.result.noTrade) || null;
  }

  function dispatch3d() {
    document.dispatchEvent(new CustomEvent('kult:perps-state', { detail:{ arena:m.arena, perps:m.arena?.perps, active:m.arena?.active || null } }));
  }

  function renderRivals(perps={}) {
    const box = $('#perpsRivals'); if (!box) return;
    const rivals = perps.rivals || [];
    if (!rivals.length) { box.innerHTML='<span class="rivalLoading">Rivals loading…</span>'; return; }
    if (!rivals.some(r=>r.id===m.rivalId)) m.rivalId = perps.lastRivalId || rivals[0].id;
    box.innerHTML = rivals.map(r => `
      <button class="perpsRival ${r.id===m.rivalId?'active':''}" data-rival-id="${esc(r.id)}" ${m.active?'disabled':''}>
        <i style="--rival-accent:${esc(r.accent||'#8b7cff')}">${esc(r.glyph||r.name?.[0]||'R')}</i>
        <span><b>${esc(r.name)}</b><small>${esc(r.title)} · ${esc(r.rating)} ELO</small></span>
      </button>`).join('');
    box.querySelectorAll('[data-rival-id]').forEach(btn => btn.addEventListener('click', () => {
      if (m.active) return;
      m.rivalId = btn.dataset.rivalId;
      renderRivals(perps);
      const rival = rivals.find(r=>r.id===m.rivalId);
      if (rival) renderRivalShell(rival);
      dispatch3d();
    }));
  }

  function renderRivalShell(rival={}) {
    $('#rivalName').textContent = rival.name || 'SHADOW-09';
    $('#rivalTitle').textContent = rival.title || 'Counterfactual Hunter';
    $('#rivalGlyph').textContent = rival.glyph || 'S';
    $('#rivalStyle').textContent = String(rival.style || 'adaptive').toUpperCase();
    $('#rivalRating').textContent = `${Number(rival.rating || 1080)} ELO`;
    if (!m.active) {
      $('#shadowDirection').textContent='SCANNING';
      $('#shadowThesis').textContent=rival.description || 'The rival forms an independent policy from the same market snapshot.';
      $('#shadowConfidence').textContent='—';
    }
  }

  function renderSkills(perps={}) {
    const skills = perps.skills || {};
    const labels = { momentum:'Momentum', risk:'Risk Control', orderflow:'Order Flow', contrarian:'Contrarian', calibration:'Calibration', memory:'Market Memory' };
    $('#perpsSkills').innerHTML = Object.entries(labels).map(([key,label]) => {
      const level=Number(skills[key]||1); const width=Math.max(6,Math.min(100,level/20*100));
      return `<div class="perpsSkill"><span>${label}</span><b>LV ${level}</b><i><em style="width:${width}%"></em></i></div>`;
    }).join('');
  }

  function renderProgress(perps={}) {
    const level=Number(perps.citadelLevel||1), rating=Number(perps.rating||1000);
    $('#perpsCitadelTitle').textContent=`CITADEL ${roman(level)}`;
    $('#perpsRankTitle').textContent=perps.title||'Unranked Raider';
    $('#perpsRating').textContent=Math.round(rating);
    $('#perpsSeasonPoints').textContent=`${Math.round(Number(perps.seasonPoints||0))} PTS`;
    $('#perpsTerritory').textContent=Number(perps.territory||1);
    $('#perpsLoot').textContent=Math.round(Number(perps.loot||0));
    $('#perpsStreak').textContent=Number(perps.raidStreak||0);
    $('#perpsBestStreak').textContent=Number(perps.bestRaidStreak||0);
    $('#perpsCitadelLevel').textContent=roman(level);
    $('#marketStage').textContent=`Citadel ${roman(level)}`;
    $('#perpsTitleSmall').textContent=String(perps.title||'Unranked').toUpperCase();
    const nextRating = 1000 + level * 125;
    $('#perpsNextLevel').textContent = level>=8 ? 'MAX CITADEL' : `NEXT: ${nextRating}`;
    const stageProgress = level>=8 ? 100 : Math.max(5,Math.min(99,((rating-(1000+(level-1)*125))/125)*100));
    $('#marketStageBar').style.width=`${stageProgress}%`;
    renderSkills(perps); renderRivals(perps);
  }

  function renderHistory(items) {
    const box=$('#marketHistoryList');
    if(!items?.length){box.innerHTML='<p>No raids yet. Challenge a rival Agent.</p>';return;}
    const receipts=new Map((m.arena?.xlayerReceipts||[]).map(x=>[x.battleId,x]));
    box.innerHTML=items.slice(0,10).map(b=>{
      const r=b.result, receipt=receipts.get(b.id), duel=r?.duelOutcome||r?.outcome||b.status;
      const loot=r?.progression?.lootDelta;
      const label=r?.noTrade?'WAIT':`${(b.nori?.side||'').toUpperCase()} ${b.symbol||''}`;
      return `<div class="marketHistoryRow"><div><b>${esc(label)} · ${esc(b.rival?.name||'RIVAL')}</b><small>${new Date(b.resolvedAt||b.createdAt).toLocaleString()}${loot?` · +${loot} loot`:''}</small></div><span class="${esc(duel)}">${esc(String(duel).toUpperCase())}${r&&!r.noTrade?` ${money(r.pnlUsd)}`:''}</span>${receipt?`<a href="${esc(m.config?.xlayer?.explorerUrl||'')}/tx/${esc(receipt.txHash)}" target="_blank" rel="noreferrer">X Layer proof ↗</a>`:''}</div>`;
    }).join('');
  }

  function renderBattle(b) {
    if (!b) {
      $('#battleReview').classList.add('hidden');
      $('#marketCancelBtn').classList.add('hidden');
      $('#marketAbstainBtn').classList.add('hidden');
      $('#marketPrepareBtn').disabled=false;
      $('#marketPrepareBtn').innerHTML=`Prepare ${m.symbol} raid <b>→</b>`;
      $('#marketPairTitle').textContent=`${m.symbol}-USDT-SWAP`;
      return;
    }
    $('#marketPairTitle').textContent=b.instId;
    $('#noriDirection').textContent = b.nori?.action==='wait' ? 'WAIT' : `${String(b.nori?.side||'').toUpperCase()} ${b.symbol}`;
    $('#noriThesis').textContent=b.nori?.thesis||'—';
    $('#noriConfidence').textContent=`${b.nori?.signalStrength ?? b.nori?.confidence ?? '—'}${Number.isFinite(Number(b.nori?.signalStrength ?? b.nori?.confidence))?' / 100':''}`;
    $('#noriStyle').textContent=String(b.nori?.style||'adaptive').toUpperCase();
    $('#noriRisk').textContent=`RISK ${b.nori?.riskBand||'—'}`;
    renderRivalShell(b.rival||{});
    $('#shadowDirection').textContent=b.rival?.action==='wait'?'WAIT':`${String(b.rival?.side||b.shadow?.side||'').toUpperCase()} ${b.symbol}`;
    $('#shadowThesis').textContent=b.rival?.thesis||b.shadow?.thesis||'—';
    $('#shadowConfidence').textContent=`${b.rival?.signalStrength ?? b.shadow?.confidence ?? '—'}${Number.isFinite(Number(b.rival?.signalStrength ?? b.shadow?.confidence))?' / 100':''}`;
    $('#marketEquity').textContent=money(b.equity,0);

    const box=$('#battleReview'); box.classList.remove('hidden');
    $('#marketCancelBtn').classList.add('hidden'); $('#marketAbstainBtn').classList.add('hidden'); $('#marketPrepareBtn').disabled=false;
    if(b.status==='prepared'){
      const seconds=Math.max(0,Math.ceil((Number(b.expiresAt||0)-Date.now())/1000));
      const wait=b.nori?.action==='wait';
      box.innerHTML=`<div class="reviewStatus ${wait?'wait':'ready'}">${wait?'AGENT RECOMMENDS WAIT':'RAID READY · EXPLICIT CONFIRMATION'}</div><div class="reviewGrid"><div><small>INSTRUMENT</small><b>${esc(b.instId)}</b></div><div><small>YOUR ACTION</small><b>${esc(wait?'WAIT':String(b.nori?.side||'').toUpperCase())}</b></div><div><small>USDT NOTIONAL</small><b>${money(b.notionalUsd)}</b></div><div><small>THESIS EXPIRES</small><b>${seconds}s</b></div></div><p>${wait?'Start a timed WAIT observation. Your Agent stays flat while the rival thesis runs over the same market horizon; WAIT can win, lose, or draw.':'KULT derived this order from Agent memory + market structure. OKX Demo execution occurs only after this separate confirmation.'}</p>`;
      if(wait){ $('#marketPrepareBtn').disabled=true; $('#marketPrepareBtn').textContent='Agent recommends staying flat'; $('#marketAbstainBtn').textContent='Start WAIT observation'; $('#marketAbstainBtn').classList.remove('hidden'); }
      else $('#marketPrepareBtn').innerHTML='Launch OKX demo raid <b>→</b>';
      $('#marketCancelBtn').classList.remove('hidden');
    } else if(b.status==='observing') {
      const remaining=Math.max(0,Number(b.observationEndsAt||0)-Date.now());
      box.innerHTML=`<div class="reviewStatus wait">WAIT OBSERVATION LIVE</div><div class="reviewGrid"><div><small>YOUR EXPOSURE</small><b>FLAT</b></div><div><small>RIVAL ACTION</small><b>${esc(String(b.rival?.action||'wait').toUpperCase())}</b></div><div><small>REFERENCE</small><b>${px(b.entryReference)}</b></div><div><small>SETTLES IN</small><b>${Math.ceil(remaining/1000)}s</b></div></div><p>WAIT is being judged against the rival's virtual market decision. No OKX order was placed.</p>`;
      $('#marketPrepareBtn').innerHTML=remaining<=0?'Resolve WAIT + evolve Agent <b>→</b>':'Check WAIT settlement <b>→</b>';
    } else if(['executing','recovery_required'].includes(b.status)) {
      box.innerHTML=`<div class="reviewStatus active">${b.status==='executing'?'EXECUTION PENDING':'RECOVERY CHECK REQUIRED'}</div><p>KULT persisted the execution intent. Reconcile the OKX demo account before any new action.</p>`;
      $('#marketPrepareBtn').innerHTML='Reconcile execution <b>→</b>';
    } else if(b.status==='active') {
      box.innerHTML=`<div class="reviewStatus active">OKX DEMO RAID LIVE</div><div class="reviewGrid"><div><small>ORDER</small><b>${short(b.execution?.ordId||b.execution?.clOrdId)}</b></div><div><small>ENTRY</small><b>${px(b.execution?.entryPrice)}</b></div><div><small>NOTIONAL</small><b>${money(b.notionalUsd)}</b></div><div><small>RIVAL</small><b>${esc(b.rival?.name||'—')}</b></div></div><p>The market is resolving the raid. Close when you want to lock the outcome; KULT will compare your Agent with the rival's independent thesis.</p>`;
      $('#marketPrepareBtn').innerHTML='Close OKX demo position <b>→</b>';
    } else if(['closing'].includes(b.status)) {
      box.innerHTML='<div class="reviewStatus active">CLOSING POSITION</div><p>Reconcile the OKX demo account before continuing.</p>';
      $('#marketPrepareBtn').innerHTML='Reconcile close <b>→</b>';
    } else if(b.status==='closed') {
      box.innerHTML=`<div class="reviewStatus ready">POSITION FLAT · RESOLVE RAID</div><div class="reviewGrid"><div><small>ENTRY</small><b>${px(b.execution?.entryPrice)}</b></div><div><small>EXIT</small><b>${px(b.close?.exitPrice)}</b></div><div><small>EXPOSURE</small><b>FLAT</b></div><div><small>MEMORY</small><b>PENDING</b></div></div><p>Resolve to award raid rating, loot, skill progression and a persistent Agent reflection.</p>`;
      $('#marketPrepareBtn').innerHTML='Resolve raid + evolve Agent <b>→</b>';
    }
  }

  function renderArena() {
    const a=m.arena||{wins:0,losses:0,draws:0,marketReasoning:40,riskDiscipline:70,battles:[],active:null,perps:{}};
    m.active=a.active||null;
    $('#marketRecord').textContent=`${a.wins||0}–${a.losses||0}${a.draws?`–${a.draws}`:''}`;
    $('#marketReasoning').textContent=a.marketReasoning??40;
    $('#marketDiscipline').textContent=a.riskDiscipline??70;
    $('#marketAgentName').textContent=document.getElementById('profileName')?.textContent||'NORI';
    $('#marketAgentGlyph').textContent=(document.getElementById('profileName')?.textContent||'N')[0]?.toUpperCase()||'N';
    renderProgress(a.perps||{});
    renderBattle(m.active);
    renderHistory(a.battles||[]);
    const anchored = new Set((a.xlayerReceipts||[]).map(x=>x.battleId));
    const latest=latestResolved();
    const eligible=latest?.result && latest.marketSource==='OKX_AGENT_TRADE_KIT' && latest.execution?.ordId;
    $('#marketAnchorBtn').classList.toggle('hidden', !(eligible && m.config?.xlayer?.registryAddress && !anchored.has(latest.id)));
    applyPermission(); dispatch3d();
  }

  async function loadHealth() {
    try {
      m.health=await req('/api/market/health'); m.permission=m.health.permission;
      const liveKit=m.health.adapter==='agent-kit';
      $('#marketHealthDot').className='ok';
      $('#marketAdapterLabel').textContent=liveKit?'OKX AGENT KIT · DEMO':'LOCAL SIM · TEST';
      $('#marketModePill').textContent=m.permission?.effectiveStatus==='paused'?'PAUSED':m.health.demoOnly?'DEMO ONLY':'UNSAFE';
      $('#marketIntro').textContent=liveKit
        ?'Persistent KULT Agents raid rivals using live OKX market inputs and OKX Demo perpetual execution. X Layer records optional battle proof; OKX.AI exposes the Agent services.'
        :'Local simulation is active. The complete Perp Wars game loop works without credentials; switch to Agent Trade Kit for OKX Demo execution.';
    } catch(e){
      $('#marketHealthDot').className='bad';
      $('#marketAdapterLabel').textContent=e.code==='okx_cli_missing'?'AGENT KIT NOT INSTALLED':'EXECUTION RAIL OFFLINE';
    }
  }

  function renderOkxAi(manifest) {
    const box=$('#okxAiServices'); if(!box)return;
    const services=manifest?.services||[];
    box.innerHTML=services.length?services.map(s=>`<div><b>${esc(s.name)}</b><span>${esc(s.mode)} · ${s.price?.amount==='0'?'FREE':`${esc(s.price?.amount)} ${esc(s.price?.currency)}`}</span></div>`).join(''):'<span>Service manifest unavailable.</span>';
  }

  async function loadState() {
    try {
      const d=await req('/api/market/state'); m.config=d; m.arena=d.arena; m.permission=d.permission;
      $('#marketAgentCensus').textContent=d.agentState?.census?.number||'GEN-01-—';
      const ps=d.permission?.effectiveStatus||'enabled';
      $('#marketModePill').textContent=ps==='paused'?'PAUSED':ps==='disabled'?'DISABLED':'DEMO ONLY';
      const x=d.xlayer||{};
      $('#marketXLayerNetwork').textContent=`X LAYER ${String(x.network||'testnet').toUpperCase()}`;
      $('#marketXLayerChain').textContent=x.chainId||'—';
      $('#marketXLayerStatus').textContent=x.registryAddress?'Receipt registry configured.':'Receipt registry not configured yet.';
      renderOkxAi(d.okxAI); renderArena();
    } catch(e){ if(e.code!=='agent_required') say(e.message,'bad'); }
  }

  async function loadSnapshot() {
    try {
      const d=await req(`/api/market/snapshot?symbol=${encodeURIComponent(m.symbol)}`),s=d.snapshot;
      $('#marketLast').textContent=px(s.ticker.last);
      $('#marketFunding').textContent=pct(Number(s.funding.rate||0)*100,4);
      const bid=Number(s.ticker.bid),ask=Number(s.ticker.ask),mid=(bid+ask)/2;
      $('#marketSpread').textContent=bid&&ask&&mid?`${(((ask-bid)/mid)*10000).toFixed(2)} bps`:'—';
    } catch(e){ $('#marketLast').textContent='—'; $('#marketFunding').textContent='—'; $('#marketSpread').textContent='—'; }
  }

  function applyPermission() {
    const status=m.permission?.effectiveStatus||'enabled';
    const prepare=$('#marketPrepareBtn');
    const newActionsBlocked=['paused','disabled'].includes(status) && !m.active;
    if(newActionsBlocked){ prepare.disabled=true; prepare.textContent=status==='disabled'?'Perp Wars disabled':'New raids paused'; }
    $$('#marketSymbols button,[data-rival-id]').forEach(btn=>{btn.disabled=Boolean(m.active)||newActionsBlocked;});
  }

  async function performPrimary() {
    if(m.busy)return; m.busy=true;
    const btn=$('#marketPrepareBtn'); const original=btn.innerHTML; btn.disabled=true; btn.textContent='Working…';
    try {
      let out;
      if(!m.active){
        out=await req('/api/market/battle/prepare',{method:'POST',body:{symbol:m.symbol,rivalId:m.rivalId}});
        say(out.battle?.nori?.action==='wait'?'Your Agent recommends WAIT.':'Raid thesis locked. Review before execution.','good');
      } else if(m.active.status==='prepared') {
        out=await req('/api/market/battle/execute',{method:'POST',body:{battleId:m.active.id}}); say('OKX demo raid launched.','good');
      } else if(m.active.status==='observing') {
        out=await req('/api/market/battle/resolve',{method:'POST',body:{battleId:m.active.id}});
        const prog=out.battle?.result?.progression; say(prog?`WAIT ${String(prog.duelOutcome).toUpperCase()} · ${prog.ratingDelta>=0?'+':''}${prog.ratingDelta} rating`:'WAIT observation resolved.','good');
      } else if(m.active.status==='active') {
        out=await req('/api/market/battle/close',{method:'POST',body:{battleId:m.active.id}}); say('Position closed. Resolve the raid.','good');
      } else if(['executing','closing','recovery_required'].includes(m.active.status)) {
        out=await req('/api/market/battle/reconcile',{method:'POST',body:{battleId:m.active.id}}); say('Execution state reconciled.','good');
      } else if(m.active.status==='closed') {
        out=await req('/api/market/battle/resolve',{method:'POST',body:{battleId:m.active.id}});
        const prog=out.battle?.result?.progression; say(prog?`${String(prog.duelOutcome).toUpperCase()} · ${prog.ratingDelta>=0?'+':''}${prog.ratingDelta} rating · +${prog.lootDelta} loot`:'Raid resolved.','good');
      }
      if(out?.arena)m.arena=out.arena;
      await loadState(); await loadSnapshot();
    } catch(e){
      say(e.message,'bad');
      if(['battle_expired','stale_thesis'].includes(e.code)) await loadState();
    } finally {m.busy=false;btn.disabled=false;btn.innerHTML=original;renderArena();}
  }

  async function abstain() {
    if(!m.active||m.busy)return;m.busy=true;
    try{const out=await req('/api/market/battle/abstain',{method:'POST',body:{battleId:m.active.id}});m.arena=out.arena;say('WAIT observation started. Your Agent is flat while the rival thesis runs.','good');await loadState();}
    catch(e){say(e.message,'bad');}finally{m.busy=false;}
  }
  async function cancel() {
    if(!m.active||m.busy)return;m.busy=true;
    try{const out=await req('/api/market/battle/cancel',{method:'POST',body:{battleId:m.active.id}});m.arena=out.arena;say('Prepared raid cancelled.');await loadState();}
    catch(e){say(e.message,'bad');}finally{m.busy=false;}
  }

  async function connectXLayer() {
    if(!window.ethereum){say('Install an EVM wallet to anchor X Layer battle proof.','bad');return;}
    try{
      const accounts=await window.ethereum.request({method:'eth_requestAccounts'}); const address=accounts?.[0]; if(!address)throw new Error('No wallet account returned.');
      const x=m.config?.xlayer; if(!x)throw new Error('X Layer configuration unavailable.');
      try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:x.chainIdHex}]});}
      catch(err){
        if(err?.code!==4902)throw err;
        await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:x.chainIdHex,chainName:`X Layer ${x.network==='mainnet'?'Mainnet':'Testnet'}`,nativeCurrency:{name:'OKB',symbol:'OKB',decimals:18},rpcUrls:[x.rpcUrl],blockExplorerUrls:[x.explorerUrl]}]});
      }
      await req('/api/wallet',{method:'POST',body:{address}});
      m.wallet=address.toLowerCase(); $('#marketXLayerBtn').textContent=`${short(m.wallet)} · ${String(x.network||'').toUpperCase()}`; say('X Layer proof wallet connected.','good'); await loadState();
    }catch(e){say(e.message||'Wallet connection failed.','bad');}
  }

  async function anchorLatest() {
    const b=latestResolved(); if(!b)return say('No eligible resolved OKX raid.','bad');
    if(!window.ethereum)return say('Connect an EVM wallet first.','bad');
    try{
      if(!m.wallet)await connectXLayer(); if(!m.wallet)return;
      const payload=await req('/api/market/xlayer/calldata',{method:'POST',body:{battleId:b.id}});
      const txHash=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:m.wallet,to:payload.to,data:payload.data,value:payload.value||'0x0'}]});
      $('#marketXLayerStatus').textContent='Transaction sent. Verifying…';
      const out=await req('/api/market/xlayer/anchored',{method:'POST',body:{battleId:b.id,txHash}});
      m.arena=out.arena; say('Raid proof anchored on X Layer.','good'); await loadState();
    }catch(e){say(e.message||'X Layer proof failed.','bad');}
  }

  function bind() {
    $('#marketPrepareBtn').addEventListener('click',performPrimary);
    $('#marketAbstainBtn').addEventListener('click',abstain);
    $('#marketCancelBtn').addEventListener('click',cancel);
    $('#marketRefreshBtn').addEventListener('click',loadSnapshot);
    $('#marketXLayerBtn').addEventListener('click',connectXLayer);
    $('#marketAnchorBtn').addEventListener('click',anchorLatest);
    $$('#marketSymbols [data-market-symbol]').forEach(btn=>btn.addEventListener('click',()=>{
      if(m.active)return; m.symbol=btn.dataset.marketSymbol; $$('#marketSymbols button').forEach(x=>x.classList.toggle('active',x===btn)); $('#marketPairTitle').textContent=`${m.symbol}-USDT-SWAP`; $('#marketPrepareBtn').innerHTML=`Prepare ${m.symbol} raid <b>→</b>`; loadSnapshot();
    }));
    document.addEventListener('kult:view-change',event=>{
      if(event.detail?.view==='market'){loadHealth();loadState();loadSnapshot();}
    });
  }

  async function init(){
    bind(); await Promise.all([loadHealth(),loadState(),loadSnapshot()]);
    clearInterval(m.poll); m.poll=setInterval(()=>{if(!document.hidden&&root.classList.contains('active')){loadSnapshot(); if(m.active)loadState();}},20000);
  }
  init();
})();
