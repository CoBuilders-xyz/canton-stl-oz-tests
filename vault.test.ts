import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  asParty, createdContracts, freshParties, LedgerApiError, singleCreatedContract, startSandbox,
  type CreatedContract, type PartyContext, type SandboxSession,
} from "@cobuilders/canton-stl";

// Original module: linked in README.md; scenario names match the pinned OZ tests.
const moduleName = "OpenZeppelin.Examples.Pausable.Vault";
const templateId = `#pausable-vault-example:${moduleName}:Vault`;

const nonPositiveAmount = { errorId: "myapp.com/vault-non-positive-amount", category: 8, message: "Vault: amount must be positive" };
const insufficientBalance = { errorId: "myapp.com/vault-insufficient-balance", category: 9, message: "Vault: amount exceeds balance" };
const enforcedPause = { errorId: "openzeppelin.com/pausable-enforced-pause", category: 9, message: "Pausable: the contract is paused" };
const expectedPause = { errorId: "openzeppelin.com/pausable-expected-pause", category: 9, message: "Pausable: the contract is not paused" };

function exercise(contract: CreatedContract, choice: string, choiceArgument: Record<string, unknown> = {}) {
  return { ExerciseCommand: { templateId: contract.templateId, contractId: contract.contractId, choice, choiceArgument } };
}

function created(transaction: unknown, template: "Vault" | "Payout") {
  const contract = createdContracts(transaction).find((event) => event.templateId.endsWith(`:${moduleName}:${template}`));
  assert.ok(contract, `${template} was created`);
  return contract;
}

async function query(client: PartyContext, contract: CreatedContract) {
  return (await client.contracts()).find((active) => active.contractId === contract.contractId);
}

async function visible(client: PartyContext, contract: CreatedContract) {
  const active = await query(client, contract);
  assert.ok(active, `${client.partyId} can query ${contract.contractId}`);
  return active.createArgument;
}

