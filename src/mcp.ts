/**
 * MCP server wrapper: exposes the paid API as a discoverable tool.
 *
 * Tool: get_quote
 *   - input: { symbol: string, payment?: string }
 *   - without payment: returns a machine-readable PAYMENT_REQUIRED payload
 *     carrying the x402 payment requirements (mirrors the HTTP 402).
 *   - with payment (base64 X-PAYMENT from a settled on-chain payment):
 *     forwards to the paid API and returns the quote plus the Flow
 *     entitlements and ledger entries.
 *
 * The agent pays; this server never pays on the agent's behalf and never
 * holds agent funds.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');

async function fetchQuote(symbol: string, payment?: string): Promise<{ status: number; body: unknown }> {
  const url = `${API_BASE}/v1/quote?symbol=${encodeURIComponent(symbol)}`;
  const headers: Record<string, string> = {};
  if (payment) headers['x-payment'] = payment;
  const res = await fetch(url, { headers });
  const body = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, body };
}

function textResult(obj: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'flow-agentic-demo', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_quote',
        description:
          'Get a market-data quote. Costs 0.01 USDC on Base Sepolia via x402. ' +
          'Call without payment to receive PAYMENT_REQUIRED with payment requirements; ' +
          'settle on-chain, then call again with the base64 payment in the "payment" argument. ' +
          'Settled revenue is split by a Payload Flow Revenue Graph (2% developer, 9.8% referrer, 88.2% operator).',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol, e.g. PAYLOAD' },
            payment: {
              type: 'string',
              description: 'Base64 X-PAYMENT payload from a settled x402 payment (optional)',
            },
          },
          required: ['symbol'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'get_quote') {
      return textResult({ status: 'ERROR', error: `unknown tool ${request.params.name}` });
    }
    const args = (request.params.arguments || {}) as { symbol?: string; payment?: string };
    const symbol = String(args.symbol || 'DEMO');
    const { status, body } = await fetchQuote(symbol, args.payment);
    if (status === 402) {
      const b = body as {
        paymentRequirements?: unknown;
        howToPay?: string;
        reason?: string;
      };
      return textResult({
        status: 'PAYMENT_REQUIRED',
        tool: 'get_quote',
        symbol,
        paymentRequirements: b.paymentRequirements,
        howToPay: b.howToPay,
        reason: b.reason,
      });
    }
    if (status !== 200) {
      return textResult({ status: 'ERROR', httpStatus: status, body });
    }
    return textResult({ status: 'OK', result: body });
  });

  return server;
}

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[mcp]', err);
    process.exit(1);
  });
}
