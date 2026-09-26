'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Chain = require('../chain');
const SDK = require('../sdk');

const receipt = {
  agentId: `0x${'1'.repeat(64)}`,
  receiptId: `0x${'2'.repeat(64)}`,
  evidenceHash: `0x${'3'.repeat(64)}`,
  cap: 'strategy', outcome: 'success', difficulty: 61,
};

function fakeFetch(results) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result: results[request.method] }) };
  };
}

test('server and SDK encode the exact same 129-byte compact receipt', () => {
  const serverData = Chain.encodeAnchorCalldata(receipt);
  assert.equal(serverData, SDK.encodeAnchorCalldata(receipt));
  assert.equal((serverData.length - 2) / 2, 129);
  assert.equal(serverData.slice(0, 4), '0x01');
  const metadata = BigInt(`0x${serverData.slice(-64)}`);
  assert.equal(Number((metadata >> 24n) & 255n), 3);
  assert.equal(Number((metadata >> 16n) & 255n), 1);
  assert.equal(Number(metadata & 65535n), 61);
});

test('transaction verifier checks chain, status, target, sender, data, and confirmations', async () => {
  const expectedData = Chain.encodeAnchorCalldata(receipt);
  const registryAddress = `0x${'a'.repeat(40)}`;
  const walletAddress = `0x${'b'.repeat(40)}`;
  const txHash = `0x${'c'.repeat(64)}`;
  const results = {
    eth_chainId: Chain.CHAIN_ID_HEX,
    eth_getTransactionByHash: { from: walletAddress, to: registryAddress, input: expectedData },
    eth_getTransactionReceipt: { status: '0x1', blockNumber: '0x20' },
    eth_blockNumber: '0x22',
  };
  const verified = await Chain.verifyAnchorTransaction({ rpcUrl: 'https://rpc.invalid', registryAddress, walletAddress, txHash, expectedData, minConfirmations: 2, fetchImpl: fakeFetch(results) });
  assert.equal(verified.blockNumber, 32);
  assert.equal(verified.confirmations, 3);

  results.eth_getTransactionByHash = { from: walletAddress, to: registryAddress, input: `0x${'0'.repeat(258)}` };
  await assert.rejects(
    Chain.verifyAnchorTransaction({ rpcUrl: 'https://rpc.invalid', registryAddress, walletAddress, txHash, expectedData, fetchImpl: fakeFetch(results) }),
    error => error.code === 'wrong_evidence',
  );
});

test('transaction verifier treats missing receipts and low confirmations as pending', async () => {
  const expectedData = Chain.encodeAnchorCalldata(receipt);
  const registryAddress = `0x${'a'.repeat(40)}`;
  const walletAddress = `0x${'b'.repeat(40)}`;
  const txHash = `0x${'c'.repeat(64)}`;
  const results = {
    eth_chainId: Chain.CHAIN_ID_HEX,
    eth_getTransactionByHash: null,
    eth_getTransactionReceipt: null,
    eth_blockNumber: '0x22',
  };
  await assert.rejects(
    Chain.verifyAnchorTransaction({ rpcUrl: 'https://rpc.invalid', registryAddress, walletAddress, txHash, expectedData, fetchImpl: fakeFetch(results) }),
    error => error.code === 'tx_pending',
  );
});
