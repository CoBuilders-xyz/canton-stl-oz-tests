# canton-stl-oz-tests

All 15 cases from OpenZeppelin's pinned VaultTest module, using published `@cobuilders/canton-stl@0.1.0-beta.1`. The STL suite uses one real local open Sandbox with `before`/`after`, and fresh admin/owner parties plus a jointly created Vault (100, unpaused) per case.

[GitHub Actions](https://github.com/CoBuilders-xyz/canton-stl-oz-tests/actions/workflows/tests.yml) builds the pinned contracts, runs the unchanged original Daml baseline, then these STL cases on pushes to main and pull requests (also manual). The Daml baseline uses `dpm test`'s in-memory ledger; the STL cases use Canton 3.5.6. Logs and original JUnit results are artifacts.

Coverage is partial: created events identify replacement contracts, rather than proving returned choice values. Named skipped subtests record unsupported assertions, grouped per original case:

- **R**: STL beta does not currently expose choice return CIDs/tuple order.
- **I**: STL beta does not expose interface views or evaluate pure Daml `Pausable.isPaused`. Template payload fields do not replace these assertions.
- **M**: Canton 3.5.6 Ledger API merges application metadata into engine context and overwrites reserved keys; the original `FailureStatus.meta` cannot be recovered exactly. Executed error checks require `DAML_FAILURE`, exact application ID/category/message, and reject unknown context entries; they do not claim full status equality.

| Original case (pinned source) | Executed checks | Skipped assertions |
| --- | --- | --- |
| [`test_withdrawRunsWhileUnpaused`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L41-L48) | Owner withdraws 40; owner queries balance 60 and payout 40. | R |
| [`test_withdrawRefusesNonPositiveAmount`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L51-L55) | Owner withdraws -10; exact non-positive-amount error, category 8, message. | M |
| [`test_withdrawRefusesAmountAboveBalance`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L58-L62) | Owner withdraws 100.5; exact insufficient-balance error, category 9, message. | M |
| [`test_pauseIsVisibleThroughTheView`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L65-L72) | Admin pauses; owner can query successor Vault. | R, I: PausableView true and isPaused true |
| [`test_withdrawRefusedWhilePaused`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L75-L80) | Admin pauses; owner withdraws 10; exact enforced-pause error. | R, M |
| [`test_redeemStaysOpenWhilePaused`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L84-L93) | Admin pauses; owner redeems; owner queries payout 100 to owner and balance 0. | R |
| [`test_pauseWhenPausedFails`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L96-L101) | Admin pauses twice; exact enforced-pause error. | R, M |
| [`test_emergencyDrainRunsWhilePaused`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L105-L114) | Admin pauses/drains; admin queries payout 100 to owner and balance 0. | R |
| [`test_emergencyDrainRefusedWhileUnpaused`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L117-L121) | Admin drains unpaused Vault; exact expected-pause error. | M |
| [`test_unpauseRestoresOperation`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L124-L135) | Admin pauses/unpauses and queries Vault; owner withdraws 40 and queries balance 60/payout 40. | R, I: isPaused false |
| [`test_unpauseWhenUnpausedFails`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L138-L142) | Admin unpauses unpaused Vault; exact expected-pause error. | M |
| [`test_flagSurvivesRedeemAndDrain`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L147-L158) | Pause; owner redeems/queries; owner withdraws 1 gets exact enforced-pause; admin drains/queries. | R, M, I: isPaused true after Redeem and Drain |
| [`test_ownerCannotFlipOrDrain`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L162-L168) | Owner cannot Pause; admin pauses; owner cannot Unpause or Drain (Daml authorization errors). | R |
| [`test_archiveRequiresBothSignatories`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L170-L177) | Admin-only and owner-only Archive give AuthorizationError; joint Archive succeeds; CID absent for both. | None |
| [`test_payoutArchiveRequiresPayer`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L179-L188) | Owner withdraws 40; owner Archive Payout gives AuthorizationError; admin archives; payout absent for both, owner balance 60. | R |

The 15 scenario tests contain 14 grouped skipped subtests (29 runner tests: 15 executed + 14 skipped). Categories occur in 10 cases for R, 3 for I and 7 for M. Only `test_archiveRequiresBothSignatories` has no skipped original assertions. Authorization checks identify Daml engine errors, not token enforcement. Other OZ modules are outside this suite.

To reproduce from a fresh clone, install Node 24.10.0, Java 21 and [DPM](https://docs.canton.network/sdks-tools/cli-tools/dpm#installation) 1.0.21 on PATH, with `JAVA_HOME` pointing to Java 21. SDK bundle 3.5.8 supplies the compiler; the Sandbox runtime is installed separately:

```sh
npm ci
git clone https://github.com/OpenZeppelin/canton-contracts.git .upstream
git -C .upstream checkout --detach 1899f7a4326c9e1b6b76cb434e490e2e82331d9c
mkdir -p .reports
(cd .upstream && dpm install && DAML_PACKAGE=examples/pausable/vault-test dpm build)
(cd .upstream && DAML_PACKAGE=examples/pausable/vault-test dpm test --test-pattern test_ --junit "$PWD/../.reports/original.xml")

runtime_config="$(mktemp -d)"
printf 'components:\n  - canton-open-source:3.5.6\n' > "$runtime_config/daml.yaml"
(cd "$runtime_config" && dpm install package)
rm -rf "$runtime_config"

OZ_VAULT_DAR="$PWD/.upstream/examples/pausable/vault/.daml/dist/pausable-vault-example-0.0.0.dar" npm test
```
