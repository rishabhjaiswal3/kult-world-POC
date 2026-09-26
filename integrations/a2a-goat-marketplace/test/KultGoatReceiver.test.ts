/**
 * KultGoatReceiver — GOAT Flow DELEGATE payments funding A2A jobs.
 *
 * Organised around the three requirements GOAT's specification imposes, because
 * each one is a way this contract could lose money:
 *
 *   1. A business failure must NOT revert the callback. GOAT retries a reverted
 *      callback and does not release the funds, so a revert strands the buyer's
 *      money inside GOAT. Every test in that block asserts the callback
 *      SUCCEEDS and the USDC is still recoverable.
 *   2. What cannot be bound stays in the receiver, credited to its payer, and
 *      only that payer can get it back.
 *   3. The receiver enforces its own selector policy, since bind-time calldata
 *      can be replaced by the buyer.
 *
 * MockUSDC implements EIP-3009 with FiatTokenV2's strictness, so the
 * `msg.sender == to` rule is enforced rather than assumed.
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Wallet, HDNodeWallet } from 'ethers';
import { time } from '@nomicfoundation/hardhat-network-helpers';

import { AGREEMENT_TYPES, buildDomain, type Agreement } from '../src/eip712';

const USDC = (n: string) => ethers.parseUnits(n, 6);
const BUDGET_MIN = USDC('0.25');
const BUDGET_MAX = USDC('0.50');
const AGREED = USDC('0.40');
const EXECUTION_WINDOW = 6 * 60 * 60;

const JOB_ID = '0x' + 'ab'.repeat(32);
const REQ_HASH = '0x' + 'cd'.repeat(32);
const TRANSCRIPT_HASH = '0x' + 'ef'.repeat(32);
const ORDER_ID = '0x' + '77'.repeat(32);

const RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/** GOAT's struct, byte for byte (GOATNetwork/x402 MERCHANT_CALLBACK.md, "Calldata Signature"). */
const CALLBACK_TYPES = {
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
};

