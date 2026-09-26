'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SQLiteStore } = require('../sqlite-store');
const E = require('../engine');

test('SQLite production store persists owners, world state, recovery lookup and audit events', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kult-world-sqlite-'));
  const file = path.join(dir, 'world.sqlite');
  const store = new SQLiteStore(file);
  assert.deepEqual(store.integrityCheck(), { ok:true, check:'ok', persistence:'sqlite' });
  const agent = E.newAgent('NORI', 'NORI', 'explore', 1700000000000);
  const owner = { createdAt: Date.now(), updatedAt: Date.now(), lastSeenAt: Date.now(), recoveryHash: 'abc123', analytics: {}, agent };
  store.setOwner('owner-1', owner);
  assert.equal(store.getOwner('owner-1').agent.id, agent.id);
  assert.equal(store.findOwnerByRecoveryHash('abc123')[0], 'owner-1');
  const world = store.getWorld();
  world.observatory = 42;
  store.setWorld(world);
  assert.equal(store.getWorld().observatory, 42);
  store.appendAudit({ id: 'evt-1', type: 'world.experience', agentId: agent.id, ownerId: 'owner-1', payload: { district: 'commons' } });
  assert.equal(store.recentAudit(5)[0].type, 'world.experience');
  assert.equal(store.metrics().persistence, 'sqlite');
  store.close();

  const reopened = new SQLiteStore(file);
  assert.equal(reopened.getOwner('owner-1').agent.id, agent.id);
  assert.equal(reopened.getWorld().observatory, 42);
  reopened.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SQLite execution lease is durable and never expires just because time passes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kult-world-lease-'));
  const file=path.join(dir,'world.sqlite');
  let store=new SQLiteStore(file);
  assert.equal(store.tryAcquireLease('okx-demo:default','battle-1','owner-1'),true);
  assert.equal(store.tryAcquireLease('okx-demo:default','battle-2','owner-2'),false);
  const first=store.getLease('okx-demo:default');
  assert.equal(first.battleId,'battle-1');
  store.close();
  store=new SQLiteStore(file);
  assert.equal(store.getLease('okx-demo:default').battleId,'battle-1','lease must survive process restart');
  assert.equal(store.tryAcquireLease('okx-demo:default','battle-2','owner-2'),false);
  assert.equal(store.releaseLease('okx-demo:default','battle-1'),true);
  assert.equal(store.tryAcquireLease('okx-demo:default','battle-2','owner-2'),true);
  store.close();fs.rmSync(dir,{recursive:true,force:true});
});
