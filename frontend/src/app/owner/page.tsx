'use client';

import { Terminal } from 'lucide-react';
import { AgentsCard, AllowlistCard, PendingCard } from '@/components/VaultPanel';
import { useVault } from '@/components/VaultProvider';
import { PageHead, Loading } from '@/components/PageHead';
import { Cmd } from '@/components/ui';

export default function OwnerPage() {
  const { snap, loading, refresh } = useVault();
  return (
    <>
      <PageHead
        title="Owner"
        lead="Payments over a limit wait here for the owner. The owner also manages the agents and the approved recipients. The owner's key never touches this server: these actions run from the owner's own machine."
      />
      {!snap ? (
        <Loading loading={loading} />
      ) : (
        <div className="two-col">
          <div className="stack">
            <PendingCard snap={snap} />
            <AllowlistCard snap={snap} />
            <section className="card" aria-labelledby="cli-h">
              <div className="card-title" id="cli-h">
                <Terminal size={15} /> Owner commands
              </div>
              <div className="sub" style={{ marginBottom: 10 }}>
                Run from a clone of the repository with the owner key in <span className="mono">.env</span>.
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <Cmd text="npm run owner -- status" />
                <Cmd text="npm run owner -- approve <id>" />
                <Cmd text="npm run owner -- reject <id>" />
                <Cmd text="npm run owner -- allow <account>" />
                <Cmd text="npm run owner -- reinstate <agent>" />
                <Cmd text="npm run owner -- pause" />
              </div>
            </section>
          </div>
          <AgentsCard snap={snap} onChange={refresh} />
        </div>
      )}
    </>
  );
}
