'use strict';

// Optional helper for hosts that specifically want to materialize a named OKX CLI profile.
// Normal KULT Perp Wars deployments can use the official OKX_API_KEY / OKX_SECRET_KEY /
// OKX_PASSPHRASE environment variables directly and do not need this file.
const fs = require('fs');
const path = require('path');
const os = require('os');

if (String(process.env.KULT_OKX_WRITE_PROFILE || '').toLowerCase() !== 'true') process.exit(0);
const key = process.env.OKX_API_KEY || process.env.OKX_DEMO_API_KEY;
const secret = process.env.OKX_SECRET_KEY || process.env.OKX_DEMO_SECRET_KEY;
const pass = process.env.OKX_PASSPHRASE || process.env.OKX_DEMO_PASSPHRASE;
if (!(key && secret && pass)) throw new Error('KULT_OKX_WRITE_PROFILE=true requires all three OKX credentials.');

const profile = String(process.env.OKX_AGENT_KIT_PROFILE || 'demo').replace(/[^a-zA-Z0-9_-]/g, '') || 'demo';
const dir = path.join(os.homedir(), '.okx');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, 'config.toml');
if (fs.existsSync(file) && String(process.env.KULT_OKX_OVERWRITE_PROFILE || '').toLowerCase() !== 'true') {
  throw new Error(`${file} already exists. Set KULT_OKX_OVERWRITE_PROFILE=true only if replacement is intentional.`);
}
const safe = value => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const body = `default_profile = "${profile}"\n\n[profiles.${profile}]\napi_key = "${safe(key)}"\nsecret_key = "${safe(secret)}"\npassphrase = "${safe(pass)}"\ndemo = true\n`;
fs.writeFileSync(file, body, { mode: 0o600 });
console.log(`OKX demo profile written to ${file}`);
