/**
 * GOAT Flow DELEGATE payments: the calldata a buyer authorises, and the checks
 * that decide whether a signing request from GOAT is safe to show them.
 *
 * The flow, from GOAT's API reference (GOATNetwork/x402 docs/goat-flow-api-reference.md,
 * Appendix A):
 *
 *   1. Our backend creates an order with `callback_calldata` — the exact call
 *      KultGoatReceiver will execute.
 *   2. GOAT responds with a `calldata_sign_request`: a complete EIP-712
 *      domain, types and message.
 *   3. The buyer signs it verbatim — GOAT says not to rebuild or selectively
 *      copy it — and our backend submits the signature.
 *   4. GOAT's operator settles on Base and calls the receiver.
 *
 * Step 3 is where this module earns its place. GOAT's own documentation warns
 * that bind-time calldata "may be omitted or replaced" and is not revalidated.
 * A buyer's wallet shows a typed-data blob they cannot meaningfully read, so
 * before we ask for a signature we check that the request binds to our
 * receiver, their wallet, the agreed price and the calldata we built. A request
 * that does not is refused rather than signed.
 */

import { Interface, TypedDataEncoder, getAddress, keccak256 } from 'ethers';

/** GOAT's reference domain (GOATNetwork/x402 goatx402-contract/MERCHANT_CALLBACK.md, "Deployment Model"). */
export const GOAT_CALLBACK_DOMAIN_NAME = 'GoatX402 Pay Callback';
export const GOAT_CALLBACK_DOMAIN_VERSION = '1';

/**
 * GOAT's calldata-signature struct. Must match the receiver's
 * EIP3009_CALLBACK_DATA_TYPEHASH byte for byte; test/KultGoatReceiver.protocol.test.ts derives
 * the typehash from both and asserts they are equal.
 */
