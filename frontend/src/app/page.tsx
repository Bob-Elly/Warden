'use client';

import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, Github, KeyRound, Lock, RefreshCw, Shield, ShieldX, Sparkles } from 'lucide-react';
import type { VaultSnapshot } from '@/lib/warden/types';
import { AgentConsole } from '@/components/AgentConsole';
import { PaidApi, PrivateAi, SwapQuote } from '@/components/Tools';
import { VaultPanel } from '@/components/VaultPanel';
import { ActivityFeed } from '@/components/ActivityFeed';
import type { Features } from '@/components/types';

type Tab = 'agent' | 'x402' | 'swap' | 'privacy';

const TABS: { id: Tab; label: string }[] = [
  { id: 'agent', label: 'Ask the agent' },
  { id: 'x402', label: 'Agent pays for an API' },
  { id: 'swap', label: 'Swap quote (Intents)' },
  { id: 'privacy', label: 'Private AI' },
];

export default function Home() {
  const [snap, setSnap] = useState<VaultSnapshot | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('agent');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vault', { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setSnap(j.snapshot);
      setFeatures(j.features);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  const explorer = snap?.explorer ?? 'https://testnet.nearblocks.io';
  const agentKeysOk =
    !!snap?.agents.length &&
    snap.agents.every((a) => a.keys.length > 0 && a.keys.every((k) => k.permission !== 'FullAccess'));
  const suspended = snap ? `${snap.agents.filter((a) => a.policy.suspended).length} of ${snap.agents.length} agents` : '';
  const vaultLocked = !!snap && snap.vaultKeys.every((k) => k.permission !== 'FullAccess');

  return (
    <main className="shell">
      <header className="header">
        <div className="brand">
          <div className="logo">
            <Shield size={22} />
          </div>
          <div>
            <h1>Warden</h1>
            <p>The agent wallet where the AI never holds the keys</p>
          </div>
        </div>
        <div className="row">
          <span className="pill ok">
            <span className="dot live" /> NEAR {snap?.network ?? 'testnet'} · live
          </span>
          <a className="pill" href="https://github.com/Bob-Elly/Warden" target="_blank" rel="noopener noreferrer">
            <Github size={12} /> Source
          </a>
          <button className="ghost" onClick={refresh} aria-label="Refresh vault state">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      <div className="how">
        <div>
          <b>1. The vault holds the money</b>A NEAR smart contract with an allowlist, per-agent budgets and a vault-wide daily cap.
        </div>
        <div>
          <b>2. The agent only holds a restricted key</b>It can ask the vault to pay. It cannot send NEAR, change rules or
          withdraw.
        </div>
        <div>
          <b>3. The contract decides</b>Within limits it pays. Over a limit, the owner decides. Anything else is blocked and
          logged as a strike.
        </div>
      </div>

      {loadError && (
        <div className="notice bad" style={{ marginBottom: 16 }}>
          Could not read the vault from NEAR RPC: {loadError}
        </div>
      )}

      {snap && (
        <div className="proofs">
          <a className="proof" href={`${explorer}/address/${snap.agents[0]?.accountId}#accesskeys`} target="_blank" rel="noopener noreferrer">
            <KeyRound size={18} color={agentKeysOk ? 'var(--ok)' : 'var(--bad)'} />
            <div>
              <div className="label">Agent keys (live from RPC)</div>
              <div className="value">{agentKeysOk ? 'Function-call only, vault-scoped' : 'Full-access key found'}</div>
            </div>
          </a>
          <a className="proof" href={`${explorer}/address/${snap.vaultId}#accesskeys`} target="_blank" rel="noopener noreferrer">
            <Lock size={18} color={vaultLocked ? 'var(--ok)' : 'var(--warn)'} />
            <div>
              <div className="label">Vault contract</div>
              <div className="value">{vaultLocked ? 'Locked: no one can change the code' : 'Upgradeable (deployer key kept)'}</div>
            </div>
          </a>
          <div className="proof">
            <ShieldX size={18} color="var(--bad)" />
            <div>
              <div className="label">Blocked on-chain</div>
              <div className="value">
                {snap.info.total_blocked} {snap.info.total_blocked === 1 ? 'attempt' : 'attempts'} · {suspended} suspended
              </div>
            </div>
          </div>
          <div className="proof">
            {features?.nearAi ? <BrainCircuit size={18} color="var(--ok)" /> : <Sparkles size={18} color="var(--warn)" />}
            <div>
              <div className="label">Agent brain</div>
              <div className="value">{features?.nearAi ? 'NEAR AI Cloud, in a TEE' : 'Local parser (no AI key)'}</div>
            </div>
          </div>
        </div>
      )}

      <div className="grid">
        <div className="stack">
          <section className="card" aria-label="Agent">
            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            {tab === 'agent' && <AgentConsole features={features} explorer={explorer} onDone={refresh} />}
            {tab === 'x402' && <PaidApi features={features} explorer={explorer} onDone={refresh} />}
            {tab === 'swap' && <SwapQuote perTxLimit={snap?.agents[0]?.policy.per_tx_limit} />}
            {tab === 'privacy' && <PrivateAi features={features} />}
          </section>
          {snap && <ActivityFeed snap={snap} />}
        </div>
        <aside>
          {snap ? (
            <VaultPanel snap={snap} onChange={refresh} />
          ) : (
            <div className="card empty">{loading ? 'Reading the vault from NEAR…' : 'Vault unavailable'}</div>
          )}
        </aside>
      </div>

      <footer className="footer">
        <span>Built at NEAR HACKATHON 2026 · MIT licensed</span>
        <span>
          Everything on this page is read from NEAR testnet. No cached or sample data.
        </span>
      </footer>
    </main>
  );
}
