'use strict';

const ROBINHOOD_TESTNET = Object.freeze({
  chainId: 46630,
  chainIdHex: '0xb626',
  name: 'Robinhood Chain Testnet',
  explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
});
const DOMAIN = Object.freeze({ analysis: 1, creativity: 2, strategy: 3, social: 4 });
const OUTCOME = Object.freeze({ success: 1, miss: 2 });

function word(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${label} must be a bytes32 hex value`);
  return normalized.slice(2);
}

function encodeAnchorCalldata({ agentId, receiptId, evidenceHash, cap, outcome, difficulty }) {
  const domain = DOMAIN[cap];
  const result = OUTCOME[outcome];
  const level = Number(difficulty);
  if (!domain || !result || !Number.isInteger(level) || level < 0 || level > 100) throw new TypeError('invalid receipt metadata');
  const metadata = ((domain << 24) | (result << 16) | level).toString(16).padStart(64, '0');
  return `0x01${word(agentId, 'agentId')}${word(receiptId, 'receiptId')}${word(evidenceHash, 'evidenceHash')}${metadata}`;
}

class KultWorldClient {
  constructor({ baseUrl = '', fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation required');
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  async request(path) {
    const response = await this.fetch(`${this.baseUrl}${path}`, { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'KULT World request failed');
      error.code = data.code;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  passport(agentId) { return this.request(`/api/passport/${encodeURIComponent(agentId)}`); }
  challenge(challengeId) { return this.request(`/api/challenge/${encodeURIComponent(challengeId)}`); }
  moment(slug) { return this.request(`/api/share/${encodeURIComponent(slug)}`); }
  leaderboard(cap) { return this.request(`/api/leaderboard${cap ? `?cap=${encodeURIComponent(cap)}` : ''}`); }
  creators() { return this.request('/api/creators'); }
}

module.exports = { ROBINHOOD_TESTNET, DOMAIN, OUTCOME, encodeAnchorCalldata, KultWorldClient };
