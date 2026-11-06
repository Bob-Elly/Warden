/**
 * npm run setup                 create a new owner (testnet helper) and a full deployment
 * npm run setup -- --reuse-owner  use OWNER_ACCOUNT_ID / OWNER_PRIVATE_KEY from the current .env
 *
 * Everything except the owner is created as a SUB-ACCOUNT of the owner, in
 * single transactions signed by the owner:
 *
 *   vault-<id>.<owner>     created, funded, deployed and initialized in ONE
 *                          transaction and never given an access key, so nobody
 *                          (not even the owner) can change its code
 *   payments-<id>.<owner>  agent, created holding ONLY a function-call key scoped
 *                          to the vault's agent methods (it never had a full key)
 *   research-<id>.<owner>  second agent with a smaller budget
 *   api-<id>.<owner>       payee for the x402 paid-API demo
 *
 * Writes `.env` (secrets, gitignored) before the first transaction, and
 * `deployment.json` (public ids) at the end.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import 'dotenv/config';
import { Account, KeyPair, connect, keyStores, transactions } from 'near-api-js';

const NETWORK = 'testnet';
const NODE_URL = process.env.NEAR_NODE_URL?.includes('rpc.testnet.near.org')
  ? 'https://test.rpc.fastnear.com'
  : process.env.NEAR_NODE_URL || 'https://test.rpc.fastnear.com';
const HELPER = 'https://helper.testnet.near.org/account';
const GAS = 100_000_000_000_000n;
const N = (near: number) => BigInt(Math.round(near * 1e6)) * 10n ** 18n; // NEAR -> yocto
const KEEP_VAULT_KEY = process.argv.includes('--keep-vault-key');
const REUSE_OWNER = process.argv.includes('--reuse-owner');
const WASM = resolve('contracts/vault/res/warden_vault.wasm');

const RECIPIENTS = ['sara.testnet', 'merchant.testnet'];
/** Circle's USDC on NEAR testnet (6 decimals). Get test USDC at https://faucet.circle.com */
const USDC = process.env.USDC_TOKEN_ID || '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';
const USD = (n: number) => BigInt(Math.round(n * 1e6)).toString();
/** Demo quarantine: a suspended agent is reinstated after this many seconds. 0 = owner only. */
const QUARANTINE_SECS = Number(process.env.QUARANTINE_SECS ?? 60);
const AGENT_METHODS = ['execute_transfer', 'execute_ft_transfer', 'charge_subscription'];

type Ids = Record<'owner' | 'vault' | 'agent' | 'research' | 'api', string>;

function suffix() {
  return Math.random().toString(36).slice(2, 7);
}

async function createWithHelper(accountId: string, key: KeyPair) {
  const res = await fetch(HELPER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
  });
  if (!res.ok) {
    throw new Error(
      `Could not create ${accountId}: ${res.status} ${await res.text()}\n` +
        'If the helper is rate-limited and you already have an owner in .env, run: npm run setup -- --force --reuse-owner'
    );
  }
  console.log(`  ✓ created ${accountId} (testnet helper)`);
}

/** The owner signs one transaction whose receiver is a new sub-account. */
async function ownerTx(owner: Account, receiverId: string, actions: transactions.Action[]) {
  return (owner as any).signAndSendTransaction({ receiverId, actions });
}

