/**
 * Runtime configuration, read lazily from process.env so CLI scripts can load
 * `.env` before the first call. Secrets are only ever read on the server.
 */
export function getConfig() {
  const env = process.env;
  const networkId = env.NEAR_NETWORK_ID || 'testnet';
  return {
    networkId,
    nodeUrl: env.NEAR_NODE_URL || (networkId === 'mainnet' ? 'https://free.rpc.fastnear.com' : 'https://test.rpc.fastnear.com'),
    explorer: networkId === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io',
    vaultId: env.VAULT_CONTRACT_ID || '',
    ownerId: env.OWNER_ACCOUNT_ID || '',
    /** Agent accounts: "id:privateKey" pairs. The first one is the default agent. */
    agents: parseAgents(env),
    x402: {
      payTo: env.X402_PAY_TO || '',
      priceYocto: env.X402_PRICE_YOCTO || '10000000000000000000000', // 0.01 NEAR
      secret: env.X402_SECRET || env.VAULT_CONTRACT_ID || 'warden-dev-secret',
    },
    nearAi: {
      baseUrl: env.NEAR_AI_BASE_URL || 'https://cloud-api.near.ai/v1',
      apiKey: env.NEAR_AI_API_KEY || '',
      model: env.NEAR_AI_MODEL || 'Qwen/Qwen3.6-35B-A3B-FP8',
      redTeamModel: env.NEAR_AI_REDTEAM_MODEL || 'Qwen/Qwen3.8-27B-abliterated',
    },
  };
}

export type WardenConfig = ReturnType<typeof getConfig>;

export interface AgentCredential {
  accountId: string;
  privateKey: string;
  role: string;
}

function parseAgents(env: NodeJS.ProcessEnv): AgentCredential[] {
  const out: AgentCredential[] = [];
  if (env.AGENT_ACCOUNT_ID && env.AGENT_PRIVATE_KEY) {
    out.push({ accountId: env.AGENT_ACCOUNT_ID, privateKey: env.AGENT_PRIVATE_KEY, role: 'payments' });
  }
  if (env.RESEARCH_AGENT_ACCOUNT_ID && env.RESEARCH_AGENT_PRIVATE_KEY) {
    out.push({
      accountId: env.RESEARCH_AGENT_ACCOUNT_ID,
      privateKey: env.RESEARCH_AGENT_PRIVATE_KEY,
      role: 'research',
    });
  }
  return out;
}
