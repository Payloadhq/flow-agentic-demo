/**
 * Minimal client for the hosted Payload Rail (the Flow engine as a service).
 * Docs: https://payloadhq.github.io/flow-rail.html
 *
 * The server calls this AFTER an x402 payment verifies: the settled payment
 * becomes a canonical economic event, the graph's rules execute, and the
 * response carries the entitlements + ledger entries back to the caller.
 * The Rail never moves money; every distribution is status "proposed".
 */

export interface RailEntitlement {
  participantId: string;
  amountMicros: number;
  reason?: string;
  [k: string]: unknown;
}

export interface RailFee {
  kind: string;
  amountMicros: number;
  [k: string]: unknown;
}

export interface RailEventResult {
  eventId: string;
  graphId: string;
  graphVersion: number;
  entitlements: RailEntitlement[];
  fees: RailFee[];
  ledgerEntries: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface FlowSplit {
  eventId: string;
  graphId: string;
  graphVersion: number;
  entitlements: RailEntitlement[];
  fees: RailFee[];
  ledgerEntries: Array<Record<string, unknown>>;
  /** Exact conservation: net in == entitlements + fees out. */
  conserved: boolean;
  netMicros: number;
  outMicros: number;
}

export class RailClient {
  private baseUrl: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(opts: { baseUrl: string; apiKey: string; fetchFn?: typeof fetch }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetchFn || fetch;
  }

  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && 'error' in data
          ? JSON.stringify((data as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new Error(`rail ${method} ${path} failed: ${msg}`);
    }
    return data;
  }

  async getGraph(graphId: string): Promise<unknown> {
    return this.req('GET', `/v1/graphs/${encodeURIComponent(graphId)}`);
  }

  async createGraph(spec: Record<string, unknown>): Promise<{ graph: { id: string } }> {
    const data = (await this.req('POST', '/v1/graphs', spec)) as { graph: { id: string } };
    return data;
  }

  async activateGraph(graphId: string): Promise<unknown> {
    return this.req('POST', `/v1/graphs/${encodeURIComponent(graphId)}/activate`);
  }

  /**
   * Post one settled x402 payment as an economic event and return the split.
   * amountMicros is integer micro-units: 0.01 USDC = 10_000.
   */
  async postPaymentEvent(opts: {
    graphId: string;
    eventId: string;
    amountMicros: number;
    currency: string;
    txHash: string;
    from: string;
    referrerId?: string;
  }): Promise<FlowSplit> {
    const { graphId, eventId, amountMicros, currency, txHash, from, referrerId } = opts;
    const event: Record<string, unknown> = {
      eventId,
      graphId,
      type: 'API_PAYMENT',
      occurredAt: new Date().toISOString(),
      amountMicros,
      currency,
      rail: 'x402',
      processingCostMicros: 0,
      usageUnits: 1,
      raw: { txHash, from, resource: 'GET /v1/quote' },
    };
    if (referrerId) event['attribution'] = { referrerId };
    const data = (await this.req(
      'POST',
      `/v1/graphs/${encodeURIComponent(graphId)}/events`,
      { event },
    )) as RailEventResult;

    const entitlements = data.entitlements || [];
    const fees = data.fees || [];
    const entSum = entitlements.reduce((s, e) => s + (Number(e.amountMicros) || 0), 0);
    const feeSum = fees.reduce((s, f) => s + (Number(f.amountMicros) || 0), 0);
    const outMicros = entSum + feeSum;
    return {
      eventId: data.eventId,
      graphId: data.graphId,
      graphVersion: data.graphVersion,
      entitlements,
      fees,
      ledgerEntries: data.ledgerEntries || [],
      conserved: outMicros === amountMicros,
      netMicros: amountMicros,
      outMicros,
    };
  }
}

/** The proven demo split: 2% developer, 9.8% referrer, 88.2% operator. */
export function demoGraphSpec(graphId: string): Record<string, unknown> {
  return {
    id: graphId,
    projectId: 'flow-agentic-demo',
    ownerId: 'operator',
    participants: [
      {
        id: 'operator',
        kind: 'company',
        roles: ['owner'],
        payoutDestinations: [{ rail: 'manual', address: 'operator-wallet' }],
      },
      {
        id: 'developer',
        kind: 'person',
        roles: ['contributor'],
        payoutDestinations: [{ rail: 'manual', address: 'developer-wallet' }],
      },
      {
        id: 'referrer',
        kind: 'person',
        roles: ['referrer'],
        payoutDestinations: [{ rail: 'manual', address: 'referrer-wallet' }],
      },
    ],
    rules: [
      { id: 'r_fee', type: 'payload_fee', priority: 1, params: { licenseTier: 'free' } },
      {
        id: 'r_dev',
        type: 'percentage',
        priority: 2,
        params: { rateBps: 200, subjectParticipantId: 'developer' },
      },
      { id: 'r_ref', type: 'referral', priority: 3, params: { rateBps: 980 } },
      {
        id: 'r_op',
        type: 'remainder',
        priority: 4,
        params: { subjectParticipantId: 'operator' },
      },
    ],
  };
}