async function main() {
  if (!existsSync(WASM)) throw new Error(`Missing ${WASM}. Run npm run build:contract first.`);
  if (existsSync('.env') && !process.argv.includes('--force')) {
    throw new Error('.env already exists. Re-run with --force to create a new deployment (the old .env is overwritten).');
  }

  const s = suffix();
  let ownerId: string;
  let ownerKey: KeyPair;
  if (REUSE_OWNER) {
    if (!process.env.OWNER_ACCOUNT_ID || !process.env.OWNER_PRIVATE_KEY) throw new Error('--reuse-owner needs OWNER_ACCOUNT_ID and OWNER_PRIVATE_KEY in .env');
    ownerId = process.env.OWNER_ACCOUNT_ID;
    ownerKey = KeyPair.fromString(process.env.OWNER_PRIVATE_KEY as any);
  } else {
    ownerId = `warden-owner-${s}.testnet`;
    ownerKey = KeyPair.fromRandom('ed25519');
  }
  const ids: Ids = {
    owner: ownerId,
    vault: `vault-${s}.${ownerId}`,
    agent: `payments-${s}.${ownerId}`,
    research: `research-${s}.${ownerId}`,
    api: `api-${s}.${ownerId}`,
  };
  const agentFc = KeyPair.fromRandom('ed25519');
  const researchFc = KeyPair.fromRandom('ed25519');
  const apiKey = KeyPair.fromRandom('ed25519');
  const x402Secret = createHash('sha256').update(KeyPair.fromRandom('ed25519').toString()).digest('hex').slice(0, 32);
  const nearAiKey = process.env.NEAR_AI_API_KEY ?? '';
  writeFileSync('.env', envFile(ids, ownerKey, agentFc, researchFc, apiKey, x402Secret, nearAiKey, true));
  console.log('\nKeys saved to .env (gitignored) before any transaction.');

  console.log('\n[1/4] Owner account');
  if (!REUSE_OWNER) await createWithHelper(ids.owner, ownerKey);
  else console.log(`  ✓ reusing ${ids.owner}`);

  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(NETWORK, ids.owner, ownerKey);
  const near = await connect({ networkId: NETWORK, nodeUrl: NODE_URL, keyStore } as any);
  if (!REUSE_OWNER) await new Promise((r) => setTimeout(r, 3000));
  const owner = await near.account(ids.owner);

  console.log('\n[2/4] Vault: create + fund + deploy + init in one transaction');
  const vaultActions = [
    transactions.createAccount(),
    transactions.transfer(N(9)),
    transactions.deployContract(readFileSync(WASM)),
    transactions.functionCall(
      'init',
      { owner_id: ids.owner, vault_daily_limit: N(3).toString(), quarantine_secs: QUARANTINE_SECS },
      GAS,
      0n
    ),
  ];
  if (KEEP_VAULT_KEY) vaultActions.push(transactions.addKey(ownerKey.getPublicKey(), transactions.fullAccessKey()));
  await ownerTx(owner, ids.vault, vaultActions);
  console.log(`  ✓ ${ids.vault}: deployed with ${KEEP_VAULT_KEY ? 'an owner key (upgradeable)' : 'NO access key (code locked forever)'}`);
  console.log(`    cap 3 NEAR / 24h, quarantine ${QUARANTINE_SECS}s`);

  console.log('\n[3/4] Agents and payee (sub-accounts)');
  for (const [id, key] of [
    [ids.agent, agentFc],
    [ids.research, researchFc],
  ] as const) {
    await ownerTx(owner, id, [
      transactions.createAccount(),
      transactions.transfer(N(1)),
      transactions.addKey(key.getPublicKey(), transactions.functionCallAccessKey(ids.vault, AGENT_METHODS, N(0.5))),
    ]);
    console.log(`  ✓ ${id}: created with ONLY a function-call key → ${ids.vault} [${AGENT_METHODS.join(', ')}]`);
  }
  await ownerTx(owner, ids.api, [
    transactions.createAccount(),
    transactions.transfer(N(0.1)),
    transactions.addKey(apiKey.getPublicKey(), transactions.fullAccessKey()),
  ]);
  console.log(`  ✓ ${ids.api}: x402 payee`);

  console.log('\n[4/4] Owner configures policy');
  const call = (methodName: string, args: object, deposit = 0n) =>
    owner.functionCall({ contractId: ids.vault, methodName, args, gas: GAS, attachedDeposit: deposit });
  await call('add_agent', { account_id: ids.agent, label: 'payments', per_tx_limit: N(0.5).toString(), daily_limit: N(2).toString() });
  await call('add_agent', { account_id: ids.research, label: 'research', per_tx_limit: N(0.05).toString(), daily_limit: N(0.2).toString() });
  for (const r of [...RECIPIENTS, ids.api]) await call('add_to_allowlist', { account_id: r });

  // Stablecoin: register the vault and the recipients on the USDC contract
  // (NEP-145 storage), then let agents pay USDC within its own limits.
  const bounds: any = await owner.viewFunction({ contractId: USDC, methodName: 'storage_balance_bounds', args: {} });
  for (const who of [ids.vault, ...RECIPIENTS]) {
    const bal = await owner.viewFunction({ contractId: USDC, methodName: 'storage_balance_of', args: { account_id: who } });
    if (bal) continue;
    await owner.functionCall({
      contractId: USDC,
      methodName: 'storage_deposit',
      args: { account_id: who, registration_only: true },
      gas: GAS,
      attachedDeposit: BigInt(bounds.min),
    });
  }
  await call('add_token', { token_id: USDC, symbol: 'USDC', decimals: 6, per_tx_limit: USD(2), daily_limit: USD(10) });
  await call('add_subscription', { label: 'Cloud hosting', receiver_id: 'sara.testnet', amount: N(0.05).toString(), interval_secs: 3600 });
  await call('add_subscription', { label: 'Contractor payroll', receiver_id: 'merchant.testnet', amount: USD(1), interval_secs: 604800, token: USDC });
  console.log('  ✓ agents: payments (0.5/tx, 2/day), research (0.05/tx, 0.2/day)');
  console.log(`  ✓ allowlist: ${[...RECIPIENTS, ids.api].join(', ')}`);
  console.log('  ✓ USDC (Circle testnet): 2 USDC per payment, 10 USDC per day; vault and recipients registered');
  console.log('  ✓ subscriptions: Cloud hosting (0.05 NEAR hourly), Contractor payroll (1 USDC weekly)');

  writeFileSync('.env', envFile(ids, ownerKey, agentFc, researchFc, apiKey, x402Secret, nearAiKey, false));
  const deployment = {
    network: 'testnet',
    createdAt: new Date().toISOString(),
    vault: ids.vault,
    owner: ids.owner,
    agents: { payments: ids.agent, research: ids.research },
    x402PayTo: ids.api,
    allowlist: [...RECIPIENTS, ids.api],
    vaultLocked: !KEEP_VAULT_KEY,
    quarantineSecs: QUARANTINE_SECS,
    tokens: { USDC },
    wasmSha256: createHash('sha256').update(readFileSync(WASM)).digest('hex'),
  };
  writeFileSync('deployment.json', JSON.stringify(deployment, null, 2) + '\n');

  console.log(`
Done. Warden is live on NEAR testnet:
  Vault : https://testnet.nearblocks.io/address/${ids.vault}
  Agent : https://testnet.nearblocks.io/address/${ids.agent}  (check the Keys tab: function-call only)

Fund the vault with test USDC for the stablecoin demo:
  https://faucet.circle.com  ->  USDC, NEAR Testnet, address: ${ids.vault}

Next:
  npm run verify        # read-only security checks
  npm run demo:attack   # live attack demo against this vault
  npm run dev           # web app on http://localhost:3000
`);
}

