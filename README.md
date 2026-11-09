# canton-stl-oz-tests

This repository uses STL's published npm beta to execute selected original OpenZeppelin scenarios from TypeScript against a real Canton Sandbox. The contracts stay unchanged.

The goal is to check how STL's helpers work with existing contracts and make the beta's capabilities and limits visible through concrete tests.

We chose three suites that exercise different uses of the library:

- **[Token](tests/token.test.ts)** starts from tests that OpenZeppelin already runs against a real Sandbox in its own CI. Their [Sandbox job](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/.github/workflows/ci.yml#L41-L61) calls [these three token scripts](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/scripts/check-sandbox.sh#L37-L45). We reproduce the mint/query case to check holding amounts and visibility through each party's queries; transfers and mint/burn remain outside this PoC's scope.
- **[Token utils](tests/token-utils.test.ts)** adds a coherent group of checks that the current beta can cover more fully. The selected consumption and expiry tests check rejection of wrong admins, accounts, locks and cancellation conditions, complementing Vault's successful application flows. These originals also run with `dpm test`; they are not part of OZ's Sandbox CI gate.
- **[Vault](tests/vault.test.ts)** provides a small application with understandable state changes: withdrawing funds, pausing, unpausing and recovery. It shows how STL can drive application scenarios and inspect the resulting contracts from TypeScript. OZ runs the [original Vault suite](https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml) with `dpm test` in memory; our port exercises those scenarios through the real Ledger API.

Some checks are intentionally skipped because of this PoC's scope or current limitations; comments beside each skip explain why.

## Technical details

Use Node 24.10.0, Java 21 (`JAVA_HOME` set), and [DPM](https://docs.canton.network/sdks-tools/cli-tools/dpm#installation) 1.0.21 on PATH. Tests use `@cobuilders/canton-stl@0.1.0-beta.2`, SDK bundle 3.5.8 and Canton 3.5.6.

Install dependencies, check out the pinned OZ sources, and install the SDK and separate Sandbox runtime:

```sh
npm ci
git clone https://github.com/OpenZeppelin/canton-contracts.git .upstream
git -C .upstream checkout --detach 1899f7a4326c9e1b6b76cb434e490e2e82331d9c
(cd .upstream && dpm install)
runtime_config="$(mktemp -d)"
printf 'components:\n  - canton-open-source:3.5.6\n' > "$runtime_config/daml.yaml"
(cd "$runtime_config" && dpm install package)
rm -rf "$runtime_config"
```

Build each selected original test package and its dependencies:

```sh
(cd .upstream && DAML_PACKAGE=examples/pausable/vault-test dpm build)
(cd .upstream && DAML_PACKAGE=test/token-cip112-v1-test dpm build)
(cd .upstream && DAML_PACKAGE=test/token-cip112-utils-test dpm build)
```

Run the ports independently (`npm test` runs only Vault):

```sh
OZ_VAULT_DAR="$PWD/.upstream/examples/pausable/vault/.daml/dist/pausable-vault-example-0.0.0.dar" npm test
OZ_TOKEN_DAR="$PWD/.upstream/packages/token/token-cip112-v1/.daml/dist/openzeppelin-token-cip112-v1-0.1.0.dar" npm run test:token
OZ_TOKEN_UTILS_DAR="$PWD/.upstream/test/token-cip112-utils-test/.daml/dist/openzeppelin-token-cip112-utils-test-0.0.0.dar" npm run test:token-utils
```

Run the unchanged original baselines in memory. Upstream also includes token mint/query in its Sandbox gate; utils is outside that gate:

```sh
(cd .upstream && DAML_PACKAGE=examples/pausable/vault-test dpm test --test-pattern test_)
(cd .upstream && DAML_PACKAGE=test/token-cip112-v1-test dpm test --test-pattern sandboxMintAndQuery)
(cd .upstream && DAML_PACKAGE=test/token-cip112-utils-test dpm test --test-pattern test)
```

| Suite | Original baseline | STL port coverage |
| --- | --- | --- |
| Vault | 15 cases | 15 business checks; 14 scenarios have a skipped assertion. |
| Token | Only mint/query: 1 case | 1 case runs; transfer lifecycle and mint/burn are omitted by PoC scope. |
| Token utils | All 20 package cases | 9 guards run from the selected 10-case block; 1 live-deadline case is skipped. |

Mint/query and the executed utils guards omit unused clock setup while preserving payload dates; mint/query also omits unused TokenRules/disclosure/settlement setup. This is not literal fixture parity.

The ports use an open Sandbox; JWT authentication is not validated.

[GitHub Actions](https://github.com/CoBuilders-xyz/canton-stl-oz-tests/actions/workflows/tests.yml) runs independent `vault`, `token` and `token-utils` jobs. They upload separate `oz-<suite>-test` artifacts containing `.reports/<suite>/` logs and JUnit results, including on failure.
