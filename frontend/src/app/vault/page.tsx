'use client';

import { SecurityChecks, Subscriptions, VaultCard } from '@/components/VaultPanel';
import { useVault } from '@/components/VaultProvider';
import { PageHead, Loading } from '@/components/PageHead';

export default function VaultPage() {
  const { snap, features, loading, refresh } = useVault();
  return (
    <>
      <PageHead title="Vault" lead="The money, the spending caps, and the checks anyone can verify on NEAR. Recurring payments are charged from here when due." />
      {!snap ? (
        <Loading loading={loading} />
      ) : (
        <>
          <SecurityChecks snap={snap} features={features} />
          <div className="two-col">
            <VaultCard snap={snap} />
            <Subscriptions snap={snap} onChange={refresh} />
          </div>
        </>
      )}
    </>
  );
}
