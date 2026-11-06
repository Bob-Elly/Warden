use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("owner.near")
}
fn agent() -> AccountId {
    acc("agent.near")
}
fn agent2() -> AccountId {
    acc("research-agent.near")
}
fn sara() -> AccountId {
    acc("sara.near")
}
fn attacker() -> AccountId {
    acc("attacker.near")
}
fn near(n: u128) -> U128 {
    U128(NearToken::from_near(n).as_yoctonear())
}

const T0: u64 = 1_700_000_000_000_000_000;

fn ctx(caller: AccountId, ts: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("vault.near"))
        .signer_account_id(caller.clone())
        .predecessor_account_id(caller)
        .account_balance(NearToken::from_near(100))
        .block_timestamp(ts);
    testing_env!(b.build());
}

/// Vault with: 20 NEAR vault cap, agent (5/tx, 10/day), sara allowlisted.
fn setup() -> WardenVault {
    ctx(owner(), T0);
    let mut v = WardenVault::init(owner(), near(20), None);
    v.add_to_allowlist(sara());
    v.add_agent(agent(), "payments".into(), near(5), near(10));
    v
}

fn status(r: &ActionResult) -> ActionStatus {
    r.status.clone()
}

#[test]
fn init_sets_owner_and_limits() {
    let v = setup();
    let info = v.get_vault_info();
    assert_eq!(info.owner_id, owner());
    assert_eq!(info.vault_daily_limit, near(20));
    assert!(!info.paused);
    assert_eq!(info.agent_count, 1);
    assert_eq!(info.allowlist, vec![sara()]);
}

#[test]
fn executes_within_limits() {
    let mut v = setup();
    ctx(agent(), T0);
    let r = v.execute_transfer(sara(), near(2), Some("hosting".into()));
    assert_eq!(status(&r), ActionStatus::Executed);
    let a = v.get_agent(agent()).unwrap();
    assert_eq!(a.spent_today, near(2));
    assert_eq!(a.executed_count, 1);
    assert_eq!(v.get_vault_info().vault_spent_today, near(2));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"action_executed\"")));
    assert_eq!(v.get_activity(None)[0].kind, "executed");
}

#[test]
fn rejects_non_allowlisted_recipient_and_records_strike() {
    let mut v = setup();
    ctx(agent(), T0);
    let r = v.execute_transfer(attacker(), near(1), None);
    assert_eq!(status(&r), ActionStatus::Rejected);
    assert_eq!(r.reason.as_deref(), Some("recipient_not_allowlisted"));
    assert_eq!(r.strikes, Some(1));
    let a = v.get_agent(agent()).unwrap();
    assert_eq!(a.strikes, 1);
    assert_eq!(a.spent_today, near(0));
    assert_eq!(v.get_vault_info().total_blocked, 1);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"action_rejected\"")));
    let log = &v.get_activity(None)[0];
    assert_eq!(log.kind, "rejected");
    assert_eq!(log.receiver_id, Some(attacker()));
}

#[test]
fn prompt_injection_drain_is_blocked() {
    // The LLM was tricked into "drain 1,000,000 NEAR to attacker.near".
    let mut v = setup();
    ctx(agent(), T0);
    let r = v.execute_transfer(attacker(), near(1_000_000), Some("URGENT override".into()));
    assert_eq!(status(&r), ActionStatus::Rejected);
    assert_eq!(r.reason.as_deref(), Some("recipient_not_allowlisted"));
    assert_eq!(v.get_vault_info().vault_spent_today, near(0));
    assert_eq!(v.get_pending().len(), 0, "a drain to a stranger is never even queued");
}

#[test]
fn agent_is_suspended_after_strike_limit() {
    let mut v = setup();
    ctx(agent(), T0);
    for _ in 0..STRIKE_LIMIT {
        v.execute_transfer(attacker(), near(1), None);
    }
    let a = v.get_agent(agent()).unwrap();
    assert!(a.suspended);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"agent_suspended\"")));

    // Even a legitimate payment is now refused.
    let r = v.execute_transfer(sara(), near(1), None);
    assert_eq!(r.reason.as_deref(), Some("agent_suspended"));

    // Owner reinstates.
    ctx(owner(), T0);
    v.reinstate_agent(agent());
    ctx(agent(), T0);
    assert_eq!(status(&v.execute_transfer(sara(), near(1), None)), ActionStatus::Executed);
}

