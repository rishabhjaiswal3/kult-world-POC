# Release Verification — v6.5.0

Run from the repository root:

```bash
npm run verify:fullstack
```

This checks syntax, the KULT test suite, the A2A bridge module, the KULT-server-to-A2A proxy flow, full-stack browser/backend wiring, SQLite persistence and a zero-write market preflight.

For the heavier release gate:

```bash
npm run verify:release
```

The release gate additionally runs coverage and the production-mode restart smoke.

## External A2A deployment acceptance

After deploying with `KULT_A2A_MODE=external`:

```bash
curl https://<host>/api/integrations
curl https://<host>/api/a2a/health
```

Then complete one controlled real marketplace payment using the existing A2A runbook. KULT bridge tests do not substitute for a real GOAT/Base settlement check.
