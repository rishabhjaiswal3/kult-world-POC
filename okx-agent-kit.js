'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 15000;

class OkxAgentKitError extends Error {
  constructor(message, code = 'okx_agent_kit_error', details = null) {
    super(message);
    this.name = 'OkxAgentKitError';
    this.code = code;
    this.details = details;
  }
}

function first(value) {
  if (Array.isArray(value)) return value[0] || null;
  if (value && Array.isArray(value.data)) return value.data[0] || null;
  if (value && value.data && Array.isArray(value.data.data)) return value.data.data[0] || null;
  return value?.data || value || null;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  if (value?.data && Array.isArray(value.data.data)) return value.data.data;
  return value ? [value] : [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function priceFrom(value) {
  const record = first(value) || {};
  return num(record.avgPx ?? record.fillPx ?? record.px ?? record.last, 0);
}

function fillForOrder(value, ordId) {
  const candidates = rows(value).filter(row => !ordId || String(row.ordId || row.orderId || '') === String(ordId));
  if (!candidates.length) return null;
  candidates.sort((a, b) => num(b.ts ?? b.fillTime ?? b.uTime) - num(a.ts ?? a.fillTime ?? a.uTime));
  return candidates[0];
}

class AgentKitAdapter {
  constructor(options = {}) {
    this.bin = options.bin || process.env.OKX_AGENT_KIT_BIN || 'okx';
    this.profile = options.profile ?? process.env.OKX_AGENT_KIT_PROFILE ?? '';
    // This prototype is intentionally demo-only. There is no environment switch to enable live execution.
    this.demoOnly = true;
    this.timeoutMs = Math.max(2000, Number(options.timeoutMs || process.env.OKX_AGENT_KIT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
    this.exec = options.exec || execFileAsync;
    this.cache = new Map();
  }

  baseArgs() {
    const args = [];
    if (this.profile) args.push('--profile', this.profile);
    args.push('--demo');
    return args;
  }

  async run(command, { timeoutMs = this.timeoutMs } = {}) {
    const args = [...this.baseArgs(), ...command, '--json'];
    try {
      const { stdout, stderr } = await this.exec(this.bin, args, {
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: process.env,
      });
      const raw = String(stdout || '').trim();
      if (!raw) throw new OkxAgentKitError(String(stderr || 'OKX Agent Trade Kit returned no data').trim(), 'okx_empty_response');
      try { return JSON.parse(raw); }
      catch (_) { throw new OkxAgentKitError(`OKX Agent Trade Kit returned invalid JSON: ${raw.slice(0, 240)}`, 'okx_invalid_json'); }
    } catch (error) {
      if (error instanceof OkxAgentKitError) throw error;
      const stderr = String(error.stderr || '').trim();
      const stdout = String(error.stdout || '').trim();
      const message = stderr || stdout || error.message || 'OKX Agent Trade Kit command failed';
      const code = error.code === 'ENOENT' ? 'okx_cli_missing' : error.killed ? 'okx_timeout' : 'okx_command_failed';
      throw new OkxAgentKitError(message.split('\n')[0].slice(0, 420), code, { command: command.join(' ') });
    }
  }

  async cached(key, ttlMs, loader) {
    const now=Date.now(), current=this.cache.get(key);
    if(current?.value && now-current.at < ttlMs) return current.value;
    if(current?.promise) return current.promise;
    const promise=Promise.resolve().then(loader).then(value=>{ this.cache.set(key,{value,at:Date.now()}); return value; },error=>{ this.cache.delete(key); throw error; });
    this.cache.set(key,{promise,at:now}); return promise;
  }

  async health() {
    try {
      const data = await this.run(['market', 'ticker', 'BTC-USDT-SWAP'], { timeoutMs: 7000 });
      const ticker = first(data);
      return {
        ok: true,
        adapter: 'agent-kit',
        demoOnly: true,
        profile: this.profile || 'default',
        samplePrice: ticker?.last || ticker?.lastPx || null,
      };
    } catch (error) {
      return {
        ok: false,
        adapter: 'agent-kit',
        demoOnly: true,
        profile: this.profile || 'default',
        error: error.message,
        code: error.code,
      };
    }
  }

  async marketSnapshot(instId) {
    const [tickerRaw, fundingRaw, candlesRaw, bookRaw, instrumentsRaw] = await Promise.all([
      this.cached(`ticker:${instId}`, 1200, () => this.run(['market', 'ticker', instId])),
      this.cached(`funding:${instId}`, 30000, () => this.run(['market', 'funding-rate', instId])),
      this.cached(`candles:${instId}:5m`, 5000, () => this.run(['market', 'candles', instId, '--bar', '5m', '--limit', '12'])),
      this.cached(`book:${instId}:5`, 1200, () => this.run(['market', 'orderbook', instId, '--sz', '5'])),
      this.cached('instruments:SWAP', 300000, () => this.run(['market', 'instruments', '--instType', 'SWAP'])),
    ]);
    const ticker = first(tickerRaw) || {};
    const funding = first(fundingRaw) || {};
    const candles = rows(candlesRaw);
    const book = first(bookRaw) || {};
    const instrument = rows(instrumentsRaw).find(item => String(item.instId || '') === instId) || {};
    return {
      source: 'OKX_AGENT_TRADE_KIT', instId,
      ticker: {
        last: num(ticker.last ?? ticker.lastPx),
        bid: num(ticker.bidPx ?? ticker.bid),
        ask: num(ticker.askPx ?? ticker.ask),
        high24h: num(ticker.high24h),
        low24h: num(ticker.low24h),
        vol24h: num(ticker.volCcy24h ?? ticker.vol24h),
        ts: Number(ticker.ts || Date.now()),
      },
      funding: { rate: num(funding.fundingRate), nextFundingTime: Number(funding.nextFundingTime || 0) || null },
      candles,
      orderbook: book,
      instrument: {
        ctVal: num(instrument.ctVal, 1),
        ctMult: num(instrument.ctMult, 1),
        lotSz: num(instrument.lotSz, 1),
        minSz: num(instrument.minSz, 1),
        tickSz: num(instrument.tickSz),
        lever: num(instrument.lever, 0),
      },
    };
  }

  async accountSnapshot(instId) {
    const [balanceRaw, configRaw, positionsRaw, leverageRaw] = await Promise.all([
      this.run(['account', 'balance']),
      this.run(['account', 'config']),
      this.run(['account', 'positions', '--instType', 'SWAP', '--instId', instId]),
      this.run(['swap', 'get-leverage', '--instId', instId, '--mgnMode', 'cross']).catch(() => []),
    ]);
    const balanceRows = rows(balanceRaw);
    let equity = 0;
    for (const row of balanceRows) {
      equity = Math.max(equity, num(row.totalEq ?? row.eq ?? row.usdEq));
      for (const detail of rows(row.details || [])) equity = Math.max(equity, num(detail.eqUsd ?? detail.usdEq ?? detail.eq));
    }
    const config = first(configRaw) || {};
    return {
      source: 'OKX_AGENT_TRADE_KIT',
      equity,
      positionMode: String(config.posMode || config.positionMode || 'net_mode'),
      accountLevel: String(config.acctLv || config.accountLevel || ''),
      positions: rows(positionsRaw),
      leverage: rows(leverageRaw),
      balanceRaw: balanceRows,
    };
  }

  async setLeverage(instId, leverage, posSide = null) {
    const command = ['swap', 'leverage', '--instId', instId, '--lever', String(leverage), '--mgnMode', 'cross'];
    if (posSide) command.push('--posSide', posSide);
    return this.run(command);
  }

  async placeSwap({ instId, side, notionalUsd, positionMode = 'net_mode', leverage = 3, clientId }) {
    const posSide = side === 'buy' ? 'long' : 'short';
    await this.setLeverage(instId, leverage, positionMode === 'long_short_mode' ? posSide : null);
    const command = [
      'swap', 'place', '--instId', instId, '--side', side, '--ordType', 'market',
      '--sz', String(notionalUsd), '--tgtCcy', 'quote_ccy', '--tdMode', 'cross',
    ];
    if (positionMode === 'long_short_mode') command.push('--posSide', posSide);
    if (clientId) command.push('--clOrdId', clientId);
    const raw = await this.run(command);
    const order = first(raw) || {};
    const ordId = order.ordId || order.orderId || null;
    const sCode = String(order.sCode ?? '0');
    if (sCode !== '0') return { raw, ordId, clOrdId: order.clOrdId || clientId || null, sCode, sMsg: order.sMsg || '' };

    let entryPrice = 0;
    if (ordId) {
      try { entryPrice = priceFrom(await this.order(instId, ordId)); } catch (_) {}
      if (!entryPrice) {
        try { entryPrice = priceFrom(fillForOrder(await this.fills(instId), ordId)); } catch (_) {}
      }
    }
    const account = await this.accountSnapshot(instId);
    const position = account.positions.find(p => String(p.instId || '') === instId && Math.abs(num(p.pos ?? p.position ?? p.sz)) > 0) || null;
    if (!entryPrice) entryPrice = num(position?.avgPx ?? position?.openAvgPx);
    if (!position) throw new OkxAgentKitError('OKX accepted the order but no demo position was found during reconciliation.', 'okx_position_not_open');
    return {
      raw,
      ordId,
      clOrdId: order.clOrdId || clientId || null,
      sCode,
      sMsg: order.sMsg || '',
      entryPrice,
      position,
      reconciled: true,
    };
  }

  async order(instId, ordId) {
    return this.run(['swap', 'get', '--instId', instId, '--ordId', String(ordId)]);
  }

  async orderByClientId(instId, clOrdId) {
    return this.run(['swap', 'get', '--instId', instId, '--clOrdId', String(clOrdId)]);
  }

  async reconcileOrder({ instId, clOrdId, ordId = null }) {
    let record = null;
    if (ordId) { try { record = first(await this.order(instId, ordId)); } catch (_) {} }
    if (!record && clOrdId) { try { record = first(await this.orderByClientId(instId, clOrdId)); } catch (_) {} }
    let fill = null;
    try {
      const candidates = rows(await this.fills(instId)).filter(row =>
        (ordId && String(row.ordId || row.orderId || '') === String(ordId)) ||
        (clOrdId && String(row.clOrdId || '') === String(clOrdId))
      );
      candidates.sort((a,b)=>num(b.fillTime ?? b.ts)-num(a.fillTime ?? a.ts)); fill=candidates[0] || null;
    } catch (_) {}
    const exact = record || fill;
    return {
      found:Boolean(exact),
      ordId:String(record?.ordId || fill?.ordId || ordId || '') || null,
      clOrdId:String(record?.clOrdId || fill?.clOrdId || clOrdId || '') || null,
      state:String(record?.state || record?.status || ''),
      entryPrice:num(record?.avgPx ?? record?.fillPx ?? fill?.fillPx ?? fill?.px),
      fillSz:num(record?.accFillSz ?? record?.fillSz ?? fill?.fillSz),
      fee:num(record?.fee ?? fill?.fee),
      fillPnl:num(fill?.fillPnl),
    };
  }

  async fills(instId) {
    return this.run(['swap', 'fills', '--instId', instId]);
  }

  async closeSwap({ instId, positionMode = 'net_mode', side }) {
    const startedAt = Date.now();
    const command = ['swap', 'close', '--instId', instId, '--mgnMode', 'cross'];
    if (positionMode === 'long_short_mode') command.push('--posSide', side === 'buy' ? 'long' : 'short');
    const raw = await this.run(command);
    const closeRecord = first(raw) || {};
    const ordId = closeRecord.ordId || closeRecord.orderId || null;

    let exitPrice = 0;
    if (ordId) {
      try { exitPrice = priceFrom(await this.order(instId, ordId)); } catch (_) {}
    }
    if (!exitPrice) {
      try {
        const fills = rows(await this.fills(instId))
          .filter(row => !ordId || String(row.ordId || row.orderId || '') === String(ordId))
          .filter(row => num(row.ts ?? row.fillTime ?? row.uTime, startedAt) >= startedAt - 5000)
          .sort((a, b) => num(b.ts ?? b.fillTime ?? b.uTime) - num(a.ts ?? a.fillTime ?? a.uTime));
        exitPrice = num(fills[0]?.fillPx ?? fills[0]?.px);
      } catch (_) {}
    }

    const account = await this.accountSnapshot(instId);
    const remaining = account.positions.filter(p => String(p.instId || '') === instId && Math.abs(num(p.pos ?? p.position ?? p.sz)) > 0);
    if (remaining.length) throw new OkxAgentKitError('OKX close returned, but the demo position is still open. Resolve it in OKX before continuing.', 'okx_position_still_open');
    return { raw, ordId, exitPrice, positionClosed: true, reconciled: true };
  }
}

class SimAdapter {
  constructor(options = {}) {
    this.demoOnly = true;
    this.profile = 'local-sim';
    this.positions = new Map();
    this.clock = options.clock || (() => Date.now());
    this.priceOffset = options.priceOffset || (() => 0);
  }
  async health() { return { ok: true, adapter: 'sim', demoOnly: true, profile: 'local-sim', samplePrice: 104250.12 }; }
  price(instId) {
    const base = instId.startsWith('BTC') ? 104250 : instId.startsWith('ETH') ? 3650 : 218;
    const phase = Math.floor(this.clock() / 15000) % 20;
    return base * (1 + Math.sin(phase / 2) * 0.0018 + Number(this.priceOffset(instId) || 0));
  }
  async marketSnapshot(instId) {
    const p = this.price(instId), candles = [];
    for (let i = 0; i < 12; i++) {
      const c = p * (1 + (i - 6) * 0.00035);
      candles.push([String(this.clock() - i * 300000), String(c * 0.999), String(c * 1.002), String(c * 0.998), String(c), '100', '100', '100', '1']);
    }
    return {
      source: 'LOCAL_SIM', instId,
      ticker: { last: p, bid: p * 0.99995, ask: p * 1.00005, high24h: p * 1.02, low24h: p * .98, vol24h: 1000000, ts: this.clock() },
      funding: { rate: 0.00008, nextFundingTime: this.clock() + 3600000 },
      candles,
      orderbook: { bids: [[String(p * .99995), '3']], asks: [[String(p * 1.00005), '3']] },
      instrument: { ctVal: 1, ctMult: 1, lotSz: 1, minSz: 1, tickSz: .1, lever: 100 },
    };
  }
  async accountSnapshot(instId) {
    return {
      source: 'LOCAL_SIM', equity: 10000, positionMode: 'net_mode', accountLevel: 'demo',
      positions: this.positions.has(instId) ? [this.positions.get(instId)] : [], leverage: [{ lever: '3' }],
    };
  }
  async setLeverage() { return { ok: true }; }
  async placeSwap({ instId, side, notionalUsd, clientId }) {
    const entry = this.price(instId), ordId = `sim_${this.clock()}`;
    const position = { instId, side, notionalUsd, entry, avgPx: String(entry), pos: String(notionalUsd), ordId, clOrdId:clientId || null };
    this.positions.set(instId, position);
    return { ordId, clOrdId: clientId, sCode: '0', sMsg: '', raw: { simulated: true, entry }, entryPrice: entry, position, reconciled: true };
  }
  async order(instId, ordId) { const p = this.positions.get(instId); return p && p.ordId === ordId ? [{ ...p, avgPx: String(p.entry) }] : []; }
  async fills(instId) { const p = this.positions.get(instId); return p ? [{ ordId: p.ordId, clOrdId:p.clOrdId || null, fillPx: String(p.entry), fillSz: String(p.notionalUsd), ts: String(this.clock()) }] : []; }
  async reconcileOrder({ instId, clOrdId, ordId = null }) {
    const p=this.positions.get(instId);
    if(!p) return { found:false, ordId:ordId || null, clOrdId:clOrdId || null, entryPrice:0 };
    const match=(!ordId || String(p.ordId)===String(ordId)) && (!clOrdId || String(p.clOrdId || '')===String(clOrdId));
    return { found:match, ordId:p.ordId, clOrdId:p.clOrdId || clOrdId || null, entryPrice:p.entry, fillSz:p.notionalUsd, state:'filled' };
  }
  async closeSwap({ instId }) {
    const p = this.positions.get(instId), exitPrice = this.price(instId);
    this.positions.delete(instId);
    return { simulated: true, closed: Boolean(p), exitPrice, positionClosed: true, reconciled: true };
  }
}

function createOkxAdapter(options = {}) {
  const mode = String(options.mode || process.env.KULT_MARKET_ADAPTER || 'sim').toLowerCase();
  return mode === 'agent-kit' ? new AgentKitAdapter(options) : new SimAdapter(options);
}

module.exports = { AgentKitAdapter, SimAdapter, OkxAgentKitError, createOkxAdapter, first, rows, num, priceFrom, fillForOrder };
