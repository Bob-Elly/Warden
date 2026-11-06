/**
 * npm run owner -- <command>
 *
 * The owner's side of Warden. Runs locally with OWNER_PRIVATE_KEY from .env;
 * the owner key never goes to the web server.
 *
 *   status                       show vault, agents and pending requests
 *   approve <id> | reject <id>   resolve a queued over-limit request
 *   pause | unpause              emergency stop
 *   reinstate <agent-id>         clear strikes and un-suspend an agent
 *   allow <account> | disallow <account>
 *   limits <agent-id> <per_tx_near> <daily_near>
 *   quarantine <secs>            auto-reinstate suspended agents after <secs> (0 = owner only)
 *   cap <daily_near>             vault-wide daily cap
 *   fund <near>                  deposit NEAR into the vault
 *   withdraw <near>              withdraw NEAR to the owner
 */
import 'dotenv/config';
import { KeyPair, connect, keyStores } from 'near-api-js';
import { getConfig } from '../frontend/src/lib/warden/config';
import { getSnapshot, cleanError } from '../frontend/src/lib/warden/vault';
import { nearToYocto, yoctoToNear } from '../frontend/src/lib/warden/units';

async function ownerAccount() {
  const cfg = getConfig();
  const key = process.env.OWNER_PRIVATE_KEY;
  if (!cfg.ownerId || !key) throw new Error('OWNER_ACCOUNT_ID / OWNER_PRIVATE_KEY missing in .env');
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(cfg.networkId, cfg.ownerId, KeyPair.fromString(key as any));
  const near = await connect({ networkId: cfg.networkId, nodeUrl: cfg.nodeUrl, keyStore } as any);
  return near.account(cfg.ownerId);
}

async function call(methodName: string, args: object, deposit = 0n) {
  const cfg = getConfig();
  const owner = await ownerAccount();
  const out: any = await owner.functionCall({
    contractId: cfg.vaultId,
    methodName,
    args,
    gas: 50_000_000_000_000n,
    attachedDeposit: deposit,
  } as any);
  console.log(`✓ ${methodName} ${JSON.stringify(args)}\n  ${cfg.explorer}/txns/${out.transaction.hash}`);
}

async function status() {
  const s = await getSnapshot();
  console.log(`Vault ${s.vaultId}  ${s.info.paused ? 'PAUSED' : 'active'}`);
  console.log(`  balance ${yoctoToNear(s.info.balance)} NEAR, spent ${yoctoToNear(s.info.vault_spent_today)}/${yoctoToNear(s.info.vault_daily_limit)} NEAR today`);
  console.log(`  allowlist: ${s.info.allowlist.join(', ')}`);
  for (const a of s.agents) {
    console.log(
      `  agent ${a.accountId} (${a.policy.label}): ${yoctoToNear(a.policy.spent_today)}/${yoctoToNear(a.policy.daily_limit)} NEAR today, ` +
        `strikes ${a.policy.strikes}/${s.info.strike_limit}${a.policy.suspended ? ' SUSPENDED' : ''}`
    );
  }
  if (!s.pending.length) console.log('  no pending requests');
  for (const p of s.pending) {
    console.log(`  pending #${p.id}: ${yoctoToNear(p.amount)} NEAR → ${p.receiver_id} from ${p.agent} (${p.reason}) "${p.memo ?? ''}"`);
  }
}

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  switch (cmd) {
    case 'status':
    case undefined:
      return status();
    case 'approve':
      return call('approve_request', { request_id: Number(a) });
    case 'reject':
      return call('reject_request', { request_id: Number(a) });
    case 'pause':
      return call('pause', {});
    case 'unpause':
      return call('unpause', {});
    case 'reinstate':
      return call('reinstate_agent', { account_id: a });
    case 'allow':
      return call('add_to_allowlist', { account_id: a });
    case 'disallow':
      return call('remove_from_allowlist', { account_id: a });
    case 'limits':
      return call('set_agent_limits', { account_id: a, per_tx_limit: nearToYocto(b), daily_limit: nearToYocto(c) });
    case 'quarantine':
      return call('set_quarantine', { quarantine_secs: Number(a) });
    case 'cap':
      return call('set_vault_daily_limit', { vault_daily_limit: nearToYocto(a) });
    case 'fund':
      return call('deposit', {}, BigInt(nearToYocto(a)));
    case 'withdraw':
      return call('withdraw', { amount: nearToYocto(a), recipient: getConfig().ownerId });
    default:
      console.log('Unknown command. See the header of scripts/owner.ts for usage.');
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(cleanError(e));
  process.exit(1);
});
