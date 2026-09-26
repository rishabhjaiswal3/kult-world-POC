'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const registry = `0x${'a'.repeat(40)}`;
process.env.KULT_MARKET_XLAYER_REGISTRY = registry;
delete require.cache[require.resolve('../xlayer-market')];
const X = require('../xlayer-market');

test('X Layer Market receipt is compact 129-byte evidence and verifies exact transaction identity', async () => {
  const wallet = `0x${'1'.repeat(40)}`;
  const txHash = `0x${'2'.repeat(64)}`;
  const data = X.encodeBattleReceipt({ battleId: 'battle-1', agentId: 'agent-1', tradeHash: `0x${'3'.repeat(64)}`, outcome: 'win', returnPct: 1.23 });
  assert.equal((data.length - 2) / 2, 129);

  const fakeFetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const result = {
      eth_chainId: X.CHAIN_ID_HEX,
      eth_getTransactionByHash: { hash: txHash, from: wallet, to: registry, input: data },
      eth_getTransactionReceipt: { transactionHash: txHash, status: '0x1', blockNumber: '0x2a' },
    }[payload.method];
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: payload.id, result }) };
  };

  const verified = await X.verify({ txHash, walletAddress: wallet, expectedData: data, fetchImpl: fakeFetch });
  assert.equal(verified.blockNumber, 42);
  await assert.rejects(
    X.verify({ txHash, walletAddress: `0x${'4'.repeat(40)}`, expectedData: data, fetchImpl: fakeFetch }),
    error => error.code === 'wrong_sender',
  );
});

test('X Layer Market rejects malformed tx hashes before RPC work', async () => {
  const data = X.encodeBattleReceipt({ battleId: 'battle-2', agentId: 'agent-2', tradeHash: 'trade', outcome: 'draw', returnPct: 0 });
  await assert.rejects(
    X.verify({ txHash: '0x1234', walletAddress: `0x${'1'.repeat(40)}`, expectedData: data, fetchImpl: async () => { throw new Error('should not call'); } }),
    error => error.code === 'invalid_tx_hash',
  );
});
