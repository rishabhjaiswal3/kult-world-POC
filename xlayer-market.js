'use strict';

const crypto = require('crypto');

const requestedNetwork = String(process.env.KULT_XLAYER_NETWORK || 'testnet').toLowerCase();
const NETWORK = requestedNetwork === 'mainnet' ? 'mainnet' : 'testnet';
const NETWORKS = Object.freeze({
  mainnet: {
    chainId: 196,
    chainIdHex: '0xc4',
    rpcUrl: process.env.XLAYER_RPC_URL || 'https://rpc.xlayer.tech',
    explorerUrl: 'https://www.okx.com/web3/explorer/xlayer',
  },
  testnet: {
    chainId: 1952,
    chainIdHex: '0x7a0',
    rpcUrl: process.env.XLAYER_TESTNET_RPC_URL || 'https://testrpc.xlayer.tech/terigon',
    explorerUrl: 'https://www.okx.com/web3/explorer/xlayer-test',
  },
});
const selected = NETWORKS[NETWORK];
const CHAIN_ID = selected.chainId;
const CHAIN_ID_HEX = selected.chainIdHex;
const RPC_URL = selected.rpcUrl;
const EXPLORER_URL = selected.explorerUrl;
const candidate = String(process.env.KULT_MARKET_XLAYER_REGISTRY || '');
const REGISTRY_ADDRESS = /^0x[a-fA-F0-9]{40}$/.test(candidate) && !/^0x0{40}$/i.test(candidate) ? candidate.toLowerCase() : null;

class XLayerVerificationError extends Error {
  constructor(message, code = 'xlayer_verification_failed') {
    super(message); this.name = 'XLayerVerificationError'; this.code = code;
  }
}

function b32(value) {
  const s = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(s)) throw new XLayerVerificationError('Invalid bytes32 receipt field.', 'invalid_receipt');
  return s;
}

function encodeBattleReceipt({ battleId, agentId, tradeHash, outcome, returnPct }) {
  const battle = `0x${crypto.createHash('sha256').update(String(battleId)).digest('hex')}`;
  const agent = `0x${crypto.createHash('sha256').update(String(agentId)).digest('hex')}`;
  const trade = /^0x[a-f0-9]{64}$/i.test(String(tradeHash || ''))
    ? String(tradeHash).toLowerCase()
    : `0x${crypto.createHash('sha256').update(String(tradeHash)).digest('hex')}`;
  const result = { win: 1, loss: 2, draw: 3 }[outcome] || 0;
  if (!result) throw new XLayerVerificationError('Battle outcome is not anchorable.', 'invalid_outcome');
  const bps = Math.max(-2147483648, Math.min(2147483647, Math.round(Number(returnPct || 0) * 100)));
  const packed = ((BigInt(result) & 255n) << 32n) | BigInt.asUintN(32, BigInt(bps));
  return `0x02${b32(battle)}${b32(agent)}${b32(trade)}${packed.toString(16).padStart(64, '0')}`;
}

async function rpc(method, params = [], fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(RPC_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (_) { throw new XLayerVerificationError('X Layer RPC unavailable.', 'rpc_unavailable'); }
  if (!response.ok) throw new XLayerVerificationError('X Layer RPC unavailable.', 'rpc_unavailable');
  const payload = await response.json();
  if (payload.error) throw new XLayerVerificationError(payload.error.message || 'X Layer RPC error.', 'rpc_error');
  return payload.result;
}

async function verify({ txHash, walletAddress, expectedData, fetchImpl }) {
  if (!REGISTRY_ADDRESS) throw new XLayerVerificationError('X Layer market registry is not configured.', 'registry_unavailable');
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''))) throw new XLayerVerificationError('Invalid X Layer transaction hash.', 'invalid_tx_hash');
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(walletAddress || ''))) throw new XLayerVerificationError('Invalid receipt sender wallet.', 'invalid_wallet');
  if (!/^0x[a-fA-F0-9]+$/.test(String(expectedData || ''))) throw new XLayerVerificationError('Invalid expected receipt payload.', 'invalid_receipt');

  const chain = await rpc('eth_chainId', [], fetchImpl);
  if (String(chain).toLowerCase() !== CHAIN_ID_HEX) throw new XLayerVerificationError(`Wrong X Layer network; expected ${NETWORK}.`, 'wrong_chain');
  const [tx, receipt] = await Promise.all([
    rpc('eth_getTransactionByHash', [txHash], fetchImpl),
    rpc('eth_getTransactionReceipt', [txHash], fetchImpl),
  ]);
  if (!tx || !receipt) throw new XLayerVerificationError('X Layer transaction is still pending.', 'tx_pending');
  if (String(receipt.status).toLowerCase() !== '0x1') throw new XLayerVerificationError('X Layer transaction reverted.', 'tx_reverted');
  if (String(tx.to || '').toLowerCase() !== REGISTRY_ADDRESS) throw new XLayerVerificationError('Wrong receipt registry.', 'wrong_target');
  if (String(tx.from || '').toLowerCase() !== String(walletAddress).toLowerCase()) throw new XLayerVerificationError('Wallet does not match receipt sender.', 'wrong_sender');
  if (String(tx.input || '').toLowerCase() !== expectedData.toLowerCase()) throw new XLayerVerificationError('Receipt payload mismatch.', 'wrong_evidence');
  return { blockNumber: Number.parseInt(receipt.blockNumber, 16), txHash: String(txHash).toLowerCase(), network: NETWORK, chainId: CHAIN_ID };
}

module.exports = {
  NETWORK, NETWORKS, CHAIN_ID, CHAIN_ID_HEX, RPC_URL, EXPLORER_URL, REGISTRY_ADDRESS,
  XLayerVerificationError, encodeBattleReceipt, verify,
};
