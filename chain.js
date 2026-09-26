'use strict';

const CHAIN_ID = 46630;
const CHAIN_ID_HEX = '0xb626';
const ANCHOR_OPERATION = '01';

class ChainVerificationError extends Error {
  constructor(message, code = 'chain_verification_failed') {
    super(message);
    this.name = 'ChainVerificationError';
    this.code = code;
  }
}

function bytes32(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(normalized)) throw new ChainVerificationError(`invalid ${label}`, 'invalid_proof');
  return normalized.slice(2);
}

const DOMAIN = { analysis: 1, creativity: 2, strategy: 3, social: 4 };
const OUTCOME = { success: 1, miss: 2 };

// Compact registry fallback protocol:
// 0x01 || localAgentId(bytes32) || receiptId(bytes32) || evidenceHash(bytes32) || metadata(bytes32)
// metadata packs domain:uint8, outcome:uint8 and difficulty:uint16 into the low four bytes.
function encodeAnchorCalldata({ agentId, receiptId, evidenceHash, cap, outcome, difficulty }) {
  const domain = DOMAIN[cap];
  const result = OUTCOME[outcome];
  const level = Number(difficulty);
  if (!domain || !result || !Number.isInteger(level) || level < 0 || level > 100) throw new ChainVerificationError('invalid receipt metadata', 'invalid_proof');
  const metadata = ((domain << 24) | (result << 16) | level).toString(16).padStart(64, '0');
  return `0x${ANCHOR_OPERATION}${bytes32(agentId, 'agent ID')}${bytes32(receiptId, 'receipt ID')}${bytes32(evidenceHash, 'evidence hash')}${metadata}`;
}

async function rpc(rpcUrl, method, params = [], fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (_) {
    throw new ChainVerificationError('Robinhood RPC is temporarily unavailable', 'rpc_unavailable');
  }
  if (!response.ok) throw new ChainVerificationError('Robinhood RPC returned an error', 'rpc_unavailable');
  const payload = await response.json().catch(() => null);
  if (!payload || payload.error) throw new ChainVerificationError('Robinhood RPC rejected the verification request', 'rpc_unavailable');
  return payload.result;
}

function hexNumber(value) { return Number.parseInt(String(value || '0x0'), 16); }

async function verifyAnchorTransaction({ rpcUrl, registryAddress, walletAddress, txHash, expectedData, minConfirmations = 1, fetchImpl }) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''))) throw new ChainVerificationError('invalid transaction hash', 'invalid_tx_hash');
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(registryAddress || ''))) throw new ChainVerificationError('registry is not configured', 'registry_unavailable');
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(walletAddress || ''))) throw new ChainVerificationError('connect a wallet first', 'wallet_required');

  const chainId = await rpc(rpcUrl, 'eth_chainId', [], fetchImpl);
  if (String(chainId).toLowerCase() !== CHAIN_ID_HEX) throw new ChainVerificationError('RPC is not connected to Robinhood Chain Testnet', 'wrong_chain');

  const [transaction, receipt, latestBlockHex] = await Promise.all([
    rpc(rpcUrl, 'eth_getTransactionByHash', [txHash], fetchImpl),
    rpc(rpcUrl, 'eth_getTransactionReceipt', [txHash], fetchImpl),
    rpc(rpcUrl, 'eth_blockNumber', [], fetchImpl),
  ]);
  if (!transaction || !receipt) throw new ChainVerificationError('transaction is still pending', 'tx_pending');
  if (String(receipt.status).toLowerCase() !== '0x1') throw new ChainVerificationError('transaction reverted', 'tx_reverted');
  if (String(transaction.to || '').toLowerCase() !== registryAddress.toLowerCase()) throw new ChainVerificationError('transaction was sent to the wrong contract', 'wrong_target');
  if (String(transaction.from || '').toLowerCase() !== walletAddress.toLowerCase()) throw new ChainVerificationError('transaction sender does not match the connected wallet', 'wrong_sender');
  if (String(transaction.input || transaction.data || '').toLowerCase() !== expectedData.toLowerCase()) throw new ChainVerificationError('transaction evidence does not match this receipt', 'wrong_evidence');

  const latest = hexNumber(latestBlockHex);
  const blockNumber = hexNumber(receipt.blockNumber);
  const confirmations = Math.max(0, latest - blockNumber + 1);
  if (confirmations < minConfirmations) throw new ChainVerificationError('waiting for transaction confirmation', 'tx_pending');
  return { blockNumber, confirmations, from: transaction.from, to: transaction.to };
}

module.exports = {
  CHAIN_ID,
  CHAIN_ID_HEX,
  ChainVerificationError,
  encodeAnchorCalldata,
  verifyAnchorTransaction,
};
