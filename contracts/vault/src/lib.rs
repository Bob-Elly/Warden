//! Warden Vault: an on-chain spending policy for AI agents.
//!
//! The vault holds the funds. AI agents hold only a NEAR function-call access
//! key that can call `execute_transfer` / `charge_subscription` on this
//! contract and nothing else. Every rule is enforced here, on-chain:
//!
//! * recipient allowlist (owner-managed)
//! * per-agent per-transaction and 24h limits, plus a vault-wide 24h cap
//! * over-limit requests are queued for owner approval instead of executing
//! * blocked attempts are recorded on-chain and count as strikes; an agent
//!   that collects `STRIKE_LIMIT` strikes is suspended automatically
//! * owner-only emergency pause
//! * owner-defined recurring payments that agents can trigger when due

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

mod events;
use events::Event;

const DAY_NS: u64 = 86_400_000_000_000;
const NS_PER_MS: u64 = 1_000_000;
/// Blocked attempts before an agent is automatically suspended.
pub const STRIKE_LIMIT: u32 = 3;
/// Maximum number of requests waiting for owner approval.
pub const MAX_PENDING: u32 = 10;
/// Activity log is a ring buffer of the most recent entries.
pub const MAX_ACTIVITY: u64 = 50;
const MAX_MEMO_LEN: usize = 140;
/// Balance kept back on top of storage staking so the vault never bricks itself.
const BALANCE_BUFFER: NearToken = NearToken::from_millinear(50);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Allowlist,
    Agents,
    Pending,
    Subscriptions,
    Activity,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub label: String,
    pub per_tx_limit: U128,
    pub daily_limit: U128,
    pub spent_today: U128,
    pub window_start: u64,
    pub strikes: u32,
    pub suspended: bool,
    pub executed_count: u32,
    pub blocked_count: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PendingRequest {
    pub id: u64,
    pub agent: AccountId,
    pub receiver_id: AccountId,
    pub amount: U128,
    pub memo: Option<String>,
    pub reason: String,
    pub created_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Subscription {
    pub id: u64,
    pub label: String,
    pub receiver_id: AccountId,
    pub amount: U128,
    pub interval_secs: u64,
    pub next_due_ms: u64,
    pub charges: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Activity {
    pub seq: u64,
    /// executed | rejected | pending | approved | denied | subscription | suspended
    pub kind: String,
    pub actor: AccountId,
    pub receiver_id: Option<AccountId>,
    pub amount: U128,
    pub reason: Option<String>,
    pub memo: Option<String>,
    pub timestamp_ms: u64,
    pub block_height: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ActionStatus {
    Executed,
    PendingApproval,
    Rejected,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ActionResult {
    pub status: ActionStatus,
    pub reason: Option<String>,
    pub request_id: Option<u64>,
    pub strikes: Option<u32>,
}

#[near(serializers = [json])]
pub struct VaultInfo {
    pub owner_id: AccountId,
    pub paused: bool,
    pub vault_daily_limit: U128,
    pub vault_spent_today: U128,
    pub reset_in_seconds: u64,
    pub balance: U128,
    pub available_balance: U128,
    pub allowlist: Vec<AccountId>,
    pub agent_count: u32,
    pub pending_count: u32,
    pub total_executed: u64,
    pub total_blocked: u64,
    pub strike_limit: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct WardenVault {
    owner_id: AccountId,
    paused: bool,
    vault_daily_limit: u128,
    vault_spent_today: u128,
    vault_window_start: u64,
    allowlist: IterableSet<AccountId>,
    agents: IterableMap<AccountId, Agent>,
    pending: IterableMap<u64, PendingRequest>,
    subscriptions: IterableMap<u64, Subscription>,
    activity: LookupMap<u64, Activity>,
    activity_count: u64,
    next_id: u64,
    total_executed: u64,
    total_blocked: u64,
}

#[near]
impl WardenVault {
    #[init]
    pub fn init(owner_id: AccountId, vault_daily_limit: U128) -> Self {
        Event::VaultInitialized {
            owner_id: &owner_id,
            vault_daily_limit: vault_daily_limit.0.to_string(),
        }
        .emit();

        Self {
            owner_id,
            paused: false,
            vault_daily_limit: vault_daily_limit.0,
            vault_spent_today: 0,
            vault_window_start: env::block_timestamp(),
            allowlist: IterableSet::new(StorageKey::Allowlist),
            agents: IterableMap::new(StorageKey::Agents),
            pending: IterableMap::new(StorageKey::Pending),
            subscriptions: IterableMap::new(StorageKey::Subscriptions),
            activity: LookupMap::new(StorageKey::Activity),
            activity_count: 0,
            next_id: 0,
            total_executed: 0,
            total_blocked: 0,
        }
    }

    /* ---------------------------------------------------------------------
       AGENT-FACING METHODS (the only methods the agent key can call)
       --------------------------------------------------------------------- */

    /// Ask the vault to send `amount` yoctoNEAR to `receiver_id`.
    ///
    /// Returns `executed`, `pending_approval` (over a limit, queued for the
    /// owner) or `rejected` (blocked; recorded on-chain as a strike when the
    /// recipient is not allowlisted). Callers that are not registered agents
    /// are refused with a panic so they cannot write to vault storage.
    pub fn execute_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) -> ActionResult {
        let caller = env::predecessor_account_id();
        let amount = amount.0;
        let memo = memo.map(truncate_memo);

        let mut agent = match self.agents.get(&caller) {
            Some(a) => a.clone(),
            None => env::panic_str("Warden: caller is not a registered agent"),
        };

        if self.paused {
            return self.reject(&caller, &mut agent, &receiver_id, amount, "vault_paused", false);
        }
        if agent.suspended {
            return self.reject(&caller, &mut agent, &receiver_id, amount, "agent_suspended", false);
        }
        if amount == 0 {
            return self.reject(&caller, &mut agent, &receiver_id, amount, "invalid_amount", false);
        }
        if !self.allowlist.contains(&receiver_id) {
            return self.reject(&caller, &mut agent, &receiver_id, amount, "recipient_not_allowlisted", true);
        }

        self.roll_vault_window();
        roll_agent_window(&mut agent);

        let over_limit = if amount > agent.per_tx_limit.0 {
            Some("per_tx_limit_exceeded")
        } else if agent.spent_today.0.saturating_add(amount) > agent.daily_limit.0 {
            Some("agent_daily_limit_exceeded")
        } else if self.vault_spent_today.saturating_add(amount) > self.vault_daily_limit {
            Some("vault_daily_limit_exceeded")
        } else {
            None
        };

        if let Some(reason) = over_limit {
            if self.pending.len() >= MAX_PENDING {
                return self.reject(&caller, &mut agent, &receiver_id, amount, "approval_queue_full", false);
            }
            let id = self.take_id();
            self.pending.insert(
                id,
                PendingRequest {
                    id,
                    agent: caller.clone(),
                    receiver_id: receiver_id.clone(),
                    amount: U128(amount),
                    memo: memo.clone(),
                    reason: reason.to_string(),
                    created_at_ms: now_ms(),
                },
            );
            Event::ApprovalRequested {
                request_id: id,
                agent: &caller,
                receiver_id: &receiver_id,
                amount: amount.to_string(),
                reason,
            }
            .emit();
            self.log_activity("pending", &caller, Some(&receiver_id), amount, Some(reason), memo.as_deref());
            self.agents.insert(caller, agent);
            return ActionResult {
                status: ActionStatus::PendingApproval,
                reason: Some(reason.to_string()),
                request_id: Some(id),
                strikes: None,
            };
        }

        if amount > self.available_balance() {
            return self.reject(&caller, &mut agent, &receiver_id, amount, "insufficient_vault_balance", false);
        }

        agent.spent_today = U128(agent.spent_today.0 + amount);
        agent.executed_count += 1;
        self.vault_spent_today += amount;
        self.total_executed += 1;

        Event::ActionExecuted {
            agent: &caller,
            receiver_id: &receiver_id,
            amount: amount.to_string(),
            memo: memo.as_deref(),
        }
        .emit();
        self.log_activity("executed", &caller, Some(&receiver_id), amount, None, memo.as_deref());
        self.agents.insert(caller, agent);

        Promise::new(receiver_id).transfer(NearToken::from_yoctonear(amount)).detach();

        ActionResult { status: ActionStatus::Executed, reason: None, request_id: None, strikes: None }
    }

    /// Pay a recurring payment the owner set up, if it is due. Callable by any
    /// registered, non-suspended agent. Amount and recipient are fixed by the
    /// owner, so a compromised agent can at most pay a bill on schedule.
    pub fn charge_subscription(&mut self, subscription_id: u64) -> ActionResult {
        let caller = env::predecessor_account_id();
        let agent = self
            .agents
            .get(&caller)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Warden: caller is not a registered agent"));
        let mut sub = self
            .subscriptions
            .get(&subscription_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Warden: unknown subscription"));
        let amount = sub.amount.0;

        let refuse = |reason: &str| ActionResult {
            status: ActionStatus::Rejected,
            reason: Some(reason.to_string()),
            request_id: None,
            strikes: None,
        };
        if self.paused {
            return refuse("vault_paused");
        }
        if agent.suspended {
            return refuse("agent_suspended");
        }
        let now = now_ms();
        if now < sub.next_due_ms {
            return refuse("not_due_yet");
        }
        self.roll_vault_window();
        if self.vault_spent_today.saturating_add(amount) > self.vault_daily_limit {
            return refuse("vault_daily_limit_exceeded");
        }
        if amount > self.available_balance() {
            return refuse("insufficient_vault_balance");
        }

        let interval_ms = sub.interval_secs * 1_000;
        sub.next_due_ms = (sub.next_due_ms + interval_ms).max(now + interval_ms / 2);
        sub.charges += 1;
        let receiver = sub.receiver_id.clone();
        let label = sub.label.clone();
        self.subscriptions.insert(subscription_id, sub);
        self.vault_spent_today += amount;
        self.total_executed += 1;

        Event::SubscriptionCharged {
            subscription_id,
            receiver_id: &receiver,
            amount: amount.to_string(),
        }
        .emit();
        self.log_activity("subscription", &caller, Some(&receiver), amount, None, Some(&label));

        Promise::new(receiver).transfer(NearToken::from_yoctonear(amount)).detach();
        ActionResult { status: ActionStatus::Executed, reason: None, request_id: None, strikes: None }
    }

    /* ---------------------------------------------------------------------
       OWNER METHODS
       --------------------------------------------------------------------- */

    #[payable]
    pub fn deposit(&mut self) {}

    pub fn add_agent(&mut self, account_id: AccountId, label: String, per_tx_limit: U128, daily_limit: U128) {
        self.assert_owner();
        require!(label.len() <= 40, "label too long");
        Event::AgentAdded {
            account_id: &account_id,
            label: &label,
            per_tx_limit: per_tx_limit.0.to_string(),
            daily_limit: daily_limit.0.to_string(),
        }
        .emit();
        self.agents.insert(
            account_id,
            Agent {
                label,
                per_tx_limit,
                daily_limit,
                spent_today: U128(0),
                window_start: env::block_timestamp(),
                strikes: 0,
                suspended: false,
                executed_count: 0,
                blocked_count: 0,
            },
        );
    }

    pub fn set_agent_limits(&mut self, account_id: AccountId, per_tx_limit: U128, daily_limit: U128) {
        self.assert_owner();
        let agent = self.agents.get_mut(&account_id).unwrap_or_else(|| env::panic_str("unknown agent"));
        agent.per_tx_limit = per_tx_limit;
        agent.daily_limit = daily_limit;
    }

    pub fn remove_agent(&mut self, account_id: AccountId) {
        self.assert_owner();
        require!(self.agents.remove(&account_id).is_some(), "unknown agent");
        Event::AgentRemoved { account_id: &account_id }.emit();
    }

    pub fn reinstate_agent(&mut self, account_id: AccountId) {
        self.assert_owner();
        let agent = self.agents.get_mut(&account_id).unwrap_or_else(|| env::panic_str("unknown agent"));
        agent.suspended = false;
        agent.strikes = 0;
        Event::AgentReinstated { account_id: &account_id }.emit();
    }

    pub fn set_vault_daily_limit(&mut self, vault_daily_limit: U128) {
        self.assert_owner();
        self.vault_daily_limit = vault_daily_limit.0;
        Event::VaultLimitUpdated { vault_daily_limit: vault_daily_limit.0.to_string() }.emit();
    }

    pub fn add_to_allowlist(&mut self, account_id: AccountId) -> bool {
        self.assert_owner();
        let inserted = self.allowlist.insert(account_id.clone());
        if inserted {
            Event::AllowlistAdded { account_id: &account_id }.emit();
        }
        inserted
    }

    pub fn remove_from_allowlist(&mut self, account_id: AccountId) -> bool {
        self.assert_owner();
        let removed = self.allowlist.remove(&account_id);
        if removed {
            Event::AllowlistRemoved { account_id: &account_id }.emit();
        }
        removed
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        Event::VaultPaused { paused: true }.emit();
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        Event::VaultPaused { paused: false }.emit();
    }

    /// Owner approves a queued over-limit request. Limits are the owner's to
    /// override, so the transfer executes as long as the vault can pay it.
    pub fn approve_request(&mut self, request_id: u64) {
        self.assert_owner();
        let req = self.pending.remove(&request_id).unwrap_or_else(|| env::panic_str("unknown request"));
        let amount = req.amount.0;
        require!(amount <= self.available_balance(), "Warden: insufficient vault balance");
        self.total_executed += 1;
        Event::ApprovalResolved { request_id, approved: true }.emit();
        let owner = self.owner_id.clone();
        self.log_activity("approved", &owner, Some(&req.receiver_id), amount, Some(&req.reason), req.memo.as_deref());
        Promise::new(req.receiver_id).transfer(NearToken::from_yoctonear(amount)).detach();
    }

    pub fn reject_request(&mut self, request_id: u64) {
        self.assert_owner();
        let req = self.pending.remove(&request_id).unwrap_or_else(|| env::panic_str("unknown request"));
        Event::ApprovalResolved { request_id, approved: false }.emit();
        let owner = self.owner_id.clone();
        self.log_activity("denied", &owner, Some(&req.receiver_id), req.amount.0, Some(&req.reason), req.memo.as_deref());
    }

    pub fn add_subscription(&mut self, label: String, receiver_id: AccountId, amount: U128, interval_secs: u64) -> u64 {
        self.assert_owner();
        require!(interval_secs >= 60, "interval must be at least 60 seconds");
        require!(label.len() <= 40, "label too long");
        let id = self.take_id();
        Event::SubscriptionAdded {
            subscription_id: id,
            receiver_id: &receiver_id,
            amount: amount.0.to_string(),
            interval_secs,
        }
        .emit();
        self.subscriptions.insert(
            id,
            Subscription { id, label, receiver_id, amount, interval_secs, next_due_ms: now_ms(), charges: 0 },
        );
        id
    }

    pub fn cancel_subscription(&mut self, subscription_id: u64) {
        self.assert_owner();
        require!(self.subscriptions.remove(&subscription_id).is_some(), "unknown subscription");
        Event::SubscriptionCancelled { subscription_id }.emit();
    }

    pub fn withdraw(&mut self, amount: U128, recipient: AccountId) {
        self.assert_owner();
        require!(amount.0 <= self.available_balance(), "Warden: insufficient vault balance");
        Event::Withdrawn { recipient: &recipient, amount: amount.0.to_string() }.emit();
        Promise::new(recipient).transfer(NearToken::from_yoctonear(amount.0)).detach();
    }

    /* ---------------------------------------------------------------------
       VIEW METHODS
       --------------------------------------------------------------------- */

    pub fn get_vault_info(&self) -> VaultInfo {
        let now = env::block_timestamp();
        let expired = now >= self.vault_window_start + DAY_NS;
        VaultInfo {
            owner_id: self.owner_id.clone(),
            paused: self.paused,
            vault_daily_limit: U128(self.vault_daily_limit),
            vault_spent_today: U128(if expired { 0 } else { self.vault_spent_today }),
            reset_in_seconds: if expired {
                86_400
            } else {
                (self.vault_window_start + DAY_NS - now) / 1_000_000_000
            },
            balance: U128(env::account_balance().as_yoctonear()),
            available_balance: U128(self.available_balance()),
            allowlist: self.allowlist.iter().cloned().collect(),
            agent_count: self.agents.len(),
            pending_count: self.pending.len(),
            total_executed: self.total_executed,
            total_blocked: self.total_blocked,
            strike_limit: STRIKE_LIMIT,
        }
    }

    pub fn get_agents(&self) -> Vec<(AccountId, Agent)> {
        let now = env::block_timestamp();
        self.agents
            .iter()
            .map(|(id, a)| {
                let mut a = a.clone();
                if now >= a.window_start + DAY_NS {
                    a.spent_today = U128(0);
                }
                (id.clone(), a)
            })
            .collect()
    }

    pub fn get_agent(&self, account_id: AccountId) -> Option<Agent> {
        self.agents.get(&account_id).cloned()
    }

    pub fn get_pending(&self) -> Vec<PendingRequest> {
        self.pending.values().cloned().collect()
    }

    pub fn get_subscriptions(&self) -> Vec<Subscription> {
        self.subscriptions.values().cloned().collect()
    }

    /// Most recent activity first, up to `limit` (max 50) entries.
    pub fn get_activity(&self, limit: Option<u64>) -> Vec<Activity> {
        let limit = limit.unwrap_or(MAX_ACTIVITY).min(MAX_ACTIVITY);
        let start = self.activity_count.saturating_sub(limit);
        (start..self.activity_count)
            .rev()
            .filter_map(|seq| self.activity.get(&(seq % MAX_ACTIVITY)).cloned())
            .collect()
    }

    pub fn is_allowlisted(&self, account_id: AccountId) -> bool {
        self.allowlist.contains(&account_id)
    }

    /* ---------------------------------------------------------------------
       INTERNAL
       --------------------------------------------------------------------- */

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Warden: owner only");
    }

    fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn available_balance(&self) -> u128 {
        let storage = env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128;
        env::account_balance()
            .as_yoctonear()
            .saturating_sub(storage)
            .saturating_sub(BALANCE_BUFFER.as_yoctonear())
    }

    fn roll_vault_window(&mut self) {
        let now = env::block_timestamp();
        if now >= self.vault_window_start + DAY_NS {
            self.vault_spent_today = 0;
            self.vault_window_start = now;
        }
    }

    fn reject(
        &mut self,
        caller: &AccountId,
        agent: &mut Agent,
        receiver_id: &AccountId,
        amount: u128,
        reason: &str,
        strike: bool,
    ) -> ActionResult {
        agent.blocked_count += 1;
        self.total_blocked += 1;
        if strike {
            agent.strikes += 1;
        }
        Event::ActionRejected { agent: caller, receiver_id, amount: amount.to_string(), reason }.emit();
        self.log_activity("rejected", caller, Some(receiver_id), amount, Some(reason), None);

        if strike && !agent.suspended && agent.strikes >= STRIKE_LIMIT {
            agent.suspended = true;
            Event::AgentSuspended { account_id: caller, strikes: agent.strikes }.emit();
            self.log_activity("suspended", caller, None, 0, Some("strike_limit_reached"), None);
        }
        let strikes = agent.strikes;
        self.agents.insert(caller.clone(), agent.clone());
        ActionResult {
            status: ActionStatus::Rejected,
            reason: Some(reason.to_string()),
            request_id: None,
            strikes: Some(strikes),
        }
    }

    fn log_activity(
        &mut self,
        kind: &str,
        actor: &AccountId,
        receiver_id: Option<&AccountId>,
        amount: u128,
        reason: Option<&str>,
        memo: Option<&str>,
    ) {
        let seq = self.activity_count;
        self.activity.insert(
            seq % MAX_ACTIVITY,
            Activity {
                seq,
                kind: kind.to_string(),
                actor: actor.clone(),
                receiver_id: receiver_id.cloned(),
                amount: U128(amount),
                reason: reason.map(str::to_string),
                memo: memo.map(str::to_string),
                timestamp_ms: now_ms(),
                block_height: env::block_height(),
            },
        );
        self.activity_count += 1;
    }
}

fn roll_agent_window(agent: &mut Agent) {
    let now = env::block_timestamp();
    if now >= agent.window_start + DAY_NS {
        agent.spent_today = U128(0);
        agent.window_start = now;
    }
}

fn now_ms() -> u64 {
    env::block_timestamp() / NS_PER_MS
}

fn truncate_memo(memo: String) -> String {
    if memo.len() <= MAX_MEMO_LEN {
        return memo;
    }
    let mut end = MAX_MEMO_LEN;
    while !memo.is_char_boundary(end) {
        end -= 1;
    }
    memo[..end].to_string()
}

#[cfg(test)]
mod tests;
