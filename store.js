'use strict';

const fs = require('fs');
const path = require('path');
const E = require('./engine');

function defaultWorld() {
  return {
    observatory: 0,
    contributors: 0,
    contributorAgents: {},
    challenges: {},
    shareCards: {},
    creators: {},
    follows: {},
    executionLeases: {},
    updatedAt: Date.now(),
  };
}

class JsonStore {
  constructor(file) {
    this.file = path.resolve(file);
    this.dir = path.dirname(this.file);
    fs.mkdirSync(this.dir, { recursive: true });
    this.data = { schemaVersion: 6, owners: {}, world: defaultWorld() };
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || !parsed.owners || typeof parsed.owners !== 'object') throw new Error('invalid store shape');
      this.data = parsed;
      this._migrate();
    } catch (err) {
      const bad = `${this.file}.corrupt-${Date.now()}`;
      try { fs.copyFileSync(this.file, bad); } catch (_) {}
      throw new Error(`[store] refusing to start with corrupt data; backup written to ${bad}: ${err.message}`);
    }
  }

  _migrate() {
    this.data.schemaVersion = 6;
    this.data.world = { ...defaultWorld(), ...(this.data.world || {}) };
    const world = this.data.world;
    world.challenges ||= {};
    world.shareCards ||= {};
    world.creators ||= {};
    world.follows ||= {};
    world.contributorAgents ||= {};
    world.executionLeases ||= {};

    // v2 stored bearer owner/session identifiers in shared growth records.
    // Remove them permanently; public identifiers are Agent IDs only.
    for (const challenge of Object.values(world.challenges)) {
      delete challenge.byOwner;
      challenge.acceptedBy ||= {};
      challenge.beatenBy ||= {};
    }
    for (const creator of Object.values(world.creators)) {
      delete creator.ownerId;
      creator.followerAgentIds ||= {};
      creator.followers = Object.keys(creator.followerAgentIds).length;
    }
    // Legacy follow keys contained owner IDs and cannot be retained safely.
    world.follows = {};
  }

  persist() {
    const tmp = `${this.file}.tmp`;
    const json = JSON.stringify(this.data, null, 2);
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }

  getOwner(id) { return this.data.owners[id] || null; }
  setOwner(id, value) { this.data.owners[id] = value; this.persist(); return value; }
  deleteOwner(id) { delete this.data.owners[id]; this.persist(); }
  moveOwner(oldId, nextId, value) {
    if (oldId !== nextId) delete this.data.owners[oldId];
    this.data.owners[nextId] = value;
    this.persist();
    return value;
  }
  listOwners() { return Object.entries(this.data.owners); }
  listAgents() { return Object.values(this.data.owners).map(o => o.agent).filter(Boolean); }
  findOwnerByRecoveryHash(hash) { return Object.entries(this.data.owners).find(([, o]) => o.recoveryHash === hash && o.agent) || null; }

  tryAcquireLease(resource, battleId, ownerId) {
    const world = this.data.world; world.executionLeases ||= {};
    const key = String(resource); const existing = world.executionLeases[key];
    if (existing && existing.battleId !== battleId) return false;
    world.executionLeases[key] = { resource:key, battleId:String(battleId), ownerId:String(ownerId || ''), acquiredAt: existing?.acquiredAt || Date.now(), heartbeatAt:Date.now() };
    this.persist(); return true;
  }
  releaseLease(resource, battleId) {
    const world = this.data.world; world.executionLeases ||= {}; const key=String(resource);
    const existing=world.executionLeases[key]; if (!existing || existing.battleId !== String(battleId)) return false;
    delete world.executionLeases[key]; this.persist(); return true;
  }
  getLease(resource) { const value=this.data.world.executionLeases?.[String(resource)]; return value ? JSON.parse(JSON.stringify(value)) : null; }
  listLeases() { return Object.values(this.data.world.executionLeases || {}).map(v=>JSON.parse(JSON.stringify(v))); }

  getWorld() { return this.data.world; }
  setWorld(value) { this.data.world = value; this.persist(); return value; }
  publicWorld() {
    const world = this.data.world;
    return {
      observatory: Number(world.observatory || 0),
      contributors: Number(world.contributors || 0),
      creatorCount: Object.keys(world.creators || {}).length,
      activeChallenges: Object.values(world.challenges || {}).filter(c => !c.expiresAt || c.expiresAt > Date.now()).length,
      updatedAt: world.updatedAt || null,
    };
  }
  integrityCheck() {
    try {
      if (!this.data || typeof this.data !== 'object' || !this.data.owners || !this.data.world) return { ok:false, persistence:'json', check:'invalid_shape' };
      return { ok:true, persistence:'json', check:'ok' };
    } catch (error) { return { ok:false, persistence:'json', check:'error', error:error.message }; }
  }
  checkpoint() { return null; }
  close() {}

  metrics() {
    const owners = Object.values(this.data.owners).filter(o => o.agent);
    const now = Date.now();
    const activeAfter = ms => owners.filter(o => (o.lastSeenAt || 0) >= now - ms).length;
    const evolutionCounts = { emerging: 0, capable: 0, skilled: 0, elite: 0 };
    for (const owner of owners) evolutionCounts[E.evolutionFor(owner.agent).id] += 1;
    return {
      agents: owners.length,
      active24h: activeAfter(24 * 60 * 60 * 1000),
      active7d: activeAfter(7 * 24 * 60 * 60 * 1000),
      activated: owners.filter(o => o.analytics?.firstMissionAt).length,
      recapOpened: owners.filter(o => (o.analytics?.recapOpens || 0) > 0).length,
      personalized: owners.filter(o => o.analytics?.homeCustomizedAt).length,
      publicPassports: owners.filter(o => o.agent?.publicProfile).length,
      anchoredProofs: owners.reduce((n, o) => n + (o.agent?.proofs || []).filter(p => p.anchored).length, 0),
      evolutionCounts,
      publicMoments: Object.keys(this.data.world.shareCards || {}).length,
      activeChallenges: Object.values(this.data.world.challenges || {}).filter(c => !c.expiresAt || c.expiresAt > now).length,
      generatedAt: now,
    };
  }
}

module.exports = { JsonStore, defaultWorld };