// Daml Decimal equality permits different scales without rounding the value.
function decimal(value: unknown) {
  assert.equal(typeof value, "string");
  return (value as string).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

async function mustFailWith(submission: Promise<unknown>, expected: typeof nonPositiveAmount) {
  await assert.rejects(submission, (error: unknown) => {
    assert.ok(error instanceof LedgerApiError);
    const body = error.responseBody as {
      code: unknown; cause: unknown; errorCategory: unknown;
      context: Record<string, unknown>;
    };
    assert.deepEqual({
      code: body.code, errorId: body.context.error_id, category: body.errorCategory, cause: body.cause,
    }, {
      code: "DAML_FAILURE", errorId: expected.errorId, category: expected.category,
      cause: `Interpretation error: Error: User failure: ${expected.errorId} (error category ${expected.category}): ${expected.message}`,
    });
    // Reject unknown entries, without claiming the remaining context is the original meta map.
    const knownContext = ["category", "commands", "definite_answer", "error_id", "exercise_trace", "participant", "tid"];
    assert.deepEqual(Object.keys(body.context).filter((key) => !knownContext.includes(key)), []);
    return true;
  });
}

async function mustFailAuthorization(submission: Promise<unknown>) {
  await assert.rejects(submission, (error: unknown) => {
    assert.ok(error instanceof LedgerApiError);
    assert.equal((error.responseBody as { code: unknown }).code, "DAML_AUTHORIZATION_ERROR");
    return true;
  });
}

describe("OpenZeppelin Pausable Vault on a real open Sandbox", { timeout: 180_000 }, () => {
  let sandbox: SandboxSession;

  before(async () => {
    const dar = process.env.OZ_VAULT_DAR;
    if (!dar) throw new Error("Set OZ_VAULT_DAR to the pinned OZ Vault DAR (see README.md).");
    sandbox = await startSandbox({ dars: [dar], cantonVersion: "3.5.6" });
  });
  after(async () => { await sandbox?.stop(); });

  async function setup() {
    const parties = await freshParties(sandbox, ["admin", "owner"]);
    const admin = asParty(sandbox, parties.admin);
    const owner = asParty(sandbox, parties.owner);
    const joint = asParty(sandbox, parties.admin, { actAs: [admin.partyId, owner.partyId] });
    const initial = singleCreatedContract(await joint.submit([{ CreateCommand: {
      templateId,
      createArguments: { admin: admin.partyId, owner: owner.partyId, balance: "100.0", paused: false },
    } }]));
    return { admin, owner, joint, initial };
  }

  describe("test_withdrawRunsWhileUnpaused", () => {
    it("Owner withdraws 40 and sees balance 60 and payout 40", async () => {
      const { owner, initial } = await setup();
      const transaction = await owner.submit([exercise(initial, "Vault_Withdraw", { amount: "40.0" })]);
      const v = await visible(owner, created(transaction, "Vault"));
      assert.equal(decimal(v.balance), "60");
      const p = await visible(owner, created(transaction, "Payout"));
      assert.equal(decimal(p.amount), "40");
    });

    // STL 0.1.0-beta.2 does not currently expose choice return values; created events cannot verify
    // returned CIDs/order.
    it.skip("Not checked: Vault_Withdraw returns the queried Vault and Payout CIDs in tuple order", () => {});
  });

  describe("test_withdrawRefusesNonPositiveAmount", () => {
    it("Owner withdrawal of -10 gets the exact non-positive-amount error", async () => {
      const { owner, initial } = await setup();
      await mustFailWith(owner.submit([exercise(initial, "Vault_Withdraw", { amount: "-10.0" })]), nonPositiveAmount);
    });

    // Canton 3.5.6 Ledger API merges application metadata into engine context and overwrites
    // reserved keys; exact FailureStatus.meta cannot be recovered.
    it.skip("Not checked: eNonPositiveAmount has exactly empty FailureStatus.meta", () => {});
  });

  describe("test_withdrawRefusesAmountAboveBalance", () => {
    it("Owner withdrawal of 100.5 gets the exact insufficient-balance error", async () => {
      const { owner, initial } = await setup();
      await mustFailWith(owner.submit([exercise(initial, "Vault_Withdraw", { amount: "100.5" })]), insufficientBalance);
    });

    // Canton 3.5.6 Ledger API merges application metadata into engine context and overwrites
    // reserved keys; exact FailureStatus.meta cannot be recovered.
    it.skip("Not checked: eInsufficientBalance has exactly empty FailureStatus.meta", () => {});
  });

  describe("test_pauseIsVisibleThroughTheView", () => {
    it("Admin pause succeeds and owner can query the successor Vault", async () => {
      const { admin, owner, initial } = await setup();
      const vault = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
      await visible(owner, vault);
    });

    // STL 0.1.0-beta.2 does not currently expose choice return values; created events cannot verify
    // returned CIDs/order.
    // STL 0.1.0-beta.2 does not expose interface views or evaluate the pure Daml Pausable.isPaused
    // function.
    it.skip("Not checked: Pause return CID; owner PausableView {paused=True}; Daml isPaused=True", () => {});
  });

  describe("test_withdrawRefusedWhilePaused", () => {
    it("Owner withdrawal of 10 after admin pause gets the exact enforced-pause error", async () => {
      const { admin, owner, initial } = await setup();
      const vault = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
      await mustFailWith(owner.submit([exercise(vault, "Vault_Withdraw", { amount: "10.0" })]), enforcedPause);
    });

    // STL 0.1.0-beta.2 does not currently expose choice return values; created events cannot verify
    // returned CIDs/order.
    // Canton 3.5.6 Ledger API merges application metadata into engine context and overwrites
    // reserved keys; exact FailureStatus.meta cannot be recovered.
    it.skip("Not checked: Pause return CID; eEnforcedPause.meta", () => {});
  });

  describe("test_redeemStaysOpenWhilePaused", () => {
    it("Owner redeems while paused and sees payout 100 to owner and balance 0", async () => {
      const { admin, owner, initial } = await setup();
      const paused = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
      const transaction = await owner.submit([exercise(paused, "Vault_Redeem")]);
      const p = await visible(owner, created(transaction, "Payout"));
      assert.equal(decimal(p.amount), "100");
      assert.equal(p.recipient, owner.partyId);
      const v = await visible(owner, created(transaction, "Vault"));
      assert.equal(decimal(v.balance), "0");
    });

    // STL 0.1.0-beta.2 does not currently expose choice return values; created events cannot verify
    // returned CIDs/order.
    it.skip("Not checked: Pause return CID and Redeem returned CID tuple", () => {});
  });

  describe("test_pauseWhenPausedFails", () => {
    it("A second admin pause gets the exact enforced-pause error", async () => {
      const { admin, initial } = await setup();
      const vault = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
      await mustFailWith(admin.submit([exercise(vault, "Vault_Pause")]), enforcedPause);
    });

    // STL 0.1.0-beta.2 does not currently expose choice return values; created events cannot verify
    // returned CIDs/order.
    // Canton 3.5.6 Ledger API merges application metadata into engine context and overwrites
    // reserved keys; exact FailureStatus.meta cannot be recovered.
    it.skip("Not checked: First Pause return CID; eEnforcedPause.meta", () => {});
  });

  describe("test_emergencyDrainRunsWhilePaused", () => {
    it("Admin drains while paused and sees payout 100 to owner and balance 0", async () => {
      const { admin, owner, initial } = await setup();
      const paused = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
      const transaction = await admin.submit([exercise(paused, "Vault_EmergencyDrain")]);
      const p = await visible(admin, created(transaction, "Payout"));
      assert.equal(decimal(p.amount), "100");
      assert.equal(p.recipient, owner.partyId);
      const v = await visible(admin, created(transaction, "Vault"));
      assert.equal(decimal(v.balance), "0");
    });

    // STL 0.1.0-beta.2 does not currently expose choice return values; created events cannot verify
    // returned CIDs/order.
    it.skip("Not checked: Pause return CID and EmergencyDrain returned CID tuple", () => {});
  });

  describe("test_emergencyDrainRefusedWhileUnpaused", () => {
    it("Admin drain of an unpaused Vault gets the exact expected-pause error", async () => {
      const { admin, initial } = await setup();
      await mustFailWith(admin.submit([exercise(initial, "Vault_EmergencyDrain")]), expectedPause);
    });

    // Canton 3.5.6 Ledger API merges application metadata into engine context and overwrites
    // reserved keys; exact FailureStatus.meta cannot be recovered.
    it.skip("Not checked: eExpectedPause has exactly empty FailureStatus.meta", () => {});
  });

  describe("test_unpauseRestoresOperation", () => {
    it("Admin unpauses and owner withdraws 40, seeing balance 60 and payout 40", async () => {
      const { admin, owner, initial } = await setup();
      const paused = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
      const unpaused = created(await admin.submit([exercise(paused, "Vault_Unpause")]), "Vault");
      await visible(admin, unpaused);
      const transaction = await owner.submit([exercise(unpaused, "Vault_Withdraw", { amount: "40.0" })]);
      const v = await visible(owner, created(transaction, "Vault"));
      assert.equal(decimal(v.balance), "60");
      const p = await visible(owner, created(transaction, "Payout"));
      assert.equal(decimal(p.amount), "40");
    });

    // STL 0.1.0-beta.2 does not currently expose choice return values; created events cannot verify
    // returned CIDs/order.
    // STL 0.1.0-beta.2 does not expose interface views or evaluate the pure Daml Pausable.isPaused
    // function.
    it.skip("Not checked: Pause/Unpause/Withdraw return values; Daml isPaused=False", () => {});
  });

  describe("test_unpauseWhenUnpausedFails", () => {
    it("Admin unpause of an unpaused Vault gets the exact expected-pause error", async () => {
      const { admin, initial } = await setup();
      await mustFailWith(admin.submit([exercise(initial, "Vault_Unpause")]), expectedPause);
    });

    // Canton 3.5.6 Ledger API merges application metadata into engine context and overwrites
    // reserved keys; exact FailureStatus.meta cannot be recovered.
    it.skip("Not checked: eExpectedPause has exactly empty FailureStatus.meta", () => {});
  });

  describe("test_flagSurvivesRedeemAndDrain", () => {
    it("After Redeem, owner withdrawal of 1 gets enforced-pause; admin can Drain and query", async () => {
      const { admin, owner, initial } = await setup();
      const paused = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
      const redeemed = created(await owner.submit([exercise(paused, "Vault_Redeem")]), "Vault");
      await visible(owner, redeemed);
      await mustFailWith(owner.submit([exercise(redeemed, "Vault_Withdraw", { amount: "1.0" })]), enforcedPause);
      const drained = created(await admin.submit([exercise(redeemed, "Vault_EmergencyDrain")]), "Vault");
      await visible(admin, drained);
    });

    // STL 0.1.0-beta.2 does not currently expose choice return values; created events cannot verify
    // returned CIDs/order.
    // Canton 3.5.6 Ledger API merges application metadata into engine context and overwrites
    // reserved keys; exact FailureStatus.meta cannot be recovered.
    // STL 0.1.0-beta.2 does not expose interface views or evaluate the pure Daml Pausable.isPaused
    // function.
    it.skip("Not checked: Pause/Redeem/Drain returns; Daml isPaused=True after Redeem and Drain; eEnforcedPause.meta", () => {});
  });

  describe("test_ownerCannotFlipOrDrain", () => {
    it("Owner cannot Pause, Unpause or Drain; admin can Pause", async () => {
      const { admin, owner, initial } = await setup();
      await mustFailAuthorization(owner.submit([exercise(initial, "Vault_Pause")]));
      const vault = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
      await mustFailAuthorization(owner.submit([exercise(vault, "Vault_Unpause")]));
      await mustFailAuthorization(owner.submit([exercise(vault, "Vault_EmergencyDrain")]));
    });

    // STL 0.1.0-beta.2 does not currently expose choice return values; created events cannot verify
    // returned CIDs/order.
    it.skip("Not checked: Administrator Pause returned CID", () => {});
  });

  describe("test_archiveRequiresBothSignatories", () => {
    it("Vault Archive requires both signatories and removes it from both parties' queries", async () => {
      const { admin, owner, joint, initial } = await setup();
      await mustFailAuthorization(admin.submit([exercise(initial, "Archive")]));
      await mustFailAuthorization(owner.submit([exercise(initial, "Archive")]));
      await joint.submit([exercise(initial, "Archive")]);
      assert.equal(await query(admin, initial), undefined);
      assert.equal(await query(owner, initial), undefined);
    });
  });

  describe("test_payoutArchiveRequiresPayer", () => {
    it("Only payer can archive Payout; it disappears for both and owner's Vault balance stays 60", async () => {
      const { admin, owner, initial } = await setup();
      const transaction = await owner.submit([exercise(initial, "Vault_Withdraw", { amount: "40.0" })]);
      const payout = created(transaction, "Payout");
      await mustFailAuthorization(owner.submit([exercise(payout, "Archive")]));
      await admin.submit([exercise(payout, "Archive")]);
      assert.equal(await query(admin, payout), undefined);
      assert.equal(await query(owner, payout), undefined);
      const v = await visible(owner, created(transaction, "Vault"));
      assert.equal(decimal(v.balance), "60");
    });

    // STL 0.1.0-beta.2 does not currently expose choice return values; created events cannot verify
    // returned CIDs/order.
    it.skip("Not checked: Withdraw returned Vault/Payout CIDs in tuple order", () => {});
  });
});
