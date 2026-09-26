/**
 * GOAT Flow funding routes.
 *
 *   POST /jobs/:jobId/goat/orders                       open an order, get the signing request
 *   POST /jobs/:jobId/goat/orders/:orderId/signature    submit the buyer's calldata signature
 *   GET  /jobs/:jobId/goat/orders/:orderId              order status
 *
 * All three require the caller to own the job's buyer agent.
 */

import { FastifyInstance, FastifyReply } from 'fastify';

import { requireAuth, assertOwnsJobCreator } from '../middleware/auth';
import { FundingPreconditionError } from '../funding/signed-agreement';
import {
  GoatMismatchError,
  GoatOwnershipError,
  GoatUnavailableError,
  createGoatOrder,
  getGoatOrder,
  submitGoatSignature,
} from '../goat/goat-funding.service';

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof FundingPreconditionError) return reply.status(400).send({ error: err.message });
  if (err instanceof GoatOwnershipError) return reply.status(403).send({ error: err.message });
  if (err instanceof GoatUnavailableError) return reply.status(503).send({ error: err.message });
  if (err instanceof GoatMismatchError) {
    // Upstream returned something unsafe to sign. Our problem to report, not the buyer's to fix.
    return reply.status(502).send({ error: 'GOAT signing request did not match this job', problems: err.problems });
  }
  return reply.status(502).send({ error: `GOAT request failed: ${(err as Error).message}` });
}

export async function goatRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [requireAuth(app)] as never };

  app.post('/:jobId/goat/orders', auth, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const { payChainId } = (req.body ?? {}) as { payChainId?: number };

    if (!(await assertOwnsJobCreator(req, reply, jobId))) return;
    if (payChainId !== undefined && (!Number.isInteger(payChainId) || payChainId <= 0)) {
      return reply.status(400).send({ error: 'payChainId must be a positive integer' });
    }

    try {
      return await createGoatOrder(jobId, payChainId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/:jobId/goat/orders/:orderId/signature', auth, async (req, reply) => {
    const { jobId, orderId } = req.params as { jobId: string; orderId: string };
    const { signature } = (req.body ?? {}) as { signature?: string };

    if (!(await assertOwnsJobCreator(req, reply, jobId))) return;
    if (!signature) return reply.status(400).send({ error: 'signature is required' });

    try {
      await submitGoatSignature(jobId, orderId, signature);
      return { orderId, submitted: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/:jobId/goat/orders/:orderId', auth, async (req, reply) => {
    const { jobId, orderId } = req.params as { jobId: string; orderId: string };

    if (!(await assertOwnsJobCreator(req, reply, jobId))) return;

    try {
      return await getGoatOrder(jobId, orderId);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
