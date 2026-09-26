'use strict';

const crypto = require('crypto');

const SECRET = String(process.env.KULT_IDENTITY_GATEWAY_SECRET || '');
const MAX_SKEW_MS = Math.max(15_000, Math.min(5 * 60_000, Number(process.env.KULT_IDENTITY_MAX_SKEW_MS || 90_000)));

function safeEqualHex(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(String(a || '')) || !/^[a-f0-9]{64}$/i.test(String(b || ''))) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return crypto.timingSafeEqual(left, right);
}

function canonicalOwnerId(subject) {
  return `ku_${crypto.createHash('sha256').update(`kult-user|${subject}`).digest('hex')}`;
}

function verifyGateway(req, pathname) {
  if (!SECRET) return null;
  const subject = String(req.headers['x-kult-subject'] || '').trim();
  const timestamp = Number(req.headers['x-kult-timestamp'] || 0);
  const signature = String(req.headers['x-kult-signature'] || '').trim();
  if (!subject || subject.length > 256 || !Number.isFinite(timestamp) || !signature) return null;
  if (Math.abs(Date.now() - timestamp) > MAX_SKEW_MS) return null;
  const message = `${req.method || 'GET'}\n${pathname}\n${subject}\n${timestamp}`;
  const expected = crypto.createHmac('sha256', SECRET).update(message).digest('hex');
  if (!safeEqualHex(signature, expected)) return null;
  return { subject, ownerId: canonicalOwnerId(subject), mode: 'kult-gateway' };
}

function health() {
  return { mode: SECRET ? 'KULT_GATEWAY_OR_SESSION' : 'SESSION', gatewayConfigured: Boolean(SECRET), maxSkewMs: MAX_SKEW_MS };
}

module.exports = { verifyGateway, canonicalOwnerId, health };
