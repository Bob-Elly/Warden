# Warden

**The agent wallet where the AI never holds the keys.**

Warden lets an AI agent make payments without being able to lose your money. Funds live in a NEAR smart contract (the vault). The agent only holds a NEAR **function-call access key** that can call two methods on that one contract. Every rule (allowlist, per-agent budgets, a vault-wide cap, owner approval above limits, automatic suspension after repeated bad requests) is enforced on-chain. If the LLM is prompt-injected or the server is taken over, the worst case is bounded by rules the agent cannot change.

Built at NEAR HACKATHON (Nov 1–14, 2026) by Bob-Elly ([GitHub](https://github.com/Bob-Elly)) and NECO ([GitHub: NECOKIZZ](https://github.com/NECOKIZZ)). MIT licensed.

- Live app: https://warden-near.vercel.app
- Live vault (testnet): [`warden-vault-5gx6t.testnet`](https://testnet.nearblocks.io/address/warden-vault-5gx6t.testnet)
- Agent account: [`warden-agent-5gx6t.testnet`](https://testnet.nearblocks.io/address/warden-agent-5gx6t.testnet) (Access Keys tab: one function-call key, no full-access key)

## The problem

Most agent wallets give the LLM a private key. One prompt injection (a poisoned email, web page or tool result) or one server breach, and the wallet is drained. Guardrails written in the prompt or in the agent's own code do not help, because they run in the same place the attacker controls.

## How Warden works

```
 user / documents ──► LLM (NEAR AI Cloud, TEE) ──► proposal {to, amount, memo}
                                                        │
                       agent server signs with a FUNCTION-CALL key
                       (receiver: vault, methods: execute_transfer, charge_subscription)
                                                        ▼
 ┌──────────────────────── Warden vault contract (Rust, near-sdk 5.30) ───────────────────────┐
 │ registered agent? ─► vault paused? ─► agent suspended? ─► recipient on allowlist?          │
 │       │                                                    no ─► REJECTED + strike (3 = suspend)
 │       ▼                                                                                    │
 │ within agent per-tx limit, agent daily budget, vault-wide daily cap?                       │
 │       yes ─► EXECUTED (transfer)          no ─► PENDING_APPROVAL (owner signs or rejects)  │
 └─── every outcome is stored in an on-chain activity log and emitted as a NEP-297 event ─────┘
```

The vault answers an agent with `executed`, `pending_approval` or `rejected` instead of panicking. That lets it write rejections to state: anyone can read the attack log and strike counts with a view call.

Security properties you can check yourself on testnet:

| Property | How it is enforced | How to check |
| --- | --- | --- |
| The agent cannot send NEAR directly | The agent account has no full-access key, only a function-call key | `npm run verify`, or the account's Access Keys tab on NearBlocks |
| The agent cannot change rules or withdraw | The function-call key only allows `execute_transfer` and `charge_subscription`. Owner methods check `predecessor == owner` | `npm run demo:attack` step 4 |
| Nobody can swap the contract code | `npm run setup` deletes the vault account's own full-access key after deploy | `npm run verify`: "vault account has no full-access key" |
| Payments only go to approved recipients | On-chain allowlist | Demo step 2 |
| Spending is bounded | Per-agent per-tx limit and 24h budget, plus a vault-wide 24h cap across all agents | Demo step 3, contract tests |
| A hijacked agent gets shut off | 3 blocked attempts suspend the agent; only the owner can reinstate | Run step 2 three times, or `agent_is_suspended_after_strike_limit` test |
| Big payments need a human | Over-limit requests are stored as pending; only the owner key can approve | Demo step 3, then `npm run owner -- approve <id>` |

## Try it in the browser (2 minutes, nothing to install)

Open https://warden-near.vercel.app. Everything on the page is read live from NEAR testnet.

1. Check the four cards at the top. Expected: "Agent keys: function-call only, vault-scoped" and "Vault contract: locked". Both are read from RPC (`view_access_key_list`).
2. Click **Step 1 Routine payment**. Expected: a green "Paid" result with a transaction link. The payments agent's "Today" bar on the right goes up by 0.1 NEAR.
3. Click **Step 2 Over the limit** (1.5 NEAR with a 0.5 NEAR per-payment limit). Expected: "Waiting for the owner", and a new entry under "Waiting for owner" with the command the owner runs to approve it.
4. Click **Step 3 Poisoned invoice**. The agent reads an email with a hidden instruction to send 1,000,000 NEAR to `attacker.testnet`, and runs in red-team mode (a model that obeys embedded instructions). Expected: the proposal shows the drain, then the vault answers "Blocked by the vault: recipient is not on the allowlist" and a red strike appears on the agent. The transaction link shows the `action_rejected` event.
5. Open the **Agent pays for an API** tab and click the button. Expected: a 402 from the paid API, a 0.01 NEAR payment through the vault, then live token prices returned after the API verified the payment on-chain.
6. Under **Recurring payments**, click "Agent: pay now" on a payment that is due. Expected: paid; clicking again shows "Not due yet".
7. The **On-chain activity** table at the bottom is read from the contract's `get_activity` view.

> The public demo uses a shared testnet vault with small budgets (0.5 NEAR per payment, 2 NEAR per day for the payments agent, 3 NEAR per day vault-wide). If the daily budget is used up, payments will queue for approval until the window resets. Repeating Step 3 three times suspends the shared agent; to see that without affecting others, run your own copy (below).

## Run it yourself (about 5 minutes)

Requirements: Node.js 20+ and git. No NEAR account, no wallet and no paid service is needed. Docker is only needed to rebuild the contract; a built `warden_vault.wasm` is committed.

```bash
git clone https://github.com/Bob-Elly/Warden && cd Warden
npm install
```

**1. Read-only verification of the public deployment** (no keys)

```bash
npm run verify
```

Expected: every line `PASS`, ending with `All checks passed` (exit code 0). It checks that the vault and both agents have no full-access key, and that each agent key is scoped to the vault's two agent methods.

**2. Create your own deployment on testnet** (free; creates 5 accounts through the testnet helper, deploys, configures and locks the keys)

```bash
npm run setup
```

Expected: `Done. Warden is live on NEAR testnet` with links. Keys go to `.env` (gitignored), public ids to `deployment.json`. The `.env` is written before the first transaction, so an interrupted run never loses keys.

**3. Live attack demo** (real transactions; exits non-zero if the vault ever does something unexpected)

```bash
npm run demo:attack
```

Expected output, in order:

1. Normal payment: `✓ vault executed it`
2. Prompt injection: `✓ the (red-team) LLM was fooled and proposed the drain`, `✓ vault rejected it on-chain`, `✓ strike 1/3 recorded`
3. Over-limit payment: `✓ vault queued it for the owner instead of paying`
4. Compromised server using the agent key directly: `✓ direct NEAR transfer refused by the protocol` and `✓ add_to_allowlist refused by the protocol`
5. `VERDICT: every attack was stopped by the vault or by the NEAR protocol.`

**4. Act as the owner** (owner key stays on your machine and is never used by the web server)

```bash
npm run owner -- status
npm run owner -- approve <request-id>
npm run owner -- reinstate <agent-account>
npm run owner -- pause
```

**5. Web app against your deployment**

```bash
npm run dev
```

Open http://localhost:3000 and follow the browser steps above.

**6. Contract tests** (21 unit tests, needs Rust)

```bash
npm run test:contract
```

Expected: `test result: ok. 21 passed`. The tests cover execution within limits, allowlist rejection with strikes, the prompt-injection drain, auto-suspension and reinstatement, the approval queue (approve, deny, an agent trying to approve itself, bounded size), per-agent and vault-wide budgets, 24h window reset, pause, unauthorized callers, owner-only methods, insufficient balance, recurring payments and the bounded activity log.

### Optional: real LLM on NEAR AI Cloud

Without an API key the agent uses a deterministic local parser, so every step above is reproducible. To use NEAR AI Cloud, create a key at https://cloud.near.ai and set it in `.env`:

```
NEAR_AI_API_KEY=sk-...
NEAR_AI_MODEL=Qwen/Qwen3.6-35B-A3B-FP8            # NEAR-hosted, runs in a TEE
NEAR_AI_REDTEAM_MODEL=Qwen/Qwen3.8-27B-abliterated  # refusals removed, used for the attack scenario
```

With a key, each proposal shows a verified TEE signature, and the **Private AI** tab fetches a fresh attestation report.

## Tracks

| Track | What in Warden fits it | Where to see it |
| --- | --- | --- |
| **AI Security & Defense** (primary) | Spending limits, policy engine, sandboxed agent wallet via function-call keys, automatic quarantine of a hijacked agent, owner approval above limits, locked contract | `contracts/vault/src/lib.rs`, `npm run demo:attack`, `npm run verify` |
| **Agent Economy** | The agent pays for an API by itself through an x402-style HTTP 402 flow, settled by the vault, verified on-chain by the API before it serves data | "Agent pays for an API" tab, `frontend/src/lib/warden/x402.ts` |
| **Privacy & Private AI** | Payment instructions go to NEAR AI Cloud models running in TEEs. Every completion's ECDSA signature is verified, and the attestation report (Intel TDX + NVIDIA evidence, fresh nonce) is shown | "Private AI" tab, `frontend/src/lib/warden/llm.ts`, `attestation.ts` (needs `NEAR_AI_API_KEY`) |
| **AI Swarms** | Several agents under one vault, each with its own budget and strike count, plus a shared vault-wide cap so the group can never overspend together | Agents panel, `vault_cap_applies_across_agents` and `agents_have_independent_budgets_and_strikes` tests |
| **Real-World Money** | Recurring payments (hosting, API plans) with amount, payee and schedule fixed on-chain by the owner; invoice payment from email | Recurring payments panel, `charge_subscription` |
| **Autonomous Business** | Humans only set the constraints (allowlist, budgets, cap); agents run day-to-day payments, subscriptions and data purchases within them | Whole app |
| **Unstoppable DeFi** (partial) | Live NEAR Intents 1Click quotes (`dry: true`, mainnet) checked against the agent's vault budget. Swap execution through the vault is not built yet | "Swap quote" tab, `frontend/src/lib/warden/intents.ts` |

## NEAR technologies used

- **Function-call access keys**: each agent account holds only a key with `receiver_id = vault` and `method_names = [execute_transfer, charge_subscription]`. Its gas allowance (0.5 NEAR) is a gas budget, not a spending limit; spending limits live in the contract.
- **Smart contract in Rust** with `near-sdk` 5.30 (`store::IterableMap`, `IterableSet`, `LookupMap`), built with `cargo-near` 0.23.
- **NEP-297 events** (`standard: "warden"`, version 2.0.0): `action_executed`, `action_rejected`, `approval_requested`, `approval_resolved`, `agent_suspended`, `subscription_charged`, and owner configuration events.
- **Locked contract account**: the vault's full-access key is deleted after deploy.
- **Named accounts** in the allowlist and agent registry.
- **NEAR AI Cloud** (`https://cloud-api.near.ai/v1`, OpenAI-compatible): TEE inference, `/v1/signature/{chat_id}` completion signatures, `/v1/attestation/report`.
- **NEAR Intents 1Click API** (`https://1click.chaindefuser.com/v0/quote`, `/v0/tokens`): dry-run quotes and live token prices.
- **NEAR RPC** (FastNEAR testnet endpoint by default): all dashboard data, `view_access_key_list`, and `tx` status for x402 payment verification.

## Contract interface

Agent methods (the only ones the agent key can call):

- `execute_transfer(receiver_id, amount: U128, memo?) -> { status, reason?, request_id?, strikes? }`
- `charge_subscription(subscription_id) -> { status, reason? }`

Owner methods: `add_agent`, `set_agent_limits`, `remove_agent`, `reinstate_agent`, `set_vault_daily_limit`, `add_to_allowlist`, `remove_from_allowlist`, `pause`, `unpause`, `approve_request`, `reject_request`, `add_subscription`, `cancel_subscription`, `withdraw`, `deposit` (payable, anyone).

Views: `get_vault_info`, `get_agents`, `get_agent`, `get_pending`, `get_subscriptions`, `get_activity(limit?)`, `is_allowlisted`.

## Repository layout

```
contracts/vault/          Rust vault contract
  src/lib.rs              rules, owner methods, views
  src/events.rs           NEP-297 events
  src/tests.rs            21 unit tests
  res/warden_vault.wasm   built contract (sha256 in deployment.json)
frontend/                 Next.js 14 app: web UI and agent server
  src/lib/warden/         agent logic shared by the API routes and the CLI scripts
    vault.ts              vault client (views, execute_transfer, charge_subscription)
    llm.ts                NEAR AI Cloud client, TEE signature check, local parser
    agent.ts              one agent turn: propose -> pre-check -> submit -> verdict
    policy.ts             off-chain advisory pre-check
    x402.ts               HTTP 402 payment requirements and on-chain verification
    intents.ts            NEAR Intents 1Click quotes and token prices
    attestation.ts        NEAR AI Cloud attestation report
  src/app/api/            agent, vault, x402, paid API, intents, attestation routes
  src/components/         UI
scripts/                  setup, verify, demo-attack, owner CLIs (run with tsx)
deployment.json           public ids of the live testnet deployment
```

## Deploying the web app

Set these environment variables on the host (for example Vercel, project root `frontend`), using values from your `.env`: `NEAR_NETWORK_ID`, `NEAR_NODE_URL`, `VAULT_CONTRACT_ID`, `AGENT_ACCOUNT_ID`, `AGENT_PRIVATE_KEY`, `RESEARCH_AGENT_ACCOUNT_ID`, `RESEARCH_AGENT_PRIVATE_KEY`, `X402_PAY_TO`, `X402_SECRET`, and optionally `NEAR_AI_API_KEY`, `NEAR_AI_MODEL`, `NEAR_AI_REDTEAM_MODEL`. **Never set `OWNER_PRIVATE_KEY` on a server.** The server only ever needs the agents' function-call keys.

## Limitations

- Testnet only. NEAR Intents has no testnet, so swaps are quote-only (`dry: true`); the vault holds native NEAR, not fungible tokens, so stablecoin payments are not built yet.
- The 24h windows are fixed windows that start at the first spend after a reset, not sliding windows.
- x402 replay protection is per server instance (in-memory set of used transaction hashes), on top of the 10-minute signed nonce.
- Owner approval happens from the owner's machine (`npm run owner`), not from the web UI; there is no wallet connection in the app.
- The activity log keeps the 50 most recent entries; events in transaction logs are the permanent record.

## Hackathon disclosure

- All code in this repository was written during the hackathon window (first commit 2026-11-03). There is no earlier codebase and no code from other projects.
- AI coding assistants were used during development.
- Libraries: `near-sdk` (Rust), `near-api-js`, `openai` (as the OpenAI-compatible client for NEAR AI Cloud), `viem` (signature recovery only), `next`, `react`, `lucide-react`, `dotenv`, `tsx`, `typescript`. Build tool: `cargo-near` via the `sourcescan/cargo-near` Docker image.
