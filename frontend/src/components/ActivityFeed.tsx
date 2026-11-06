'use client';

import { History } from 'lucide-react';
import type { VaultSnapshot, Activity } from '@/lib/warden/types';
import { near, relTime } from './ui';
import { reasonText } from '@/lib/warden/reasons';

const KIND: Record<Activity['kind'], { label: string; cls: string }> = {
  executed: { label: 'Paid', cls: 'ok' },
  subscription: { label: 'Recurring', cls: 'ok' },
  approved: { label: 'Owner approved', cls: 'ok' },
  pending: { label: 'Queued', cls: 'info' },
  denied: { label: 'Owner denied', cls: 'warn' },
  rejected: { label: 'Blocked', cls: 'bad' },
  suspended: { label: 'Agent suspended', cls: 'bad' },
};

export function ActivityFeed({ snap }: { snap: VaultSnapshot }) {
  const labelFor = (id: string) => snap.agents.find((a) => a.accountId === id)?.policy.label ?? (id === snap.info.owner_id ? 'owner' : id);
  return (
    <section className="card" aria-labelledby="feed-h">
      <div className="card-title" id="feed-h">
        <History size={15} /> On-chain activity
        <span className="count faint">
          {snap.info.total_executed} paid · {snap.info.total_blocked} blocked · stored in the contract
        </span>
      </div>
      {snap.activity.length === 0 ? (
        <div className="empty">No activity yet. Run a step above.</div>
      ) : (
        <div className="table-wrap">
          <table className="feed">
            <thead>
              <tr>
                <th>Result</th>
                <th>Agent</th>
                <th>To</th>
                <th>Amount</th>
                <th>Why</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {snap.activity.map((a) => (
                <tr key={a.seq}>
                  <td>
                    <span className={`pill ${KIND[a.kind]?.cls ?? ''}`}>{KIND[a.kind]?.label ?? a.kind}</span>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{labelFor(a.actor)}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {a.receiver_id ?? '–'}
                  </td>
                  <td className="amt">{a.kind === 'suspended' ? '–' : `${near(a.amount)} NEAR`}</td>
                  <td className="sub">{a.reason ? reasonText(a.reason) : a.memo ?? ''}</td>
                  <td className="faint" title={`block ${a.block_height}`}>
                    <a href={`${snap.explorer}/blocks/${a.block_height}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                      {relTime(a.timestamp_ms)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
