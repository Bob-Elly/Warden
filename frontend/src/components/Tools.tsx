'use client';

import { useState } from 'react';
import { Cpu, Loader2, Receipt, Repeat2, ShieldCheck } from 'lucide-react';
import type { TraceStep } from '@/lib/warden/agent';
import type { ExecutionOutcome } from '@/lib/warden/types';
import type { DryQuote } from '@/lib/warden/intents';
import type { AttestationSummary } from '@/lib/warden/attestation';
import { Explorer, Trace, near, postJson } from './ui';
import type { Features } from './types';

/* ------------------------------------------------------------------ x402 */

export function PaidApi({ features, explorer, onDone }: { features: Features | null; explorer: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ trace: TraceStep[]; outcome?: ExecutionOutcome; data?: any } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      setRes(await postJson('/api/x402/buy'));
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="sub">
        Agents need to pay for APIs, data and compute. Here the agent calls a paid API, gets{' '}
        <code>HTTP 402 Payment Required</code>, pays <b>{near(features?.x402Price, 4)} NEAR</b> through the vault, and retries
        with the transaction hash. The API reads the payment from NEAR RPC before it returns data. The payee{' '}
        <code>{features?.x402PayTo || '…'}</code> is on the allowlist, and the price fits the agent&apos;s budget, so no human
        is needed. An API that asked for more would be refused or queued by the vault.
      </p>
      <div>
        <button className="primary" onClick={buy} disabled={busy || !features?.x402PayTo}>
          {busy ? <Loader2 size={15} className="spin" /> : <Receipt size={15} />} Let the agent buy live market data
        </button>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {res && <Trace steps={res.trace} />}
      {res?.outcome?.txHash && (
        <Explorer base={explorer} path={`txns/${res.outcome.txHash}`}>
          Payment transaction
        </Explorer>
      )}
      {res?.data?.prices && (
        <div className="item">
          <div className="sub" style={{ marginBottom: 6 }}>
            Paid response · source <code>{res.data.source}</code>
          </div>
          <div className="row wrap" style={{ gap: 16 }}>
            {res.data.prices.map((p: any) => (
              <div key={p.symbol}>
                <div className="faint" style={{ fontSize: 12 }}>
                  {p.symbol}
                </div>
                <div style={{ fontWeight: 700 }}>${Number(p.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Intents */

export function SwapQuote({ perTxLimit }: { perTxLimit?: string }) {
  const [amount, setAmount] = useState('0.5');
  const [to, setTo] = useState<'USDC' | 'USDT'>('USDC');
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<DryQuote | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function getQuote() {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ quote: DryQuote }>('/api/intents/quote', { from: 'NEAR', to, amount });
      setQuote(r.quote);
    } catch (e: any) {
      setError(e.message);
      setQuote(null);
    } finally {
      setBusy(false);
    }
  }

  const limit = perTxLimit ? Number(near(perTxLimit, 6)) : null;
  const overLimit = limit !== null && Number(amount) > limit;

  return (
    <div className="stack">
      <p className="sub">
        A live quote from the NEAR Intents 1Click API on mainnet, with <code>dry: true</code>: a real solver price, but no
        deposit address is created, so nothing can be sent. NEAR Intents has no testnet. Warden checks the size of the
        proposed swap against the agent&apos;s vault budget before any execution.
      </p>
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 140 }}>
          Sell (NEAR)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field" style={{ width: 140 }}>
          Buy
          <select value={to} onChange={(e) => setTo(e.target.value as any)}>
            <option value="USDC">USDC (NEAR)</option>
            <option value="USDT">USDT (NEAR)</option>
          </select>
        </label>
        <button className="primary" onClick={getQuote} disabled={busy || !/^\d+(\.\d+)?$/.test(amount)}>
          {busy ? <Loader2 size={15} className="spin" /> : <Repeat2 size={15} />} Get live quote
        </button>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {quote && (
        <div className="item">
          <div className="row between wrap">
            <div>
              <div className="stat">
                {Number(quote.amountOutFormatted).toLocaleString(undefined, { maximumFractionDigits: 4 })} {quote.to}
              </div>
              <div className="sub">
                for {quote.amountInFormatted} {quote.from} (${Number(quote.amountInUsd).toFixed(2)})
              </div>
            </div>
            <span className="pill info">dry run · mainnet</span>
          </div>
          <div className="divider" />
          <div className="kv">
            <span>Minimum out (1% slippage)</span>
            <span>{(Number(quote.minAmountOut) / 1e6).toFixed(4)} {quote.to}</span>
          </div>
          <div className="kv">
            <span>Estimated time</span>
            <span>{quote.timeEstimate}s</span>
          </div>
          {quote.correlationId && (
            <div className="kv">
              <span>1Click correlation id</span>
              <span className="mono">{quote.correlationId.slice(0, 18)}…</span>
            </div>
          )}
          <div className="kv">
            <span>Vault policy</span>
            <span style={{ color: overLimit ? 'var(--warn)' : 'var(--ok)' }}>
              {overLimit ? `Over the ${limit} NEAR per-payment limit: owner approval needed` : 'Within the agent budget'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Private AI */

export function PrivateAi({ features }: { features: Features | null }) {
  const [busy, setBusy] = useState(false);
  const [att, setAtt] = useState<AttestationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/attestation');
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setAtt(j);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="sub">
        Payment instructions contain counterparties, amounts and invoices. Warden sends them to models on{' '}
        <b>NEAR AI Cloud</b>, which run inside Intel TDX / NVIDIA confidential-computing enclaves. Every completion is
        signed by an enclave key. Warden checks that signature on each proposal, and the attestation report below binds
        that key to the hardware.
      </p>
      <div className="kv">
        <span>Agent model</span>
        <span className="mono">{features?.nearAiModel}</span>
      </div>
      <div className="kv">
        <span>Red-team model (refusals removed)</span>
        <span className="mono">{features?.redTeamModel}</span>
      </div>
      <div className="kv">
        <span>Status</span>
        <span>{features?.nearAi ? <span className="pill ok">connected</span> : <span className="pill warn">no API key: local parser in use</span>}</span>
      </div>
      <div>
        <button className="primary" onClick={load} disabled={busy || !features?.nearAi}>
          {busy ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />} Fetch a fresh attestation report
        </button>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {att && (
        <div className="list">
          {att.gateway && (
            <div className="item">
              <div className="row" style={{ marginBottom: 4 }}>
                <Cpu size={14} /> <b>Gateway enclave</b>
              </div>
              <div className="kv">
                <span>Signing address</span>
                <span className="mono">{att.gateway.signingAddress}</span>
              </div>
              <div className="kv">
                <span>Intel TDX quote</span>
                <span>{att.gateway.hasIntelQuote ? '✓ present' : '✗ missing'}</span>
              </div>
              <div className="kv">
                <span>Our nonce echoed (fresh report)</span>
                <span>{att.gateway.nonceEchoed ? '✓' : '✗'}</span>
              </div>
            </div>
          )}
          {att.models.map((m, i) => (
            <div className="item" key={i}>
              <div className="row" style={{ marginBottom: 4 }}>
                <Cpu size={14} /> <b>Model enclave {i + 1}</b>
              </div>
              <div className="kv">
                <span>Signing address</span>
                <span className="mono">{m.signingAddress}</span>
              </div>
              <div className="kv">
                <span>Intel TDX quote</span>
                <span>{m.hasIntelQuote ? '✓ present' : '✗ missing'}</span>
              </div>
              <div className="kv">
                <span>NVIDIA GPU evidence</span>
                <span>{m.hasNvidiaPayload ? '✓ present' : '✗ missing'}</span>
              </div>
            </div>
          ))}
          <div className="sub">
            Verify the raw quotes independently in the{' '}
            <a href={att.verifyUrl} target="_blank" rel="noopener noreferrer">
              NEAR AI verification center
            </a>
            .
          </div>
        </div>
      )}
    </div>
  );
}
