/**
 * The shared protocol helpers must describe the contract that is actually deployed.
 *
 * src/goat.ts writes out the fundJob ABI fragment and the
 * EIP-712 struct by hand so services do not depend on build artifacts. That is
 * only safe if drift is caught, so this suite checks both against the compiled
 * KultGoatReceiver, and then exercises the signing-request validator the backend
 * relies on before a buyer is ever asked to sign.
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Wallet } from 'ethers';

import {
  EIP3009_CALLBACK_DATA_TYPES,
  EIP712_DOMAIN_FIELDS,
  checkGoatSignRequest,
  encodeFundJobCalldata,
  goatCallbackDomain,
  type GoatCalldataSignRequest,
} from '../src/goat';

const JOB_ID = '0x' + 'ab'.repeat(32);

async function deploy() {
  const [admin, treasury] = await ethers.getSigners();
  const usdc = await (await ethers.getContractFactory('MockUSDC')).deploy();
  const registry = await (await ethers.getContractFactory('MockIdentityRegistry')).deploy();
  const escrow = await (await ethers.getContractFactory('A2AJobEscrow')).deploy(
    admin.address, await usdc.getAddress(), treasury.address, await registry.getAddress(),
  );
  const receiver = await (await ethers.getContractFactory('KultGoatReceiver')).deploy(admin.address, await usdc.getAddress(), await escrow.getAddress());
  const { chainId } = await ethers.provider.getNetwork();
  return { usdc, escrow, receiver, chainId: Number(chainId) };
}

function sampleCall() {
  const provider = Wallet.createRandom();
  const creator = Wallet.createRandom();
  return {
    jobId: JOB_ID,
    agreement: {
      jobId: JOB_ID,
      creatorAgentId: '86640',
      providerAgentId: '86641',
      providerWallet: provider.address,
      agreedPrice: '400000',
      requirementsHash: '0x' + 'cd'.repeat(32),
      executionWindow: 21_600,
      transcriptHash: '0x' + 'ef'.repeat(32),
      expiry: 1_800_000_000,
    },
    creatorSigner: creator.address,
    creatorSig: '0x' + '11'.repeat(65),
    providerSigner: provider.address,
    providerSig: '0x' + '22'.repeat(65),
  };
}

describe('GOAT protocol helpers match the deployed contract', () => {
  it('encodeFundJobCalldata produces exactly the bytes the compiled ABI does', async () => {
    const { receiver } = await deploy();
    const call = sampleCall();
    const a = call.agreement;

    const fromArtifact = receiver.interface.encodeFunctionData('fundJob', [
      call.jobId,
      {
        jobId: a.jobId, creatorAgentId: a.creatorAgentId, providerAgentId: a.providerAgentId,
        providerWallet: a.providerWallet, agreedPrice: a.agreedPrice, requirementsHash: a.requirementsHash,
        executionWindow: a.executionWindow, transcriptHash: a.transcriptHash, expiry: a.expiry,
      },
      call.creatorSigner, call.creatorSig, call.providerSigner, call.providerSig,
    ]);

    expect(encodeFundJobCalldata(call)).to.equal(fromArtifact);
  });

  it('the calldata selector is the one the receiver allows', async () => {
    const { receiver } = await deploy();
    expect(encodeFundJobCalldata(sampleCall()).slice(0, 10)).to.equal(await receiver.FUND_JOB_SELECTOR());
  });

  it('EIP3009_CALLBACK_DATA_TYPES hashes to the receiver typehash', async () => {
    const { receiver } = await deploy();
    const encoded = ethers.TypedDataEncoder.from(
      EIP3009_CALLBACK_DATA_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
    ).encodeType('Eip3009CallbackData');
    expect(ethers.keccak256(ethers.toUtf8Bytes(encoded))).to.equal(await receiver.EIP3009_CALLBACK_DATA_TYPEHASH());
  });

  it('goatCallbackDomain hashes to the receiver domain separator', async () => {
    const { receiver, chainId } = await deploy();
    const domain = goatCallbackDomain(await receiver.getAddress(), chainId);
    expect(ethers.TypedDataEncoder.hashDomain(domain)).to.equal(await receiver.getDomainSeparator());
  });
});

describe('checkGoatSignRequest', () => {
  let ctx: Awaited<ReturnType<typeof deploy>>;
  let calldata: string;
  const payer = Wallet.createRandom().address;
  const tss = Wallet.createRandom().address;

  beforeEach(async () => {
    ctx = await deploy();
    calldata = encodeFundJobCalldata(sampleCall());
  });

  /** Shaped as GOAT's API returns it, EIP712Domain included. */
  async function goodRequest(): Promise<GoatCalldataSignRequest> {
    return {
      domain: goatCallbackDomain(await ctx.receiver.getAddress(), ctx.chainId),
      types: {
        EIP712Domain: [...EIP712_DOMAIN_FIELDS],
        Eip3009CallbackData: [...EIP3009_CALLBACK_DATA_TYPES.Eip3009CallbackData],
      },
      primaryType: 'Eip3009CallbackData',
      message: {
        token: await ctx.usdc.getAddress(),
        owner: tss,
        payer,
        amount: '400000',
        orderId: '0x' + '77'.repeat(32),
        calldataNonce: '1',
        deadline: '1790000000',
        calldataHash: ethers.keccak256(calldata),
      },
    };
  }

  async function expected() {
    return {
      receiver: await ctx.receiver.getAddress(),
      receiverChainId: ctx.chainId,
      payer,
      amount: '400000',
      calldata,
      token: await ctx.usdc.getAddress(),
    };
  }

  it('accepts a request that binds to our receiver, payer, price and calldata', async () => {
    expect(checkGoatSignRequest(await goodRequest(), await expected())).to.deep.equal([]);
  });

  it('accepts the same request without an EIP712Domain entry', async () => {
    const r = await goodRequest();
    delete r.types.EIP712Domain;
    expect(checkGoatSignRequest(r, await expected())).to.deep.equal([]);
  });

  it('rejects an EIP712Domain that describes a different domain than the receiver hashes', async () => {
    // A wallet signs under this list, so the signature would not recover on-chain.
    const r = await goodRequest();
    r.types.EIP712Domain = r.types.EIP712Domain.filter((f) => f.name !== 'chainId');
    expect(checkGoatSignRequest(r, await expected()).join()).to.include('types.EIP712Domain');
  });

  it('EIP712_DOMAIN_FIELDS hashes to the receiver domain separator', async () => {
    const domain = goatCallbackDomain(await ctx.receiver.getAddress(), ctx.chainId);
    const typeString = `EIP712Domain(${EIP712_DOMAIN_FIELDS.map((f) => `${f.type} ${f.name}`).join(',')})`;
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const separator = ethers.keccak256(coder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        ethers.id(typeString), ethers.id(domain.name), ethers.id(domain.version),
        domain.chainId, domain.verifyingContract,
      ],
    ));
    expect(separator).to.equal(await ctx.receiver.getDomainSeparator());
  });

  it('rejects calldata replaced after order creation', async () => {
    const r = await goodRequest();
    r.message.calldataHash = ethers.keccak256('0xdeadbeef');
    expect(checkGoatSignRequest(r, await expected()).join()).to.include('calldataHash');
  });

  it('rejects a request signed for a different contract', async () => {
    const r = await goodRequest();
    r.domain.verifyingContract = Wallet.createRandom().address;
    expect(checkGoatSignRequest(r, await expected()).join()).to.include('verifyingContract');
  });

  it('rejects a different payer, amount, token or chain', async () => {
    const e = await expected();
    const cases: Array<[(r: GoatCalldataSignRequest) => void, string]> = [
      [(r) => { r.message.payer = Wallet.createRandom().address; }, 'payer'],
      [(r) => { r.message.amount = '1'; }, 'amount'],
      [(r) => { r.message.token = Wallet.createRandom().address; }, 'token'],
      [(r) => { r.domain.chainId = 1; }, 'chainId'],
    ];
    for (const [mutate, field] of cases) {
      const r = await goodRequest();
      mutate(r);
      expect(checkGoatSignRequest(r, e).join(), field).to.include(field);
    }
  });

  it('rejects the Permit2 variant, which the receiver does not implement', async () => {
    const r = await goodRequest();
    r.primaryType = 'Permit2CallbackData';
    expect(checkGoatSignRequest(r, await expected()).join()).to.include('primaryType');
  });

  it('rejects a struct definition that would not recover on-chain', async () => {
    const r = await goodRequest();
    r.types = { Eip3009CallbackData: [...EIP3009_CALLBACK_DATA_TYPES.Eip3009CallbackData].reverse() };
    expect(checkGoatSignRequest(r, await expected()).join()).to.include('types describe');
  });

  it('rejects a deadline that outlives the agreement', async () => {
    const r = await goodRequest();
    const e = { ...(await expected()), notAfter: 1_700_000_000 };
    expect(checkGoatSignRequest(r, e).join()).to.include('deadline');
  });

  it('reports every problem at once', async () => {
    const r = await goodRequest();
    r.message.amount = '1';
    r.message.payer = Wallet.createRandom().address;
    expect(checkGoatSignRequest(r, await expected())).to.have.length(2);
  });
});