async function setup() {
  const [admin, relayer, verifier, arbiter, treasury, operator, stranger] = await ethers.getSigners();

  const usdc = await (await ethers.getContractFactory('MockUSDC')).deploy();
  await usdc.waitForDeployment();
  const registry = await (await ethers.getContractFactory('MockIdentityRegistry')).deploy();
  await registry.waitForDeployment();

  const escrow = await (await ethers.getContractFactory('A2AJobEscrow')).deploy(
    admin.address, await usdc.getAddress(), treasury.address, await registry.getAddress(),
  );
  await escrow.waitForDeployment();

  const receiver = await (await ethers.getContractFactory('KultGoatReceiver')).deploy(
    admin.address, await usdc.getAddress(), await escrow.getAddress(),
  );
  await receiver.waitForDeployment();

  await escrow.grantRole(await escrow.RELAYER_ROLE(), relayer.address);
  await escrow.grantRole(await escrow.VERIFIER_ROLE(), verifier.address);
  await escrow.grantRole(await escrow.ARBITER_ROLE(), arbiter.address);
  await escrow.grantRole(await escrow.RECEIVER_ROLE(), await receiver.getAddress());
  await receiver.connect(admin).setAuthorizedCaller(operator.address, true);

  // The buyer holds no USDC on Base. GOAT's TSS wallet does, and pays.
  const creator = Wallet.createRandom().connect(ethers.provider);
  const provider = Wallet.createRandom().connect(ethers.provider);
  const tss = Wallet.createRandom().connect(ethers.provider);
  await usdc.mint(tss.address, USDC('10'));
  await registry.bindAgentWallet(1n, creator.address);
  await registry.bindAgentWallet(2n, provider.address);

  const { chainId } = await ethers.provider.getNetwork();
  const agreementDomain = buildDomain(await escrow.getAddress(), Number(chainId));

  return { admin, relayer, verifier, arbiter, treasury, operator, stranger,
           usdc, escrow, receiver, creator, provider, tss, agreementDomain, chainId };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function postJob(ctx: Ctx, jobId = JOB_ID) {
  await ctx.escrow.connect(ctx.relayer).postJob(
    jobId, 1n, ctx.creator.address, REQ_HASH, BUDGET_MIN, BUDGET_MAX, EXECUTION_WINDOW,
  );
}

async function agreementFor(ctx: Ctx, over: Partial<Agreement> = {}): Promise<Agreement> {
  return {
    jobId: JOB_ID,
    creatorAgentId: '1',
    providerAgentId: '2',
    providerWallet: ctx.provider.address,
    agreedPrice: AGREED.toString(),
    requirementsHash: REQ_HASH,
    executionWindow: EXECUTION_WINDOW,
    transcriptHash: TRANSCRIPT_HASH,
    expiry: (await time.latest()) + 86_400,
    ...over,
  };
}

function toStruct(a: Agreement) {
  return {
    jobId: a.jobId, creatorAgentId: a.creatorAgentId, providerAgentId: a.providerAgentId,
    providerWallet: a.providerWallet, agreedPrice: a.agreedPrice, requirementsHash: a.requirementsHash,
    executionWindow: a.executionWindow, transcriptHash: a.transcriptHash, expiry: a.expiry,
  };
}

/** The bytes the buyer authorises: fund this job. */
async function fundJobCalldata(ctx: Ctx, over: Partial<Agreement> = {}, jobId = JOB_ID) {
  const agreement = await agreementFor(ctx, { jobId, ...over });
  const creatorSig = await (ctx.creator as unknown as HDNodeWallet).signTypedData(ctx.agreementDomain, AGREEMENT_TYPES as never, agreement);
  const providerSig = await (ctx.provider as unknown as HDNodeWallet).signTypedData(ctx.agreementDomain, AGREEMENT_TYPES as never, agreement);
  return ctx.receiver.interface.encodeFunctionData('fundJob', [
    jobId, toStruct(agreement), ctx.creator.address, creatorSig, ctx.provider.address, providerSig,
  ]);
}

/** A full GOAT callback: TSS authorization over the token, payer signature over the calldata. */
async function callback(ctx: Ctx, opts: {
  amount?: bigint; calldata?: string; payer?: HDNodeWallet; payerAddress?: string;
  deadline?: number; calldataNonce?: number; token?: string;
} = {}) {
  const receiverAddr = await ctx.receiver.getAddress();
  const usdcAddr = await ctx.usdc.getAddress();
  const amount = opts.amount ?? AGREED;
  const calldata = opts.calldata ?? (await fundJobCalldata(ctx));
  const now = await time.latest();
  const deadline = opts.deadline ?? now + 3600;
  const calldataNonce = opts.calldataNonce ?? 1;
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const token = opts.token ?? usdcAddr;

  const auth = { from: ctx.tss.address, to: receiverAddr, value: amount, validAfter: 0, validBefore: now + 3600, nonce };
  const authSig = ethers.Signature.from(await (ctx.tss as unknown as HDNodeWallet).signTypedData(
    { name: 'USD Coin', version: '2', chainId: Number(ctx.chainId), verifyingContract: usdcAddr },
    RECEIVE_TYPES, auth,
  ));

  const payer = opts.payer ?? (ctx.creator as unknown as HDNodeWallet);
  const payerAddress = opts.payerAddress ?? payer.address;
  const cbSig = ethers.Signature.from(await payer.signTypedData(
    { name: 'GoatX402 Pay Callback', version: '1', chainId: Number(ctx.chainId), verifyingContract: receiverAddr },
    CALLBACK_TYPES,
    { token, owner: ctx.tss.address, payer: payerAddress, amount, orderId: ORDER_ID, calldataNonce, deadline, calldataHash: ethers.keccak256(calldata) },
  ));

  return [
    token, payerAddress, ctx.tss.address, amount, auth.validAfter, auth.validBefore, nonce,
    authSig.v, authSig.r, authSig.s,
    calldata, ORDER_ID, calldataNonce, deadline, cbSig.v, cbSig.r, cbSig.s,
  ] as const;
}

/** What CalldataExecuted carries when the self-call reverts with a reason string. */
const revertData = (reason: string) =>
  ethers.concat(['0x08c379a0', ethers.AbiCoder.defaultAbiCoder().encode(['string'], [reason])]);

const escrowBalance = async (ctx: Ctx) => ctx.usdc.balanceOf(await ctx.escrow.getAddress());
const receiverBalance = async (ctx: Ctx) => ctx.usdc.balanceOf(await ctx.receiver.getAddress());

describe('KultGoatReceiver', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await setup(); });

  describe('funding a job', () => {
    it('funds the job from GOAT money, leaving no credit behind', async () => {
      await postJob(ctx);

      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx))))
        .to.emit(ctx.receiver, 'JobFundedFromCredit').withArgs(JOB_ID, ctx.creator.address, AGREED)
        .and.to.emit(ctx.escrow, 'JobFunded')
        .and.to.emit(ctx.receiver, 'CalldataExecuted');

      expect((await ctx.escrow.getJob(JOB_ID)).status).to.equal(2); // ESCROWED
      expect(await escrowBalance(ctx)).to.equal(AGREED);
      expect(await receiverBalance(ctx)).to.equal(0n);
      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(0n);
      expect(await ctx.usdc.allowance(await ctx.receiver.getAddress(), await ctx.escrow.getAddress())).to.equal(0n);
    });

    it('settles to the provider exactly as a directly funded job would', async () => {
      await postJob(ctx);
      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx)));

      await ctx.escrow.connect(ctx.relayer).submitDeliverable(JOB_ID, '0x' + '11'.repeat(32));
      await ctx.escrow.connect(ctx.verifier).submitVerdict(JOB_ID, true, '0x' + '22'.repeat(32));

      const commission = (AGREED * 1000n) / 10_000n;
      expect(await ctx.usdc.balanceOf(ctx.provider.address)).to.equal(AGREED - commission);
    });

    it('keeps any overpayment as credit the payer can reclaim', async () => {
      await postJob(ctx);
      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx, { amount: USDC('0.50') })));

      expect((await ctx.escrow.getJob(JOB_ID)).status).to.equal(2);
      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(USDC('0.10'));
    });
  });

  // ── Requirement 1: business failures never revert the callback ─────────────

  describe('a business failure does not revert the payment', () => {
    async function expectCredited(args: Awaited<ReturnType<typeof callback>>, amount = AGREED) {
      // The whole point: this must SUCCEED. A revert here would strand the
      // money inside GOAT, which retries and does not release it.
      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...args))
        .to.emit(ctx.receiver, 'CalldataExecuted');

      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(amount);
      expect(await receiverBalance(ctx)).to.equal(amount);
      expect(await escrowBalance(ctx)).to.equal(0n);
    }

    it('job was never posted', async () => {
      await expectCredited(await callback(ctx));
    });

    it('agreement has expired', async () => {
      await postJob(ctx);
      const calldata = await fundJobCalldata(ctx, { expiry: (await time.latest()) - 1 });
      await expectCredited(await callback(ctx, { calldata }));
      expect((await ctx.escrow.getJob(JOB_ID)).status).to.equal(1); // still POSTED
    });

    it('job is already funded', async () => {
      await postJob(ctx);
      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx, { calldataNonce: 1 })));

      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx, { calldataNonce: 2 })));
      // The second payment is not lost.
      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(AGREED);
      expect(await escrowBalance(ctx)).to.equal(AGREED);
    });

    it('payment is less than the agreed price', async () => {
      await postJob(ctx);
      await expectCredited(await callback(ctx, { amount: USDC('0.30') }), USDC('0.30'));
    });

    it('escrow is paused', async () => {
      await postJob(ctx);
      await ctx.escrow.connect(ctx.admin).pause();
      await expectCredited(await callback(ctx));
    });

    it('the payer is not the job creator', async () => {
      await postJob(ctx);
      const stranger = Wallet.createRandom().connect(ethers.provider) as unknown as HDNodeWallet;
      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx, { payer: stranger })));

      // Their money is credited to them, not to the creator, and the job is untouched.
      expect(await ctx.receiver.credit(stranger.address)).to.equal(AGREED);
      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(0n);
      expect((await ctx.escrow.getJob(JOB_ID)).status).to.equal(1);
    });

    it('the buyer signed the provider slot themselves', async () => {
      // The payer signature proves who is paying, not who agreed. A buyer who
      // names their own key for the provider is refused by the escrow, and
      // their payment waits as credit.
      await postJob(ctx);
      const buyer = ctx.creator as unknown as HDNodeWallet;
      const agreement = await agreementFor(ctx, { providerWallet: Wallet.createRandom().address });
      const sig = await buyer.signTypedData(ctx.agreementDomain, AGREEMENT_TYPES as never, agreement);
      const calldata = ctx.receiver.interface.encodeFunctionData('fundJob', [
        JOB_ID, toStruct(agreement), buyer.address, sig, buyer.address, sig,
      ]);

      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx, { calldata }))))
        .to.emit(ctx.receiver, 'CalldataExecuted')
        .withArgs(calldata, false, revertData('provider signer is not the agent wallet'));

      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(AGREED);
      expect((await ctx.escrow.getJob(JOB_ID)).status).to.equal(1);
    });
  });

  // ── Requirement 2: unbound money belongs to its payer ──────────────────────

  describe('reclaiming unbound credit', () => {
    beforeEach(async () => {
      // Never posted, so the payment is credited rather than bound.
      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx)));
    });

    it('the payer can withdraw their own credit', async () => {
      await ctx.stranger.sendTransaction({ to: ctx.creator.address, value: ethers.parseEther('1') });
      await expect(ctx.receiver.connect(ctx.creator).withdrawCredit())
        .to.emit(ctx.receiver, 'CreditWithdrawn').withArgs(ctx.creator.address, AGREED);

      expect(await ctx.usdc.balanceOf(ctx.creator.address)).to.equal(AGREED);
      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(0n);
    });

    it('an admin can return credit, but only to the payer it belongs to', async () => {
      await ctx.receiver.connect(ctx.admin).refundCredit(ctx.creator.address);
      expect(await ctx.usdc.balanceOf(ctx.creator.address)).to.equal(AGREED);
      expect(await ctx.usdc.balanceOf(ctx.admin.address)).to.equal(0n);
    });

    it('a non-admin cannot trigger a refund', async () => {
      await expect(ctx.receiver.connect(ctx.stranger).refundCredit(ctx.creator.address))
        .to.be.revertedWithCustomError(ctx.receiver, 'AccessControlUnauthorizedAccount');
    });

    it('someone with no credit cannot withdraw anything', async () => {
      await expect(ctx.receiver.connect(ctx.stranger).withdrawCredit()).to.be.revertedWith('no credit');
    });

    it('unbound credit stays held in the receiver, backed 1:1 by USDC', async () => {
      // Nothing spends credit except signed calldata or its payer, so it waits.
      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(AGREED);
      expect(await receiverBalance(ctx)).to.equal(AGREED);
    });
  });

  // ── Requirement 3: selector policy ──────────────────────────────────────────

  describe('selector policy', () => {
    it('a calldata selector other than fundJob is recorded as failed and does nothing', async () => {
      await postJob(ctx);
      const hostile = ctx.receiver.interface.encodeFunctionData('setAuthorizedCaller', [ctx.stranger.address, true]);

      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx, { calldata: hostile }))))
        .to.emit(ctx.receiver, 'CalldataExecuted').withArgs(hostile, false, ethers.toUtf8Bytes('selector not allowed'));

      expect(await ctx.receiver.authorizedCallers(ctx.stranger.address)).to.equal(false);
      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(AGREED);
    });

    it('calldata cannot reach withdrawCredit or refundCredit', async () => {
      for (const fn of ['withdrawCredit', 'refundCredit'] as const) {
        const fresh = await setup();
        const data = fn === 'withdrawCredit'
          ? fresh.receiver.interface.encodeFunctionData('withdrawCredit')
          : fresh.receiver.interface.encodeFunctionData('refundCredit', [fresh.creator.address]);
        await fresh.receiver.connect(fresh.operator).x402SpentEip3009WithCalldata(...(await callback(fresh, { calldata: data })));
        expect(await fresh.receiver.credit(fresh.creator.address)).to.equal(AGREED);
      }
    });

    it('empty calldata is recorded as failed and the payment is credited', async () => {
      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx, { calldata: '0x' }))))
        .to.emit(ctx.receiver, 'CalldataExecuted');
      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(AGREED);
    });

    it('fundJob is not callable from outside', async () => {
      const agreement = await agreementFor(ctx);
      await expect(
        ctx.receiver.connect(ctx.stranger).fundJob(JOB_ID, toStruct(agreement), ctx.creator.address, '0x', ctx.provider.address, '0x'),
      ).to.be.revertedWith('self only');
    });

    it("signed calldata cannot spend a different payer's credit", async () => {
      // Victim has credit.
      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx)));
      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(AGREED);

      // Attacker pays nothing extra and signs calldata funding the victim's job.
      await postJob(ctx);
      const attacker = Wallet.createRandom().connect(ethers.provider) as unknown as HDNodeWallet;
      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(
        ...(await callback(ctx, { payer: attacker, amount: USDC('0.01'), calldataNonce: 9 })),
      );

      // fundJob spends only the verified signer's credit, which is 0.01. Victim untouched.
      expect(await ctx.receiver.credit(ctx.creator.address)).to.equal(AGREED);
      expect(await ctx.receiver.credit(attacker.address)).to.equal(USDC('0.01'));
      expect((await ctx.escrow.getJob(JOB_ID)).status).to.equal(1);
    });
  });

  // ── Payment validity — the category GOAT's reference also reverts on ───────

  describe('payment validity', () => {
    beforeEach(async () => { await postJob(ctx); });

    it('rejects an unauthorized caller', async () => {
      await expect(ctx.receiver.connect(ctx.stranger).x402SpentEip3009WithCalldata(...(await callback(ctx))))
        .to.be.revertedWith('unauthorized caller');
    });

    it('rejects a replayed calldata nonce', async () => {
      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx, { calldataNonce: 5 })));
      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx, { calldataNonce: 5 }))))
        .to.be.revertedWith('calldata nonce used');
    });

    it('rejects an expired calldata signature', async () => {
      const args = await callback(ctx, { deadline: (await time.latest()) + 30 });
      await time.increase(60);
      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...args))
        .to.be.revertedWith('calldata signature expired');
    });

    it('rejects a signature that does not recover to the named payer', async () => {
      const other = Wallet.createRandom().connect(ethers.provider) as unknown as HDNodeWallet;
      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(
        ...(await callback(ctx, { payer: other, payerAddress: ctx.creator.address })),
      )).to.be.revertedWith('invalid calldata signature');
    });

    it('rejects calldata swapped after the payer signed', async () => {
      const args = [...(await callback(ctx))] as unknown[];
      args[10] = await fundJobCalldata(ctx, {}, '0x' + 'dd'.repeat(32));
      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(
        ...(args as Parameters<typeof ctx.receiver.x402SpentEip3009WithCalldata>),
      )).to.be.revertedWith('invalid calldata signature');
    });

    it('rejects a token that is not USDC', async () => {
      const fake = await (await ethers.getContractFactory('MockUSDC')).deploy();
      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(
        ...(await callback(ctx, { token: await fake.getAddress() })),
      )).to.be.revertedWith('unexpected token');
    });

    it('a rejected payment moves no USDC', async () => {
      await expect(ctx.receiver.connect(ctx.stranger).x402SpentEip3009WithCalldata(...(await callback(ctx)))).to.be.reverted;
      expect(await ctx.usdc.balanceOf(ctx.tss.address)).to.equal(USDC('10'));
    });
  });

  // ── Escrow boundary ────────────────────────────────────────────────────────

  describe('escrow boundary', () => {
    it('only RECEIVER_ROLE may call fundFromReceiver', async () => {
      await postJob(ctx);
      const agreement = await agreementFor(ctx);
      await expect(
        ctx.escrow.connect(ctx.relayer).fundFromReceiver(JOB_ID, ctx.creator.address, toStruct(agreement), ctx.creator.address, '0x', ctx.provider.address, '0x'),
      ).to.be.revertedWithCustomError(ctx.escrow, 'AccessControlUnauthorizedAccount');
    });

    it('the receiver cannot move a job or render a verdict', async () => {
      const receiverAddr = await ctx.receiver.getAddress();
      for (const role of ['RELAYER_ROLE', 'VERIFIER_ROLE', 'ARBITER_ROLE', 'DEFAULT_ADMIN_ROLE'] as const) {
        expect(await ctx.escrow.hasRole(await ctx.escrow[role](), receiverAddr)).to.equal(false);
      }
    });

    it("an unbound payment never reaches the escrow's balance", async () => {
      // Two jobs locked, one unbound payment. The escrow holds exactly the locked amount.
      await postJob(ctx, JOB_ID);
      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx, { calldataNonce: 1 })));
      await ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(
        ...(await callback(ctx, { calldataNonce: 2, calldata: await fundJobCalldata(ctx, {}, '0x' + 'ee'.repeat(32)) })),
      );
      expect(await escrowBalance(ctx)).to.equal(AGREED);
      expect(await receiverBalance(ctx)).to.equal(AGREED);
    });
  });

  describe('domain', () => {
    it("matches GOAT's documented domain for this contract", async () => {
      const expected = ethers.TypedDataEncoder.hashDomain({
        name: 'GoatX402 Pay Callback', version: '1',
        chainId: Number(ctx.chainId), verifyingContract: await ctx.receiver.getAddress(),
      });
      expect(await ctx.receiver.getDomainSeparator()).to.equal(expected);
    });

    it('an admin can follow a coordinated GOAT domain change', async () => {
      await ctx.receiver.connect(ctx.admin).setDomain('GoatX402 Pay Callback', '2');
      await postJob(ctx);
      // Signatures under version 1 stop verifying, which is the point of a coordinated change.
      await expect(ctx.receiver.connect(ctx.operator).x402SpentEip3009WithCalldata(...(await callback(ctx))))
        .to.be.revertedWith('invalid calldata signature');
    });
  });
});
