import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { VaultNotices, VaultProvider } from '@/components/VaultProvider';

export const metadata: Metadata = {
  title: 'Warden | The Corporate Card for AI Agents',
  description:
    'AI agents pay invoices, subscriptions and APIs in NEAR or USDC, within limits a NEAR smart contract enforces. Private, verifiable AI on NEAR AI Cloud.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <VaultProvider>
          <Nav />
          <main className="shell">
            <VaultNotices />
            {children}
            <footer className="footer">
              <span>Built at NEAR HACKATHON 2026 · MIT licensed</span>
              <span>Everything on these pages is read live from NEAR testnet. No cached or sample data.</span>
            </footer>
          </main>
        </VaultProvider>
      </body>
    </html>
  );
}