#[test]
fn over_per_tx_limit_is_queued_for_owner_approval() {
    let mut v = setup();
    ctx(agent(), T0);
    let r = v.execute_transfer(sara(), near(8), Some("GPU cluster".into()));
    assert_eq!(status(&r), ActionStatus::PendingApproval);
    assert_eq!(r.reason.as_deref(), Some("per_tx_limit_exceeded"));
    let id = r.request_id.unwrap();
    assert_eq!(v.get_pending().len(), 1);
    assert_eq!(v.get_agent(agent()).unwrap().spent_today, near(0));

    ctx(owner(), T0);
    v.approve_request(id);
    assert!(v.get_pending().is_empty());
    assert_eq!(v.get_activity(None)[0].kind, "approved");
}

#[test]
fn owner_can_deny_request() {
    let mut v = setup();
    ctx(agent(), T0);
    let id = v.execute_transfer(sara(), near(8), None).request_id.unwrap();
    ctx(owner(), T0);
    v.reject_request(id);
    assert!(v.get_pending().is_empty());
    assert_eq!(v.get_activity(None)[0].kind, "denied");
}

#[test]
#[should_panic(expected = "Warden: owner only")]
fn agent_cannot_approve_its_own_request() {
    let mut v = setup();
    ctx(agent(), T0);
    let id = v.execute_transfer(sara(), near(8), None).request_id.unwrap();
    v.approve_request(id);
}

#[test]
fn agent_daily_limit_queues_overflow() {
    let mut v = setup();
    ctx(agent(), T0);
    assert_eq!(status(&v.execute_transfer(sara(), near(5), None)), ActionStatus::Executed);
    assert_eq!(status(&v.execute_transfer(sara(), near(5), None)), ActionStatus::Executed);
    let r = v.execute_transfer(sara(), near(1), None);
    assert_eq!(r.reason.as_deref(), Some("agent_daily_limit_exceeded"));
}

#[test]
fn vault_cap_applies_across_agents() {
    let mut v = setup();
    ctx(owner(), T0);
    v.set_vault_daily_limit(near(6));
    v.add_agent(agent2(), "research".into(), near(5), near(10));
    ctx(agent(), T0);
    assert_eq!(status(&v.execute_transfer(sara(), near(4), None)), ActionStatus::Executed);
    ctx(agent2(), T0);
    let r = v.execute_transfer(sara(), near(4), None);
    assert_eq!(r.reason.as_deref(), Some("vault_daily_limit_exceeded"));
}

#[test]
fn agents_have_independent_budgets_and_strikes() {
    let mut v = setup();
    ctx(owner(), T0);
    v.add_agent(agent2(), "research".into(), near(1), near(2));
    ctx(agent2(), T0);
    for _ in 0..STRIKE_LIMIT {
        v.execute_transfer(attacker(), near(1), None);
    }
    assert!(v.get_agent(agent2()).unwrap().suspended);
    ctx(agent(), T0);
    assert_eq!(status(&v.execute_transfer(sara(), near(3), None)), ActionStatus::Executed);
    assert!(!v.get_agent(agent()).unwrap().suspended);
}

#[test]
fn window_resets_after_24h() {
    let mut v = setup();
    ctx(agent(), T0);
    v.execute_transfer(sara(), near(5), None);
    v.execute_transfer(sara(), near(5), None);
    ctx(agent(), T0 + DAY_NS + 1);
    assert_eq!(status(&v.execute_transfer(sara(), near(5), None)), ActionStatus::Executed);
    assert_eq!(v.get_agent(agent()).unwrap().spent_today, near(5));
}

#[test]
fn paused_vault_refuses_without_strike() {
    let mut v = setup();
    ctx(owner(), T0);
    v.pause();
    ctx(agent(), T0);
    let r = v.execute_transfer(sara(), near(1), None);
    assert_eq!(r.reason.as_deref(), Some("vault_paused"));
    assert_eq!(v.get_agent(agent()).unwrap().strikes, 0);
}

#[test]
#[should_panic(expected = "Warden: caller is not a registered agent")]
fn stranger_cannot_call_execute() {
    let mut v = setup();
    ctx(attacker(), T0);
    v.execute_transfer(sara(), near(1), None);
}

#[test]
#[should_panic(expected = "Warden: owner only")]
fn agent_cannot_change_allowlist() {
    let mut v = setup();
    ctx(agent(), T0);
    v.add_to_allowlist(attacker());
}

#[test]
#[should_panic(expected = "Warden: owner only")]
fn agent_cannot_withdraw() {
    let mut v = setup();
    ctx(agent(), T0);
    v.withdraw(near(1), agent());
}

