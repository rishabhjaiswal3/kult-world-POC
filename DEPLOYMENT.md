# KULT World v6.5.0 — Deployment Runbook

## 1. Runtime

Use Node 24.15+ or the provided Dockerfile (`node:24-alpine`).

## 2. Core production environment

```text
NODE_ENV=production
PUBLIC_ORIGIN=https://world.yourdomain.com
KULT_PERSISTENCE=sqlite
KULT_DATA_DB=/var/data/kult-world.sqlite
KULT_ADMIN_TOKEN=<32+ random chars>
KULT_MARKET_ADAPTER=sim
KULT_MARKET_ACCESS=enabled
KULT_PULSE_REFERENCE_ADAPTER=sim
```

## 3. Real A2A environment

```text
KULT_A2A_MODE=external
KULT_A2A_API_URL=https://<existing-a2a-api>
KULT_A2A_CHAIN_API_URL=https://<existing-chain-access-service>
KULT_A2A_MARKETPLACE_URL=https://<existing-marketplace-ui>
```

Default Base addresses are already configured from the bundled A2A repository. Override only for a separately verified redeployment.

If KULT and A2A use federated bearer authentication, configure the relevant forwarding option. Do not use a broad system bearer unless the A2A ownership middleware still constrains every job to the correct buyer.

## 4. Verify before deploy

```bash
npm run verify:fullstack
```

## 5. Deploy

Docker:

```bash
docker build -t kult-world:6.5.0 .
docker run --env-file .env.production -p 8060:8060 -v kult-world-data:/var/data kult-world:6.5.0
```

Or use `render.yaml` after filling the secret/external A2A URL variables.

## 6. Post-deploy checks

```bash
curl https://world.yourdomain.com/api/ready
curl https://world.yourdomain.com/api/integrations
curl https://world.yourdomain.com/api/a2a/health
```

Then:

1. adopt a test Agent
2. open A2A Exchange and confirm it launches the real marketplace
3. create one controlled marketplace job
4. use the marketplace's normal GOAT signing flow
5. confirm the Base escrow/receiver events and marketplace reconciliation
6. test Pulse and Perp Wars separately

## 7. OKX Demo promotion

Keep `KULT_MARKET_ADAPTER=sim` until A2A/public UX is stable. For supervised OKX Demo, configure the Agent Trade Kit profile and run `npm run market:preflight` before switching to `agent-kit`.
