'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const E = require('../engine');
const G = require('../growth');
const { JsonStore } = require('../store');

function freshStore() { return new JsonStore(path.join(os.tmpdir(), `kw-growth-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)); }
function trainedAgent(name = 'NORI', attempts = 14) {
  const agent = E.newAgent(name, 'NORI', 'explore', 1);
  for (let index = 0; index < attempts; index++) {
    agent.needs.energy = 100;
    E.runMission(agent, 'game_qa', index % 2 ? 'speed' : 'loop', 100 + index);
  }
  return agent;
}

test('moments and share cards only describe earned records', () => {
  const fresh = E.newAgent('FRESH', 'NORI', 'explore', 1);
  assert.equal(G.deriveMoments(fresh).length, 0);
  const trained = trainedAgent();
  const moments = G.deriveMoments(trained);
  assert.ok(moments.length > 0);
  for (const moment of moments.filter(item => item.kind === 'TIER_UP')) assert.ok(moment.evidence >= 7);
  const card = G.buildShareCard(trained, moments[0]);
  assert.match(card.slug, /^moment_[a-f0-9]{32}$/);
  assert.equal(card.agentId, trained.id);
  assert.equal('ownerId' in card, false);
  assert.equal('byOwner' in card, false);
});

test('leaderboard includes public Passports and separates provisional evidence', () => {
  const store = freshStore();
  const proven = trainedAgent('PROVEN'); proven.publicProfile = true;
  const provisional = E.newAgent('PROVISIONAL', 'NORI', 'explore', 2); provisional.publicProfile = true;
  const privateAgent = trainedAgent('PRIVATE');
  const board = G.leaderboard(store, [proven, provisional, privateAgent]);
  assert.equal(board.proven[0].name, 'PROVEN');
  assert.ok(board.provisional.some(row => row.name === 'PROVISIONAL'));
  assert.ok(!JSON.stringify(board).includes('PRIVATE'));
});

test('challenge requires evidence, acceptance, a different Agent, and idempotent counters', () => {
  const store = freshStore();
  const target = trainedAgent('TARGET', 6);
  const challenge = G.createChallenge(store, target, 'analysis');
  assert.equal(challenge.cap, 'analysis');
  assert.ok(challenge.targetEvidence >= 4);
  assert.ok(G.acceptChallenge(store, challenge.id, target).error, 'self challenge is rejected');

  const rookie = E.newAgent('ROOKIE', 'NORI', 'explore', 3);
  assert.ok(G.resolveChallenge(store, challenge.id, rookie).error, 'resolution requires prior acceptance');
  assert.equal(G.acceptChallenge(store, challenge.id, rookie).ok, true);
  assert.equal(G.acceptChallenge(store, challenge.id, rookie).challenge.accepted, 1, 'repeat acceptance cannot inflate totals');
  const result = G.resolveChallenge(store, challenge.id, rookie);
  assert.equal(result.beaten, false);
  assert.equal(result.reason, 'insufficient_evidence');

  const fresh = E.newAgent('NO_DATA', 'NORI', 'explore', 4);
  assert.ok(G.createChallenge(store, fresh, 'analysis').error);
});

test('creator discovery and follows never change capability or credits', () => {
  const store = freshStore();
  const creator = trainedAgent('CREATOR');
  const follower = E.newAgent('FOLLOWER', 'MOSS', 'explore', 5);
  const beforeCapability = JSON.stringify(creator.capability);
  const beforeCredits = creator.credits;
  const registration = G.registerCreatorAgent(store, creator, 'karn_builds');
  assert.equal(registration.creator.handle, 'karn_builds');
  assert.equal(creator.publicProfile, true);
  assert.equal(JSON.stringify(creator.capability), beforeCapability);
  assert.equal(creator.credits, beforeCredits);
  assert.ok(G.registerCreatorAgent(store, follower, 'admin').error, 'reserved handles are blocked');

  assert.equal(G.followCreator(store, creator.id, follower).followers, 1);
  const duplicate = G.followCreator(store, creator.id, follower);
  assert.equal(duplicate.followers, 1);
  assert.equal(duplicate.already, true);
  assert.ok(G.followCreator(store, creator.id, creator).error, 'self follows are blocked');
  assert.equal(JSON.stringify(store.getWorld()).includes('ow_'), false, 'bearer owner IDs never enter public growth records');
});

test('public IDs are high-entropy and public serializers hide mutable maps', () => {
  const store = freshStore();
  const agent = trainedAgent('SIGNAL', 5);
  const first = G.createChallenge(store, agent, 'analysis');
  const second = G.createChallenge(store, agent, 'analysis');
  assert.notEqual(first.id, second.id);
  assert.equal('acceptedBy' in first, false);
  assert.equal('beatenBy' in first, false);
  const card = G.storeShareCard(store, G.buildShareCard(agent, G.deriveMoments(agent)[0]));
  assert.deepEqual(G.publicCard(store.getWorld().shareCards[card.slug]), card);
});
