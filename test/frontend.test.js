'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const staticDir = path.join(__dirname, '..', 'static');
const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(staticDir, 'styles.css'), 'utf8');

test('frontend IDs are unique and JavaScript selectors resolve', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate HTML IDs create ambiguous interactions');
  const referenced = [...app.matchAll(/\$\(['"]#([A-Za-z][\w-]*)/g)].map(match => match[1]);
  const dynamicIds = new Set(['recoveryInput']);
  const missing = [...new Set(referenced)].filter(id => !ids.includes(id) && !dynamicIds.has(id));
  assert.deepEqual(missing, []);
});

test('every navigation target has a view and mobile/desktop expose Community', () => {
  const views = new Set([...html.matchAll(/id="([a-z]+)View"/g)].map(match => match[1]));
  const targets = [...html.matchAll(/data-view="([a-z]+)"/g)].map(match => match[1]);
  for (const target of targets) assert.ok(views.has(target), `missing ${target} view`);
  assert.ok(targets.filter(target => target === 'community').length >= 2);
});

test('stylesheets and markup include launch-critical responsive surfaces', () => {
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /\.communityColumns/);
  assert.match(html, /id="activeChallenge"/);
  assert.match(html, /id="publishPassportBtn"/);
  assert.match(html, /id="leaderboardList"/);
  assert.match(html, /id="creatorList"/);
  assert.match(html, /id="townSquare"/);
  assert.match(html, /id="verifyPassportBtn"/);
  assert.match(css, /data-evolution="elite"/);
  assert.match(app, /renderTownSquare/);
});

test('cinematic world uses backend-owned Pulse, A2A and runtime state',()=>{
  assert.match(app,/\/api\/world\/runtime/);
  assert.match(app,/\/api\/pulse\/prepare/);
  assert.match(app,/\/api\/pulse\/commit/);
  assert.match(app,/\/api\/pulse\/resolve/);
  assert.match(app,/\/api\/a2a\/hire/);
  assert.doesNotMatch(app,/commerce adapter not connected in v6/);
  assert.doesNotMatch(app,/simulated prototype only/);
});
