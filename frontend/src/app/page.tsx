'use client';

import { useState } from 'react';
import { AgentConsole } from '@/components/AgentConsole';
import { PaidApi, PrivateAi, SwapQuote } from '@/components/Tools';
import { LiveStatus } from '@/components/VaultPanel';
import { useVault } from '@/components/VaultProvider';

type Tab = 'agent' | 'x402' | 'swap' | 'privacy';

const TABS: { id: Tab; label: string }[] = [
  { id: 'agent', label: 'Pay an invoice' },
  { id: 'x402', label: 'Buy API data (x402)' },
  { id: 'swap', label: 'Swap (NEAR Intents)' },
  { id: 'privacy', label: 'Private AI (TEE)' },
];

export default function Home() {
  const { snap, features, loading, refresh, explorer } = useVault();
  const [tab, setTab] = useState<Tab>('agent');

  return (
    <>
      <section className="hero">
        <h1>
          The <span className="accent">corporate card</span> for AI agents.
        </h1>
        <p className="lead">
          Your agents pay invoices, subscriptions and APIs on their own, in NEAR or USDC. A NEAR smart contract holds the
          money and enforces every limit, even if an agent is tricked.
        </p>
        <div className="pillars">
          <div>
            <b>Agents that pay</b>
            <span>Invoices, recurring payments, pay-per-call APIs</span>
          </div>
          <div>
            <b>Limits they cannot break</b>
            <span>Enforced on-chain by NEAR, not by a prompt</span>
          </div>
          <div>
            <b>Private, verifiable AI</b>
            <span>Runs in a secure enclave, every decision signed</span>
          </div>
        </div>
      </section>

      <div className="grid">
        <section className="card" aria-label="Try the agent">
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
        <aside>
          {snap ? (
            <LiveStatus snap={snap} onChange={refresh} />
          ) : (
            <div className="card empty">{loading ? 'Reading the vault from NEAR…' : 'Vault unavailable'}</div>
          )}
        </aside>
      </div>
    </>
  );
}
