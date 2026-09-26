/**
 * Notice a job that was funded on Base without us doing the funding.
 *
 * Every funding path until now ran through our own relayer, so the database
 * was updated by the same request that sent the transaction. That is not a
 * reconciliation, it is a side effect, and it has two holes:
 *
 *   1. **GOAT Flow does not call us.** In the x402 path goatx402 invokes the
 *      escrow directly. No request of ours is in flight, so nothing runs the
 *      Prisma write or starts the training. The job would sit ESCROWED on
 *      chain and NEGOTIATING in our database, with the buyer's USDC locked and
 *      the trainer never told to begin.
 *
 *   2. **Our own relayer can already strand a job.** If the funding
 *      transaction lands but this service dies before the write, the money is
 *      locked on chain and invisible here, with no path back. That bug exists
 *      today, independent of GOAT.
 *
 * Both are the same bug: the chain is the source of truth for whether a job is
 * funded, and nothing was reading it. This reads it.
 *
 * It compares state rather than scanning logs, because every job we care about
 * is already in our database — we posted it. There is no discovery problem, so
 * there is no block cursor to keep, nothing to miss across a restart, and no
 * log-range limit to work around. A job whose chain status has moved ahead of
 * ours is one we need to catch up on, whenever we happen to look.
 */

import type { FastifyBaseLogger } from 'fastify';
import { prisma, type A2AJobStatus } from '@ai-arena/db-client';

import { startExecution } from './execution.service';

const BASE_CHAIN_SERVICE_URL = process.env.BASE_CHAIN_SERVICE_URL ?? 'http://localhost:8051';
const POLL_INTERVAL_MS = Number(process.env.FUNDING_WATCH_INTERVAL_S ?? '45') * 1000;

/** Off-chain statuses that mean "we do not think this job is funded yet". */
const UNFUNDED: A2AJobStatus[] = ['POSTED', 'NEGOTIATING'];

/**
 * On-chain statuses that mean the money is in. EXECUTING and beyond are
 * included deliberately: if we missed the funding we have almost certainly
 * missed everything after it too, and the job still needs catching up.
 */
const FUNDED_ON_CHAIN = ['ESCROWED', 'EXECUTING', 'DELIVERED', 'SETTLED', 'REFUNDED', 'DISPUTED'];

type OnChainJob = {
  exists: boolean;
  status: string;
  providerAgentId: string;
  providerWallet: string;
  agreementHash: string;
  agreedPriceBaseUnits: string;
};

/**
 * Backoff for a job that will not reconcile.
 *
 * The likely cause is a job funded against an agreement we have no negotiation
 * record for, which is a standing condition rather than a blip. Held in memory
 * because it is a rate limit, not a record worth a migration.
 */
const FIRST_BACKOFF_MS = 2 * 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const backoff = new Map<string, { retryAt: number; failures: number }>();

async function readOnChain(jobId: string): Promise<OnChainJob | null> {
  const response = await fetch(`${BASE_CHAIN_SERVICE_URL}/jobs/${jobId}`);
  // 404 is the ordinary answer for a job that has not reached the chain yet.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`base-chain-service returned ${response.status}`);
  return (await response.json()) as OnChainJob;
}

/**
 * Bring one job's record up to what the chain says.
 *
 * The agreed price, provider and agreement hash are taken from the chain, not
 * from our negotiation, because the chain is what the escrow will actually pay
 * against. The negotiation is consulted only to translate the on-chain
 * ERC-8004 provider id back into our own agent id, which the chain does not
 * carry.
 */
async function reconcile(jobId: string, onChain: OnChainJob, log: FastifyBaseLogger): Promise<void> {
  const negotiation = await prisma.a2ANegotiation.findFirst({
    where: { jobId, agreementHash: onChain.agreementHash },
  });

  if (!negotiation) {
    // Funded against terms we have no record of. Refusing to guess: writing a
    // provider we cannot substantiate would put a wrong counterparty on a job
    // that is holding real money.
    throw new Error(
      `funded on-chain under agreement ${onChain.agreementHash}, which matches no negotiation on this job`,
    );
  }

  await prisma.a2AJob.update({
    where: { id: jobId },
    data: {
      status: 'ESCROWED',
      agreedPriceBaseUnits: onChain.agreedPriceBaseUnits,
      providerAgentId: negotiation.providerAgentId,
      providerErc8004Id: negotiation.providerErc8004Id ?? onChain.providerAgentId,
      agreementHash: onChain.agreementHash,
      fundedAt: new Date(),
      lastError: null,
      // fundTxHash is deliberately left alone. A state read cannot tell us
      // which transaction did the funding, and inventing one would put a
      // BaseScan link on screen that goes nowhere. The relayer path still
      // records it; this path leaves it null rather than wrong.
    },
  });

  log.info(
    { jobId, onChainStatus: onChain.status, price: onChain.agreedPriceBaseUnits },
    'job was funded on-chain without us — record reconciled',
  );

  // Same as the relayer path: non-fatal, because the USDC is already locked
  // and a failure to start is not a failure to fund. The next pass retries.
  try {
    await startExecution(jobId);
  } catch (err) {
    log.error({ err, jobId }, 'reconciled a funded job but execution did not start');
  }
}

async function sweepOnce(log: FastifyBaseLogger): Promise<void> {
  const candidates = await prisma.a2AJob.findMany({
    where: { status: { in: UNFUNDED }, postTxHash: { not: null } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  const due = candidates.filter(({ id }) => {
    const entry = backoff.get(id);
    return entry === undefined || Date.now() >= entry.retryAt;
  });
  if (due.length === 0) return;

  for (const { id } of due) {
    try {
      const onChain = await readOnChain(id);
      if (!onChain?.exists || !FUNDED_ON_CHAIN.includes(onChain.status)) {
        backoff.delete(id);
        continue;
      }

      await reconcile(id, onChain, log);
      backoff.delete(id);
    } catch (err) {
      const failures = (backoff.get(id)?.failures ?? 0) + 1;
      const delay = Math.min(FIRST_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
      backoff.set(id, { retryAt: Date.now() + delay, failures });

      const message = (err as Error).message;
      log.warn({ err, jobId: id, retryInMs: delay }, 'funding reconciliation failed');

      // Put it where the creator can see it. A job holding locked USDC that
      // this service cannot account for is exactly the state that must not be
      // visible only in a log.
      await prisma.a2AJob
        .update({ where: { id }, data: { lastError: `funding watch: ${message}`.slice(0, 500) } })
        .catch(() => undefined);
    }
  }
}

/** Start the loop. Returns a function that stops it. */
export function startFundingWatcher(log: FastifyBaseLogger): () => void {
  if (process.env.FUNDING_WATCH === 'false') {
    log.warn('FUNDING_WATCH=false — jobs funded outside our relayer will not be noticed');
    return () => undefined;
  }

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  // Chained timeouts rather than setInterval: a slow pass must not have the
  // next one start underneath it and reconcile the same job twice.
  const tick = async (): Promise<void> => {
    try {
      await sweepOnce(log);
    } catch (err) {
      log.error({ err }, 'funding watch pass failed');
    }
    if (!stopped) timer = setTimeout(tick, POLL_INTERVAL_MS);
  };

  log.info({ intervalMs: POLL_INTERVAL_MS }, 'funding watcher started');
  timer = setTimeout(tick, POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
