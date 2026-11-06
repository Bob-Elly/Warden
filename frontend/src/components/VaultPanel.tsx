'use client';

import { useState } from 'react';
import { Bot, CalendarClock, Clock, KeyRound, ListChecks, Loader2, PauseCircle, Vault } from 'lucide-react';
import type { VaultSnapshot, ExecutionOutcome } from '@/lib/warden/types';
import { Cmd, Explorer, Meter, Strikes, amountText, near, postJson, relTime, useCountdown } from './ui';
import { fromBaseUnits } from '@/lib/warden/units';
import { reasonText } from '@/lib/warden/reasons';

function keySummary(keys: VaultSnapshot['agents'][number]['keys'], vaultId: string) {
  if (!keys.length) return { ok: false, text: 'no keys' };
  if (keys.some((k) => k.permission === 'FullAccess')) return { ok: false, text: 'has a FULL-ACCESS key' };
  const fc = keys.map((k) => (k.permission as any).FunctionCall);
  const scoped = fc.every((f) => f.receiver_id === vaultId);
  const methods = [...new Set(fc.flatMap((f) => f.method_names))];
  return { ok: scoped, text: `function-call only → ${methods.join(', ')}` };
}

function SuspendedPill({ untilMs, onOver }: { untilMs: number; onOver: () => void }) {
  const left = useCountdown(untilMs || null, onOver);
  return <span className="pill bad">{untilMs ? `suspended · back in ${left}s` : 'suspended'}</span>;
}

