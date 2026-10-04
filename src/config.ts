/**
 * Runtime configuration, all from the environment. Nothing secret is ever
 * sent to clients: RAIL_API_KEY and DEV_SECRET stay server-side.
 */
export interface DemoConfig {
  port: number;
  publicBaseUrl: string;
  /** Wallet that receives the USDC for paid API calls (the API's own revenue). */
  payTo: string;
  x402Network: string;
  x402Asset: string;
  price: string;
  /** 'dev' (HMAC, local/demo) or 'facilitator' (real x402 /verify). */
  verifierKind: 'dev' | 'facilitator';
  devSecret: string;
  facilitatorVerifyUrl: string;
  facilitatorApiKey?: string;
  railBaseUrl: string;
  railApiKey?: string;
  railGraphId?: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`flow-agentic-demo: missing required env ${name}`);
  return v;
}

export function loadConfig(): DemoConfig {
  const verifierKind = (process.env.X402_VERIFIER || 'dev').toLowerCase();
  if (verifierKind !== 'dev' && verifierKind !== 'facilitator') {
    throw new Error(`flow-agentic-demo: X402_VERIFIER must be 'dev' or 'facilitator', got '${verifierKind}'`);
  }
  const port = Number(process.env.PORT || '8080');
  return {
    port,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
    payTo: process.env.PAY_TO || '0x000000000000000000000000000000000000dEaD',
    x402Network: process.env.X402_NETWORK || 'eip155:84532',
    x402Asset: process.env.X402_ASSET || 'USDC',
    price: process.env.PRICE || '0.01',
    verifierKind: verifierKind as 'dev' | 'facilitator',
    devSecret: process.env.DEV_SECRET || 'demo-dev-secret-change-me',
    facilitatorVerifyUrl: process.env.FACILITATOR_VERIFY_URL || 'https://x402.org/facilitator/verify',
    facilitatorApiKey: process.env.FACILITATOR_API_KEY || undefined,
    railBaseUrl: (process.env.RAIL_BASE_URL || 'https://payload-rail.fly.dev').replace(/\/$/, ''),
    railApiKey: process.env.RAIL_API_KEY || undefined,
    railGraphId: process.env.RAIL_GRAPH_ID || undefined,
  };
}

/** Exported for tests so they can assert on required vars without throwing. */
export { required };
