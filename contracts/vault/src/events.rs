//! NEP-297 structured events. Every state change and every blocked action
//! is logged as `EVENT_JSON:{"standard":"warden","version":"2.0.0",...}`.

use near_sdk::serde::Serialize;
use near_sdk::{env, AccountId};

#[derive(Serialize, Debug)]
#[serde(crate = "near_sdk::serde", tag = "event", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum Event<'a> {
    VaultInitialized {
        owner_id: &'a AccountId,
        vault_daily_limit: String,
    },
    VaultPaused {
        paused: bool,
    },
    VaultLimitUpdated {
        vault_daily_limit: String,
    },
    AllowlistAdded {
        account_id: &'a AccountId,
    },
    AllowlistRemoved {
        account_id: &'a AccountId,
    },
    AgentAdded {
        account_id: &'a AccountId,
        label: &'a str,
        per_tx_limit: String,
        daily_limit: String,
    },
    AgentRemoved {
        account_id: &'a AccountId,
    },
    AgentSuspended {
        account_id: &'a AccountId,
        strikes: u32,
        /// 0 = until the owner reinstates the agent
        until_ms: u64,
    },
    AgentReinstated {
        account_id: &'a AccountId,
        automatic: bool,
    },
    TokenAdded {
        token: &'a AccountId,
        symbol: &'a str,
        per_tx_limit: String,
        daily_limit: String,
    },
    ActionExecuted {
        agent: &'a AccountId,
        receiver_id: &'a AccountId,
        amount: String,
        /// None = NEAR
        token: Option<&'a AccountId>,
        memo: Option<&'a str>,
    },
    ActionRejected {
        agent: &'a AccountId,
        receiver_id: &'a AccountId,
        amount: String,
        token: Option<&'a AccountId>,
        reason: &'a str,
    },
    TransferFailed {
        token: &'a AccountId,
        receiver_id: &'a AccountId,
        amount: String,
    },
    ApprovalRequested {
        request_id: u64,
        agent: &'a AccountId,
        receiver_id: &'a AccountId,
        amount: String,
        token: Option<&'a AccountId>,
        reason: &'a str,
    },
    ApprovalResolved {
        request_id: u64,
        approved: bool,
    },
    SubscriptionAdded {
        subscription_id: u64,
        receiver_id: &'a AccountId,
        amount: String,
        interval_secs: u64,
        token: Option<&'a AccountId>,
    },
    SubscriptionCharged {
        subscription_id: u64,
        receiver_id: &'a AccountId,
        amount: String,
        token: Option<&'a AccountId>,
    },
    SubscriptionCancelled {
        subscription_id: u64,
    },
    Withdrawn {
        recipient: &'a AccountId,
        amount: String,
        token: Option<&'a AccountId>,
    },
}

impl Event<'_> {
    pub fn emit(&self) {
        #[derive(Serialize)]
        #[serde(crate = "near_sdk::serde")]
        struct EventLog<'a> {
            standard: &'static str,
            version: &'static str,
            #[serde(flatten)]
            event: &'a Event<'a>,
        }

        let log = EventLog {
            standard: "warden",
            version: "2.1.0",
            event: self,
        };

        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::to_string(&log).expect("event serialization")
        ));
    }
}
