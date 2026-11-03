import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { connect, keyStores, KeyPair } from 'near-api-js';

const NETWORK_ID = 'testnet';
const NODE_URL = 'https://rpc.testnet.near.org';
const HELPER_URL = 'https://helper.testnet.near.org/account';

function randomSuffix() {
  return Math.random().toString(36).substring(2, 7);
}

async function createFundedAccount(accountId, keyPair) {
  console.log(`[1/3] Creating and funding ${accountId} on NEAR Testnet...`);
  const response = await fetch(HELPER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: keyPair.getPublicKey().toString(),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create account ${accountId}: ${errText}`);
  }

  const result = await response.json();
  console.log(`✓ Account ${accountId} created successfully! (10 NEAR funded)`);
  return result;
}

async function main() {
  console.log('='.repeat(70));
  console.log('  WARDEN TESTNET AUTO-SETUP & DEPLOYMENT');
  console.log('='.repeat(70));
  console.log();

  const suffix = randomSuffix();
  const ownerId = `warden-owner-${suffix}.testnet`;
  const vaultId = `warden-vault-${suffix}.testnet`;
  const agentId = `warden-agent-${suffix}.testnet`;

  const ownerKeyPair = KeyPair.fromRandom('ed25519');
  const vaultKeyPair = KeyPair.fromRandom('ed25519');
  const agentKeyPair = KeyPair.fromRandom('ed25519');

  // Step 1: Create all three accounts pre-funded with 10 NEAR each
  await createFundedAccount(ownerId, ownerKeyPair);
  await createFundedAccount(vaultId, vaultKeyPair);
  await createFundedAccount(agentId, agentKeyPair);

  // Set up keystore
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(NETWORK_ID, ownerId, ownerKeyPair);
  await keyStore.setKey(NETWORK_ID, vaultId, vaultKeyPair);
  await keyStore.setKey(NETWORK_ID, agentId, agentKeyPair);

  const near = await connect({
    networkId: NETWORK_ID,
    nodeUrl: NODE_URL,
    keyStore,
  });

  // Step 2: Deploy Vault Contract to vaultId
  console.log('\n[2/3] Deploying Warden Vault Wasm to', vaultId, '...');
  const wasmPath = resolve(process.cwd(), 'contracts/vault/target/wasm32-unknown-unknown/release/warden_vault.wasm');
  const wasmBytes = readFileSync(wasmPath);

  const vaultAccount = await near.account(vaultId);
  await vaultAccount.deployContract(wasmBytes);
  console.log('✓ Vault Wasm deployed successfully!');

  // Step 3: Initialize Vault Contract
  console.log('\n[3/3] Initializing Vault rules on-chain...');
  const yoctoMultiplier = 10n ** 24n;
  const perTxLimit = (5n * yoctoMultiplier).toString(); // 5 NEAR
  const dailyLimit = (20n * yoctoMultiplier).toString(); // 20 NEAR

  // Initialize
  await vaultAccount.functionCall({
    contractId: vaultId,
    methodName: 'init',
    args: {
      owner_id: ownerId,
      per_tx_limit: perTxLimit,
      daily_limit: dailyLimit,
    },
    gas: 30000000000000n,
  });
  console.log(`✓ Vault initialized! Owner: ${ownerId}, Per-tx: 5 NEAR, Daily: 20 NEAR`);

  // Owner adds agent to vault
  const ownerAccount = await near.account(ownerId);
  console.log(`Adding agent ${agentId} to vault authorized agents...`);
  await ownerAccount.functionCall({
    contractId: vaultId,
    methodName: 'add_agent',
    args: {
      account_id: agentId,
      public_key: null,
    },
    gas: 30000000000000n,
  });
  console.log(`✓ Agent ${agentId} registered in vault.`);

  // Owner adds default allowlist
  console.log('Adding "sara.testnet" and "merchant.testnet" to allowlist...');
  await ownerAccount.functionCall({
    contractId: vaultId,
    methodName: 'add_to_allowlist',
    args: { account_id: 'sara.testnet' },
    gas: 30000000000000n,
  });
  await ownerAccount.functionCall({
    contractId: vaultId,
    methodName: 'add_to_allowlist',
    args: { account_id: 'merchant.testnet' },
    gas: 30000000000000n,
  });
  console.log('✓ Allowlist configured.');

  // Owner deposits 3 NEAR into vault for transfers
  console.log('Funding vault with 3 NEAR initial operational balance...');
  await ownerAccount.functionCall({
    contractId: vaultId,
    methodName: 'deposit',
    args: {},
    gas: 30000000000000n,
    attachedDeposit: 3000000000000000000000000n, // 3 NEAR
  });
  console.log('✓ Vault funded with 3 NEAR.');

  // Write .env
  const envContent = `# NEAR Network Configuration
NEAR_NETWORK_ID=testnet
NEAR_NODE_URL=https://rpc.testnet.near.org

# Vault Account Details
VAULT_CONTRACT_ID=${vaultId}
OWNER_ACCOUNT_ID=${ownerId}
OWNER_PRIVATE_KEY=${ownerKeyPair.toString()}

# Restricted Agent Key
AGENT_ACCOUNT_ID=${agentId}
AGENT_PRIVATE_KEY=${agentKeyPair.toString()}

# LLM Inference (NEAR AI Cloud / OpenAI compatible)
NEAR_AI_BASE_URL=https://api.near.ai/v1
NEAR_AI_API_KEY=
NEAR_AI_MODEL=llama-3.3-70b-instruct

# Demo Mocking (Set to true to use offline mock LLM parser)
MOCK_LLM=true
`;

  writeFileSync(resolve(process.cwd(), '.env'), envContent, 'utf-8');
  console.log('\n✓ Configuration saved to .env (gitignored)');

  console.log('\n' + '='.repeat(70));
  console.log('  SETUP COMPLETE! WARDEN IS LIVE ON NEAR TESTNET');
  console.log('='.repeat(70));
  console.log(`Vault Contract : https://testnet.nearblocks.io/address/${vaultId}`);
  console.log(`Owner Account  : https://testnet.nearblocks.io/address/${ownerId}`);
  console.log(`Agent Account  : https://testnet.nearblocks.io/address/${agentId}`);
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('\nSetup failed:', err);
  process.exit(1);
});
