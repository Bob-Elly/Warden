import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Warden | The Agent Wallet Where the AI Never Holds the Keys',
  description: 'On-chain security vault for AI agents built on NEAR Protocol',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

