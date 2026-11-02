use near_sdk::collections::UnorderedSet;
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, PublicKey,
};

mod events;
use events::Event;

// 24 hours in nanoseconds = 86,400 * 1,000,000,000
const DAY_IN_NANOSECONDS: u64 = 86_400_000_000_000;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Allowlist,
    AllowedAgents,
    AllowedAgentKeys,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct WardenVault {
    /// Owner of the vault who can configure rules and withdraw
    pub owner_id: AccountId,
    /// Maximum amount (in yoctoNEAR) allowed in a single transaction
    pub per_tx_limit: u128,
    /// Maximum cumulative spending (in yoctoNEAR) allowed in a 24-hour window
    pub daily_limit: u128,
    /// Amount spent during the current 24-hour window
    pub spent_today: u128,
    /// Timestamp (in nanoseconds) when the current 24-hour window began
    pub last_reset_timestamp: u64,
    /// Global emergency switch: when paused, no executions are allowed
    pub paused: bool,
    /// Allowed recipients for transactions
    pub allowlist: UnorderedSet<AccountId>,
    /// Authorized agent account IDs
    pub allowed_agents: UnorderedSet<AccountId>,
    /// Authorized agent public keys (for scoped function-call access keys)
    pub allowed_agent_keys: UnorderedSet<PublicKey>,
}

#[near]
impl WardenVault {
    #[init]
    pub fn init(owner_id: AccountId, per_tx_limit: U128, daily_limit: U128) -> Self {
        require!(!env::state_exists(), "Already initialized");

        Event::VaultInitialized {
            owner_id: &owner_id,
            per_tx_limit: per_tx_limit.0.to_string(),
            daily_limit: daily_limit.0.to_string(),
        }
        .emit();

        Self {
            owner_id,
            per_tx_limit: per_tx_limit.0,
            daily_limit: daily_limit.0,
            spent_today: 0,
            last_reset_timestamp: env::block_timestamp(),
            paused: false,
            allowlist: UnorderedSet::new(StorageKey::Allowlist),
            allowed_agents: UnorderedSet::new(StorageKey::AllowedAgents),
            allowed_agent_keys: UnorderedSet::new(StorageKey::AllowedAgentKeys),
        }
    }

    /* ------------------------------------------------------------------------
       CORE EXECUTION (The Agent-facing interface)
       ------------------------------------------------------------------------ */

    /// Execute a native NEAR transfer to an allowlisted recipient within the spending limits.
    /// Can be called by authorized agents or the owner.
    pub fn execute_transfer(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
    ) -> Promise {
        let caller = env::predecessor_account_id();
        let amount_u128 = amount.0;

        // 1. Check if paused
        if self.paused {
            Event::ActionRejected {
                reason: "vault_paused",
                caller: &caller,
                receiver_id: &receiver_id,
                attempted_amount: amount_u128.to_string(),
                limit_or_status: "paused".to_string(),
            }
            .emit();
            env::panic_str("Warden: Vault is currently paused by owner");
        }

        // 2. Check authorization
        if !self.is_authorized_caller(&caller) {
            Event::ActionRejected {
                reason: "unauthorized_caller",
                caller: &caller,
                receiver_id: &receiver_id,
                attempted_amount: amount_u128.to_string(),
                limit_or_status: "caller not recognized as agent or owner".to_string(),
            }
            .emit();
            env::panic_str("Warden: Caller is not authorized as agent or owner");
        }

        // 3. Check allowlist
        if !self.allowlist.contains(&receiver_id) {
            Event::ActionRejected {
                reason: "recipient_not_allowlisted",
                caller: &caller,
                receiver_id: &receiver_id,
                attempted_amount: amount_u128.to_string(),
                limit_or_status: "recipient not in allowlist".to_string(),
            }
            .emit();
            env::panic_str("Warden: Target recipient is not on the allowlist");
        }

        // 4. Check per-tx limit
        if amount_u128 > self.per_tx_limit {
            Event::ActionRejected {
                reason: "per_tx_limit_exceeded",
                caller: &caller,
                receiver_id: &receiver_id,
                attempted_amount: amount_u128.to_string(),
                limit_or_status: self.per_tx_limit.to_string(),
            }
            .emit();
            env::panic_str("Warden: Requested amount exceeds per-transaction limit");
        }

        // 5. Update and check 24-hour spending window
        self.update_window_if_needed();

        let new_spent_today = self
            .spent_today
            .checked_add(amount_u128)
            .expect("Warden: Spent calculation overflow");

        if new_spent_today > self.daily_limit {
            Event::ActionRejected {
                reason: "daily_limit_exceeded",
                caller: &caller,
                receiver_id: &receiver_id,
                attempted_amount: amount_u128.to_string(),
                limit_or_status: format!(
                    "daily_limit: {}, spent_today: {}",
                    self.daily_limit, self.spent_today
                ),
            }
            .emit();
            env::panic_str("Warden: Requested amount would exceed 24-hour spending limit");
        }

        // 6. Record spending and emit success event
        self.spent_today = new_spent_today;

        Event::ActionExecuted {
            caller: &caller,
            receiver_id: &receiver_id,
            amount: amount_u128.to_string(),
            token: "NEAR",
            memo: memo.as_deref(),
        }
        .emit();

        // 7. Transfer funds
        Promise::new(receiver_id).transfer(NearToken::from_yoctonear(amount_u128))
    }

