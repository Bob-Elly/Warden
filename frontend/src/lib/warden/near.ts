import { Account, KeyPair, connect, keyStores, providers } from 'near-api-js';
import { getConfig, type AgentCredential } from './config';
import type { AccessKeyView } from './types';

let provider: providers.JsonRpcProvider | null = null;

export function rpc(): providers.JsonRpcProvider {
  if (!provider) provider = new providers.JsonRpcProvider({ url: getConfig().nodeUrl });
  return provider;
}

export async function view<T>(contractId: string, methodName: string, args: Record<string, unknown> = {}): Promise<T> {
  const res: any = await rpc().query({
    request_type: 'call_function',
    finality: 'optimistic',
    account_id: contractId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(res.result).toString()) as T;
}

export async function accessKeys(accountId: string): Promise<AccessKeyView[]> {
  const res: any = await rpc().query({ request_type: 'view_access_key_list', finality: 'optimistic', account_id: accountId });
  return res.keys.map((k: any) => ({ public_key: k.public_key, permission: k.access_key.permission }));
}

const accounts = new Map<string, Account>();

/** An Account object signing with the given (function-call) key. */
export async function accountFor(cred: AgentCredential): Promise<Account> {
  const cached = accounts.get(cred.accountId);
  if (cached) return cached;
  const cfg = getConfig();
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(cfg.networkId, cred.accountId, KeyPair.fromString(cred.privateKey as any));
  const near = await connect({ networkId: cfg.networkId, nodeUrl: cfg.nodeUrl, keyStore } as any);
  const account = await near.account(cred.accountId);
  accounts.set(cred.accountId, account);
  return account;
}

/** Pull NEP-297 events with standard "warden" out of transaction logs. */
export function parseEvents(logs: string[]): { event: string; data: Record<string, unknown> }[] {
  const out: { event: string; data: Record<string, unknown> }[] = [];
  for (const line of logs) {
    if (!line.startsWith('EVENT_JSON:')) continue;
    try {
      const j = JSON.parse(line.slice('EVENT_JSON:'.length));
      if (j.standard === 'warden') out.push({ event: j.event, data: j.data ?? {} });
    } catch {
      /* ignore non-JSON logs */
    }
  }
  return out;
}

export function collectLogs(outcome: any): string[] {
  const logs: string[] = [...(outcome?.transaction_outcome?.outcome?.logs ?? [])];
  for (const r of outcome?.receipts_outcome ?? []) logs.push(...(r.outcome?.logs ?? []));
  return logs;
}

export function lastResult<T>(outcome: any): T | null {
  try {
    return providers.getTransactionLastResult(outcome) as T;
  } catch {
    return null;
  }
}
