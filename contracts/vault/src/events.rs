use near_sdk::serde::Serialize;
use near_sdk::{env, AccountId};

#[derive(Serialize, Debug)]
#[serde(crate = "near_sdk::serde", tag = "event", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum Event<'a> {
    VaultInitialized {
        owner_id: &'a AccountId,
        per_tx_limit: String,
        daily_limit: String,
    },
    VaultPaused {
        paused: bool,
        by: &'a AccountId,
    },
    LimitsUpdated {
        per_tx_limit: String,
        daily_limit: String,
        by: &'a AccountId,
    },
    AllowlistAdded {
        account_id: &'a AccountId,
    },
    AllowlistRemoved {
        account_id: &'a AccountId,
    },
    AgentAdded {
        account_id: Option<&'a AccountId>,
        public_key: Option<String>,
    },
    AgentRemoved {
        account_id: Option<&'a AccountId>,
        public_key: Option<String>,
    },
    ActionExecuted {
        caller: &'a AccountId,
        receiver_id: &'a AccountId,
        amount: String,
        token: &'a str,
        memo: Option<&'a str>,
    },
    ActionRejected {
        reason: &'a str,
        caller: &'a AccountId,
        receiver_id: &'a AccountId,
        attempted_amount: String,
        limit_or_status: String,
    },
}

impl<'a> Event<'a> {
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
            version: "1.0.0",
            event: self,
        };

        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::to_string(&log).expect("Failed to serialize event log")
        ));
    }
}
