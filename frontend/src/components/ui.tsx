'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2, Clock, Copy, ExternalLink, Hourglass, Info, ShieldX, XCircle } from 'lucide-react';
import { fromBaseUnits, yoctoToNear } from '@/lib/warden/units';
import { fmtNear, reasonText } from '@/lib/warden/reasons';
import type { TraceStep } from '@/lib/warden/agent';
import type { ExecutionOutcome, TokenInfo } from '@/lib/warden/types';

export const near = (yocto?: string | null, digits = 3) => fmtNear(yoctoToNear(yocto ?? '0', digits));

/** Formats an on-chain amount: NEAR when `token` is null, otherwise the token's symbol and decimals. */
export function amountText(amount: string, token: string | null | undefined, tokens: TokenInfo[]): string {
  if (!token) return `${near(amount)} NEAR`;
  const t = tokens.find((x) => x.tokenId === token);
  if (!t) return `${amount} (unknown token)`;
  return `${fmtNear(fromBaseUnits(amount, t.policy.decimals, 2))} ${t.policy.symbol}`;
}

/** Seconds left until `untilMs`, re-rendering every second. Calls onDone once at zero. */
export function useCountdown(untilMs: number | null | undefined, onDone?: () => void): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!untilMs) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [untilMs]);
  const left = untilMs ? Math.max(0, Math.ceil((untilMs - now) / 1000)) : 0;
  useEffect(() => {
    if (untilMs && left === 0) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left === 0, untilMs]);
  return left;
}

/** Shown when the agent's third strike suspends it with a timed quarantine. */
export function QuarantineNotice({ untilMs, agent, onOver }: { untilMs: number; agent: string; onOver?: () => void }) {
  const left = useCountdown(untilMs, onOver);
  const over = left === 0;
  return (
    <div className={`verdict ${over ? 'ok' : 'fail'}`} role="status" aria-live="polite">
      <Hourglass size={22} color={over ? 'var(--ok)' : 'var(--bad)'} />
      <div className="grow">
        <div className="big">{over ? 'Agent reinstated: the demo can continue' : `Agent suspended on-chain · back in ${left}s`}</div>
        <div className="sub">
          {over
            ? `The quarantine set by the owner has ended, so ${agent} works again with a clean record.`
            : `Three blocked attempts suspended ${agent}. In this public demo the owner set a short quarantine in the contract, so it is reinstated automatically. In production the owner would set none, and only the owner key could bring the agent back.`}
        </div>
      </div>
    </div>
  );
}

export function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 60) return `in ${f}s`;
    if (f < 3600) return `in ${Math.round(f / 60)} min`;
    if (f < 86400) return `in ${Math.round(f / 3600)} h`;
    return `in ${Math.round(f / 86400)} d`;
  }
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function Meter({ value, max }: { value: string; max: string }) {
  const v = Number(BigInt(value || '0') / 10n ** 18n);
  const m = Number(BigInt(max || '0') / 10n ** 18n) || 1;
  const pct = Math.min(100, (v / m) * 100);
  return (
    <div className={`meter ${pct > 80 ? 'hot' : ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Explorer({ base, path, children }: { base: string; path: string; children: ReactNode }) {
  return (
    <a href={`${base}/${path}`} target="_blank" rel="noopener noreferrer" className="row" style={{ display: 'inline-flex', gap: 4 }}>
      {children} <ExternalLink size={12} />
    </a>
  );
}

export function Cmd({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <code>{text}</code>
      <button
        className="ghost small"
        aria-label="Copy command"
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

const ICONS = {
  ok: <CheckCircle2 size={15} />,
  warn: <AlertTriangle size={15} />,
  fail: <XCircle size={15} />,
  info: <Info size={15} />,
};

export function Trace({ steps }: { steps: TraceStep[] }) {
  return (
    <ol className="trace" aria-label="What the agent did">
      {steps.map((s, i) => (
        <li key={i}>
          <span className={`icon ${s.status}`}>{ICONS[s.status]}</span>
          <div>
            <div className="title">{s.title}</div>
            {s.detail && <div className="detail">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Verdict({ outcome, explorer }: { outcome: ExecutionOutcome; explorer?: string }) {
  const map = {
    executed: { cls: 'ok', icon: <CheckCircle2 size={22} color="var(--ok)" />, title: 'Paid' },
    pending_approval: { cls: 'info', icon: <Clock size={22} color="var(--info)" />, title: 'Waiting for the owner' },
    rejected: { cls: 'fail', icon: <ShieldX size={22} color="var(--bad)" />, title: 'Blocked by the vault' },
    error: { cls: 'fail', icon: <XCircle size={22} color="var(--bad)" />, title: 'Transaction failed' },
  } as const;
  const v = map[outcome.status];
  return (
    <div className={`verdict ${v.cls}`} role="status">
      {v.icon}
      <div className="grow">
        <div className="big">{v.title}</div>
        <div className="sub">
          {outcome.status === 'executed' && 'Every on-chain rule passed and the vault sent the funds.'}
          {outcome.status === 'pending_approval' &&
            `Request #${outcome.requestId} is stored in the contract. Nothing moves until the owner approves it with their own key.`}
          {outcome.status === 'rejected' &&
            `${reasonText(outcome.reason)}.${outcome.strikes ? ` Strike ${outcome.strikes} recorded on-chain against ${outcome.agent}.` : ''} No funds moved.`}
          {outcome.status === 'error' && outcome.error}
        </div>
        {outcome.txHash && explorer && (
          <div style={{ marginTop: 6 }}>
            <Explorer base={explorer} path={`txns/${outcome.txHash}`}>
              View transaction {outcome.txHash.slice(0, 8)}…
            </Explorer>
          </div>
        )}
      </div>
    </div>
  );
}

export function Strikes({ n, max }: { n: number; max: number }) {
  return (
    <span className="strikes" aria-label={`${n} of ${max} strikes`} title={`${n} of ${max} strikes`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

export async function postJson<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !json.trace) throw new Error(json.error || `Request failed (HTTP ${res.status})`);
  return json as T;
}
