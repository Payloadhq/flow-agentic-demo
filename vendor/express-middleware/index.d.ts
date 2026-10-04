/**
 * Type declarations for the vendored x402 express-middleware v1.0.4.
 * Source: ~/workspace/products/x402-paid-api-starter-kit/v1.0.4/
 */
import type { RequestHandler } from 'express';
import type { Verifier } from './x402-core';

export interface PaidEndpoint {
  method: string;
  path: string;
  price: string;
  asset?: string;
  network?: string;
  description?: string;
}

export function paidRoute(args: {
  price: string;
  payTo: string;
  network: string;
  asset: string;
  verifier: Verifier;
  resource?: string;
}): RequestHandler;

export function manifestRoute(args: {
  baseUrl?: string;
  endpoints?: PaidEndpoint[];
  asset?: string;
  name?: string;
  description?: string;
}): RequestHandler;
