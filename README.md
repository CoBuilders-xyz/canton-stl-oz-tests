# canton-stl-oz-tests

Reproduces the 15 [OpenZeppelin Pausable Vault tests](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml) using `@cobuilders/canton-stl@0.1.0-beta.1` against a shared local Sandbox, with fresh parties and contracts per case.

**Skips are intentional:** the current STL beta does not support every original assertion yet. Each skipped check has a source comment explaining the limitation, including cases where Canton's JSON response cannot preserve the original information. The console marks scenarios as `COMPLETE`, `PARTIAL` or `FAILED`.

[GitHub Actions](https://github.com/CoBuilders-xyz/canton-stl-oz-tests/actions/workflows/tests.yml) builds the pinned OZ sources, runs the unchanged Daml tests, then runs this suite. Logs and original JUnit results are available as artifacts.

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