export const EIP3009_CALLBACK_DATA_TYPES = {
  Eip3009CallbackData: [
    { name: 'token', type: 'address' },
    { name: 'owner', type: 'address' },
    { name: 'payer', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'orderId', type: 'bytes32' },
    { name: 'calldataNonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'calldataHash', type: 'bytes32' },
  ],
} as const;

/**
 * The domain fields the receiver hashes, in order. A wallet signing through
 * eth_signTypedData_v4 builds the domain separator from the request's
 * EIP712Domain entry, so any other list signs a different domain.
 */
export const EIP712_DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const;

/**
 * The one function KultGoatReceiver lets calldata reach.
 *
 * Written out rather than imported from a build artifact so services do not
 * depend on the contract build. test/KultGoatReceiver.protocol.test.ts encodes the same call
 * with this fragment and with the compiled ABI and asserts identical bytes, so a
 * contract change that is not mirrored here fails loudly.
 */
export const RECEIVER_FUND_JOB_ABI = [
  'function fundJob(bytes32 jobId, (bytes32 jobId, uint256 creatorAgentId, uint256 providerAgentId, address providerWallet, uint128 agreedPrice, bytes32 requirementsHash, uint32 executionWindow, bytes32 transcriptHash, uint64 expiry) agreement, address creatorSigner, bytes creatorSig, address providerSigner, bytes providerSig)',
] as const;

const receiverInterface = new Interface(RECEIVER_FUND_JOB_ABI);

export interface GoatAgreement {
  jobId: string;
  creatorAgentId: string | bigint;
  providerAgentId: string | bigint;
  providerWallet: string;
  agreedPrice: string | bigint;
  requirementsHash: string;
  executionWindow: number;
  transcriptHash: string;
  expiry: number;
}

export interface FundJobCall {
  jobId: string;
  agreement: GoatAgreement;
  creatorSigner: string;
  creatorSig: string;
  providerSigner: string;
  providerSig: string;
}

/** Encode the call the buyer will authorise: commit my payment to this job. */
export function encodeFundJobCalldata(call: FundJobCall): string {
  const a = call.agreement;
  return receiverInterface.encodeFunctionData('fundJob', [
    call.jobId,
    [
      a.jobId,
      BigInt(a.creatorAgentId),
      BigInt(a.providerAgentId),
      getAddress(a.providerWallet),
      BigInt(a.agreedPrice),
      a.requirementsHash,
      a.executionWindow,
      a.transcriptHash,
      a.expiry,
    ],
    getAddress(call.creatorSigner),
    call.creatorSig,
    getAddress(call.providerSigner),
    call.providerSig,
  ]);
}

/**
 * Shape GOAT returns; mirrors goatflow-sdk-server's CalldataSignRequest.
 *
 * `types` includes EIP712Domain. Pass the request to eth_signTypedData_v4 as
 * is. ethers' signTypedData needs EIP712Domain removed first, as GOAT's own
 * browser SDK does.
 */
export interface GoatCalldataSignRequest {
  domain: { name?: string; version?: string; chainId?: number | string; verifyingContract?: string };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: {
    token: string;
    owner: string;
    payer: string;
    amount: string;
    orderId: string;
    calldataNonce: string;
    deadline: string;
    calldataHash: string;
    permit2?: string;
  };
}

export interface ExpectedSignRequest {
  /** KultGoatReceiver address on the settlement chain. */
  receiver: string;
  /** Chain the receiver lives on. Base mainnet is 8453. */
  receiverChainId: number;
  /** Buyer wallet: must equal job.creatorWallet, which the escrow enforces. */
  payer: string;
  /** Agreed price in USDC base units. */
  amount: string | bigint;
  /** The exact calldata we created the order with. */
  calldata: string;
  /** USDC on the settlement chain. */
  token: string;
  /**
   * Latest acceptable calldata deadline, unix seconds. The escrow agreement
   * expires; a signature valid past it would authorise funding a stale deal.
   */
  notAfter?: number;
}

const same = (a: string | undefined, b: string) => {
  try {
    return a !== undefined && getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
};

const describeFields = (fields: ReadonlyArray<{ name: string; type: string }>) =>
  fields.map((f) => `${f.type} ${f.name}`).join(',');

/**
 * Every way a GOAT signing request fails to match what we asked for.
 *
 * Returns a list rather than the first problem so a mismatch report says
 * everything that is wrong at once. An empty list means the request is safe to
 * show the buyer.
 */
export function checkGoatSignRequest(request: GoatCalldataSignRequest, expected: ExpectedSignRequest): string[] {
  const problems: string[] = [];
  const { domain, message } = request;

  if (request.primaryType !== 'Eip3009CallbackData') {
    // Only the EIP-3009 variant is implemented by the receiver.
    problems.push(`primaryType is ${request.primaryType}, expected Eip3009CallbackData`);
  }

  if (domain.name !== GOAT_CALLBACK_DOMAIN_NAME) problems.push(`domain.name is ${domain.name}`);
  if (domain.version !== GOAT_CALLBACK_DOMAIN_VERSION) problems.push(`domain.version is ${domain.version}`);
  if (Number(domain.chainId) !== expected.receiverChainId) {
    problems.push(`domain.chainId is ${domain.chainId}, expected ${expected.receiverChainId}`);
  }
  if (!same(domain.verifyingContract, expected.receiver)) {
    // Signed for a different contract, the signature is useless to us — or
    // useful to whoever that contract belongs to.
    problems.push(`domain.verifyingContract is ${domain.verifyingContract}, expected our receiver ${expected.receiver}`);
  }

  if (!same(message.payer, expected.payer)) {
    problems.push(`message.payer is ${message.payer}, expected the job creator ${expected.payer}`);
  }
  if (!same(message.token, expected.token)) {
    problems.push(`message.token is ${message.token}, expected USDC ${expected.token}`);
  }
  if (BigInt(message.amount) !== BigInt(expected.amount)) {
    problems.push(`message.amount is ${message.amount}, expected the agreed price ${expected.amount}`);
  }
  if (message.calldataHash?.toLowerCase() !== keccak256(expected.calldata).toLowerCase()) {
    // The warning in GOAT's docs, made concrete: the bytes the buyer would
    // authorise are not the bytes we built.
    problems.push('message.calldataHash does not match the calldata this order was created with');
  }
  if (expected.notAfter !== undefined && Number(message.deadline) > expected.notAfter) {
    problems.push(`message.deadline ${message.deadline} outlives the agreement, which expires at ${expected.notAfter}`);
  }

  // GOAT includes EIP712Domain in `types`, as eth_signTypedData_v4 expects.
  // ethers derives the domain type from the domain object instead, and treats
  // an EIP712Domain entry as a second primary type, so it is checked here on
  // its own and left out of what ethers sees.
  const { EIP712Domain: domainFields, ...structTypes } = request.types;
  if (domainFields !== undefined && describeFields(domainFields) !== describeFields(EIP712_DOMAIN_FIELDS)) {
    problems.push(
      `types.EIP712Domain is (${describeFields(domainFields)}), expected (${describeFields(EIP712_DOMAIN_FIELDS)})`,
    );
  }

  // The types must describe the struct the receiver hashes, or a correct-looking
  // message would still produce a signature that never recovers on-chain.
  try {
    const theirs = TypedDataEncoder.from(structTypes).encodeType('Eip3009CallbackData');
    const ours = TypedDataEncoder.from(EIP3009_CALLBACK_DATA_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>).encodeType('Eip3009CallbackData');
    if (theirs !== ours) problems.push(`types describe ${theirs}, expected ${ours}`);
  } catch (err) {
    problems.push(`types are not a valid EIP-712 definition: ${(err as Error).message}`);
  }

  return problems;
}

/** The domain a buyer signs under for a given receiver. */
export function goatCallbackDomain(receiver: string, chainId: number) {
  return {
    name: GOAT_CALLBACK_DOMAIN_NAME,
    version: GOAT_CALLBACK_DOMAIN_VERSION,
    chainId,
    verifyingContract: getAddress(receiver),
  };
}

