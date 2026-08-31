# ⚠️ REVIEW CHECKLIST — READ BEFORE SUBMITTING, THEN DELETE THIS SECTION

Everything below the `---` line is the actual report — copy from there down. This section above the line is only for you; do not paste it.

Before copying/pasting and submitting, check:

- [ ] Scope confirmed — the affected asset is in the program's scope RIGHT NOW (scope can change; re-confirm on the program page before submitting)
- [ ] Category confirmed — matches a category the program declares eligible for a reward (not metadata/cosmetic)
- [ ] Evidence checked — the code excerpts and the PoC output below really exist/ran as described
- [ ] Not a duplicate — checked against reports already submitted; also do a fresh search on the program page right before submitting (a live public program with real activity can get new duplicates fast — this session already lost a race on a different finding)

**Live-verified 2026-08-31:** `circlefin/solana-gateway-contracts`, type "Smart contract", **In scope**, max severity **Critical**, **Eligible**, on `hackerone.com/circle-bbp`.

**Deployment status:** Circle Gateway is **not yet on Solana mainnet** (confirmed via Circle's own blog, circle.com/blog/gateway-new-pre-mint-address-for-usdc-on-solana). This is actually a good time to report — before real funds are at risk. There is no program address to cite yet; when it deploys, that should be added.

**Timing note:** don't sit on this one. This session already lost report-priority on a related Circle finding (arc-remote-signer) to another researcher who submitted first, even though our analysis was independently confirmed correct by Circle's own triage team.

**⚠️ Read this before deciding to submit — real precedent risk:** The identical behavior on this program's EVM counterpart (`evm-gateway-contracts::Withdrawals.sol`, same missing check on `initiateWithdrawal`/`withdraw`) is **not an open/paid vulnerability** — Circle's own commissioned audit (ChainSecurity, "PUBLIC Code Assessment of the Circle Gateway Smart Contracts," 2025-07-08) documents this exact behavior in section 8.1 ("Denylist on GatewayWallet and GatewayMinter") as a **Note**, not a finding requiring a fix: *"The GatewayWallet prevents denylisted accounts from depositing tokens into the contract, updating delegations, or bridging... However, denylisted users can still withdraw their tokens from the wallet contract."* That's Circle treating this exact behavior as accepted design on the EVM side. Neither public Circle Gateway audit (ChainSecurity or OtterSec) covers the Solana program at all, so this specific instance genuinely hasn't been publicly disclosed anywhere found — it may still be legitimately reportable as a novel finding on a different codebase. But there is a real, material chance Circle applies the same "accepted design" reasoning here and closes this as informative/not-applicable rather than paying it. Go in with that expectation, not as a slam-dunk.

---

## Title
Denylisted accounts on the Solana `gateway-wallet` program can still withdraw funds deposited before being denylisted (`initiate_withdrawal` / `withdraw` missing denylist check)

## Program / Platform
Circle BBP via HackerOne — https://hackerone.com/circle-bbp

## Category / Severity
Broken access control / missing authorization check (CWE-862) in a Solana smart contract handling user token custody. `asset_type: Smart contract`, `eligible_for_bounty: true`, `max_severity: critical` (confirmed live on the program's scope page).

## Affected asset
- Repository: `circlefin/solana-gateway-contracts`
- Program: `gateway-wallet` (Anchor, program ID `devN7ZZFhGVTgwoKHaDDTFFgrhRzSGzuC6hgVFPrxbs`)
- Files: `programs/gateway-wallet/src/instructions/initiate_withdrawal.rs`, `programs/gateway-wallet/src/instructions/withdrawal.rs`, `programs/gateway-wallet/src/state.rs`, `programs/gateway-wallet/src/utils.rs`
- Commit at time of analysis: `master` (Anchor.toml declares program IDs matching the live repo; re-confirm current `master` SHA before submitting)

## Summary
`gateway-wallet` maintains a denylist: once an account is denylisted, `deposit`, `deposit_for`, `add_delegate`, and `remove_delegate` all check the denylist PDA and reject the call. `initiate_withdrawal` and `withdraw` do not. Both only check that the program isn't paused — neither instruction's `#[derive(Accounts)]` struct declares a denylist account at all, and neither handler calls `is_account_denylisted`. As a result, an account that deposited funds *before* being denylisted can still call `initiate_withdrawal` followed by `withdraw` and fully recover its balance after being denylisted. The denylist blocks new deposits and new delegations, but not withdrawal of funds already in the program.

The same gap exists on this program's EVM counterpart (`evm-gateway-contracts::Withdrawals.sol`, no `notDenylisted` modifier on `initiateWithdrawal`/`withdraw`) — confirmed independently here by direct code reading on the Solana program, not by analogy. Note, however, that on the EVM side Circle's own commissioned audit documents this exact behavior as accepted design rather than a vulnerability (see the caveat above) — this report is submitted on the basis that the Solana instance is a distinct, undisclosed codebase, not on the assumption that the EVM precedent was treated as a confirmed bug.

## Confirmed call chain
1. `instructions/deposit.rs` and `instructions/deposit_for.rs` load an `UncheckedAccount depositor_denylist` (seeds `[DENYLIST_SEED, owner/depositor]`) and call `require!(!utils::is_account_denylisted(...), GatewayWalletError::AccountDenylisted)` before accepting a deposit.
2. `instructions/add_delegate.rs` and `remove_delegate.rs` run the same check for both the depositor and the delegate.
3. `utils.rs::is_account_denylisted` checks only `!denylist_account.data_is_empty()` — the PDA's mere existence (created by `instructions/denylist.rs` via `init_if_needed`, no data fields) is the denylist signal.
4. `instructions/initiate_withdrawal.rs` (`InitiateWithdrawalContext`) does **not** declare a denylist account in its `Accounts` struct. Its only gate is `!gateway_wallet.paused`. No `require!` involving denylist anywhere in the file.
5. `state.rs::GatewayDeposit::initiate_withdrawal` (called by the handler) only validates `amount > 0`, supported token, and sufficient available balance — no denylist check.
6. `instructions/withdrawal.rs` (`WithdrawContext`) also only checks `!gateway_wallet.paused`. No denylist account, no denylist check.
7. `state.rs::GatewayDeposit::complete_withdrawal` only debits `withdrawing_amount` and performs the `token::transfer` CPI — no denylist check.

## Steps to reproduce
1. Depositor deposits funds into `gateway-wallet` for a supported token (normal `deposit` flow — succeeds, not denylisted yet).
2. Program denylister calls `denylist` on that depositor's account (normal `denylist` flow — succeeds).
3. Depositor calls `initiate_withdrawal` for their existing balance. **This succeeds** — no denylist check exists on this instruction.
4. After the program's withdrawal delay elapses, depositor calls `withdraw`. **This succeeds** — no denylist check exists on this instruction either. Funds are transferred to the depositor's token account in full.

## Evidence
```rust
// instructions/initiate_withdrawal.rs — InitiateWithdrawalContext
#[event_cpi]
#[derive(Accounts)]
pub struct InitiateWithdrawalContext<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
        constraint = !gateway_wallet.paused @ GatewayWalletError::ProgramPaused
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,

    #[account(
        mut,
        seeds = [GATEWAY_DEPOSIT_SEED, deposit.token_mint.key().as_ref(), depositor.key().as_ref()],
        bump = deposit.bump
    )]
    pub deposit: Account<'info, GatewayDeposit>,
    // no denylist account declared anywhere in this struct
}
```
```rust
// instructions/withdrawal.rs — WithdrawContext
#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawContext<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [GATEWAY_WALLET_SEED],
        bump = gateway_wallet.bump,
        constraint = !gateway_wallet.paused @ GatewayWalletError::ProgramPaused
    )]
    pub gateway_wallet: Box<Account<'info, GatewayWallet>>,

    #[account(mut, token::authority = gateway_wallet, seeds = [...], bump = ...)]
    pub custody_token_account: Account<'info, TokenAccount>,

    #[account(mut, token::mint = custody_token_account.mint, token::authority = depositor)]
    pub depositor_token_account: Account<'info, TokenAccount>,

    #[account(mut, seeds = [...], bump = deposit.bump, constraint = deposit.token_mint == custody_token_account.mint)]
    pub deposit: Account<'info, GatewayDeposit>,

    pub token_program: Program<'info, Token>,
    // no denylist account declared anywhere in this struct
}
```
```rust
// instructions/deposit.rs — DepositContext, for contrast (the check that DOES exist)
/// CHECK: Depositor denylist PDA. Account is denylisted if it exists at the expected PDA.
#[account(seeds = [DENYLIST_SEED, owner.key().as_ref()], bump)]
pub depositor_denylist: UncheckedAccount<'info>,
// ... and in the handler: require!(!utils::is_account_denylisted(&ctx.accounts.depositor_denylist), GatewayWalletError::AccountDenylisted);
```

Because Anchor's `#[derive(Accounts)]` macro validates and constrains accounts *exclusively* from what is declared in the struct, the absence of a denylist account in `InitiateWithdrawalContext`/`WithdrawContext` is a compile-time property of the program, not a runtime condition — there is no code path by which either handler could check a denylist account that isn't part of its `Accounts` struct.

## Executable proof of concept
Built the real `gateway-wallet` program from source (`cargo-build-sbf`, official Solana/Agave CLI, no reimplementation) and generated the real Anchor IDL (`anchor-cli` 0.31.1). Ran the test against the real compiled program using `litesvm` (an in-process Solana VM) via **the project's own real test helper class**, `GatewayWalletTestClient` from `tests/gateway-wallet/test_client.ts` — the exact same client the project's own `deposit.test.ts`/`withdrawal.test.ts`/`denylist.test.ts` use, not a custom reimplementation.

Test sequence:
1. Initialize the program, add a token mint, mint 2,000,000 units to a fresh depositor's token account.
2. Depositor deposits 1,000,000 units into `gateway-wallet` (normal `deposit` call, succeeds — not denylisted yet).
3. Denylister denylists the depositor (normal `denylist` call, succeeds).
4. **Sanity check**: depositor attempts a NEW deposit of 1 unit. This is correctly **rejected** — confirms the denylist mechanism itself works, and that this account is genuinely denylisted from the program's own point of view.
5. Depositor calls `initiate_withdrawal` for the full 1,000,000 balance deposited in step 2 (before being denylisted). **Succeeds.**
6. After the withdrawal delay, depositor calls `withdraw`. **Succeeds.** Funds are transferred.

Real output (literal, 2026-08-31):
```
PoC: denylisted depositor can still withdraw pre-existing balance
RESULT: withdrawal from a DENYLISTED account was ACCEPTED.
tx: 4pA4JX4bLT3sqDZmG6fM8TPYgU6vvn68cnrFrR8xUrobGpZyKnjcVwatosaD3KFSFd3ZzR9MDtcdnS4danRnhStk
balance before: 1000000
balance after: 2000000
denylisted before the withdrawal: true

  1 passing (281ms)
```

`balance after` minus `balance before` is exactly 1,000,000 — the full amount deposited before the denylist, withdrawn in full by an account the program itself confirms is denylisted (step 4 above proves the denylist state is real, not a setup error).

## Impact
An account holder who deposits funds into `gateway-wallet` and is subsequently denylisted (e.g., for sanctions compliance, fraud, or other policy reasons this denylist mechanism presumably exists to enforce) retains full, unrestricted access to withdraw everything they deposited before the denylist action. The denylist is fully effective against *new* activity (deposits, delegations) but provides no protection at all against a denylisted account draining its existing balance. Depending on why an account was denylisted, this defeats the practical purpose of the control: an account can be denylisted moments after depositing and still walk away with the funds.

## Suggested fix
Add a denylist account (same PDA convention as `deposit.rs`: `seeds = [DENYLIST_SEED, depositor.key().as_ref()]`) to both `InitiateWithdrawalContext` and `WithdrawContext`, and call `require!(!utils::is_account_denylisted(...), GatewayWalletError::AccountDenylisted)` in both handlers, mirroring the existing check in `deposit`/`deposit_for`/`add_delegate`/`remove_delegate`.

---
