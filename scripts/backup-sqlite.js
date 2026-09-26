'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const source = path.resolve(process.argv[2] || process.env.KULT_DATA_DB || './data/kult-world.sqlite');
if (!fs.existsSync(source)) throw new Error(`SQLite database not found: ${source}`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.resolve(process.argv[3] || `${source}.backup-${stamp}`);
const db = new DatabaseSync(source);
const escaped = target.replaceAll("'", "''");
db.exec(`VACUUM INTO '${escaped}'`);
db.close();
console.log(target);
