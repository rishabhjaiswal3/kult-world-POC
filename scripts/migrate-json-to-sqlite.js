'use strict';

const fs = require('fs');
const path = require('path');
const { SQLiteStore } = require('../sqlite-store');

const source = path.resolve(process.argv[2] || process.env.KULT_DATA_FILE || './data/kult-world.json');
const target = path.resolve(process.argv[3] || process.env.KULT_DATA_DB || './data/kult-world.sqlite');
if (!fs.existsSync(source)) throw new Error(`Source JSON not found: ${source}`);
if (fs.existsSync(target) && !process.argv.includes('--overwrite')) throw new Error(`Target already exists: ${target}. Pass --overwrite only after taking a backup.`);
if (fs.existsSync(target)) fs.rmSync(target, { force: true });
const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
if (!parsed?.owners || typeof parsed.owners !== 'object') throw new Error('Invalid KULT World JSON store.');
const store = new SQLiteStore(target);
for (const [ownerId, owner] of Object.entries(parsed.owners)) store.setOwner(ownerId, owner);
store.setWorld(parsed.world || {});
store.appendAudit({ type: 'migration.json_to_sqlite', payload: { source: path.basename(source), owners: Object.keys(parsed.owners).length } });
store.close();
console.log(`Migrated ${Object.keys(parsed.owners).length} owners to ${target}`);
