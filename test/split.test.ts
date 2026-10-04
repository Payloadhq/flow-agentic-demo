/**
 * Flow split math: the proven 2% / 9.8% / 88.2% split on a 0.01 USDC event.
 * Uses a mocked Rail fetch (no network); asserts exact conservation and the
 * expected per-participant amounts the real Rail returns for this graph.
 */
import { describe, it, expect } from 'vitest';
import { RailClient, demoGraphSpec } from '../src/rail.js';
import { priceToMicros } from '../src/server.js';

/** Canned Rail response for a 10_000-micros API_PAYMENT on the demo graph. */
function mockRailFetch() {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as { event?: { amountMicros: number; eventId: string } };
    const amount = body.event?.amountMicros ?? 10000;
    // 2% of 10_000 = 200; 9.8% of 10_000 = 980; remainder 8_820.
    const payload = {
      eventId: body.event?.eventId || 'evt_test',
      graphId: 'g_agentic_demo',
      graphVersion: 1,
      entitlements: [
        { participantId: 'developer', amountMicros: 200, reason: 'percentage 2.00% of remaining pool' },
        { participantId: 'referrer', amountMicros: 980, reason: 'referral 9.80% of remaining pool' },
        { participantId: 'operator', amountMicros: 8820, reason: 'remainder of pool' },
      ],
      fees: [{ kind: 'payload_fee', amountMicros: 0 }],
      ledgerEntries: [
        { type: 'ENTITLEMENT', amountMicros: 200 },
        { type: 'ENTITLEMENT', amountMicros: 980 },
        { type: 'ENTITLEMENT', amountMicros: 8820 },
      ],
    };
    void amount;
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

describe('flow split math', () => {
  it('converts 0.01 USDC to exactly 10_000 micros with no floats', () => {
    expect(priceToMicros('0.01')).toBe(10000);
    expect(priceToMicros('0.10')).toBe(100000);
    expect(priceToMicros('1')).toBe(1000000);
  });

  it('demo graph spec carries the proven split', () => {
    const spec = demoGraphSpec('g1') as {
      rules: Array<{ type: string; params: Record<string, unknown> }>;
    };
    const byType = Object.fromEntries(spec.rules.map((r) => [r.type, r.params]));
    expect(byType['percentage']).toMatchObject({ rateBps: 200, subjectParticipantId: 'developer' });
    expect(byType['referral']).toMatchObject({ rateBps: 980 });
    expect(byType['remainder']).toMatchObject({ subjectParticipantId: 'operator' });
  });

  it('conserves the pool exactly: 10_000 in == 10_000 out', async () => {
    const rail = new RailClient({
      baseUrl: 'https://rail.test',
      apiKey: 'test',
      fetchFn: mockRailFetch(),
    });
    const split = await rail.postPaymentEvent({
      graphId: 'g_agentic_demo',
      eventId: 'evt_test_1',
      amountMicros: 10000,
      currency: 'USDC',
      txHash: '0xabc',
      from: '0xagent',
      referrerId: 'referrer',
    });
    expect(split.conserved).toBe(true);
    expect(split.netMicros).toBe(10000);
    expect(split.outMicros).toBe(10000);
    const byParticipant = Object.fromEntries(split.entitlements.map((e) => [e.participantId, e.amountMicros]));
    expect(byParticipant['developer']).toBe(200);
    expect(byParticipant['referrer']).toBe(980);
    expect(byParticipant['operator']).toBe(8820);
  });

  it('flags non-conservation instead of hiding it', async () => {
    const badFetch = (async () =>
      new Response(
        JSON.stringify({
          eventId: 'e',
          graphId: 'g',
          graphVersion: 1,
          entitlements: [{ participantId: 'operator', amountMicros: 9999 }],
          fees: [],
          ledgerEntries: [],
        }),
        { status: 200 },
      )) as typeof fetch;
    const rail = new RailClient({ baseUrl: 'https://rail.test', apiKey: 't', fetchFn: badFetch });
    const split = await rail.postPaymentEvent({
      graphId: 'g',
      eventId: 'e',
      amountMicros: 10000,
      currency: 'USDC',
      txHash: '0x1',
      from: '0x2',
    });
    expect(split.conserved).toBe(false);
    expect(split.outMicros).toBe(9999);
  });
});
