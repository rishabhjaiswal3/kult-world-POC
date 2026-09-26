/**
 * Funding a job through GOAT Flow (DELEGATE).
 *
 *   createGoatOrder     build the fundJob calldata, open a GOAT order with it,
 *                       and return the signing request once it is verified to
 *                       bind to this job
 *   submitGoatSignature forward the buyer's calldata signature to GOAT
 *   getGoatOrder        read an order's status
 *
 * GOAT then settles on Base by calling KultGoatReceiver, which credits the buyer
 * and funds the job. Nothing here moves money: the escrow state change is picked
 * up by the funding watcher, exactly as for any job funded outside our relayer.
 *
 * Merchant HMAC credentials never leave this service.
 */

// goatflow-sdk-server ships ESM only and this service compiles to CommonJS.
// Types resolve through the package's import condition; the client itself is
// loaded with a dynamic import, which Node16 module output preserves.
import type { GoatFlowClient, Order, OrderProof } from 'goatflow-sdk-server' with { 'resolution-mode': 'import' };
import { checkGoatSignRequest, encodeFundJobCalldata, formatUsdc, type GoatCalldataSignRequest } from '@ai-arena/a2a-protocol';
import { prisma } from '@ai-arena/db-client';

import { FundingPreconditionError, loadFundableAgreement } from '../funding/signed-agreement';

const BASE_CHAIN_SERVICE_URL = process.env.BASE_CHAIN_SERVICE_URL ?? 'http://localhost:8051';

/** Settlement is always Base mainnet: that is where the escrow and receiver live. */
const SETTLEMENT_CHAIN_ID = 8453;
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** Prefix for our dapp_order_id, so an order can be traced back to its agreement. */
const ORDER_ID_PREFIX = 'a2a-';

/**
 * Our dapp_order_id as GOAT hands it back: the agreement hash, plus a suffix
 * when a blocked id had to be retried. Only the hash identifies the agreement.
 */
const DAPP_ORDER_ID = /^a2a-(0x[0-9a-fA-F]{64})(?:-[0-9a-z]+)?$/;

/**
 * GOAT's smallest order, in USDC base units.
 *
 * Their API enforces this and rejects anything smaller with "amount N is less
 * than minimum amount 100000". Checked here first only so the buyer is told
 * before an order is opened; GOAT stays the authority, and if they change the
 * figure their own error still reaches the caller.
 */
const GOAT_MINIMUM_BASE_UNITS = 100_000n;

/**
 * How much life the agreement must still have before a GOAT order is opened.
 *
 * The buyer signs now and GOAT settles shortly after, but the escrow refuses an
 * agreement that expired in between, and such a payment waits as credit instead
 * of funding the job. Re-signing first leaves hours of room. Agreements last a
 * day, so this only ever costs a fresh signature from both agents.
 */
const GOAT_SIGNING_WINDOW_SECONDS = 6 * 60 * 60;

/** GOAT is not configured, or DELEGATE is not enabled for this merchant. */
export class GoatUnavailableError extends Error {}

/** A GOAT response that does not match what we asked for. Never shown to a buyer to sign. */
export class GoatMismatchError extends Error {
  constructor(readonly problems: string[]) {
    super(`GOAT signing request does not match this job: ${problems.join('; ')}`);
  }
}

/** The order does not belong to the job it was submitted against. */
export class GoatOwnershipError extends Error {}

/**
 * Every step here can wait on something outside this process: the database, the
 * signing service, GOAT's API. Without a bound, one slow dependency holds the
 * request until the platform kills it, and the caller sees a 502 with no
 * explanation and no log line saying which step stalled.
 */
