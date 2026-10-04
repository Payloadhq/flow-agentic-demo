/**
 * The agentic commerce loop, scripted end to end.
 *
 * 1. Agent discovers the paid tool via MCP (list_tools).
 * 2. Agent calls get_quote -> PAYMENT_REQUIRED with x402 requirements.
 * 3. Agent pays. (In this local demo the payment is minted with the dev
 *    verifier, standing in for an on-chain EIP-3009 settlement. Against
 *    Base Sepolia with a real wallet, step 3 is a real USDC transfer.)
 * 4. Agent retries with the payment -> server verifies -> serves the quote.
 * 5. Server posts the settlement to the Payload Rail as an economic event;
 *    the response carries the Flow entitlements + ledger entries.
 * 6. The script verifies exact conservation and prints the whole loop.
 *
 * Usage: npm run demo:loop
 * (Spins up the API in-process and the MCP server as a child process.
 *  Set RAIL_API_KEY + RAIL_GRAPH_ID to see the live Flow split; without
 *  them the loop still runs and reports the split as unconfigured.)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from './server.js';
import { loadConfig } from './config.js';
import { createDevVerifier, decodePaymentHeader, encodePaymentPayload, type PaymentRequirements } from '../vendor/x402-core/index.js';

const step = (n: number, title: string) => console.log(`\n=== [${n}] ${title} ===`);

async function main(): Promise<void> {
  const cfg = loadConfig();
  const apiPort = 18080;
  const apiBase = `http://localhost:${apiPort}`;

  // 0. Boot the paid API in-process (dev verifier).
  const app = createApp({ ...cfg, publicBaseUrl: apiBase });
  const httpServer = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(apiPort, () => resolve(s));
  });
  console.log(`demo API up at ${apiBase}`);

  // 0b. Connect to the MCP server over stdio (transport spawns it).
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/src/mcp.js'],
    env: { ...process.env, API_BASE_URL: apiBase } as Record<string, string>,
  });
  const client = new Client({ name: 'demo-agent', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  try {
    // 1. Discovery.
    step(1, 'Agent discovers the paid tool via MCP');
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'get_quote');
    if (!tool) throw new Error('get_quote not advertised');
    console.log(`found tool: ${tool.name} — ${(tool.description || '').slice(0, 100)}...`);

    // 2. First call: no payment.
    step(2, 'Agent calls get_quote without payment');
    const first = (await client.callTool({ name: 'get_quote', arguments: { symbol: 'PAYLOAD' } })) as {
      content: Array<{ text: string }>;
    };
    const firstBody = JSON.parse(first.content[0]!.text) as {
      status: string;
      paymentRequirements?: PaymentRequirements;
    };
    console.log(`tool status: ${firstBody.status}`);
    if (firstBody.status !== 'PAYMENT_REQUIRED' || !firstBody.paymentRequirements) {
      throw new Error('expected PAYMENT_REQUIRED');
    }
    const reqs = firstBody.paymentRequirements;
    console.log(`price: ${reqs.amount} ${reqs.asset} on ${reqs.network} -> ${reqs.payTo.slice(0, 10)}...`);

    // 3. Agent pays (simulated settlement via dev verifier mint).
    step(3, 'Agent pays (dev-minted payment stands in for the on-chain EIP-3009 settlement)');
    const agentVerifier = createDevVerifier({
      secret: cfg.devSecret,
      payTo: cfg.payTo,
      asset: cfg.x402Asset,
      network: cfg.x402Network,
    });
    const payment = agentVerifier.mintPayment!(reqs, { from: '0xagentdemo000000000000000000000000000001' });
    const paymentB64 = encodePaymentPayload(payment);
    console.log(`payment minted: txHash ${payment.txHash!.slice(0, 18)}... (NOT a real chain tx in this local demo)`);
    if (!decodePaymentHeader(paymentB64)) throw new Error('payment encoding round-trip failed');

    // 4. Retry with payment.
    step(4, 'Agent retries with payment; server verifies and serves the quote');
    const second = (await client.callTool({
      name: 'get_quote',
      arguments: { symbol: 'PAYLOAD', payment: paymentB64 },
    })) as { content: Array<{ text: string }> };
    const secondBody = JSON.parse(second.content[0]!.text) as {
      status: string;
      result?: {
        symbol: string;
        price: number;
        payment?: { txHash: string; amount: string; asset: string };
        flow?: {
          configured: boolean;
          conserved?: boolean;
          netMicros?: number;
          outMicros?: number;
          entitlements?: Array<{ participantId: string; amountMicros: number; reason?: string }>;
          fees?: Array<{ kind: string; amountMicros: number }>;
          ledgerEntries?: unknown[];
          error?: string;
        };
      };
    };
    if (secondBody.status !== 'OK' || !secondBody.result) throw new Error('expected OK with result');
    const r = secondBody.result;
    console.log(`quote: ${r.symbol} = $${r.price} (paid ${r.payment?.amount} ${r.payment?.asset}, tx ${r.payment?.txHash?.slice(0, 18)}...)`);

    // 5. The Flow split.
    step(5, 'Payload Flow splits the settled revenue');
    const flow = r.flow;
    if (!flow || !flow.configured) {
      console.log(`Flow split not configured in this run: ${flow && 'error' in flow ? (flow as { error: string }).error : 'no Rail key/graph'}`);
      console.log('Set RAIL_API_KEY + RAIL_GRAPH_ID and re-run to see the live split.');
    } else if (flow.conserved === false || !flow.entitlements) {
      throw new Error(`conservation FAILED: in=${flow.netMicros} out=${flow.outMicros}`);
    } else {
      for (const e of flow.entitlements) {
        console.log(`  ${e.participantId}: ${(e.amountMicros / 1e6).toFixed(6)} USDC  (${e.reason || 'entitlement'})`);
      }
      for (const f of flow.fees || []) {
        console.log(`  fee [${f.kind}]: ${(f.amountMicros / 1e6).toFixed(6)} USDC`);
      }
      console.log(`conservation: ${flow.netMicros} micros in == ${flow.outMicros} micros out  ✓`);
      console.log(`ledger entries: ${(flow.ledgerEntries || []).length} (hash-chained on the Rail)`);
    }

    console.log('\nLoop complete: discover -> pay -> verify -> split -> audit.');
  } finally {
    await client.close().catch(() => undefined);
    httpServer.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('demo failed:', (err as Error).message);
    process.exit(1);
  });
}
