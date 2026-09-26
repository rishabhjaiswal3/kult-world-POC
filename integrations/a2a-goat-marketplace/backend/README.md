# Backend integration

The marketplace service code that integrates with the GOAT Flow merchant API.

These files are extracted from a larger Fastify service and are included for
review. They import packages that are not part of this repository, so they do not
build here. The contracts and protocol helpers at the repository root are
standalone and fully tested.

## Files

| File | Responsibility |
| --- | --- |
| [`goat-funding.service.ts`](goat-funding.service.ts) | Creates GOAT Flow orders, validates the signing request, submits the buyer's calldata signature, and reports order status. |
| [`goat.routes.ts`](goat.routes.ts) | HTTP routes for the service above. |
| [`signed-agreement.ts`](signed-agreement.ts) | Loads a job's signed agreement in the form the escrow verifies, re-signing it if it has expired. |
| [`credit.routes.ts`](credit.routes.ts) | Reads a payer's unbound credit from `KultGoatReceiver`. |
| [`funding-watcher.ts`](funding-watcher.ts) | Detects jobs funded on-chain and records them, so GOAT settlement does not depend on a request from this service. |

## Routes

All routes require the caller to own the job's buyer agent.

| Method | Path | Result |
| --- | --- | --- |
| `POST` | `/jobs/:jobId/goat/orders` | Opens a GOAT order and returns the verified `calldata_sign_request` with payment details. |
| `POST` | `/jobs/:jobId/goat/orders/:orderId/signature` | Submits the buyer's calldata signature to GOAT. |
| `GET` | `/jobs/:jobId/goat/orders/:orderId` | Returns the GOAT order status, the job status, and the payer's held credit. |

`GET /goat/credit/:payer` is served by a separate chain-access service and is
public, since the value it returns is already public on Base.

## Order creation

1. The signed agreement for the job is loaded and refreshed if it has expired.
2. `fundJob` calldata is encoded from that agreement with `encodeFundJobCalldata`.
3. An order is created through `goatflow-sdk-server` with the calldata as
   `callbackCalldata`. The payer is the job creator's wallet, which the escrow
   requires.
4. `checkGoatSignRequest` verifies the returned signing request. The order is
   cancelled, and nothing reaches the buyer, if GOAT returns no signing request
   (DELEGATE is not enabled for the merchant) or if the request does not match.

`dapp_order_id` is `a2a-<agreementHash>`. GOAT recommends an id that is stable
across retries of one payment intent, and a signed agreement is one payment intent.
Re-signing an expired agreement changes the calldata and so correctly produces a
new id. Signature submission and status reads resolve the order's job from this id
on GOAT's record, not from client input.

## Dependencies not included

| Import | Provides |
| --- | --- |
| `@ai-arena/db-client` | Prisma client for jobs, negotiations and agent identities. |
| `@ai-arena/a2a-protocol` | The protocol helpers in [`../src`](../src). |
| `../negotiation.service` | `signAgreement`: re-signs an agreement with both agents' keys. |
| `../middleware/auth` | JWT authentication and job ownership checks. |
| `./execution.service` | Starts work on a funded job. |
| `../contracts` | The Base RPC provider. |

`goatflow-sdk-server` is an ESM-only package; `goat-funding.service.ts` loads it
with a dynamic import so it can run in a CommonJS service.

## Configuration

| Variable | Used by | Purpose |
| --- | --- | --- |
| `GOATX402_API_KEY` | order service | GOAT Flow merchant API key |
| `GOATX402_API_SECRET` | order service | GOAT Flow merchant API secret |
| `GOATX402_API_URL` | order service | Defaults to `https://flow-api.goat.network` |
| `GOAT_RECEIVER_ADDRESS` | order service, credit route | `KultGoatReceiver` on Base |
