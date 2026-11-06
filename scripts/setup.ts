/**
 * npm run setup
 *
 * Creates a complete, fresh Warden deployment on NEAR testnet in ~1 minute,
 * using only free testnet accounts from the NEAR testnet helper:
 *
 *   owner   - holds the owner key (stays on your machine, in .env)
 *   vault   - the Warden contract; its full-access key is DELETED after
 *             deploy, so nobody (not even the owner) can change the code
 *   agent   - "payments" agent; ends with ONLY a function-call key that can
 *             call execute_transfer / charge_subscription on the vault
 *   research- second agent with a smaller budget (multi-agent policies)
 *   api     - payee for the x402 paid-API demo
 *
 * Writes `.env` (secrets, gitignored) and `deployment.json` (public ids).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Account, KeyPair, connect, keyStores } from 'near-api-js';

const NETWORK = 'testnet';
const NODE_URL = process.env.NEAR_NODE_URL || 'https://test.rpc.fastnear.com';
const HELPER = 'https://helper.testnet.near.org/account';
const GAS = 100_000_000_000_000n;
const N = (near: number) => BigInt(Math.round(near * 1e6)) * 10n ** 18n; // NEAR -> yocto
const KEEP_VAULT_KEY = process.argv.includes('--keep-vault-key');
const WASM = resolve('contracts/vault/res/warden_vault.wasm');

const RECIPIENTS = ['sara.testnet', 'merchant.testnet'];

function suffix() {
  return Math.random().toString(36).slice(2, 7);
}

async function createAccount(accountId: string, key: KeyPair) {
  const res = await fetch(HELPER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`Could not create ${accountId}: ${res.status} ${await res.text()}`);
  console.log(`  ✓ created ${accountId}`);
}

/** Replace an account's full-access key with a vault-scoped function-call key. */
async function lockDownAgent(account: Account, fullKey: KeyPair, fcKey: KeyPair, vaultId: string, ownerId: string) {
  // Move most of the free testnet balance to the owner first: once the
  // full-access key is gone, the agent account can only spend gas.
  await account.sendMoney(ownerId, N(8));
  await account.addKey(fcKey.getPublicKey(), vaultId, ['execute_transfer', 'charge_subscription'], N(0.5));
  await account.deleteKey(fullKey.getPublicKey());
  console.log(`  ✓ ${account.accountId}: full-access key deleted, function-call key → ${vaultId}`);
}