export function VaultPanel({ snap, onChange }: { snap: VaultSnapshot; onChange: () => void }) {
  const { info } = snap;
  return (
    <div className="stack">
      <section className="card" aria-labelledby="vault-h">
        <div className="card-title" id="vault-h">
          <Vault size={15} /> Vault
          <span className="count">
            {info.paused ? (
              <span className="pill bad">
                <PauseCircle size={12} /> paused
              </span>
            ) : (
              <span className="pill ok">
                <span className="dot live" /> active
              </span>
            )}
          </span>
        </div>
        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <div>
            <div className="stat">{near(info.balance, 2)} NEAR</div>
            <div className="sub">{near(info.available_balance, 2)} spendable after storage</div>
          </div>
          <Explorer base={snap.explorer} path={`address/${snap.vaultId}`}>
            <span className="mono" style={{ fontSize: 12 }}>
              {snap.vaultId}
            </span>
          </Explorer>
        </div>
        <div className="divider" />
        <div className="kv">
          <span>Vault-wide cap, all agents</span>
          <span>
            {near(info.vault_spent_today)} / {near(info.vault_daily_limit)} NEAR
          </span>
        </div>
        <Meter value={info.vault_spent_today} max={info.vault_daily_limit} />
        <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
          Window resets in {Math.round(info.reset_in_seconds / 3600)} h · owner {info.owner_id}
        </div>
        {snap.tokens.map((t) => (
          <div key={t.tokenId} style={{ marginTop: 12 }}>
            <div className="divider" style={{ margin: '0 0 10px' }} />
            <div className="kv">
              <span>{t.policy.symbol} balance</span>
              <span>
                {fromBaseUnits(t.balance, t.policy.decimals, 2)} {t.policy.symbol}
              </span>
            </div>
            <div className="kv">
              <span>{t.policy.symbol} today (≤ {fromBaseUnits(t.policy.per_tx_limit, t.policy.decimals, 2)} per payment)</span>
              <span>
                {fromBaseUnits(t.policy.spent_today, t.policy.decimals, 2)} / {fromBaseUnits(t.policy.daily_limit, t.policy.decimals, 2)}
              </span>
            </div>
            <Meter value={t.policy.spent_today} max={t.policy.daily_limit} />
          </div>
        ))}
        {info.quarantine_secs > 0 && (
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            Quarantine: a suspended agent is reinstated after {info.quarantine_secs}s (demo setting; 0 = owner only)
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="agents-h">
        <div className="card-title" id="agents-h">
          <Bot size={15} /> Agents <span className="count faint">{snap.agents.length}</span>
        </div>
        <div className="list">
          {snap.agents.map((a) => {
            const k = keySummary(a.keys, snap.vaultId);
            return (
              <div className="item" key={a.accountId}>
                <div className="row between">
                  <b style={{ textTransform: 'capitalize' }}>{a.policy.label}</b>
                  {a.policy.suspended ? <SuspendedPill untilMs={a.policy.suspended_until_ms} onOver={onChange} /> : <Strikes n={a.policy.strikes} max={info.strike_limit} />}
                </div>
                <div className="mono faint" style={{ fontSize: 11.5, marginBottom: 6 }}>
                  {a.accountId}
                </div>
                <div className="kv">
                  <span>Today</span>
                  <span>
                    {near(a.policy.spent_today)} / {near(a.policy.daily_limit)} NEAR
                  </span>
                </div>
                <Meter value={a.policy.spent_today} max={a.policy.daily_limit} />
                <div className="kv" style={{ marginTop: 4 }}>
                  <span>Per payment</span>
                  <span>≤ {near(a.policy.per_tx_limit)} NEAR</span>
                </div>
                <a
                  href={`${snap.explorer}/address/${a.accountId}#accesskeys`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`pill ${k.ok ? 'ok' : 'bad'}`}
                  style={{ marginTop: 6, whiteSpace: 'normal' }}
                  title="Read live from NEAR RPC (view_access_key_list)"
                >
                  <KeyRound size={11} /> {k.text}
                </a>
                {a.policy.suspended && !a.policy.suspended_until_ms && (
                  <div style={{ marginTop: 8 }}>
                    <div className="sub" style={{ marginBottom: 4 }}>
                      Suspended after {a.policy.strikes} blocked attempts. Only the owner can reinstate it:
                    </div>
                    <Cmd text={`npm run owner -- reinstate ${a.accountId}`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card" aria-labelledby="pending-h">
        <div className="card-title" id="pending-h">
          <Clock size={15} /> Waiting for owner <span className="count faint">{snap.pending.length}</span>
        </div>
        {snap.pending.length === 0 ? (
          <div className="empty">Nothing waiting. Over-limit payments land here.</div>
        ) : (
          <div className="list">
            {snap.pending.map((p) => (
              <div className="item" key={p.id}>
                <div className="row between">
                  <b>
                    #{p.id} · {amountText(p.amount, p.token, snap.tokens)} → {p.receiver_id}
                  </b>
                </div>
                <div className="sub">
                  {reasonText(p.reason)} · {p.memo || 'no memo'} · {relTime(p.created_at_ms)}
                </div>
                <div style={{ marginTop: 6 }}>
                  <Cmd text={`npm run owner -- approve ${p.id}`} />
                </div>
              </div>
            ))}
            <div className="faint" style={{ fontSize: 12 }}>
              The owner key never touches this server. Approve or reject from the owner&apos;s machine.
            </div>
          </div>
        )}
      </section>

      <Subscriptions snap={snap} onChange={onChange} />

      <section className="card" aria-labelledby="allow-h">
        <div className="card-title" id="allow-h">
          <ListChecks size={15} /> Allowlist <span className="count faint">{info.allowlist.length}</span>
        </div>
        <div className="row wrap">
          {info.allowlist.map((a) => (
            <span className="pill mono" key={a}>
              {a}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function Subscriptions({ snap, onChange }: { snap: VaultSnapshot; onChange: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [last, setLast] = useState<Record<number, ExecutionOutcome>>({});

  async function charge(id: number) {
    setBusy(id);
    try {
      const r = await postJson<{ outcome: ExecutionOutcome }>('/api/subscriptions/charge', { id });
      setLast((m) => ({ ...m, [id]: r.outcome }));
      onChange();
    } catch (e: any) {
      setLast((m) => ({ ...m, [id]: { status: 'error', error: e.message, events: [], agent: '' } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" aria-labelledby="subs-h">
      <div className="card-title" id="subs-h">
        <CalendarClock size={15} /> Recurring payments <span className="count faint">{snap.subscriptions.length}</span>
      </div>
      {snap.subscriptions.length === 0 && <div className="empty">No recurring payments set up.</div>}
      <div className="list">
        {snap.subscriptions.map((s) => {
          const due = s.next_due_ms <= Date.now();
          const o = last[s.id];
          return (
            <div className="item" key={s.id}>
              <div className="row between">
                <b>{s.label}</b>
                <button className="small" disabled={busy !== null || !due} onClick={() => charge(s.id)} title={due ? 'The agent pays it now' : 'Not due yet'}>
                  {busy === s.id && <Loader2 size={12} className="spin" />} {due ? 'Agent: pay now' : 'Not due'}
                </button>
              </div>
              <div className="sub">
                {amountText(s.amount, s.token, snap.tokens)} → {s.receiver_id} every {fmtInterval(s.interval_secs)}
              </div>
              <div className="faint" style={{ fontSize: 12 }}>
                Paid {s.charges}× · next due {due ? 'now' : relTime(s.next_due_ms)}
              </div>
              {o && (
                <div style={{ fontSize: 12, marginTop: 4, color: o.status === 'executed' ? 'var(--ok)' : 'var(--warn)' }}>
                  {o.status === 'executed' ? 'Paid by the agent. ' : `${o.reason ? reasonText(o.reason) : o.error}. `}
                  {o.txHash && (
                    <a href={`${snap.explorer}/txns/${o.txHash}`} target="_blank" rel="noopener noreferrer">
                      tx
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
        Amount, payee and schedule are fixed by the owner in the contract. The agent can only trigger a payment that is due.
      </div>
    </section>
  );
}

function fmtInterval(s: number) {
  if (s % 86400 === 0) return s === 86400 ? 'day' : `${s / 86400} days`;
  if (s % 3600 === 0) return s === 3600 ? 'hour' : `${s / 3600} hours`;
  return `${Math.round(s / 60)} min`;
}