async function step<T>(label: string, jobId: string, ms: number, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;

  try {
    const result = await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new GoatUnavailableError(`${label} did not finish within ${ms / 1000}s`)), ms);
      }),
    ]);
    console.info(`[goat] ${label} ok for ${jobId} in ${Date.now() - started}ms`);
    return result;
  } catch (err) {
    console.warn(`[goat] ${label} failed for ${jobId} after ${Date.now() - started}ms: ${(err as Error).message}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new GoatUnavailableError(`${name} is not configured`);
  return value;
}

let client: GoatFlowClient | null = null;

async function goatClient(): Promise<GoatFlowClient> {
  if (client) return client;

  // Read configuration before importing, so a missing credential is reported
  // as unconfigured rather than surfacing as an import failure.
  const config = {
    // Production origin from GOAT's service-origin table; overridable for testnet.
    baseUrl: process.env.GOATX402_API_URL ?? 'https://flow-api.goat.network',
    apiKey: required('GOATX402_API_KEY'),
    apiSecret: required('GOATX402_API_SECRET'),
  };

  const sdk = await import('goatflow-sdk-server');
  client = new sdk.GoatFlowClient(config);
  return client;
}

export interface GoatOrderForBuyer {
  orderId: string;
  flow: Order['flow'];
  /** Where and how much the buyer pays, on the chain they pay from. */
  payToAddress: string;
  payChainId: number;
  tokenContract: string;
  amountWei: string;
  expiresAt: number;
  /**
   * Sign this verbatim with eth_signTypedData_v4. It has been checked against
   * the job. With ethers' signTypedData, drop `types.EIP712Domain` first.
   */
  calldataSignRequest: GoatCalldataSignRequest;
}

/**
 * Open a GOAT order that funds this job, and return what the buyer must sign.
 *
 * `dapp_order_id` is derived from the signed agreement hash. GOAT asks for an id
 * that is stable across retries of one payment intent, and one signed agreement
 * is exactly one payment intent: a retry reuses the id, and re-signing an
 * expired agreement produces new calldata and correctly gets a new one.
 *
 * @param payChainId the chain the buyer pays from. Defaults to Base.
 */
export async function createGoatOrder(jobId: string, payChainId = SETTLEMENT_CHAIN_ID): Promise<GoatOrderForBuyer> {
  const receiver = required('GOAT_RECEIVER_ADDRESS');
  const fundable = await step('load signed agreement', jobId, 20_000, () =>
    loadFundableAgreement(jobId, GOAT_SIGNING_WINDOW_SECONDS));

  if (BigInt(fundable.agreedPriceBaseUnits) < GOAT_MINIMUM_BASE_UNITS) {
    throw new FundingPreconditionError(
      `GOAT Flow needs at least ${formatUsdc(GOAT_MINIMUM_BASE_UNITS.toString())} USDC and this job is ` +
        `${formatUsdc(fundable.agreedPriceBaseUnits)} USDC. Pay directly instead, or agree a higher price.`,
    );
  }

  const calldata = encodeFundJobCalldata({
    jobId,
    agreement: fundable.agreement,
    creatorSigner: fundable.creatorSigner,
    creatorSig: fundable.creatorSignature,
    providerSigner: fundable.providerSigner,
    providerSig: fundable.providerSignature,
  });

  const goat = await step('load GOAT client', jobId, 10_000, goatClient);

  const openOrder = (dappOrderId: string) => goat.createOrder({
    dappOrderId,
    chainId: payChainId,
    tokenSymbol: 'USDC',
    // The payer must be the job creator: the escrow rejects any other.
    fromAddress: fundable.job.creatorWallet,
    amountWei: fundable.agreedPriceBaseUnits,
    callbackCalldata: calldata,
  });

  const dappOrderId = `${ORDER_ID_PREFIX}${fundable.agreementHash}`;

  const order = await step('create GOAT order', jobId, 20_000, () =>
    openOrder(dappOrderId).catch((err: Error) => {
      // The id is the agreement hash, which is what makes a retry of the same
      // payment idempotent rather than a second charge. An order GOAT already
      // holds under that id therefore blocks the next attempt, including one
      // abandoned because its signing request was refused. A suffixed id opens
      // a fresh order for the same agreement; only one of them can ever fund
      // the job, because the escrow refuses a second funding and the receiver
      // credits that payer instead.
      if (!/order already exists/i.test(err.message)) throw err;
      const retryId = `${dappOrderId}-${Date.now().toString(36)}`;
      console.warn(`[goat] ${dappOrderId} is taken on GOAT; opening ${retryId} for ${jobId}`);
      return openOrder(retryId);
    }));

  if (!order.calldataSignRequest) {
    console.warn(`[goat] order ${order.orderId} for ${jobId} came back with no signing request; flow=${order.flow}`);
    // GOAT only returns a signing request when DELEGATE is provisioned for the
    // merchant. Without it the payment would settle by plain transfer and could
    // never be bound to a job.
    await cancelQuietly(order.orderId);
    throw new GoatUnavailableError(
      'GOAT returned no calldata signing request. DELEGATE is not enabled for this merchant.',
    );
  }

  // `notAfter` is deliberately not passed.
  //
  // GOAT dates the calldata deadline about 24 hours and 20 minutes out, and an
  // agreement is issued for 24 hours, so their deadline always outlives it
  // however fresh the signature is. Refusing on that basis made GOAT payments
  // impossible while protecting nothing: the expiry is inside the agreement
  // both agents signed and the escrow enforces it on-chain, so a payment that
  // arrives late cannot fund a stale deal. It becomes credit the payer can
  // withdraw instead. What actually protects the buyer is opening the order
  // only against an agreement with hours of life left, which is done above.
  const problems = checkGoatSignRequest(order.calldataSignRequest, {
    receiver,
    receiverChainId: SETTLEMENT_CHAIN_ID,
    payer: fundable.job.creatorWallet,
    amount: fundable.agreedPriceBaseUnits,
    calldata,
    token: BASE_USDC,
  });

  const deadline = Number(order.calldataSignRequest.message.deadline);
  if (deadline > fundable.agreementExpiry) {
    console.info(
      `[goat] order ${order.orderId} may be signed until ${deadline}, past the agreement's ` +
        `${fundable.agreementExpiry}; settlement after that is refused on-chain and credited to the payer`,
    );
  }

  if (problems.length > 0) {
    // Log what GOAT actually sent next to what this job requires: the problem
    // list alone says a field is wrong, not what either side believes it to be.
    console.warn(
      `[goat] signing request for ${jobId} does not bind to this job: ${problems.join('; ')}`,
      JSON.stringify({
        received: { domain: order.calldataSignRequest.domain, message: order.calldataSignRequest.message },
        expected: {
          receiver,
          chainId: SETTLEMENT_CHAIN_ID,
          payer: fundable.job.creatorWallet,
          amount: fundable.agreedPriceBaseUnits,
          token: BASE_USDC,
          agreementExpiry: fundable.agreementExpiry,
        },
      }),
    );
    await cancelQuietly(order.orderId);
    throw new GoatMismatchError(problems);
  }

  return {
    orderId: order.orderId,
    flow: order.flow,
    payToAddress: order.payToAddress,
    payChainId: order.fromChainId,
    tokenContract: order.tokenContract,
    amountWei: order.amountWei,
    expiresAt: order.expiresAt,
    calldataSignRequest: order.calldataSignRequest,
  };
}

