'use strict';

const crypto = require('crypto');

const networkName = String(process.env.KULT_OKX_AI_NETWORK || 'mainnet').toLowerCase() === 'testnet' ? 'testnet' : 'mainnet';
const OKX_AI_NETWORK = Object.freeze(networkName === 'testnet'
  ? { name:'X Layer Testnet', chainId:1952, caip2:'eip155:1952' }
  : { name:'X Layer', chainId:196, caip2:'eip155:196' });

function service(id, name, description, endpoint, inputSchema) {
  return Object.freeze({
    id, name, mode:'A2MCP',
    price:{ amount:'0', currency:'USDC', network:OKX_AI_NETWORK.caip2 },
    description, endpoint, inputSchema,
  });
}

const SERVICE_CATALOG = Object.freeze([
  service(
    'kult.market.read',
    'KULT Market Read',
    'Returns a structured market thesis from a persistent, publicly opted-in KULT Agent without placing a trade.',
    '/api/okx-ai/market-read',
    { type:'object', required:['agentId','symbol'], properties:{ agentId:{type:'string'}, symbol:{type:'string',enum:['BTC','ETH','SOL']} } },
  ),
  service(
    'kult.agent.market-profile',
    'KULT Agent Market Profile',
    'Returns the public Perp Wars profile, skill levels and raid record for a publicly opted-in persistent KULT Agent.',
    '/api/okx-ai/agent-profile',
    { type:'object', required:['agentId'], properties:{ agentId:{type:'string'} } },
  ),
  service(
    'kult.perp.raid-evaluate',
    'KULT Perp Raid Evaluator',
    'Returns progression-safe evaluation metadata for a resolved raid belonging to a publicly opted-in KULT Agent.',
    '/api/okx-ai/raid-evaluate',
    { type:'object', required:['agentId','battleId'], properties:{ agentId:{type:'string'}, battleId:{type:'string'} } },
  ),
]);

function publicCatalog() {
  return SERVICE_CATALOG.map(x => ({ ...x, price:{...x.price}, inputSchema:JSON.parse(JSON.stringify(x.inputSchema)) }));
}

function serviceManifest(publicOrigin = '') {
  const base = String(publicOrigin || '').replace(/\/$/, '');
  return {
    provider:'KULT Games',
    product:'KULT World · Perp Wars',
    version:'6.5.0',
    serviceType:'A2MCP',
    access:'Public Agents must opt in by publishing their KULT Passport. Owner browser sessions may call their own Agent directly.',
    network:{ ...OKX_AI_NETWORK },
    services:publicCatalog().map(item => ({ ...item, endpoint:`${base}${item.endpoint}` })),
    capabilities:[
      'persistent-agent-market-memory', 'gamified-perps', 'agent-v-agent-raids',
      'market-reasoning', 'risk-discipline', 'xlayer-battle-receipts',
    ],
  };
}

function idempotencyKey(parts) {
  return crypto.createHash('sha256').update(parts.map(x => String(x ?? '')).join('|')).digest('hex');
}

module.exports = { OKX_AI_NETWORK, SERVICE_CATALOG, publicCatalog, serviceManifest, idempotencyKey };
