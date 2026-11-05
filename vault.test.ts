import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  asParty, createdContracts, freshParties, singleCreatedContract, startSandbox,
  type SandboxSession,
} from "@cobuilders/canton-stl";

// Original: https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/examples/pausable/vault-test/daml/OpenZeppelin/Examples/Pausable/VaultTest.daml#L41-L48
const moduleName = "OpenZeppelin.Examples.Pausable.Vault";
const templateId = `#pausable-vault-example:${moduleName}:Vault`;

describe("OpenZeppelin Pausable Vault on a real open Sandbox", { timeout: 180_000 }, () => {
  let sandbox: SandboxSession;

  before(async () => {
    const dar = process.env.OZ_VAULT_DAR;
    if (!dar) throw new Error("Set OZ_VAULT_DAR to the pinned OZ Vault DAR (see README.md).");
    sandbox = await startSandbox({ dars: [dar], cantonVersion: "3.5.6" });
  });
  after(async () => { await sandbox?.stop(); });

  it("test_withdrawRunsWhileUnpaused", async (t) => {
    const parties = await freshParties(sandbox, ["admin", "owner"]);
    const admin = asParty(sandbox, parties.admin);
    const owner = asParty(sandbox, parties.owner);
    const joint = asParty(sandbox, parties.admin, { actAs: [admin.partyId, owner.partyId] });
    const initial = singleCreatedContract(await joint.submit([{ CreateCommand: {
      templateId,
      createArguments: { admin: admin.partyId, owner: owner.partyId, balance: "100.0", paused: false },
    } }]));

    const transaction = await owner.submit([{ ExerciseCommand: {
      templateId, contractId: initial.contractId,
      choice: "Vault_Withdraw", choiceArgument: { amount: "40.0" },
    } }]);
    const created = createdContracts(transaction);
    const vault = created.find((event) => event.templateId.endsWith(`:${moduleName}:Vault`));
    const payout = created.find((event) => event.templateId.endsWith(`:${moduleName}:Payout`));
    const active = await owner.contracts();
    const v = active.find((contract) => contract.contractId === vault?.contractId);
    const p = active.find((contract) => contract.contractId === payout?.contractId);
    assert.ok(v, "owner can query the successor Vault");
    assert.equal(Number(v.createArgument.balance), 60);
    assert.ok(p, "owner can query the Payout");
    assert.equal(Number(p.createArgument.amount), 40);

    await t.test("Vault_Withdraw returns the queried Vault and Payout CIDs in tuple order", {
      skip: "STL 0.1.0-beta.1 submit uses ACS_DELTA, which omits exerciseResult; created events cannot verify returned CIDs/order.",
    }, () => {});
  });
});
