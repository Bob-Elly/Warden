import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Warden | The Corporate Card for AI Agents',
  description:
    'AI agents pay invoices, subscriptions and APIs in NEAR or USDC, within limits a NEAR smart contract enforces. Private, verifiable AI on NEAR AI Cloud.',
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