    /* ------------------------------------------------------------------------
       OWNER CONFIGURATION & MANAGEMENT
       ------------------------------------------------------------------------ */

    #[payable]
    pub fn deposit(&mut self) {
        // Anyone (typically owner) can fund the vault
    }

    pub fn withdraw_near(&mut self, amount: U128, recipient: AccountId) -> Promise {
        self.assert_owner();
        Promise::new(recipient).transfer(NearToken::from_yoctonear(amount.0))
    }

    pub fn set_limits(&mut self, per_tx_limit: U128, daily_limit: U128) {
        self.assert_owner();
        self.per_tx_limit = per_tx_limit.0;
        self.daily_limit = daily_limit.0;

        Event::LimitsUpdated {
            per_tx_limit: per_tx_limit.0.to_string(),
            daily_limit: daily_limit.0.to_string(),
            by: &env::predecessor_account_id(),
        }
        .emit();
    }

    pub fn add_to_allowlist(&mut self, account_id: AccountId) -> bool {
        self.assert_owner();
        let inserted = self.allowlist.insert(&account_id);
        if inserted {
            Event::AllowlistAdded {
                account_id: &account_id,
            }
            .emit();
        }
        inserted
    }

    pub fn remove_from_allowlist(&mut self, account_id: AccountId) -> bool {
        self.assert_owner();
        let removed = self.allowlist.remove(&account_id);
        if removed {
            Event::AllowlistRemoved {
                account_id: &account_id,
            }
            .emit();
        }
        removed
    }

    pub fn add_agent(&mut self, account_id: Option<AccountId>, public_key: Option<PublicKey>) {
        self.assert_owner();
        require!(
            account_id.is_some() || public_key.is_some(),
            "Must provide either account_id or public_key"
        );

        if let Some(ref acc) = account_id {
            self.allowed_agents.insert(acc);
        }
        if let Some(ref pk) = public_key {
            self.allowed_agent_keys.insert(pk);
        }

        Event::AgentAdded {
            account_id: account_id.as_ref(),
            public_key: public_key.map(|pk| format!("{:?}", pk)),
        }
        .emit();
    }

