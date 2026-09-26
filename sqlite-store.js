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
    updatedAt: Date.now(),
  };
}

function loadSqlite() {
  try {
    // Node 22+ built-in SQLite keeps the production profile dependency-light.
    // The adapter deliberately stays behind a store interface so Postgres can
    // replace it without changing World/Arena/Passport semantics.
    return require('node:sqlite');
  } catch (error) {
    throw new Error(`SQLite runtime unavailable. KULT World production profile requires Node 22+: ${error.message}`);
  }
}

class SQLiteStore {
  constructor(file) {
    const { DatabaseSync } = loadSqlite();
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this._migrate();
    this._ensureWorld();
    this._prepare();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS owners (
        owner_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        recovery_hash TEXT,
        agent_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_owners_recovery_hash
        ON owners(recovery_hash) WHERE recovery_hash IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_owners_agent_id
        ON owners(agent_id) WHERE agent_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS world_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        agent_id TEXT,
        owner_id TEXT,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_agent_created ON audit_events(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_type_created ON audit_events(event_type, created_at DESC);
      CREATE TABLE IF NOT EXISTS execution_leases (
        resource TEXT PRIMARY KEY,
        battle_id TEXT NOT NULL,
        owner_id TEXT,
        acquired_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL
      );
    `);
    const current = this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version || 0;
    if (current < 1) this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)').run(Date.now());
    if (current < 2) this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, ?)').run(Date.now());
  }

  _ensureWorld() {
    const existing = this.db.prepare('SELECT singleton FROM world_state WHERE singleton = 1').get();
    if (!existing) this.db.prepare('INSERT INTO world_state(singleton, payload, updated_at) VALUES(1, ?, ?)').run(JSON.stringify(defaultWorld()), Date.now());
  }

  _prepare() {
    this.q = {
      getOwner: this.db.prepare('SELECT payload FROM owners WHERE owner_id = ?'),
      upsertOwner: this.db.prepare(`
        INSERT INTO owners(owner_id,payload,recovery_hash,agent_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(owner_id) DO UPDATE SET
          payload=excluded.payload,
          recovery_hash=excluded.recovery_hash,
          agent_id=excluded.agent_id,
          updated_at=excluded.updated_at
      `),
      deleteOwner: this.db.prepare('DELETE FROM owners WHERE owner_id = ?'),
      listOwners: this.db.prepare('SELECT owner_id,payload FROM owners ORDER BY created_at ASC'),
      byRecovery: this.db.prepare('SELECT owner_id,payload FROM owners WHERE recovery_hash = ? LIMIT 1'),
      getWorld: this.db.prepare('SELECT payload FROM world_state WHERE singleton = 1'),
      setWorld: this.db.prepare('UPDATE world_state SET payload = ?, updated_at = ? WHERE singleton = 1'),
      audit: this.db.prepare('INSERT OR IGNORE INTO audit_events(event_id,event_type,agent_id,owner_id,payload,created_at) VALUES(?,?,?,?,?,?)'),
      auditRecent: this.db.prepare('SELECT event_id,event_type,agent_id,owner_id,payload,created_at FROM audit_events ORDER BY id DESC LIMIT ?'),
      getLease: this.db.prepare('SELECT resource,battle_id,owner_id,acquired_at,heartbeat_at FROM execution_leases WHERE resource = ?'),
      insertLease: this.db.prepare('INSERT INTO execution_leases(resource,battle_id,owner_id,acquired_at,heartbeat_at) VALUES(?,?,?,?,?)'),
      touchLease: this.db.prepare('UPDATE execution_leases SET heartbeat_at = ? WHERE resource = ? AND battle_id = ?'),
      deleteLease: this.db.prepare('DELETE FROM execution_leases WHERE resource = ? AND battle_id = ?'),
      listLeases: this.db.prepare('SELECT resource,battle_id,owner_id,acquired_at,heartbeat_at FROM execution_leases ORDER BY acquired_at ASC'),
    };
  }

  _parse(raw, fallback = null) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (error) { throw new Error(`Corrupt SQLite JSON payload: ${error.message}`); }
  }

  _transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  getOwner(id) {
    const row = this.q.getOwner.get(id);
    return row ? this._parse(row.payload) : null;
  }

  setOwner(id, value) {
    const now = Date.now();
    const createdAt = Number(value?.createdAt || now);
    this.q.upsertOwner.run(id, JSON.stringify(value), value?.recoveryHash || null, value?.agent?.id || null, createdAt, now);
    return value;
  }

  deleteOwner(id) { this.q.deleteOwner.run(id); }

  moveOwner(oldId, nextId, value) {
    this._transaction(() => {
      if (oldId !== nextId) this.q.deleteOwner.run(oldId);
      this.setOwner(nextId, value);
    });
    return value;
  }

  listOwners() { return this.q.listOwners.all().map(row => [row.owner_id, this._parse(row.payload)]); }
  listAgents() { return this.listOwners().map(([, owner]) => owner.agent).filter(Boolean); }

  findOwnerByRecoveryHash(hash) {
    const row = this.q.byRecovery.get(hash);
    return row ? [row.owner_id, this._parse(row.payload)] : null;
  }


  tryAcquireLease(resource, battleId, ownerId) {
    const key=String(resource), bid=String(battleId), now=Date.now();
    return this._transaction(()=>{
      const existing=this.q.getLease.get(key);
      if (existing && String(existing.battle_id) !== bid) return false;
      if (existing) this.q.touchLease.run(now,key,bid);
      else this.q.insertLease.run(key,bid,String(ownerId || ''),now,now);
      return true;
    });
  }
  releaseLease(resource, battleId) { return this.q.deleteLease.run(String(resource),String(battleId)).changes > 0; }
  getLease(resource) {
    const row=this.q.getLease.get(String(resource));
    return row ? { resource:row.resource,battleId:row.battle_id,ownerId:row.owner_id,acquiredAt:row.acquired_at,heartbeatAt:row.heartbeat_at } : null;
  }
  listLeases() { return this.q.listLeases.all().map(row=>({ resource:row.resource,battleId:row.battle_id,ownerId:row.owner_id,acquiredAt:row.acquired_at,heartbeatAt:row.heartbeat_at })); }

  getWorld() {
    const row = this.q.getWorld.get();
    const world = { ...defaultWorld(), ...this._parse(row?.payload, {}) };
    world.challenges ||= {}; world.shareCards ||= {}; world.creators ||= {}; world.follows ||= {}; world.contributorAgents ||= {};
    return world;
  }

  setWorld(value) { this.q.setWorld.run(JSON.stringify(value), Date.now()); return value; }

  publicWorld() {
    const world = this.getWorld();
    return {
      observatory: Number(world.observatory || 0),
      contributors: Number(world.contributors || 0),
      creatorCount: Object.keys(world.creators || {}).length,
      activeChallenges: Object.values(world.challenges || {}).filter(c => !c.expiresAt || c.expiresAt > Date.now()).length,
      updatedAt: world.updatedAt || null,
    };
  }

  appendAudit(event) {
    const createdAt = Number(event.createdAt || Date.now());
    const eventId = String(event.id || `evt_${createdAt}_${Math.random().toString(36).slice(2, 10)}`);
    this.q.audit.run(eventId, String(event.type || 'unknown'), event.agentId || null, event.ownerId || null, JSON.stringify(event.payload || {}), createdAt);
    return eventId;
  }

  integrityCheck() {
    try {
      const row=this.db.prepare('PRAGMA quick_check').get();
      const check=row ? String(Object.values(row)[0] ?? '') : 'unknown';
      return { ok:check==='ok', check, persistence:'sqlite' };
    } catch (error) { return { ok:false, check:'error', persistence:'sqlite', error:error.message }; }
  }

  checkpoint(mode='PASSIVE') {
    const allowed=new Set(['PASSIVE','FULL','RESTART','TRUNCATE']); const selected=allowed.has(String(mode).toUpperCase()) ? String(mode).toUpperCase() : 'PASSIVE';
    try { return this.db.prepare(`PRAGMA wal_checkpoint(${selected})`).get() || null; } catch (_) { return null; }
  }

  recentAudit(limit = 100) {
    return this.q.auditRecent.all(Math.max(1, Math.min(500, Number(limit) || 100))).map(row => ({
      id: row.event_id, type: row.event_type, agentId: row.agent_id, ownerId: row.owner_id,
      payload: this._parse(row.payload, {}), createdAt: row.created_at,
    }));
  }

  metrics() {
    const owners = this.listOwners().map(([, owner]) => owner).filter(owner => owner.agent);
    const now = Date.now();
    const activeAfter = ms => owners.filter(owner => (owner.lastSeenAt || 0) >= now - ms).length;
    const evolutionCounts = { emerging: 0, capable: 0, skilled: 0, elite: 0 };
    for (const owner of owners) evolutionCounts[E.evolutionFor(owner.agent).id] += 1;
    const world = this.getWorld();
    return {
      agents: owners.length,
      active24h: activeAfter(24 * 60 * 60 * 1000),
      active7d: activeAfter(7 * 24 * 60 * 60 * 1000),
      activated: owners.filter(owner => owner.analytics?.firstMissionAt).length,
      recapOpened: owners.filter(owner => (owner.analytics?.recapOpens || 0) > 0).length,
      personalized: owners.filter(owner => owner.analytics?.homeCustomizedAt).length,
      publicPassports: owners.filter(owner => owner.agent?.publicProfile).length,
      anchoredProofs: owners.reduce((n, owner) => n + (owner.agent?.proofs || []).filter(p => p.anchored).length, 0),
      evolutionCounts,
      publicMoments: Object.keys(world.shareCards || {}).length,
      activeChallenges: Object.values(world.challenges || {}).filter(c => !c.expiresAt || c.expiresAt > now).length,
      persistence: 'sqlite',
      generatedAt: now,
    };
  }

  close() { try { this.db.close(); } catch (_) {} }
}

module.exports = { SQLiteStore, defaultWorld };
