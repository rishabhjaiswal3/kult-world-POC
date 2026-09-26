/**
 * Read-only views of the GOAT Flow receiver.
 *
 *   GET /goat/credit/:payer   USDC held for a payer and not yet committed to a job
 *
 * A GOAT payment whose job could not be funded is not lost: KultGoatReceiver
 * credits it to the payer, who can withdraw it. Without a way to read that
 * credit, a buyer whose payment failed to bind would see a job that simply never
 * started. Public, like every other GET here, because it is already public on Base.
 */

import { ethers } from 'ethers';
import { FastifyInstance } from 'fastify';

import { getProvider } from '../contracts';

const RECEIVER_ABI = ['function credit(address payer) view returns (uint256)'];

export async function goatRoutes(app: FastifyInstance): Promise<void> {
  app.get('/credit/:payer', async (req, reply) => {
    const { payer } = req.params as { payer: string };

    const receiverAddress = process.env.GOAT_RECEIVER_ADDRESS;
    if (!receiverAddress) return reply.status(503).send({ error: 'GOAT_RECEIVER_ADDRESS is not configured' });
    if (!ethers.isAddress(payer)) return reply.status(400).send({ error: 'payer is not a valid address' });

    try {
      const receiver = new ethers.Contract(receiverAddress, RECEIVER_ABI, getProvider());
      const credit: bigint = await receiver.credit(ethers.getAddress(payer));
      return {
        payer: ethers.getAddress(payer),
        receiver: ethers.getAddress(receiverAddress),
        creditBaseUnits: credit.toString(),
      };
    } catch (err) {
      return reply.status(502).send({ error: `Could not read receiver credit: ${(err as Error).message}` });
    }
  });
}
