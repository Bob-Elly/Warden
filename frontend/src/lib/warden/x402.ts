import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from './config';
import { collectLogs, lastResult, parseEvents, rpc } from './near';

/**
 * An x402-style "HTTP 402 Payment Required" flow, settled through the Warden
 * vault on NEAR:
 *
 * 1. Agent GETs a paid resource and receives 402 + payment requirements
 *    (pay `amount` yoctoNEAR to `payTo` with memo `nonce`).
 * 2. Agent pays through the vault (`execute_transfer`), so the payment is
 *    bound by the same allowlist and budgets as everything else.
 * 3. Agent retries with `X-PAYMENT: base64({"txHash","payer"})`.
 * 4. Server reads the transaction from NEAR RPC and serves the resource only
 *    if the vault emitted `action_executed` to `payTo` with the right memo.
 *
 * The nonce is an HMAC over a timestamp, so the server needs no database.
 * Replays are refused per server instance (in-memory set).
 */

export interface PaymentRequirements {
  x402Version: 1;
  scheme: 'warden-vault-transfer';
  network: string;
  payTo: string;
  maxAmountRequired: string;
  asset: 'NEAR';
  resource: string;
  description: string;
  nonce: string;
  expiresAt: number;
  vault: string;
}

const NONCE_TTL_MS = 10 * 60 * 1000;
const used = new Set<string>();

function sign(ts: string): string {
  return createHmac('sha256', getConfig().x402.secret).update(ts).digest('hex').slice(0, 24);
}

export function paymentRequirements(resource: string, description: string): PaymentRequirements {
  const cfg = getConfig();
  const ts = Date.now().toString();
  return {
    x402Version: 1,
    scheme: 'warden-vault-transfer',
    network: `near-${cfg.networkId}`,
    payTo: cfg.x402.payTo,
    maxAmountRequired: cfg.x402.priceYocto,
    asset: 'NEAR',
    resource,
    description,
    nonce: `x402:${ts}:${sign(ts)}`,
    expiresAt: Number(ts) + NONCE_TTL_MS,
    vault: cfg.vaultId,
  };
}

function nonceValid(nonce: string): boolean {
  const m = /^x402:(\d+):([0-9a-f]{24})$/.exec(nonce);
  if (!m) return false;
  const [, ts, mac] = m;
  if (Date.now() - Number(ts) > NONCE_TTL_MS) return false;
  const expected = Buffer.from(sign(ts));
  const got = Buffer.from(mac);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function verifyPayment(header: string): Promise<{ ok: true; txHash: string; payer: string } | { ok: false; error: string }> {
  const cfg = getConfig();
  let txHash: string, payer: string;
  try {
    ({ txHash, payer } = JSON.parse(Buffer.from(header, 'base64').toString()));
  } catch {
    return { ok: false, error: 'X-PAYMENT must be base64 JSON {"txHash","payer"}' };
  }
  if (!txHash || !payer) return { ok: false, error: 'X-PAYMENT is missing txHash or payer' };
  if (used.has(txHash)) return { ok: false, error: 'Payment already used' };

  let outcome: any;
  try {
    outcome = await rpc().txStatus(txHash, payer, 'EXECUTED_OPTIMISTIC' as any);
  } catch (e: any) {
    return { ok: false, error: `Transaction not found: ${e?.message ?? e}` };
  }
  if (outcome.transaction?.receiver_id !== cfg.vaultId) return { ok: false, error: 'Payment was not made through the Warden vault' };
  const result = lastResult<{ status: string }>(outcome);
  if (result?.status !== 'executed') return { ok: false, error: `Vault did not execute the payment (${result?.status ?? 'unknown'})` };

  const paid = parseEvents(collectLogs(outcome)).find(
    (e) =>
      e.event === 'action_executed' &&
      e.data.receiver_id === cfg.x402.payTo &&
      BigInt(String(e.data.amount)) >= BigInt(cfg.x402.priceYocto) &&
      typeof e.data.memo === 'string' &&
      nonceValid(e.data.memo)
  );
  if (!paid) return { ok: false, error: 'No matching vault payment (payee, amount or nonce mismatch, or nonce expired)' };
  used.add(txHash);
  return { ok: true, txHash, payer };
}
