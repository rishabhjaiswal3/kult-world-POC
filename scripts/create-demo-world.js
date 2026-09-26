'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const E = require('../engine');
const G = require('../growth');
const { JsonStore } = require('../store');

if (process.env.NODE_ENV === 'production' || process.env.KULT_DEMO_SEED !== 'yes') {
  console.error('Refusing to seed. Run only locally with KULT_DEMO_SEED=yes.');
  process.exit(1);
}

const output = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'demo-world.json'));
const store = new JsonStore(output);
if (store.listOwners().length) {
  console.error(`Refusing to overwrite non-empty store: ${output}`);
  process.exit(1);
}

const missionFor = { analysis: 'game_qa', creativity: 'remix', strategy: 'arena_trial', social: 'welcome_shift' };
const choiceFor = { analysis: 'loop', creativity: 'twist', strategy: 'wait', social: 'listen' };
function train(agent, cap, attempts) {
  for (let index = 0; index < attempts; index++) {
    agent.needs.energy = 100;
    E.runMission(agent, missionFor[cap], choiceFor[cap], Date.now() - (attempts - index) * 60_000);
  }
}
function addAgent(name, persona, cap, attempts) {
  const agent = E.newAgent(name, persona, 'explore', Date.now() - 14 * 86_400_000);
  train(agent, cap, attempts);
  agent.publicProfile = true;
  const ownerId = `ow_${crypto.randomBytes(32).toString('hex')}`;
  store.setOwner(ownerId, { createdAt: agent.born, updatedAt: Date.now(), lastSeenAt: Date.now(), recoveryHash: null, analytics: { adoptedAt: agent.born, firstMissionAt: agent.born + 1000 }, agent });
  return agent;
}

const nori = addAgent('Nori', 'NORI', 'analysis', 18);
const aegis = addAgent('Aegis', 'AEGIS', 'strategy', 22);
const pixel = addAgent('Pixel', 'PIXEL', 'creativity', 16);
const moss = addAgent('Moss', 'MOSS', 'social', 14);

G.registerCreatorAgent(store, pixel, 'pixel_builds');
G.registerCreatorAgent(store, moss, 'moss_hosts');
G.followCreator(store, pixel.id, nori);
G.followCreator(store, pixel.id, aegis);
G.followCreator(store, moss.id, nori);

const challenge = G.createChallenge(store, aegis, 'strategy');
const moment = G.deriveMoments(nori)[0];
const card = G.storeShareCard(store, G.buildShareCard(nori, moment));
const recoveryCode = crypto.randomBytes(18).toString('base64url');
const noriOwner = store.listOwners().find(([, owner]) => owner.agent?.id === nori.id);
noriOwner[1].recoveryHash = crypto.createHash('sha256').update(recoveryCode).digest('hex');
store.setOwner(noriOwner[0], noriOwner[1]);

const world = store.getWorld();
world.contributorAgents = Object.fromEntries(store.listAgents().map(agent => [agent.id, Date.now()]));
world.contributors = Object.keys(world.contributorAgents).length;
world.observatory = store.listAgents().reduce((sum, agent) => sum + agent.reputation, 0);
world.updatedAt = Date.now();
store.setWorld(world);

console.log(`Demo store: ${output}`);
console.log(`Nori recovery key: ${recoveryCode}`);
console.log(`Moment path: /s/${card.slug}`);
console.log(`Challenge path: /c/${challenge.id}`);
console.log('Start with: KULT_DATA_FILE=' + output + ' npm start');