function envFile(
  ids: Ids,
  ownerKey: KeyPair,
  agentFc: KeyPair,
  researchFc: KeyPair,
  apiKey: KeyPair,
  x402Secret: string,
  nearAiKey: string,
  inProgress: boolean
) {
  return `${inProgress ? '# SETUP IN PROGRESS: if npm run setup was interrupted, re-run it with --force --reuse-owner.\n' : ''}# Generated by npm run setup on ${new Date().toISOString()}. NEVER COMMIT THIS FILE.
NEAR_NETWORK_ID=testnet
NEAR_NODE_URL=${NODE_URL}
VAULT_CONTRACT_ID=${ids.vault}

# Owner key: only used by scripts/owner.ts on your machine. Do NOT put it on a server.
OWNER_ACCOUNT_ID=${ids.owner}
OWNER_PRIVATE_KEY=${ownerKey.toString()}

# Agent keys: function-call keys, scoped to ${ids.vault} (${AGENT_METHODS.join(', ')}).
AGENT_ACCOUNT_ID=${ids.agent}
AGENT_PRIVATE_KEY=${agentFc.toString()}
RESEARCH_AGENT_ACCOUNT_ID=${ids.research}
RESEARCH_AGENT_PRIVATE_KEY=${researchFc.toString()}

# x402 paid-API demo
X402_PAY_TO=${ids.api}
X402_SECRET=${x402Secret}
X402_PAYEE_KEY=${apiKey.toString()}

# NEAR AI Cloud (optional). Without a key the agent uses a deterministic local parser.
NEAR_AI_API_KEY=${nearAiKey}
NEAR_AI_MODEL=Qwen/Qwen3.6-35B-A3B-FP8
NEAR_AI_REDTEAM_MODEL=Qwen/Qwen3.8-27B-abliterated
`;
}

main().catch((e) => {
  console.error('\nSetup failed:', e?.message ?? e);
  process.exit(1);
});
