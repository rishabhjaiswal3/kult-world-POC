'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const E = require('../engine');
const { JsonStore } = require('../store');

test('store migrates legacy bearer references out of public growth records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-store-migrate-'));
  const file = path.join(dir, 'world.json');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 2,
    owners: {},
    world: {
      challenges: { old: { id: 'old', byOwner: 'ow_secret' } },
      creators: { agent_old: { agentId: 'agent_old', handle: 'old', ownerId: 'ow_secret', followerAgentIds: {} } },
      follows: { 'ow_secret:agent_old': true },
    },
  }));
  const store = new JsonStore(file);
  assert.equal(store.getWorld().challenges.old.byOwner, undefined);
  assert.equal(store.getWorld().creators.agent_old.ownerId, undefined);
  assert.deepEqual(store.getWorld().follows, {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test('store refuses corrupt state and preserves a diagnostic backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-store-corrupt-'));
  const file = path.join(dir, 'world.json');
  fs.writeFileSync(file, '{not-json');
  assert.throws(() => new JsonStore(file), /refusing to start with corrupt data/);
  assert.ok(fs.readdirSync(dir).some(name => name.startsWith('world.json.corrupt-')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('public world and metrics expose aggregates rather than owner records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-store-metrics-'));
  const store = new JsonStore(path.join(dir, 'world.json'));
  const agent = E.newAgent('Nori', 'NORI', 'explore', Date.now());
  agent.publicProfile = true;
  store.setOwner('ow_internal', { agent, lastSeenAt: Date.now(), analytics: { firstMissionAt: Date.now(), recapOpens: 1, homeCustomizedAt: Date.now() } });
  const publicWorld = store.publicWorld();
  assert.equal(publicWorld.observatory, 0);
  assert.equal('owners' in publicWorld, false);
  const metrics = store.metrics();
  assert.equal(metrics.agents, 1);
  assert.equal(metrics.activated, 1);
  assert.equal(metrics.publicPassports, 1);
  assert.equal('ownerIds' in metrics, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
