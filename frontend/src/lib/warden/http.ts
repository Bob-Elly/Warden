import { NextRequest, NextResponse } from 'next/server';

/**
 * Tiny per-instance rate limit for the public demo. The vault enforces the
 * real limits on-chain; this only keeps one visitor from spending the shared
 * testnet budget in a loop.
 */
const hits = new Map<string, number[]>();

export function rateLimited(req: NextRequest, max = 12, windowMs = 60_000): NextResponse | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (recent.length > max) {
    return NextResponse.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429 });
  }
  return null;
}

export function errorJson(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: message }, { status });
}
