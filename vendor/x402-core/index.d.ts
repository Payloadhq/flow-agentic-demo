/**
 * Type declarations for the vendored x402 starter kit v1.0.4 modules.
 * Source: ~/workspace/products/x402-paid-api-starter-kit/v1.0.4/
 * Do not edit the .js files; they are verbatim copies of the kit.
 */

export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  resource: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export interface PaymentPayload {
  txHash?: string;
  from?: string;
  sig?: string;
  amount?: string;
  asset?: string;
  network?: string;
  payTo?: string;
  nonce?: string;
  [k: string]: unknown;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  txHash?: string;
  from?: string;
}

export interface Verifier {
  name: string;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult>;
  supports?: (q: { asset?: string; network?: string }) => { ok: boolean; reason?: string };
  mintPayment?: (
    requirements: PaymentRequirements,
    opts?: { txHash?: string; from?: string },
  ) => PaymentPayload;
}

export declare const HEADER_REQUIREMENTS: string;
export declare const HEADER_PAYMENT: string;

export declare function buildPaymentRequirements(args: {
  payTo: string;
  network: string;
  asset: string;
  amount: string;
  resource: string;
  expiresInSec?: number;
}): PaymentRequirements;

export declare function encodeRequirements(req: PaymentRequirements): string;
export declare function decodeRequirements(b64: string): PaymentRequirements;
export declare function decodePaymentHeader(value: string | undefined): PaymentPayload | null;
export declare function encodePaymentPayload(payload: PaymentPayload): string;

export declare function createDevVerifier(args: {
  secret: string;
  payTo?: string;
  asset?: string;
  network?: string;
}): Verifier;

export declare function createFacilitatorVerifier(args: {
  verifyUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  supportedAssets?: string[];
  supportedNetworks?: string[];
  assetDecimals?: number;
}): Verifier;

export declare function assertProductionVerifier(verifier: Verifier): void;
