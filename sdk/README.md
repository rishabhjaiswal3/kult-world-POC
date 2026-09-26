# KULT World Passport SDK

Dependency-free helpers for reading public KULT World surfaces and encoding the registry's compact receipt protocol.

```js
const { KultWorldClient, encodeAnchorCalldata } = require('@kult/world-passport-sdk');

const client = new KultWorldClient({ baseUrl: 'https://world.example.com' });
const { passport } = await client.passport('agent_abc');

const data = encodeAnchorCalldata({
  agentId: '0x…', receiptId: '0x…', evidenceHash: '0x…',
  cap: 'analysis', outcome: 'success', difficulty: 52,
});
```

The server remains the authority for whether a transaction matches a KULT receipt. The encoder does not mark anything verified by itself.
