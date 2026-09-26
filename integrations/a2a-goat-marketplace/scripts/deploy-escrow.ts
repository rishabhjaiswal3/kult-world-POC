/**
 * Deploy A2AJobEscrow to Base mainnet.
 *
 *   npx hardhat run scripts/deploy-escrow.ts --network base
 *
 * The escrow custodies real USDC and its token and identity registry addresses
 * are immutable, so confirm USDC_BASE against Circle's published address and
 * IDENTITY_REGISTRY_BASE against the ERC-8004 deployment before running.
 *
 * Roles are granted separately and deliberately: the deployer keeps
 * DEFAULT_ADMIN_ROLE, and RELAYER/VERIFIER/ARBITER go to distinct addresses so
 * no single key can both drive a job's state and decide its outcome.
 */

import { ethers, network } from 'hardhat';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** ERC-8004 identity registry on Base. Agreement signers must be agent wallets bound here. */
const IDENTITY_REGISTRY_BASE = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

async function main(): Promise<void> {
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== 8453n) {
    throw new Error(`Refusing to deploy: expected Base mainnet (8453), got ${net.chainId} on "${network.name}"`);
  }

  const [deployer] = await ethers.getSigners();
  const treasury = process.env.A2A_TREASURY_ADDRESS ?? deployer.address;
  const relayer = process.env.BASE_RELAYER_ADDRESS;
  const verifier = process.env.A2A_VERIFIER_ADDRESS;

  if (!relayer) throw new Error('BASE_RELAYER_ADDRESS not set — the relayer cannot be the deployer by default');
  if (!verifier) throw new Error('A2A_VERIFIER_ADDRESS not set — the verifier must be a distinct key from the relayer');
  if (verifier.toLowerCase() === relayer.toLowerCase()) {
    throw new Error('Verifier and relayer must be different keys: one drives state, the other judges outcomes');
  }

  // An address with no code would make every agreement fail its signer check.
  if ((await ethers.provider.getCode(IDENTITY_REGISTRY_BASE)) === '0x') {
    throw new Error(`No contract at the identity registry address ${IDENTITY_REGISTRY_BASE}`);
  }

  console.log(`\nDeploying A2AJobEscrow to Base mainnet`);
  console.log(`  deployer: ${deployer.address}`);
  console.log(`  balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`  usdc:     ${USDC_BASE}`);
  console.log(`  registry: ${IDENTITY_REGISTRY_BASE}`);
  console.log(`  treasury: ${treasury}\n`);

  const Factory = await ethers.getContractFactory('A2AJobEscrow');
  const escrow = await Factory.deploy(deployer.address, USDC_BASE, treasury, IDENTITY_REGISTRY_BASE);
  await escrow.waitForDeployment();
  const address = await escrow.getAddress();

  console.log(`A2AJobEscrow deployed: ${address}`);
  console.log(`  https://basescan.org/address/${address}\n`);

  console.log('Granting roles...');
  await (await escrow.grantRole(await escrow.RELAYER_ROLE(), relayer)).wait();
  console.log(`  RELAYER_ROLE  -> ${relayer}`);
  await (await escrow.grantRole(await escrow.VERIFIER_ROLE(), verifier)).wait();
  console.log(`  VERIFIER_ROLE -> ${verifier}`);

  const arbiter = process.env.A2A_ARBITER_ADDRESS;
  if (arbiter) {
    await (await escrow.grantRole(await escrow.ARBITER_ROLE(), arbiter)).wait();
    console.log(`  ARBITER_ROLE  -> ${arbiter}`);
  } else {
    console.log('  ARBITER_ROLE  -> not granted (disputes cannot be resolved until it is)');
  }

  console.log(`\nSet A2A_JOB_ESCROW_ADDRESS=${address}`);
  console.log(
    `Verify: npx hardhat verify --network base ${address} ${deployer.address} ${USDC_BASE} ${treasury} ${IDENTITY_REGISTRY_BASE}\n`,
  );
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