    pub fn remove_agent(&mut self, account_id: Option<AccountId>, public_key: Option<PublicKey>) {
        self.assert_owner();
        if let Some(ref acc) = account_id {
            self.allowed_agents.remove(acc);
        }
        if let Some(ref pk) = public_key {
            self.allowed_agent_keys.remove(pk);
        }

        Event::AgentRemoved {
            account_id: account_id.as_ref(),
            public_key: public_key.map(|pk| format!("{:?}", pk)),
        }
        .emit();
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        Event::VaultPaused {
            paused: true,
            by: &env::predecessor_account_id(),
        }
        .emit();
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        Event::VaultPaused {
            paused: false,
            by: &env::predecessor_account_id(),
        }
        .emit();
    }

    /* ------------------------------------------------------------------------
       VIEW METHODS
       ------------------------------------------------------------------------ */

    pub fn get_vault_info(&self) -> VaultInfo {
        let now = env::block_timestamp();
        let (spent_today, reset_in_seconds) = if now >= self.last_reset_timestamp + DAY_IN_NANOSECONDS {
            (0, 86400)
        } else {
            let elapsed_ns = now - self.last_reset_timestamp;
            let remaining_ns = DAY_IN_NANOSECONDS.saturating_sub(elapsed_ns);
            (self.spent_today, remaining_ns / 1_000_000_000)
        };

        VaultInfo {
            owner_id: self.owner_id.clone(),
            per_tx_limit: U128(self.per_tx_limit),
            daily_limit: U128(self.daily_limit),
            spent_today: U128(spent_today),
            reset_in_seconds,
            paused: self.paused,
            allowlist: self.allowlist.to_vec(),
            allowed_agents: self.allowed_agents.to_vec(),
            vault_balance: U128(env::account_balance().as_yoctonear()),
        }
    }

    pub fn is_allowlisted(&self, account_id: AccountId) -> bool {
        self.allowlist.contains(&account_id)
    }

    pub fn is_agent(&self, account_id: Option<AccountId>, public_key: Option<PublicKey>) -> bool {
        if let Some(acc) = account_id {
            if self.allowed_agents.contains(&acc) {
                return true;
            }
        }
        if let Some(pk) = public_key {
            if self.allowed_agent_keys.contains(&pk) {
                return true;
            }
        }
        false
    }

    pub fn get_spending_status(&self) -> SpendingStatus {
        let now = env::block_timestamp();
        let spent = if now >= self.last_reset_timestamp + DAY_IN_NANOSECONDS {
            0
        } else {
            self.spent_today
        };

        SpendingStatus {
            spent_today: U128(spent),
            daily_limit: U128(self.daily_limit),
            remaining_today: U128(self.daily_limit.saturating_sub(spent)),
            per_tx_limit: U128(self.per_tx_limit),
        }
    }

    /* ------------------------------------------------------------------------
       INTERNAL HELPERS
       ------------------------------------------------------------------------ */

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Warden: Action only permitted by vault owner"
        );
    }

    fn is_authorized_caller(&self, caller: &AccountId) -> bool {
        // Owner can always execute
        if caller == &self.owner_id {
            return true;
        }
        // Account listed in allowed agents
        if self.allowed_agents.contains(caller) {
            return true;
        }
        // Function-call key signer is authorized
        let signer_pk = env::signer_account_pk();
        if self.allowed_agent_keys.contains(&signer_pk) {
            return true;
        }
        false
    }

    fn update_window_if_needed(&mut self) {
        let now = env::block_timestamp();
        if now >= self.last_reset_timestamp + DAY_IN_NANOSECONDS {
            self.spent_today = 0;
            self.last_reset_timestamp = now;
        }
    }
}

#[derive(near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct VaultInfo {
    pub owner_id: AccountId,
    pub per_tx_limit: U128,
    pub daily_limit: U128,
    pub spent_today: U128,
    pub reset_in_seconds: u64,
    pub paused: bool,
    pub allowlist: Vec<AccountId>,
    pub allowed_agents: Vec<AccountId>,
    pub vault_balance: U128,
}

