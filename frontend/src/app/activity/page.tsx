'use client';

import { ActivityFeed } from '@/components/ActivityFeed';
import { useVault } from '@/components/VaultProvider';
import { PageHead, Loading } from '@/components/PageHead';

export default function ActivityPage() {
  const { snap, loading } = useVault();
  return (
    <>
      <PageHead title="Activity" lead="Every payment, refusal, strike and approval, read from the vault contract's on-chain log." />
      {!snap ? <Loading loading={loading} /> : <ActivityFeed snap={snap} />}
    </>
  );
}
