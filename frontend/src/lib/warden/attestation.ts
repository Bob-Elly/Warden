import { randomBytes } from 'node:crypto';
import { getConfig } from './config';

/**
 * Fetch NEAR AI Cloud's attestation report for the model the agent uses.
 * The report contains Intel TDX (and, for GPU models, NVIDIA) evidence for
 * the enclave, plus the enclave's signing address. Completion signatures
 * that recover to this address were produced inside that enclave.
 */
export interface AttestationSummary {
  model: string;
  nonce: string;
  fetchedAt: number;
  gateway?: { signingAddress: string; signingAlgo: string; hasIntelQuote: boolean; nonceEchoed: boolean };
  models: { signingAddress: string; signingAlgo: string; hasIntelQuote: boolean; hasNvidiaPayload: boolean; nonceEchoed: boolean }[];
  verifyUrl: string;
}

export async function getAttestation(model?: string): Promise<AttestationSummary> {
  const cfg = getConfig().nearAi;
  if (!cfg.apiKey) throw new Error('NEAR_AI_API_KEY is not set');
  const m = model || cfg.model;
  const nonce = randomBytes(32).toString('hex');
  const qs = new URLSearchParams({ model: m, signing_algo: 'ecdsa', nonce });
  const res = await fetch(`${cfg.baseUrl}/attestation/report?${qs}`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json', 'x-no-aliasing': 'true' },
    cache: 'no-store',
  } as any);
  if (!res.ok) throw new Error(`Attestation request failed (HTTP ${res.status})`);
  const body: any = await res.json();
  const g = body.gateway_attestation;
  return {
    model: m,
    nonce,
    fetchedAt: Date.now(),
    gateway: g
      ? {
          signingAddress: g.signing_address,
          signingAlgo: g.signing_algo,
          hasIntelQuote: !!g.intel_quote,
          nonceEchoed: g.request_nonce === nonce,
        }
      : undefined,
    models: (body.model_attestations ?? []).map((a: any) => ({
      signingAddress: a.signing_address,
      signingAlgo: a.signing_algo,
      hasIntelQuote: !!a.intel_quote,
      hasNvidiaPayload: !!a.nvidia_payload,
      nonceEchoed: a.request_nonce === nonce,
    })),
    verifyUrl: 'https://docs.near.ai/cloud/verification/verification-center',
  };
}