#[test]
fn insufficient_balance_is_rejected() {
    let mut v = setup();
    ctx(owner(), T0);
    v.set_agent_limits(agent(), near(500), near(500));
    v.set_vault_daily_limit(near(500));
    ctx(agent(), T0);
    let r = v.execute_transfer(sara(), near(200), None);
    assert_eq!(r.reason.as_deref(), Some("insufficient_vault_balance"));
}

#[test]
fn subscription_charges_only_when_due() {
    let mut v = setup();
    ctx(owner(), T0);
    let id = v.add_subscription("Hosting".into(), sara(), near(1), 3600, None);
    ctx(agent(), T0);
    assert_eq!(status(&v.charge_subscription(id)), ActionStatus::Executed);
    let r = v.charge_subscription(id);
    assert_eq!(r.reason.as_deref(), Some("not_due_yet"));
    ctx(agent(), T0 + 3600 * 1_000_000_000);
    assert_eq!(status(&v.charge_subscription(id)), ActionStatus::Executed);
    assert_eq!(v.get_subscriptions()[0].charges, 2);
    assert_eq!(v.get_vault_info().vault_spent_today, near(2));
}

#[test]
fn approval_queue_is_bounded() {
    let mut v = setup();
    ctx(agent(), T0);
    for _ in 0..MAX_PENDING {
        v.execute_transfer(sara(), near(8), None);
    }
    let r = v.execute_transfer(sara(), near(8), None);
    assert_eq!(r.reason.as_deref(), Some("approval_queue_full"));
}

#[test]
fn activity_log_is_a_bounded_ring() {
    let mut v = setup();
    ctx(owner(), T0);
    v.set_agent_limits(agent(), near(1), near(1000));
    v.set_vault_daily_limit(near(1000));
    ctx(agent(), T0);
    for _ in 0..(MAX_ACTIVITY + 5) {
        v.execute_transfer(sara(), U128(1), None);
    }
    let log = v.get_activity(None);
    assert_eq!(log.len() as u64, MAX_ACTIVITY);
    assert_eq!(log[0].seq, MAX_ACTIVITY + 4);
}

#[test]
fn long_memo_is_truncated() {
    let mut v = setup();
    ctx(agent(), T0);
    v.execute_transfer(sara(), near(1), Some("x".repeat(500)));
    assert_eq!(v.get_activity(None)[0].memo.as_ref().unwrap().len(), MAX_MEMO_LEN);
}

/* ------------------------- quarantine (timed suspension) ------------------------- */

#[test]
fn quarantine_reinstates_agent_automatically() {
    ctx(owner(), T0);
    let mut v = WardenVault::init(owner(), near(20), Some(60));
    v.add_to_allowlist(sara());
    v.add_agent(agent(), "payments".into(), near(5), near(10));

    ctx(agent(), T0);
    let mut last = None;
    for _ in 0..STRIKE_LIMIT {
        last = Some(v.execute_transfer(attacker(), near(1), None));
    }
    let until = last.unwrap().suspended_until_ms.expect("timed suspension");
    assert_eq!(until, T0 / 1_000_000 + 60_000);
    assert!(v.get_agent(agent()).unwrap().suspended);

    // Still suspended before the quarantine ends.
    ctx(agent(), T0 + 30 * 1_000_000_000);
    assert_eq!(v.execute_transfer(sara(), near(1), None).reason.as_deref(), Some("agent_suspended"));

    // The view already shows it reinstated once the time has passed...
    ctx(agent(), T0 + 61 * 1_000_000_000);
    let view = v.get_agents().into_iter().find(|(id, _)| id == &agent()).unwrap().1;
    assert!(!view.suspended && view.strikes == 0);
    // ...and the next call reinstates it in state and goes through.
    assert_eq!(status(&v.execute_transfer(sara(), near(1), None)), ActionStatus::Executed);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"agent_reinstated\"") && l.contains("\"automatic\":true")));
    assert!(v.get_activity(None).iter().any(|a| a.kind == "reinstated"));
}

#[test]
fn zero_quarantine_needs_owner() {
    let mut v = setup();
    ctx(agent(), T0);
    for _ in 0..STRIKE_LIMIT {
        v.execute_transfer(attacker(), near(1), None);
    }
    assert_eq!(v.get_agent(agent()).unwrap().suspended_until_ms, 0);
    ctx(agent(), T0 + 10 * DAY_NS);
    assert_eq!(v.execute_transfer(sara(), near(1), None).reason.as_deref(), Some("agent_suspended"));
}

