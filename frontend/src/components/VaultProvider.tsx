'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { VaultSnapshot } from '@/lib/warden/types';
import type { Features } from './types';

interface VaultState {
  snap: VaultSnapshot | null;
  features: Features | null;
  loadError: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  explorer: string;
}

const Ctx = createContext<VaultState | null>(null);

/** Reads the vault from /api/vault (live NEAR RPC) once for every page, and every 20 s after that. */
export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<VaultSnapshot | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
  return <Ctx.Provider value={{ snap, features, loadError, loading, refresh, explorer }}>{children}</Ctx.Provider>;
}

export function useVault() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVault must be used inside VaultProvider');
  return v;
}

/** Configuration and RPC problems, shown at the top of every page. */
export function VaultNotices() {
  const { snap, features, loadError } = useVault();
  return (
    <>
      {!!features?.unregisteredAgents?.length && (
        <div className="notice bad" style={{ marginBottom: 16 }}>
          Configuration problem: this server signs as {features.unregisteredAgents.join(', ')}, which is not an agent of{' '}
          {snap?.vaultId}. Its key belongs to a different vault, so NEAR will refuse its transactions. Update AGENT_ACCOUNT_ID /
          AGENT_PRIVATE_KEY (and RESEARCH_AGENT_*) to the agents of this vault.
        </div>
      )}
      {loadError && (
        <div className="notice bad" style={{ marginBottom: 16 }}>
          Could not read the vault from NEAR RPC: {loadError}
        </div>
      )}
    </>
  );
}
