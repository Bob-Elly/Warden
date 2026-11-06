import { proposeTransfer, type ProposeInput, type ProposeResult } from './llm';
import { predict } from './policy';
import { defaultAgent, executeTransfer, getSnapshot } from './vault';
import type { ExecutionOutcome, Proposal } from './types';
import { getConfig } from './config';
import { REASONS, fmtNear } from './reasons';
export { REASONS };

export interface TraceStep {
  id: 'llm' | 'precheck' | 'submit' | 'verdict' | 'x402' | 'resource';
  title: string;
  detail: string;
  status: 'ok' | 'warn' | 'fail' | 'info';
}

export interface AgentRun {
  input: ProposeInput & { agentRole?: string };
  llm?: ProposeResult;
  precheck?: ReturnType<typeof predict>;
  outcome?: ExecutionOutcome;
  trace: TraceStep[];
  error?: string;
}

/**
 * One full agent turn: the LLM proposes, the agent pre-checks, then submits to
 * the vault with its function-call key. The agent always submits, even when
 * its own pre-check says "blocked": we want the vault, not the agent, to be
 * the thing that says no. A compromised server would skip the pre-check anyway.
 */
export async function runAgent(input: ProposeInput & { agentRole?: string }): Promise<AgentRun> {
  const run: AgentRun = { input, trace: [] };
  const cred = defaultAgent(input.agentRole);

  try {
    run.llm = await proposeTransfer(input);
  } catch (e: any) {
    run.error = e?.message ?? String(e);
    run.trace.push({ id: 'llm', title: 'Agent could not form a proposal', detail: run.error!, status: 'fail' });
    return run;
  }
  const p = run.llm.proposal;
  run.trace.push({
    id: 'llm',
    title: `Proposal: ${fmtNear(p.amount_near)} ${p.token || 'NEAR'} → ${p.receiver_id}`,
    detail:
      run.llm.engine === 'near-ai-cloud'
        ? `${run.llm.model} on NEAR AI Cloud (TEE), ${run.llm.latencyMs} ms${run.llm.tee?.valid ? ', response signature verified' : ''}`
        : run.llm.warning ?? 'Local parser',
    status: input.mode === 'redteam' ? 'warn' : 'ok',
  });

  try {
    const snap = await getSnapshot();
    run.precheck = predict(p, snap, cred.accountId);
    run.trace.push({
      id: 'precheck',
      title:
        run.precheck.prediction === 'auto'
          ? 'Pre-check: within limits'
          : run.precheck.prediction === 'needs_approval'
            ? 'Pre-check: needs owner approval'
            : 'Pre-check: the vault will block this',
      detail: run.precheck.reasons.join('; ') + '. Advisory only, so the agent submits anyway.',
      status: run.precheck.prediction === 'auto' ? 'ok' : run.precheck.prediction === 'blocked' ? 'warn' : 'info',
    });
  } catch (e: any) {
    run.trace.push({ id: 'precheck', title: 'Pre-check skipped', detail: e?.message ?? String(e), status: 'info' });
  }

  run.trace.push({
    id: 'submit',
    title: 'Submitted to the vault',
    detail: `${cred.accountId} signs execute_transfer with a function-call key (receiver: ${getConfig().vaultId})`,
    status: 'info',
  });

  run.outcome = await executeTransfer(p, cred);
  run.trace.push(verdictStep(run.outcome));
  return run;
}

export function verdictStep(o: ExecutionOutcome): TraceStep {
  switch (o.status) {
    case 'executed':
      return { id: 'verdict', title: 'Vault executed the payment', detail: 'All on-chain rules passed', status: 'ok' };
    case 'pending_approval':
      return {
        id: 'verdict',
        title: `Vault queued it for owner approval (#${o.requestId})`,
        detail: `${REASONS[o.reason ?? ''] ?? o.reason}. Nothing moves until the owner signs.`,
        status: 'info',
      };
    case 'rejected':
      return {
        id: 'verdict',
        title: 'Vault blocked it on-chain',
        detail:
          `${REASONS[o.reason ?? ''] ?? o.reason}${o.strikes ? `. Strike ${o.strikes} recorded against the agent.` : ''}` +
          (o.suspendedUntilMs
            ? ` That was the last strike: the agent is suspended on-chain until its quarantine ends (${Math.round((o.suspendedUntilMs - Date.now()) / 1000)} s).`
            : ''),
        status: 'fail',
      };
    default:
      return { id: 'verdict', title: 'Transaction failed', detail: o.error ?? 'Unknown error', status: 'fail' };
  }
}



export type { Proposal };