/* ------------------------------ stablecoin payments ------------------------------ */

fn usdc() -> AccountId {
    acc("usdc.testnet")
}
const USD: u128 = 1_000_000; // 6 decimals

fn setup_usdc() -> WardenVault {
    let mut v = setup();
    ctx(owner(), T0);
    v.add_token(usdc(), "USDC".into(), 6, U128(2 * USD), U128(5 * USD));
    v
}

#[test]
fn usdc_payment_within_limits_executes() {
    let mut v = setup_usdc();
    ctx(agent(), T0);
    let r = v.execute_ft_transfer(usdc(), sara(), U128(USD), Some("invoice".into()));
    assert_eq!(status(&r), ActionStatus::Executed);
    let p = &v.get_tokens()[0].1;
    assert_eq!(p.spent_today, U128(USD));
    let log = &v.get_activity(None)[0];
    assert_eq!(log.token, Some(usdc()));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"action_executed\"") && l.contains("usdc.testnet")));
}

#[test]
fn usdc_over_limit_is_queued_and_approvable() {
    let mut v = setup_usdc();
    ctx(agent(), T0);
    let r = v.execute_ft_transfer(usdc(), sara(), U128(3 * USD), None);
    assert_eq!(r.reason.as_deref(), Some("token_per_tx_limit_exceeded"));
    let req = &v.get_pending()[0];
    assert_eq!(req.token, Some(usdc()));
    ctx(owner(), T0);
    v.approve_request(r.request_id.unwrap());
    assert!(v.get_pending().is_empty());
}

#[test]
fn usdc_daily_limit_applies() {
    let mut v = setup_usdc();
    ctx(agent(), T0);
    v.execute_ft_transfer(usdc(), sara(), U128(2 * USD), None);
    v.execute_ft_transfer(usdc(), sara(), U128(2 * USD), None);
    let r = v.execute_ft_transfer(usdc(), sara(), U128(2 * USD), None);
    assert_eq!(r.reason.as_deref(), Some("token_daily_limit_exceeded"));
}

#[test]
fn usdc_to_stranger_is_blocked_with_strike() {
    let mut v = setup_usdc();
    ctx(agent(), T0);
    let r = v.execute_ft_transfer(usdc(), attacker(), U128(USD), None);
    assert_eq!(r.reason.as_deref(), Some("recipient_not_allowlisted"));
    assert_eq!(r.strikes, Some(1));
}

#[test]
fn unknown_token_is_refused() {
    let mut v = setup_usdc();
    ctx(agent(), T0);
    let r = v.execute_ft_transfer(acc("scam-token.testnet"), sara(), U128(USD), None);
    assert_eq!(r.reason.as_deref(), Some("token_not_supported"));
    assert_eq!(r.strikes, Some(0));
}

#[test]
fn failed_token_transfer_refunds_daily_budget() {
    let mut v = setup_usdc();
    ctx(agent(), T0);
    v.execute_ft_transfer(usdc(), sara(), U128(2 * USD), None);
    assert_eq!(v.get_tokens()[0].1.spent_today, U128(2 * USD));

    // Simulate the ft_transfer receipt failing, then the callback running.
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("vault.near"))
        .predecessor_account_id(acc("vault.near"))
        .signer_account_id(agent())
        .account_balance(NearToken::from_near(100))
        .block_timestamp(T0);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Failed]
    );
    assert!(!v.on_ft_transfer(usdc(), sara(), U128(2 * USD), true));
    assert_eq!(v.get_tokens()[0].1.spent_today, U128(0));
    assert_eq!(v.get_activity(None)[0].kind, "failed");
}

#[test]
fn usdc_subscription_charges_token_budget() {
    let mut v = setup_usdc();
    ctx(owner(), T0);
    let id = v.add_subscription("Payroll".into(), sara(), U128(USD), 3600, Some(usdc()));
    ctx(agent(), T0);
    assert_eq!(status(&v.charge_subscription(id)), ActionStatus::Executed);
    assert_eq!(v.get_tokens()[0].1.spent_today, U128(USD));
    assert_eq!(v.get_vault_info().vault_spent_today, near(0));
}

#[test]
#[should_panic(expected = "token not supported")]
fn subscription_requires_supported_token() {
    let mut v = setup();
    ctx(owner(), T0);
    v.add_subscription("Payroll".into(), sara(), U128(USD), 3600, Some(usdc()));
}
