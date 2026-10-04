/**
 * Verifier factory using the vendored x402 starter kit v1.0.4.
 *
 * - 'dev': HMAC verifier. Local development, automated tests, and the
 *   scripted demo loop only. The kit's own boot guard crashes the process
 *   if this is wired while NODE_ENV=production.
 * - 'facilitator': production path. Speaks the canonical x402 v1 /verify
 *   wire format { paymentPayload, paymentRequirements }, maps CAIP-2 ids to
 *   v1 network names (eip155:84532 -> base-sepolia), converts decimals to
 *   base units, and accepts { isValid } / { valid }.
 *
 * Honest limit (documented in README): x402.org cannot verify EIP-3009
 * authorizations for Base Sepolia USDC because that token contract lacks
 * the EIP-5267 eip712Domain() interface. Real on-chain settlement still
 * works; facilitator-mediated verification on that path does not.
 */
import {
  createDevVerifier,
  createFacilitatorVerifier,
  assertProductionVerifier,
  type Verifier,
} from '../vendor/x402-core/index.js';
import type { DemoConfig } from './config.js';

export function buildVerifier(cfg: DemoConfig): Verifier {
  if (cfg.verifierKind === 'facilitator') {
    const verifier = createFacilitatorVerifier({
      verifyUrl: cfg.facilitatorVerifyUrl,
      apiKey: cfg.facilitatorApiKey,
      supportedAssets: [cfg.x402Asset],
      supportedNetworks: [cfg.x402Network],
      assetDecimals: 6,
    });
    assertProductionVerifier(verifier);
    return verifier;
  }
  const verifier = createDevVerifier({
    secret: cfg.devSecret,
    payTo: cfg.payTo,
    asset: cfg.x402Asset,
    network: cfg.x402Network,
  });
  // Crash loudly if someone deploys the dev verifier to production.
  assertProductionVerifier(verifier);
  return verifier;
}
