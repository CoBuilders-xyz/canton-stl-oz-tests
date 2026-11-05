# canton-stl-oz-tests

Partial port of OpenZeppelin's [`test_withdrawRunsWhileUnpaused`](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L41-L48), using the published `@cobuilders/canton-stl@0.1.0-beta.1` on a real local open Sandbox.

[GitHub Actions](https://github.com/CoBuilders-xyz/canton-stl-oz-tests/actions/workflows/tests.yml) checks out the pinned OZ sources, installs the toolchain, builds Vault and runs this scenario on pushes to main and pull requests. It can also be run manually. Logs record the source commit, toolchain, build and test result.

To reproduce from a fresh clone of this repository, install Node 24.10.0, Java 21 and [DPM](https://docs.canton.network/sdks-tools/cli-tools/dpm#installation) 1.0.21, with binaries on PATH and `JAVA_HOME` pointing to Java 21. The commands below install SDK bundle 3.5.8 and the separate Canton 3.5.6 runtime, then build unmodified OZ commit `1899f7a4326c9e1b6b76cb434e490e2e82331d9c`:

```sh
npm ci
git clone https://github.com/OpenZeppelin/canton-contracts.git .upstream
git -C .upstream checkout --detach 1899f7a4326c9e1b6b76cb434e490e2e82331d9c
(cd .upstream && dpm install && DAML_PACKAGE=examples/pausable/vault dpm build)

runtime_config="$(mktemp -d)"
printf 'components:\n  - canton-open-source:3.5.6\n' > "$runtime_config/daml.yaml"
(cd "$runtime_config" && dpm install package)
rm -rf "$runtime_config"

OZ_VAULT_DAR="$PWD/.upstream/examples/pausable/vault/.daml/dist/pausable-vault-example-0.0.0.dar" npm test
```

The suite starts one Sandbox in `before` and stops it in `after`; each test creates fresh parties and its own Vault. This case creates a Vault jointly as admin and owner with balance 100 and paused false, withdraws 40 as owner, then queries the created Vault and Payout as owner and checks balance 60 and payout amount 40.

These business-state checks reproduce the original values and querying party. STL identifies the contracts through created events; a named skipped subtest records that beta's ACS_DELTA response omits the exercise result, so the returned CIDs and their tuple order are not verified. Coverage is partial, not exact parity. This test does not cover token enforcement or the rest of OZ's original suite.
