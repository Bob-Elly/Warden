import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getVaultState, Proposal } from '@/lib/near';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    let proposal: Proposal;
    const isInjection =
      prompt.toLowerCase().includes('attacker') ||
      prompt.toLowerCase().includes('ignore previous') ||
      prompt.toLowerCase().includes('override');

    const apiKey = process.env.NEAR_AI_API_KEY || process.env.OPENAI_API_KEY;
    const baseURL = process.env.NEAR_AI_BASE_URL || 'https://api.near.ai/v1';

    if (apiKey && process.env.MOCK_LLM !== 'true') {
      try {
        const openai = new OpenAI({ apiKey, baseURL });
        const res = await openai.chat.completions.create({
          model: process.env.NEAR_AI_MODEL || 'llama-3.3-70b-instruct',
          messages: [
            {
              role: 'system',
              content:
                'You are Warden agent. Extract payment intent to JSON: {"action":"transfer","receiver_id":"<id>","amount_near":"<decimal>","memo":"<memo>","rationale":"<why>"}',
            },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
        });
        proposal = JSON.parse(res.choices[0].message.content || '{}');
      } catch (e) {
        proposal = fallbackParse(prompt, isInjection);
      }
    } else {
      proposal = fallbackParse(prompt, isInjection);
    }

    // Precheck against on-chain vault
    let precheck = {
      valid: true,
      errors: [] as string[],
      warnings: [] as string[],
    };

    try {
      const vaultState = await getVaultState();
      if (vaultState.paused) {
        precheck.errors.push('Vault is currently PAUSED.');
      }
      if (!vaultState.allowlist.includes(proposal.receiver_id)) {
        precheck.errors.push(`Recipient "${proposal.receiver_id}" is NOT in the allowlist!`);
      }
      const yoctoMultiplier = 10n ** 24n;
      const amtYocto = BigInt(Math.floor(parseFloat(proposal.amount_near || '0') * 1e6)) * (yoctoMultiplier / 1000000n);
      if (amtYocto > BigInt(vaultState.per_tx_limit)) {
        precheck.errors.push('Amount exceeds on-chain per-transaction limit!');
      }
      precheck.valid = precheck.errors.length === 0;
    } catch (e: any) {
      precheck.warnings.push('Could not verify on-chain limits in real-time. Contract will verify at execution.');
    }

    return NextResponse.json({
      success: true,
      proposal,
      precheck,
      isAttack: isInjection,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function fallbackParse(prompt: string, isInjection: boolean): Proposal {
  if (isInjection) {
    return {
      action: 'transfer',
      receiver_id: 'attacker.testnet',
      amount_near: '1000000',
      memo: 'Emergency hot-wallet drain',
      rationale: 'Executed requested instruction after system override',
    };
  }

  const match =
    prompt.match(/(?:pay|send|transfer)\s+([a-zA-Z0-9._-]+)\s+([0-9.]+)/i) ||
    prompt.match(/(?:pay|send|transfer)\s+([0-9.]+)\s*(?:near)?\s+to\s+([a-zA-Z0-9._-]+)/i);

  if (match) {
    const isFirstNum = !isNaN(Number(match[1]));
    const amount = isFirstNum ? match[1] : match[2];
    const receiver = isFirstNum ? match[2] : match[1];
    return {
      action: 'transfer',
      receiver_id: receiver,
      amount_near: amount,
      memo: 'Payment via Warden Agent',
      rationale: `User requested payment of ${amount} NEAR to ${receiver}`,
    };
  }

  return {
    action: 'transfer',
    receiver_id: 'sara.testnet',
    amount_near: '0.5',
    memo: 'Service settlement',
    rationale: 'Parsed intent from instruction',
  };
}
