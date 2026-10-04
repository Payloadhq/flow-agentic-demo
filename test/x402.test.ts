/**
 * x402 verification unit tests against the vendored kit v1.0.4 dev verifier.
 * No network, no secrets beyond a throwaway HMAC key.
 */
import { describe, it, expect } from 'vitest';
import {
  createDevVerifier,
  buildPaymentRequirements,
  decodePaymentHeader,
  encodePaymentPayload,
} from '../vendor/x402-core/index.js';

const SECRET = 'test-secret';
const PAY_TO = '0x000000000000000000000000000000000000dEaD';
const NETWORK = 'eip155:84532';
const ASSET = 'USDC';

function setup() {
  const verifier = createDevVerifier({ secret: SECRET, payTo: PAY_TO, asset: ASSET, network: NETWORK });
  const reqs = buildPaymentRequirements({
    payTo: PAY_TO,
    network: NETWORK,
    asset: ASSET,
    amount: '0.01',
    resource: 'GET /v1/quote',
  });
  return { verifier, reqs };
}

describe('dev verifier', () => {
  it('accepts a correctly minted payment', async () => {
    const { verifier, reqs } = setup();
    const payment = verifier.mintPayment!(reqs, { from: '0xtester' });
    const res = await verifier.verify(payment, reqs);
    expect(res.ok).toBe(true);
    expect(res.from).toBe('0xtester');
  });

  it('rejects a tampered signature', async () => {
    const { verifier, reqs } = setup();
    const payment = verifier.mintPayment!(reqs);
    payment.sig = 'deadbeef';
    const res = await verifier.verify(payment, reqs);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/signature/i);
  });

  it('rejects an amount mismatch', async () => {
    const { verifier, reqs } = setup();
    // Mint against the real 0.01 requirements, then verify against
    // requirements demanding 0.02: the signature is valid, the amount is not.
    const payment = verifier.mintPayment!(reqs);
    const reqs2 = { ...reqs, amount: '0.02' };
    const res = await verifier.verify(payment, reqs2);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/amount mismatch/);
  });

  it('rejects a replayed payment', async () => {
    const { verifier, reqs } = setup();
    const payment = verifier.mintPayment!(reqs);
    const first = await verifier.verify(payment, reqs);
    expect(first.ok).toBe(true);
    const second = await verifier.verify(payment, reqs);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/replay/);
  });

  it('rejects expired requirements', async () => {
    const { verifier } = setup();
    const old = buildPaymentRequirements({
      payTo: PAY_TO,
      network: NETWORK,
      asset: ASSET,
      amount: '0.01',
      resource: 'GET /v1/quote',
      expiresInSec: -3600,
    });
    const payment = verifier.mintPayment!(old);
    const res = await verifier.verify(payment, old);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/expired/);
  });

  it('rejects the wrong recipient', async () => {
    const { verifier, reqs } = setup();
    const payment = verifier.mintPayment!(reqs);
    (payment as Record<string, unknown>)['payTo'] = '0x0000000000000000000000000000000000000001';
    const res = await verifier.verify(payment, reqs);
    expect(res.ok).toBe(false);
  });

  it('payment header encodes and decodes losslessly', () => {
    const { reqs } = setup();
    const verifier = createDevVerifier({ secret: SECRET });
    const payment = verifier.mintPayment!(reqs);
    const b64 = encodePaymentPayload(payment);
    const back = decodePaymentHeader(b64);
    expect(back).toMatchObject({ txHash: payment.txHash, from: payment.from, sig: payment.sig });
    expect(decodePaymentHeader('!!!not-base64!!!')).toBeNull();
  });
});
