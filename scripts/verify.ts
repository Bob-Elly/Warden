/**
 * npm run verify
 *
 * Read-only checks against a live Warden deployment. Needs no keys and no
 * account: by default it reads the public deployment in deployment.json.
 * Exits non-zero if any security property does not hold.
 */
import { existsSync, readFileSync } from 'node:fs';
import 'dotenv/config';
import { accessKeys, view } from '../frontend/src/lib/warden/near';
import { yoctoToNear } from '../frontend/src/lib/warden/units';
import type { AgentPolicy, VaultInfo, Activity } from '../frontend/src/lib/warden/types';

const deployment = existsSync('deployment.json') ? JSON.parse(readFileSync('deployment.json', 'utf8')) : {};
const vaultId = process.env.VAULT_CONTRACT_ID || deployment.vault;

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

async function main() {
  if (!vaultId) throw new Error('No vault id: set VAULT_CONTRACT_ID or keep deployment.json in the repo root.');
  console.log(`\nWarden verification: ${vaultId} on testnet\n`);

  const info = await view<VaultInfo>(vaultId, 'get_vault_info');
  const agents = await view<[string, AgentPolicy][]>(vaultId, 'get_agents');
  const activity = await view<Activity[]>(vaultId, 'get_activity', { limit: 50 });

  console.log('Vault');
  check(true, `owner ${info.owner_id}, balance ${yoctoToNear(info.balance)} NEAR, cap ${yoctoToNear(info.vault_daily_limit)} NEAR/24h`);
  const vaultKeys = await accessKeys(vaultId);
  check(
    vaultKeys.every((k) => k.permission !== 'FullAccess'),
    'vault account has no full-access key (contract code cannot be changed)',
    `${vaultKeys.length} key(s)`
  );
  check(info.allowlist.length > 0, 'recipient allowlist is set', info.allowlist.join(', '));

  console.log('\nAgents');
  for (const [id, p] of agents) {
    const keys = await accessKeys(id);
    const full = keys.filter((k) => k.permission === 'FullAccess');
    const scoped = keys.filter(
      (k) => k.permission !== 'FullAccess' && (k.permission as any).FunctionCall.receiver_id === vaultId
    );
    const methods = [...new Set(scoped.flatMap((k) => (k.permission as any).FunctionCall.method_names))];
    check(full.length === 0, `${id} (${p.label}) has no full-access key`);
    check(
      scoped.length > 0 && methods.every((m) => ['execute_transfer', 'charge_subscription'].includes(m)),
      `${id} key can only call the vault`,
      `receiver ${vaultId}, methods [${methods.join(', ')}]`
    );
    check(true, `${p.label} budget: ${yoctoToNear(p.per_tx_limit)} NEAR/tx, ${yoctoToNear(p.daily_limit)} NEAR/day`, `strikes ${p.strikes}/${info.strike_limit}${p.suspended ? ', SUSPENDED' : ''}`);
  }

  console.log('\nOn-chain record');
  console.log(`  executed ${info.total_executed}, blocked ${info.total_blocked}, pending approvals ${info.pending_count}`);
  for (const a of activity.slice(0, 8)) {
    console.log(`  #${a.seq} ${a.kind.padEnd(12)} ${a.actor} → ${a.receiver_id ?? '-'} ${yoctoToNear(a.amount)} NEAR ${a.reason ?? ''}`);
  }

  console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nAll checks passed\n');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
