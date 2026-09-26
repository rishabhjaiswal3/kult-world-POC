# KULT Identity + 0G Boundaries

## Canonical owner identity

Standalone launch uses the existing 256-bit opaque HttpOnly session/recovery model.

When embedded behind the KULT backend, set `KULT_IDENTITY_GATEWAY_SECRET`. The trusted gateway sends:

- `x-kult-subject`
- `x-kult-timestamp`
- `x-kult-signature = HMAC_SHA256(secret, METHOD + "\\n" + PATH + "\\n" + SUBJECT + "\\n" + TIMESTAMP)`

KULT World hashes the subject into an internal owner key; the raw account subject is not stored in public Agent/world records.

## 0G decisions

Enable with:

```bash
KULT_0G_ENABLED=true
KULT_0G_COMPUTE_ENDPOINT=https://...
KULT_0G_API_KEY=...
```

The server sends a deliberately small context: persona, mandate, focus, needs, relationship closeness and recent lived memories. The response must select one allowlisted district/action. Any malformed response, timeout or service failure falls back deterministically.

0G is never allowed to:

- create capability evidence;
- anchor proofs;
- move money;
- change permissions;
- publish externally;
- accept financial obligations.
