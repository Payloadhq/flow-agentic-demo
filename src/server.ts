/**
 * flow-agentic-demo HTTP server.
 *
 * GET /v1/quote?symbol=XYZ — paid API, 0.01 USDC on Base Sepolia via x402.
 * On a verified payment the settlement is posted to the Payload Rail as an
 * economic event; the response includes the Flow entitlements + ledger
 * entries so the loop (pay -> split -> audit) is visible in one round trip.
 *
 * GET /.well-known/x402 — machine-readable price manifest (agent discovery).
 * GET /health — liveness.
 *
 * The server never holds user funds beyond the x402 settlement to its own
 * PAY_TO wallet, which is the API's own revenue. Flow only *proposes*
 * distributions; it never moves money.
 */
import express, { type Request, type Response } from 'express';
import { paidRoute, manifestRoute } from '../vendor/express-middleware/index.js';
import { HEADER_PAYMENT } from '../vendor/x402-core/index.js';
import { loadConfig, type DemoConfig } from './config.js';
import { buildVerifier } from './verifier.js';
import { RailClient, type FlowSplit } from './rail.js';
import type { Verifier } from '../vendor/x402-core/index.js';

export interface ServerDeps {
  verifier?: Verifier;
  /** Inject a RailClient (or mock) for tests. Null disables Flow posting. */
  rail?: RailClient | null;
}

/** Deterministic mock quote feed: AI-style data result, no external calls. */
export function buildQuote(symbol: string): Record<string, unknown> {
  const s = (symbol || 'DEMO').toUpperCase().slice(0, 12);
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const price = 100 + ((h >>> 0) % 90000) / 100;
  return {
    symbol: s,
    price: Math.round(price * 100) / 100,
    currency: 'USD',
    asOf: new Date().toISOString(),
    source: 'flow-agentic-demo feed (simulated market data)',
  };
}

/** 0.01 USDC -> 10_000 integer micro-units. No floats cross this boundary. */
export function priceToMicros(priceDecimal: string): number {
  const [i, f = ''] = priceDecimal.split('.');
  const frac = (f + '000000').slice(0, 6);
  return Number(BigInt(i || '0') * 1_000_000n + BigInt(frac || '0'));
}

export function createApp(cfg: DemoConfig, deps: ServerDeps = {}): express.Express {
  const app = express();
  const verifier = deps.verifier || buildVerifier(cfg);
  const rail = deps.rail === undefined ? makeRailClient(cfg) : deps.rail;

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'flow-agentic-demo' });
  });

  app.get(
    '/.well-known/x402',
    manifestRoute({
      baseUrl: cfg.publicBaseUrl,
      name: 'Flow Agentic Demo',
      description:
        'Pay-per-call data API (x402). Every settled payment is split by a Payload Flow Revenue Graph: 2% developer, 9.8% referrer, 88.2% operator.',
      asset: cfg.x402Asset,
      endpoints: [
        {
          method: 'GET',
          path: '/v1/quote',
          price: cfg.price,
          asset: cfg.x402Asset,
          network: cfg.x402Network,
          description: 'Simulated market-data quote. Settles 0.01 USDC, then Flow splits the revenue.',
        },
      ],
    }),
  );

  app.get(
    '/v1/quote',
    paidRoute({
      price: cfg.price,
      payTo: cfg.payTo,
      network: cfg.x402Network,
      asset: cfg.x402Asset,
      verifier,
      resource: 'GET /v1/quote',
    }),
    async (req: Request, res: Response) => {
      const symbol = String(req.query['symbol'] || 'DEMO');
      const quote = buildQuote(symbol);
      const payment = (req as unknown as { x402?: { payment?: { txHash?: string; from?: string } } }).x402?.payment;

      let flow: (FlowSplit & { configured: boolean }) | { configured: boolean; error: string } = {
        configured: false,
        error: 'RAIL_API_KEY / RAIL_GRAPH_ID not configured; Flow split skipped',
      };

      if (rail && cfg.railGraphId && payment?.txHash) {
        try {
          const referrer =
            typeof req.query['referrer'] === 'string' && req.query['referrer']
              ? String(req.query['referrer'])
              : undefined;
          const split = await rail.postPaymentEvent({
            graphId: cfg.railGraphId,
            eventId: `evt_${payment.txHash.slice(0, 32)}_${Date.now()}`,
            amountMicros: priceToMicros(cfg.price),
            currency: cfg.x402Asset,
            txHash: payment.txHash,
            from: payment.from || 'unknown',
            referrerId: referrer,
          });
          flow = { ...split, configured: true };
        } catch (err) {
          flow = {
            configured: true,
            error: `Flow event failed (quote still served; payment was valid): ${(err as Error).message}`,
          };
        }
      }

      res.json({
        ...quote,
        payment: {
          txHash: payment?.txHash,
          from: payment?.from,
          amount: cfg.price,
          asset: cfg.x402Asset,
          network: cfg.x402Network,
        },
        flow,
        note: 'Distributions are proposed instructions only. This demo never moves money beyond the x402 settlement to its own wallet.',
      });
    },
  );

  return app;
}

function makeRailClient(cfg: DemoConfig): RailClient | null {
  if (!cfg.railApiKey) {
    console.warn('[flow-agentic-demo] RAIL_API_KEY not set: Flow split disabled (x402 payments still work).');
    return null;
  }
  return new RailClient({ baseUrl: cfg.railBaseUrl, apiKey: cfg.railApiKey });
}

export function startServer(): void {
  const cfg = loadConfig();
  const app = createApp(cfg);
  app.listen(cfg.port, () => {
    console.log(`[flow-agentic-demo] listening on :${cfg.port} (verifier=${cfg.verifierKind}, network=${cfg.x402Network})`);
  });
}

if (require.main === module) {
  startServer();
}
