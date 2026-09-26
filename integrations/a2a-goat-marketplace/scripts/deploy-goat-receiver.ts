/**
 * Deploy KultGoatReceiver and wire it to the escrow. Idempotent and resumable.
 *
 *   npx hardhat run scripts/deploy-goat-receiver.ts --network base
 *
 * Required:
 *   A2A_JOB_ESCROW_ADDRESS   an A2AJobEscrow that has fundFromReceiver and checks
 *                            agreement signers against the identity registry.
 *                            Earlier deployments lack one or both and cannot be used.
 *   GOAT_OPERATOR_ADDRESS    GOAT Flow's operator caller for Base mainnet. GOAT
 *                            issues this per environment (GOATNetwork/x402 MERCHANT_CALLBACK.md,
 *                            integration checklist, step 2).
 * Optional:
 *   GOAT_RECEIVER_ADDRESS    reuse an already-deployed receiver instead of
 *                            deploying a new one — set this when resuming.
 *
 * Three steps, each checked before it is sent, so a run interrupted by a dropped
 * RPC connection resumes where it stopped instead of deploying a second receiver:
 *
 *   1. deploy the receiver (skipped when GOAT_RECEIVER_ADDRESS is set)
 *   2. grant it RECEIVER_ROLE on the escrow
 *   3. authorize GOAT's operator on the receiver
 *
 * The signer must hold DEFAULT_ADMIN_ROLE on the escrow for step 2.
 *
 * After this, register the receiver with GOAT's deployment operator (see
 * docs/INTEGRATION.md, section 3) and set GOAT_RECEIVER_ADDRESS in the
 * marketplace service environment.
 */

import { ethers, network } from 'hardhat';
import { withRetry, sendWithRetry } from './rpc-retry';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function requireAddress(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  if (!ethers.isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return ethers.getAddress(value);
}

async function main(): Promise<void> {
  const net = await withRetry('network', () => ethers.provider.getNetwork());
  if (net.chainId !== 8453n) {
    throw new Error(`Refusing to run: expected Base mainnet (8453), got ${net.chainId} on "${network.name}"`);
  }

  const escrowAddress = requireAddress('A2A_JOB_ESCROW_ADDRESS');
  const operator = requireAddress('GOAT_OPERATOR_ADDRESS');
  const [signer] = await ethers.getSigners();

  const escrow = await ethers.getContractAt('A2AJobEscrow', escrowAddress);

  // Fail before spending gas if the escrow cannot accept receiver funding.
  const receiverRole = await withRetry('RECEIVER_ROLE', () => escrow.RECEIVER_ROLE()).catch(() => {
    throw new Error(`${escrowAddress} has no RECEIVER_ROLE. Deploy the current A2AJobEscrow first.`);
  });
  await withRetry('identityRegistry', () => escrow.identityRegistry()).catch(() => {
    throw new Error(
      `${escrowAddress} does not check agreement signers against the identity registry. Deploy the current A2AJobEscrow first.`,
    );
  });

  const escrowUsdc = await withRetry('escrow usdc', () => escrow.usdc());
  if (ethers.getAddress(escrowUsdc) !== USDC_BASE) {
    throw new Error(`Escrow is configured for ${escrowUsdc}, not Base USDC ${USDC_BASE}`);
  }

  const balance = await withRetry('balance', () => ethers.provider.getBalance(signer.address));
  console.log(`\nEscrow:   ${escrowAddress}`);
  console.log(`Operator: ${operator}`);
  console.log(`Signer:   ${signer.address}  (${ethers.formatEther(balance)} ETH)\n`);

  // ── 1. Receiver ──────────────────────────────────────────────────────────
  let receiverAddress = process.env.GOAT_RECEIVER_ADDRESS;
  if (receiverAddress) {
    receiverAddress = ethers.getAddress(receiverAddress);
    console.log(`1. Reusing receiver ${receiverAddress}`);
  } else {
    console.log('1. Deploying KultGoatReceiver...');
    const factory = await ethers.getContractFactory('KultGoatReceiver');
    const receiver = await factory.deploy(signer.address, USDC_BASE, escrowAddress);
    await receiver.waitForDeployment();
    receiverAddress = await receiver.getAddress();
    console.log(`   deployed ${receiverAddress}`);

    // A public RPC may route the next read to a node that has not seen the new
    // contract yet, which decodes as empty data rather than an error worth
    // retrying. Wait for the code to be visible before reading anything back.
    await withRetry('receiver code', async () => {
      if ((await ethers.provider.getCode(receiverAddress!)) === '0x') {
        throw new Error('TIMEOUT: receiver code is not visible on this node yet');
      }
    });
    console.log(`   Set GOAT_RECEIVER_ADDRESS=${receiverAddress} before re-running.`);
  }

  const receiver = await ethers.getContractAt('KultGoatReceiver', receiverAddress);

  const wiredEscrow = await withRetry('receiver escrow', () => receiver.escrow());
  if (ethers.getAddress(wiredEscrow) !== escrowAddress) {
    throw new Error(`Receiver ${receiverAddress} is wired to escrow ${wiredEscrow}, not ${escrowAddress}`);
  }

  // ── 2. RECEIVER_ROLE on the escrow ───────────────────────────────────────
  if (await withRetry('hasRole', () => escrow.hasRole(receiverRole, receiverAddress!))) {
    console.log('2. RECEIVER_ROLE already granted');
  } else {
    process.stdout.write('2. Granting RECEIVER_ROLE... ');
    const hash = await sendWithRetry('grant RECEIVER_ROLE', signer.address,
      () => escrow.grantRole(receiverRole, receiverAddress!) as never);
    console.log(`done (${hash})`);
  }

  // ── 3. Authorize GOAT's operator ─────────────────────────────────────────
  if (await withRetry('authorizedCallers', () => receiver.authorizedCallers(operator))) {
    console.log('3. GOAT operator already authorized');
  } else {
    process.stdout.write('3. Authorizing GOAT operator... ');
    const hash = await sendWithRetry('authorize operator', signer.address,
      () => receiver.setAuthorizedCaller(operator, true) as never);
    console.log(`done (${hash})`);
  }

  // ── Verify the result rather than trusting the steps ─────────────────────
  const domain = await withRetry('domain', () => receiver.getDomainSeparator());
  const expected = ethers.TypedDataEncoder.hashDomain({
    name: 'GoatX402 Pay Callback', version: '1', chainId: 8453, verifyingContract: receiverAddress,
  });

  const checks: Array<[string, boolean]> = [
    ['escrow grants RECEIVER_ROLE to receiver', await escrow.hasRole(receiverRole, receiverAddress)],
    ['receiver authorizes GOAT operator', await receiver.authorizedCallers(operator)],
    ['receiver domain matches GOAT reference', domain === expected],
  ];

  console.log('\nFinal state:');
  for (const [label, ok] of checks) console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}`);
  console.log(`\n  https://basescan.org/address/${receiverAddress}\n`);

  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
