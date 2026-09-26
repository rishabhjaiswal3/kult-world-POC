/**
 * The signed agreement a job is funded against.
 *
 * Both funding paths hand the escrow the same agreement and the same two agent
 * signatures: the buyer's own USDC authorization (routes/funding.routes.ts) and
 * a GOAT Flow payment settled through KultGoatReceiver (goat/).
 *
 * The GOAT path loads it here. The direct route shares refreshIfExpired but
 * still assembles the payload inline; moving it onto loadFundableAgreement would
 * remove the last duplicate, and is worth doing once that route can be
 * exercised end to end.
 */

import { prisma } from '@ai-arena/db-client';

import { signAgreement } from '../negotiation.service';

/** A funding precondition the caller should report as a 400, not a server error. */
export class FundingPreconditionError extends Error {}

/**
 * Re-sign an agreement whose expiry has passed or is about to.
 *
 * The expiry is inside the EIP-712 signature and enforced on-chain, so an
 * expired agreement cannot be extended, only signed again. The terms are
 * unchanged and both signatures come from the agents' own keys, so there is no
 * decision to put in front of the user.
 *
 * Re-signing changes the agreement hash. A buyer signature that commits to the
 * hash must not be requested for an agreement that could be re-signed before
 * that signature is used, so `mustOutlastSeconds` refreshes early enough to
 * cover it.
 */
export async function refreshIfExpired(
  negotiation: { id: string; agreementExpiry: number | null },
  mustOutlastSeconds = 0,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // Margin for the signing round-trip, so an agreement is never funded seconds after it died.
  const EXPIRY_MARGIN_SECONDS = 120;

  if (negotiation.agreementExpiry && negotiation.agreementExpiry > now + mustOutlastSeconds + EXPIRY_MARGIN_SECONDS) {
    return;
  }

  await signAgreement(negotiation.id);
}

export interface FundableAgreement {
  job: { id: string; creatorWallet: string; status: string };
  /** Hash of the signed agreement. Identifies one payment intent. */
  agreementHash: string;
  agreedPriceBaseUnits: string;
  agreementExpiry: number;
  /** Exactly what A2AJobEscrow verifies. */
  agreement: {
    jobId: string;
    creatorAgentId: string;
    providerAgentId: string;
    providerWallet: string;
    agreedPrice: string;
    requirementsHash: string;
    executionWindow: number;
    transcriptHash: string;
    expiry: number;
  };
  creatorSigner: string;
  creatorSignature: string;
  providerSigner: string;
  providerSignature: string;
}

/**
 * Load a job's signed agreement, refreshed if stale, in the form the escrow checks.
 *
 * @param mustOutlastSeconds re-sign unless the agreement stays valid at least
 *        this long. A payment authorised now may be settled later, and an
 *        agreement that expires in between would be refused on-chain.
 * @throws FundingPreconditionError when the job cannot be funded yet.
 */
export async function loadFundableAgreement(
  jobId: string,
  mustOutlastSeconds = 0,
): Promise<FundableAgreement> {
  const job = await prisma.a2AJob.findUnique({ where: { id: jobId } });
  if (!job) throw new FundingPreconditionError('Job not found.');

  // NEGOTIATING is the normal off-chain state at funding time; the on-chain
  // status stays POSTED until funds arrive.
  if (job.status !== 'POSTED' && job.status !== 'NEGOTIATING') {
    throw new FundingPreconditionError(`Job is ${job.status} and can no longer be funded.`);
  }

  const negotiation = await prisma.a2ANegotiation.findFirst({
    where: { jobId, agreementHash: { not: null } },
    orderBy: { updatedAt: 'desc' },
  });

  if (!negotiation?.agreedPriceBaseUnits) {
    throw new FundingPreconditionError('No signed agreement on this job yet. Agree a price and sign before funding.');
  }
  if (!negotiation.creatorSignature || !negotiation.providerSignature) {
    throw new FundingPreconditionError('The agreement is not signed by both agents yet.');
  }

  try {
    await refreshIfExpired(negotiation, mustOutlastSeconds);
  } catch (err) {
    throw new FundingPreconditionError(`Could not refresh the expired agreement: ${(err as Error).message}`);
  }

  // Re-read: the refresh may have replaced the signatures and the expiry.
  const current = await prisma.a2ANegotiation.findUniqueOrThrow({ where: { id: negotiation.id } });
  const creatorIdentity = await prisma.agentBaseIdentity.findUnique({ where: { agentId: job.creatorAgentId } });
  if (!creatorIdentity) {
    throw new FundingPreconditionError('The buyer agent has no Base identity. Register it before funding.');
  }

  if (!current.agreedPriceBaseUnits || !current.creatorSignature || !current.providerSignature
      || !current.providerWallet || !current.providerErc8004Id || !current.transcriptHash
      || !current.agreementExpiry || !current.agreementHash || !job.creatorErc8004Id) {
    throw new FundingPreconditionError('The signed agreement is incomplete.');
  }

  return {
    job: { id: job.id, creatorWallet: job.creatorWallet, status: job.status },
    agreementHash: current.agreementHash,
    agreedPriceBaseUnits: current.agreedPriceBaseUnits,
    agreementExpiry: current.agreementExpiry,
    agreement: {
      jobId,
      creatorAgentId: job.creatorErc8004Id,
      providerAgentId: current.providerErc8004Id,
      providerWallet: current.providerWallet,
      agreedPrice: current.agreedPriceBaseUnits,
      requirementsHash: job.requirementsHash,
      executionWindow: job.executionWindowSeconds,
      transcriptHash: current.transcriptHash,
      expiry: current.agreementExpiry,
    },
    creatorSigner: creatorIdentity.eoaAddress,
    creatorSignature: current.creatorSignature,
    providerSigner: current.providerWallet,
    providerSignature: current.providerSignature,
  };
}
