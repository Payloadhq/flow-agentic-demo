/**
 * Mocked end-to-end loop: Express app + dev verifier + mocked Rail client.
 * Exercises the real HTTP 402 -> X-PAYMENT -> verify -> Flow event path.
 * No network, no secrets.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp, type ServerDeps } from '../src/server.js';
import { RailClient } from '../src/rail.js';
import {
  createDevVerifier,
  decodePaymentHeader,
  encodePaymentPayload,
  HEADER_REQUIREMENTS,
  HEADER_PAYMENT,
  decodeRequirements,
} from '../vendor/x402-core/index.js';
import type { DemoConfig } from '../src/config.js';

const SECRET = 'loop-test-secret';
const PAY_TO = '0x000000000000000000000000000000000000dEaD';

function mockRail(): RailClient {
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as { event?: { amountMicros: number; eventId: string } };
    return new Response(
      JSON.stringify({
        eventId: body.event?.eventId || 'evt_x',
        graphId: 'g_agentic_demo',
        graphVersion: 1,
        entitlements: [
          { participantId: 'developer', amountMicros: 200 },
          { participantId: 'referrer', amountMicros: 980 },
          { participantId: 'operator', amountMicros: 8820 },
        ],
        fees: [{ kind: 'payload_fee', amountMicros: 0 }],
        ledgerEntries: [{ type: 'ENTITLEMENT' }, { type: 'ENTITLEMENT' }, { type: 'ENTITLEMENT' }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return new RailClient({ baseUrl: 'https://rail.test', apiKey: 't', fetchFn });
}

describe('agentic loop (mocked)', () => {
  let base: string;
  let server: import('node:http').Server;
  const verifier = createDevVerifier({ secret: SECRET, payTo: PAY_TO, asset: 'USDC', network: 'eip155:84532' });

  beforeAll(async () => {
    const cfg: DemoConfig = {
      port: 0,
      publicBaseUrl: 'http://localhost',
      payTo: PAY_TO,
      x402Network: 'eip155:84532',
      x402Asset: 'USDC',
      price: '0.01',
      verifierKind: 'dev',
      devSecret: SECRET,
      facilitatorVerifyUrl: 'https://x402.org/facilitator/verify',
      railBaseUrl: 'https://rail.test',
      railApiKey: 't',
      railGraphId: 'g_agentic_demo',
    };
    const deps: ServerDeps = { verifier, rail: mockRail() };
    const app = createApp(cfg, deps);
    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    base = `http://localhost:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('full loop: 402 -> pay -> 200 with conserved Flow split', async () => {
    // 1. No payment -> 402 with requirements.
    const r402 = await fetch(`${base}/v1/quote?symbol=PAYLOAD`);
    expect(r402.status).toBe(402);
    const reqB64 = r402.headers.get(HEADER_REQUIREMENTS);
    expect(reqB64).toBeTruthy();
    const reqs = decodeRequirements(reqB64!);
    expect(reqs.amount).toBe('0.01');
    expect(reqs.asset).toBe('USDC');

    // 2. Agent pays (dev-minted).
    const payment = verifier.mintPayment!(reqs, { from: '0xagent' });
    const b64 = encodePaymentPayload(payment);
    expect(decodePaymentHeader(b64)).toMatchObject({ from: '0xagent' });

    // 3. Retry with X-PAYMENT -> 200, quote + flow split.
    const r200 = await fetch(`${base}/v1/quote?symbol=PAYLOAD&referrer=referrer`, {
      headers: { [HEADER_PAYMENT]: b64 },
    });
    expect(r200.status).toBe(200);
    const body = (await r200.json()) as {
      symbol: string;
      price: number;
      flow: { configured: boolean; conserved: boolean; netMicros: number; outMicros: number; entitlements: Array<{ participantId: string; amountMicros: number }> };
    };
    expect(body.symbol).toBe('PAYLOAD');
    expect(body.flow.configured).toBe(true);
    expect(body.flow.conserved).toBe(true);
    expect(body.flow.netMicros).toBe(10000);
    expect(body.flow.outMicros).toBe(10000);
    const byP = Object.fromEntries(body.flow.entitlements.map((e) => [e.participantId, e.amountMicros]));
    expect(byP).toEqual({ developer: 200, referrer: 980, operator: 8820 });
  });

  it('replayed payment is rejected with a fresh 402', async () => {
    const r1 = await fetch(`${base}/v1/quote`);
    const reqs = decodeRequirements(r1.headers.get(HEADER_REQUIREMENTS)!);
    const payment = verifier.mintPayment!(reqs, { from: '0xagent2' });
    const b64 = encodePaymentPayload(payment);
    const ok = await fetch(`${base}/v1/quote`, { headers: { [HEADER_PAYMENT]: b64 } });
    expect(ok.status).toBe(200);
    const replay = await fetch(`${base}/v1/quote`, { headers: { [HEADER_PAYMENT]: b64 } });
    expect(replay.status).toBe(402);
  });

  it('manifest advertises the paid endpoint for discovery', async () => {
    const r = await fetch(`${base}/.well-known/x402`);
    expect(r.status).toBe(200);
    const m = (await r.json()) as { endpoints: Array<{ path: string; price: string }> };
    expect(m.endpoints.some((e) => e.path === '/v1/quote' && e.price === '0.01')).toBe(true);
  });
});