/**
 * Confirm a GOAT order was opened for this job.
 *
 * Checked against GOAT's own record rather than anything the client sends: the
 * order's dapp_order_id carries the agreement hash, and that agreement must
 * belong to this job.
 */
async function assertOrderBelongsToJob(jobId: string, orderId: string): Promise<OrderProof> {
  const goat = await goatClient();
  const order = await step('read GOAT order', jobId, 15_000, () => goat.getOrderStatus(orderId));

  const parsed = DAPP_ORDER_ID.exec(order.dappOrderId);
  if (!parsed) {
    throw new GoatOwnershipError('Order was not created by this marketplace.');
  }

  const negotiation = await prisma.a2ANegotiation.findFirst({
    where: { agreementHash: parsed[1] },
    select: { jobId: true },
  });

  if (negotiation?.jobId !== jobId) {
    throw new GoatOwnershipError('Order does not belong to this job.');
  }

  return order;
}

/** Forward the buyer's calldata signature to GOAT. */
export async function submitGoatSignature(jobId: string, orderId: string, signature: string): Promise<void> {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new FundingPreconditionError('signature must be a 65-byte hex string');
  }
  await assertOrderBelongsToJob(jobId, orderId);
  const goat = await goatClient();
  await step('submit calldata signature', jobId, 20_000, () => goat.submitCalldataSignature(orderId, signature));
}

export interface GoatOrderStatus {
  order: OrderProof;
  /** The job's status in our records. ESCROWED or later means the payment was bound. */
  jobStatus: string;
  /**
   * USDC the receiver holds for this buyer and has not committed to a job, in
   * base units. Non-zero after a confirmed payment that could not fund the job:
   * that money is refundable, not lost. Null when the credit could not be read.
   */
  heldCreditBaseUnits: string | null;
}

/**
 * Current status of a job's GOAT order, with enough context to tell a buyer
 * whether their payment was bound to the job or is waiting to be reclaimed.
 *
 * Reports facts rather than a verdict. Between GOAT confirming a payment and the
 * funding watcher recording the job as escrowed there is a short window where
 * both are true and neither means anything is wrong.
 */
export async function getGoatOrder(jobId: string, orderId: string): Promise<GoatOrderStatus> {
  const order = await assertOrderBelongsToJob(jobId, orderId);
  const job = await prisma.a2AJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, creatorWallet: true } });

  return {
    order,
    jobStatus: job.status,
    heldCreditBaseUnits: await readHeldCredit(job.creatorWallet),
  };
}

async function readHeldCredit(payer: string): Promise<string | null> {
  try {
    const response = await fetch(`${BASE_CHAIN_SERVICE_URL}/goat/credit/${payer}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { creditBaseUnits?: string };
    return body.creditBaseUnits ?? null;
  } catch {
    // The order status is still worth returning without it.
    return null;
  }
}

/**
 * Cancel an order we have decided not to proceed with.
 *
 * Best effort: GOAT only allows cancelling in CHECKOUT_VERIFIED, and the caller
 * is already reporting a more useful error than a failed cleanup would be.
 */
async function cancelQuietly(orderId: string): Promise<void> {
  try {
    await (await goatClient()).cancelOrder(orderId);
  } catch {
    // Left to expire on GOAT's side.
  }
}
