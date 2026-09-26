'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentKitAdapter } = require('../okx-agent-kit');

function stripGlobal(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--demo' || args[i] === '--json') continue;
    if (args[i] === '--profile') { i++; continue; }
    out.push(args[i]);
  }
  return out;
}

test('OKX Agent Trade Kit adapter hard-forces demo mode and reconciles open/close writes', async () => {
  const calls = [];
  let open = false;
  const fakeExec = async (bin, args) => {
    calls.push({ bin, args: [...args] });
    const c = stripGlobal(args);
    let data = [];
    if (c[0] === 'swap' && c[1] === 'leverage') data = [{ lever: '3' }];
    else if (c[0] === 'swap' && c[1] === 'place') { open = true; data = [{ ordId: 'open-1', sCode: '0', sMsg: '' }]; }
    else if (c[0] === 'swap' && c[1] === 'close') { open = false; data = [{ ordId: 'close-1', sCode: '0', sMsg: '' }]; }
    else if (c[0] === 'swap' && c[1] === 'get') data = [{ ordId: c[c.indexOf('--ordId') + 1], avgPx: c.includes('close-1') ? '101.25' : '100.50' }];
    else if (c[0] === 'swap' && c[1] === 'fills') data = [];
    else if (c[0] === 'swap' && c[1] === 'get-leverage') data = [{ lever: '3' }];
    else if (c[0] === 'account' && c[1] === 'balance') data = [{ totalEq: '10000' }];
    else if (c[0] === 'account' && c[1] === 'config') data = [{ posMode: 'net_mode', acctLv: '2' }];
    else if (c[0] === 'account' && c[1] === 'positions') data = open ? [{ instId: 'BTC-USDT-SWAP', pos: '1', avgPx: '100.50' }] : [];
    else throw new Error(`unexpected fake command: ${c.join(' ')}`);
    return { stdout: JSON.stringify(data), stderr: '' };
  };

  const adapter = new AgentKitAdapter({ exec: fakeExec, profile: 'demo-test' });
  assert.equal(adapter.demoOnly, true);
  const opened = await adapter.placeSwap({ instId: 'BTC-USDT-SWAP', side: 'buy', notionalUsd: 250, leverage: 3, positionMode: 'net_mode', clientId: 'kult_test' });
  assert.equal(opened.reconciled, true);
  assert.equal(opened.entryPrice, 100.50);
  const placeCall = calls.find(call => stripGlobal(call.args).slice(0, 2).join(' ') === 'swap place');
  assert.ok(placeCall);
  assert.ok(placeCall.args.includes('--demo'));
  assert.deepEqual(placeCall.args.slice(placeCall.args.indexOf('--tgtCcy'), placeCall.args.indexOf('--tgtCcy') + 2), ['--tgtCcy', 'quote_ccy']);
  assert.deepEqual(placeCall.args.slice(placeCall.args.indexOf('--sz'), placeCall.args.indexOf('--sz') + 2), ['--sz', '250']);

  const closed = await adapter.closeSwap({ instId: 'BTC-USDT-SWAP', positionMode: 'net_mode', side: 'buy' });
  assert.equal(closed.positionClosed, true);
  assert.equal(closed.exitPrice, 101.25);
  assert.ok(calls.every(call => call.args.includes('--demo')), 'every OKX command must use demo mode');
});

test('OKX Agent Trade Kit adapter does not need a profile flag when the CLI default/env credentials are used', () => {
  const adapter = new AgentKitAdapter({ profile: '' });
  assert.deepEqual(adapter.baseArgs(), ['--demo']);
});