#[derive(near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SpendingStatus {
    pub spent_today: U128,
    pub daily_limit: U128,
    pub remaining_today: U128,
    pub per_tx_limit: U128,
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn alice() -> AccountId {
        "alice.near".parse().unwrap()
    }
    fn bob() -> AccountId {
        "bob.near".parse().unwrap()
    }
    fn attacker() -> AccountId {
        "attacker.near".parse().unwrap()
    }
    fn agent() -> AccountId {
        "agent.near".parse().unwrap()
    }

    fn get_context(predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("vault.near".parse().unwrap())
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .account_balance(NearToken::from_near(100))
            .block_timestamp(1_000_000_000);
        builder
    }

    #[test]
    fn test_initialization() {
        let context = get_context(alice());
        testing_env!(context.build());

        let vault = WardenVault::init(
            alice(),
            U128(NearToken::from_near(5).as_yoctonear()),
            U128(NearToken::from_near(20).as_yoctonear()),
        );

        let info = vault.get_vault_info();
        assert_eq!(info.owner_id, alice());
        assert_eq!(info.per_tx_limit.0, NearToken::from_near(5).as_yoctonear());
        assert_eq!(info.daily_limit.0, NearToken::from_near(20).as_yoctonear());
        assert_eq!(info.spent_today.0, 0);
        assert!(!info.paused);
    }

    #[test]
    fn test_allowlist_and_agent_management() {
        let mut context = get_context(alice());
        testing_env!(context.build());

        let mut vault = WardenVault::init(
            alice(),
            U128(NearToken::from_near(5).as_yoctonear()),
            U128(NearToken::from_near(20).as_yoctonear()),
        );

        vault.add_to_allowlist(bob());
        assert!(vault.is_allowlisted(bob()));
        assert!(!vault.is_allowlisted(attacker()));

        vault.add_agent(Some(agent()), None);
        assert!(vault.is_agent(Some(agent()), None));

        vault.remove_from_allowlist(bob());
        assert!(!vault.is_allowlisted(bob()));
    }

    #[test]
    fn test_successful_execution_within_limits() {
        let mut context = get_context(alice());
        testing_env!(context.build());

        let mut vault = WardenVault::init(
            alice(),
            U128(NearToken::from_near(5).as_yoctonear()),
            U128(NearToken::from_near(20).as_yoctonear()),
        );

        vault.add_to_allowlist(bob());
        vault.add_agent(Some(agent()), None);

        // Switch caller to authorized agent
        testing_env!(get_context(agent()).build());

        let tx_amount = NearToken::from_near(2).as_yoctonear();
        vault.execute_transfer(bob(), U128(tx_amount), Some("Coffee payment".to_string()));

        let status = vault.get_spending_status();
        assert_eq!(status.spent_today.0, tx_amount);
        assert_eq!(
            status.remaining_today.0,
            NearToken::from_near(18).as_yoctonear()
        );
    }

    #[test]
    #[should_panic(expected = "Warden: Target recipient is not on the allowlist")]
    fn test_rejects_non_allowlisted_recipient() {
        let mut context = get_context(alice());
        testing_env!(context.build());

        let mut vault = WardenVault::init(
            alice(),
            U128(NearToken::from_near(5).as_yoctonear()),
            U128(NearToken::from_near(20).as_yoctonear()),
        );

        vault.add_agent(Some(agent()), None);

        // Attacker is NOT in allowlist
        testing_env!(get_context(agent()).build());
        vault.execute_transfer(
            attacker(),
            U128(NearToken::from_near(1).as_yoctonear()),
            Some("Malicious drain".to_string()),
        );
    }

    #[test]
    #[should_panic(expected = "Warden: Requested amount exceeds per-transaction limit")]
    fn test_rejects_exceeding_per_tx_limit() {
        let mut context = get_context(alice());
        testing_env!(context.build());

        let mut vault = WardenVault::init(
            alice(),
            U128(NearToken::from_near(5).as_yoctonear()),
            U128(NearToken::from_near(20).as_yoctonear()),
        );

        vault.add_to_allowlist(bob());
        vault.add_agent(Some(agent()), None);

        testing_env!(get_context(agent()).build());
        // Try sending 6 NEAR when limit is 5 NEAR
        vault.execute_transfer(
            bob(),
            U128(NearToken::from_near(6).as_yoctonear()),
            Some("Big transfer".to_string()),
        );
    }

    #[test]
    #[should_panic(expected = "Warden: Requested amount would exceed 24-hour spending limit")]
    fn test_rejects_exceeding_daily_limit() {
        let mut context = get_context(alice());
        testing_env!(context.build());

        let mut vault = WardenVault::init(
            alice(),
            U128(NearToken::from_near(5).as_yoctonear()),
            U128(NearToken::from_near(7).as_yoctonear()), // 7 NEAR daily limit
        );

        vault.add_to_allowlist(bob());
        vault.add_agent(Some(agent()), None);

        testing_env!(get_context(agent()).build());
        // Spend 4 NEAR (ok)
        vault.execute_transfer(bob(), U128(NearToken::from_near(4).as_yoctonear()), None);

        // Spend another 4 NEAR (4 + 4 = 8 > 7 daily limit -> PANIC)
        vault.execute_transfer(bob(), U128(NearToken::from_near(4).as_yoctonear()), None);
    }

    #[test]
    #[should_panic(expected = "Warden: Vault is currently paused by owner")]
    fn test_rejects_when_paused() {
        let mut context = get_context(alice());
        testing_env!(context.build());

        let mut vault = WardenVault::init(
            alice(),
            U128(NearToken::from_near(5).as_yoctonear()),
            U128(NearToken::from_near(20).as_yoctonear()),
        );

        vault.add_to_allowlist(bob());
        vault.add_agent(Some(agent()), None);

        // Owner pauses vault
        vault.pause();

        // Agent attempts transfer
        testing_env!(get_context(agent()).build());
        vault.execute_transfer(bob(), U128(NearToken::from_near(1).as_yoctonear()), None);
    }

    #[test]
    #[should_panic(expected = "Warden: Caller is not authorized as agent or owner")]
    fn test_rejects_unauthorized_caller() {
        let mut context = get_context(alice());
        testing_env!(context.build());

        let mut vault = WardenVault::init(
            alice(),
            U128(NearToken::from_near(5).as_yoctonear()),
            U128(NearToken::from_near(20).as_yoctonear()),
        );

        vault.add_to_allowlist(bob());

        // Attacker directly calls execute_transfer
        testing_env!(get_context(attacker()).build());
        vault.execute_transfer(bob(), U128(NearToken::from_near(1).as_yoctonear()), None);
    }

    #[test]
    fn test_daily_window_resets_after_24_hours() {
        let mut context = get_context(alice());
        testing_env!(context.build());

        let mut vault = WardenVault::init(
            alice(),
            U128(NearToken::from_near(5).as_yoctonear()),
            U128(NearToken::from_near(6).as_yoctonear()),
        );

        vault.add_to_allowlist(bob());
        vault.add_agent(Some(agent()), None);

        // Spend 5 NEAR at timestamp 1_000_000_000
        testing_env!(get_context(agent()).build());
        vault.execute_transfer(bob(), U128(NearToken::from_near(5).as_yoctonear()), None);

        assert_eq!(
            vault.get_spending_status().remaining_today.0,
            NearToken::from_near(1).as_yoctonear()
        );

        // Fast forward time by 25 hours (25 * 3600 * 10^9 ns)
        let future_time = 1_000_000_000 + (25 * 3600 * 1_000_000_000);
        let mut future_context = get_context(agent());
        future_context.block_timestamp(future_time);
        testing_env!(future_context.build());

        // Now daily limit has reset! We can spend 5 NEAR again
        vault.execute_transfer(bob(), U128(NearToken::from_near(5).as_yoctonear()), None);
        assert_eq!(
            vault.get_spending_status().spent_today.0,
            NearToken::from_near(5).as_yoctonear()
        );
    }
}
