'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Github, RefreshCw, Shield } from 'lucide-react';
import { useVault } from './VaultProvider';

const LINKS = [
  { href: '/', label: 'Demo' },
  { href: '/vault', label: 'Vault' },
  { href: '/owner', label: 'Owner' },
  { href: '/activity', label: 'Activity' },
];

export function Nav() {
  const path = usePathname();
  const { snap, loading, refresh } = useVault();
  const pending = snap?.pending.length ?? 0;
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner">
        <Link href="/" className="nav-brand" aria-label="Warden home">
          <span className="logo small">
            <Shield size={16} />
          </span>
          Warden
        </Link>
        <div className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link" aria-current={path === l.href ? 'page' : undefined}>
              {l.label}
              {l.href === '/owner' && pending > 0 && <span className="nav-badge">{pending}</span>}
            </Link>
          ))}
        </div>
        <div className="nav-right">
          <span className="pill ok nav-live">
            <span className="dot live" /> {snap?.network ?? 'testnet'}
          </span>
          <a className="ghost icon-btn nav-gh" href="https://github.com/Bob-Elly/Warden" target="_blank" rel="noopener noreferrer" aria-label="Source on GitHub">
            <Github size={15} />
          </a>
          <button className="ghost icon-btn" onClick={refresh} aria-label="Refresh vault state">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>
    </nav>
  );
}
