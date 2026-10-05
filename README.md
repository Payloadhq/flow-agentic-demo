# Flow Agentic Demo

The agentic commerce loop, working end to end:

**AI agent discovers a paid API via MCP → pays with x402 → RevRule splits the revenue.**

```
agent --MCP--> get_quote tool --402--> x402 payment (0.01 USDC, Base Sepolia)
   --X-PAYMENT--> server verifies settlement --> serves quote
   --> economic event posted to the Payload Rail
   --> Revenue Graph executes: 2% developer, 9.8% referrer, 88.2% operator
   --> entitlements + hash-chained ledger entries returned in the response
```

- **x402**: pay-per-call micropayments, starter-kit v1.0.4 patterns (vendored verbatim in `vendor/`)
- **MCP**: the paid API as a discoverable tool (`get_quote`), stdio transport
- **RevRule**: the hosted Rail computes who is owed what; every distribution is `status: "proposed"` — this demo never moves money beyond the x402 settlement to its own wallet

## Try it (2 minutes, no wallet needed)

```bash
npm install
npm run demo:loop
```

The scripted agent discovers the tool over MCP, gets a `PAYMENT_REQUIRED` challenge, pays (dev-minted payment stands in for the on-chain settlement in this local run), retries, and prints the quote plus the Flow split with an exact conservation check.

To see the **live** Flow split, get a Rail API key and graph first:

```bash
# 1. Issue a free Rail key (https://payload-rail.fly.dev)
curl -s -X POST https://payload-rail.fly.dev/v1/access-keys \
  -H 'Content-Type: application/json' -d '{"label":"agentic-demo"}'

# 2. Create + activate the demo Revenue Graph
RAIL_API_KEY=<key> npm run graph:setup
# -> prints RAIL_GRAPH_ID=g_agentic_demo

# 3. Run the loop with the live split
RAIL_API_KEY=<key> RAIL_GRAPH_ID=g_agentic_demo npm run demo:loop
```

## Run the pieces separately

```bash
# Paid API (dev verifier; set X402_VERIFIER=facilitator for production)
npm start

# MCP server (point it at the API)
API_BASE_URL=http://localhost:8080 npm run mcp
```

Endpoints: `GET /v1/quote?symbol=XYZ` (paid), `GET /.well-known/x402` (agent discovery manifest), `GET /health`.

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `PORT` | 8080 | HTTP port |
| `PAY_TO` | dead address | Wallet receiving the USDC (the API's own revenue) |
| `X402_NETWORK` | `eip155:84532` | Base Sepolia |
| `X402_ASSET` | `USDC` | Settlement asset |
| `PRICE` | `0.01` | Per-call price |
| `X402_VERIFIER` | `dev` | `dev` (HMAC, local/demo) or `facilitator` (real x402 /verify) |
| `DEV_SECRET` | demo default | HMAC secret for the dev verifier |
| `FACILITATOR_VERIFY_URL` | `https://x402.org/facilitator/verify` | Production verifier endpoint |
| `RAIL_BASE_URL` | `https://payload-rail.fly.dev` | Payload Rail |
| `RAIL_API_KEY` | — | Server-side only. Never exposed to clients. |
| `RAIL_GRAPH_ID` | — | Demo Revenue Graph id |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | Used in the discovery manifest |

`NODE_ENV=production` with the dev verifier crashes at boot (the kit's own guard).

## Real testnet run (Base Sepolia)

1. Set `PAY_TO` to your wallet, `X402_VERIFIER=facilitator`.
2. Deploy (see below).
3. From any wallet with Base Sepolia USDC, settle 0.01 USDC to `PAY_TO` via EIP-3009, then call the API with the `X-PAYMENT` header.

**Honest limit:** x402.org cannot verify EIP-3009 authorizations for Base Sepolia USDC because that token contract lacks the EIP-5267 `eip712Domain()` interface. On-chain settlement works and signatures are real; facilitator-mediated verification on that path does not. The facilitator verifier fails closed rather than pretending.

## What this is not

- Not custody: the server only receives its own API revenue via x402. It never holds agent or user funds.
- Not a payment processor: Flow proposes distributions; your own wallet / Stripe / facilitator executes payouts.
- The dev-minted payments in `demo:loop` are clearly labeled simulated settlement. Real runs use real chain transactions.

## Deploy

Push to `main` deploys to Fly.io via GitHub Actions (same pattern as `Payloadhq/payload-rail`). Two owner steps before the first deploy:

1. Add `.github/workflows/deploy.yml` to the repo (one file — the automation token cannot push workflow files; the file is ready in the build workspace).
2. Add the `FLY_API_TOKEN` secret in the repo's Settings → Secrets → Actions.

## Tests

```bash
npm test   # 14 tests: x402 verifier unit tests, split-math conservation, mocked end-to-end loop
```

No live-network tests in CI. The loop test mocks the Rail client; the verifier tests use the HMAC dev path.

## Links

- Telegram: https://t.me/payloadtool
- Patreon: https://patreon.com/PayloadTools

## License

MIT.