async function main() {
  if (!existsSync(WASM)) throw new Error(`Missing ${WASM}. Run npm run build:contract first.`);
  if (existsSync('.env') && !process.argv.includes('--force')) {
    throw new Error('.env already exists. Re-run with --force to create a new deployment (the old .env is overwritten).');
  }
  const s = suffix();
  const ids = {
    owner: `warden-owner-${s}.testnet`,
    vault: `warden-vault-${s}.testnet`,
    agent: `warden-agent-${s}.testnet`,
    research: `warden-research-${s}.testnet`,
    api: `warden-api-${s}.testnet`,
  };
  const keys = Object.fromEntries(Object.keys(ids).map((k) => [k, KeyPair.fromRandom('ed25519')])) as Record<
    keyof typeof ids,
    KeyPair
  >;
  const agentFc = KeyPair.fromRandom('ed25519');
  const researchFc = KeyPair.fromRandom('ed25519');
  const x402Secret = createHash('sha256').update(KeyPair.fromRandom('ed25519').toString()).digest('hex').slice(0, 32);
  writeFileSync('.env', envFile(ids, keys, agentFc, researchFc, x402Secret));
  console.log('\nKeys saved to .env (gitignored) before any transaction.');

  console.log('\n[1/5] Creating testnet accounts (free, via helper.testnet.near.org)');
  for (const k of Object.keys(ids) as (keyof typeof ids)[]) await createAccount(ids[k], keys[k]);

  const keyStore = new keyStores.InMemoryKeyStore();
  for (const k of Object.keys(ids) as (keyof typeof ids)[]) await keyStore.setKey(NETWORK, ids[k], keys[k]);
  const near = await connect({ networkId: NETWORK, nodeUrl: NODE_URL, keyStore } as any);
  const acct = async (id: string) => near.account(id);
  // Give the RPC a moment to see the new accounts.
  await new Promise((r) => setTimeout(r, 3000));

  console.log('\n[2/5] Deploying and initializing the vault');
  const vault = await acct(ids.vault);
  await vault.deployContract(readFileSync(WASM));
  await vault.functionCall({
    contractId: ids.vault,
    methodName: 'init',
    args: { owner_id: ids.owner, vault_daily_limit: N(3).toString() },
    gas: GAS,
  });
  console.log(`  ✓ ${ids.vault} deployed, owner ${ids.owner}, vault-wide cap 3 NEAR / 24h`);

  console.log('\n[3/5] Owner configures policy');
  const owner = await acct(ids.owner);
  const call = (methodName: string, args: object, deposit = 0n) =>
    owner.functionCall({ contractId: ids.vault, methodName, args, gas: GAS, attachedDeposit: deposit });
  await call('add_agent', { account_id: ids.agent, label: 'payments', per_tx_limit: N(0.5).toString(), daily_limit: N(2).toString() });
  await call('add_agent', { account_id: ids.research, label: 'research', per_tx_limit: N(0.05).toString(), daily_limit: N(0.2).toString() });
  for (const r of [...RECIPIENTS, ids.api]) await call('add_to_allowlist', { account_id: r });
  await call('add_subscription', { label: 'Cloud hosting', receiver_id: 'sara.testnet', amount: N(0.05).toString(), interval_secs: 3600 });
  await call('add_subscription', { label: 'Merchant API plan', receiver_id: 'merchant.testnet', amount: N(0.02).toString(), interval_secs: 86400 });
  await call('deposit', {}, N(5));
  console.log('  ✓ agents: payments (0.5/tx, 2/day), research (0.05/tx, 0.2/day)');
  console.log(`  ✓ allowlist: ${[...RECIPIENTS, ids.api].join(', ')}`);
  console.log('  ✓ subscriptions: Cloud hosting (0.05 NEAR hourly), Merchant API plan (0.02 NEAR daily)');
  console.log('  ✓ owner deposited 5 NEAR');

  console.log('\n[4/5] Locking down keys');
  await lockDownAgent(await acct(ids.agent), keys.agent, agentFc, ids.vault, ids.owner);
  await lockDownAgent(await acct(ids.research), keys.research, researchFc, ids.vault, ids.owner);
  if (!KEEP_VAULT_KEY) {
    await vault.deleteKey(keys.vault.getPublicKey());
    console.log(`  ✓ ${ids.vault}: full-access key deleted. The contract can no longer be changed by anyone.`);
  }

  console.log('\n[5/5] Writing deployment.json');
  writeFileSync('.env', envFile(ids, keys, agentFc, researchFc, x402Secret).replace(/^# SETUP IN PROGRESS.*\n/m, ''));
  const deployment = {
    network: 'testnet',
    createdAt: new Date().toISOString(),
    vault: ids.vault,
    owner: ids.owner,
    agents: { payments: ids.agent, research: ids.research },
    x402PayTo: ids.api,
    allowlist: [...RECIPIENTS, ids.api],
    vaultLocked: !KEEP_VAULT_KEY,
    wasmSha256: createHash('sha256').update(readFileSync(WASM)).digest('hex'),
  };
  writeFileSync('deployment.json', JSON.stringify(deployment, null, 2) + '\n');

  console.log(`
Done. Warden is live on NEAR testnet:
  Vault : https://testnet.nearblocks.io/address/${ids.vault}
  Agent : https://testnet.nearblocks.io/address/${ids.agent}  (check the Keys tab: function-call only)

Next:
  npm run demo:attack   # live attack demo against this vault
  npm run dev           # web app on http://localhost:3000
`);
}

type Ids = Record<'owner' | 'vault' | 'agent' | 'research' | 'api', string>;

/**
 * Written BEFORE the first transaction, so an interrupted run never loses keys.
 * The SETUP_* keys are the original full-access keys; they are deleted on-chain
 * during lock-down and are only kept here to resume or debug a failed run.
 */
function envFile(ids: Ids, keys: Record<keyof Ids, KeyPair>, agentFc: KeyPair, researchFc: KeyPair, x402Secret: string) {
  return `# SETUP IN PROGRESS: if npm run setup was interrupted, re-run it with --force.
# Generated by npm run setup on ${new Date().toISOString()}. NEVER COMMIT THIS FILE.
NEAR_NETWORK_ID=testnet
NEAR_NODE_URL=${NODE_URL}
VAULT_CONTRACT_ID=${ids.vault}

# Owner key: only used by scripts/owner.ts on your machine. Do NOT put it on a server.
OWNER_ACCOUNT_ID=${ids.owner}
OWNER_PRIVATE_KEY=${keys.owner.toString()}

# Agent keys: function-call keys, scoped to ${ids.vault} (execute_transfer, charge_subscription).
AGENT_ACCOUNT_ID=${ids.agent}
AGENT_PRIVATE_KEY=${agentFc.toString()}
RESEARCH_AGENT_ACCOUNT_ID=${ids.research}
RESEARCH_AGENT_PRIVATE_KEY=${researchFc.toString()}

# x402 paid-API demo
X402_PAY_TO=${ids.api}
X402_SECRET=${x402Secret}

# NEAR AI Cloud (optional). Without a key the agent uses a deterministic local parser.
NEAR_AI_API_KEY=
NEAR_AI_MODEL=Qwen/Qwen3.6-35B-A3B-FP8
NEAR_AI_REDTEAM_MODEL=Qwen/Qwen3.8-27B-abliterated

# Original full-access keys, deleted on-chain during setup. Kept only for debugging.
SETUP_VAULT_KEY=${keys.vault.toString()}
SETUP_AGENT_KEY=${keys.agent.toString()}
SETUP_RESEARCH_KEY=${keys.research.toString()}
SETUP_API_KEY=${keys.api.toString()}
`;
}

main().catch((e) => {
  console.error('\nSetup failed:', e?.message ?? e);
  process.exit(1);
});
