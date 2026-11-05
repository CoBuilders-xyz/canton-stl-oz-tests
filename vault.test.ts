import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  asParty, createdContracts, freshParties, LedgerApiError, singleCreatedContract, startSandbox,
  type CreatedContract, type PartyContext, type SandboxSession,
} from "@cobuilders/canton-stl";

// Original module and case mapping: README.md (OZ commit 1899f7a4326c9e1b6b76cb434e490e2e82331d9c).
const moduleName = "OpenZeppelin.Examples.Pausable.Vault";
const templateId = `#pausable-vault-example:${moduleName}:Vault`;
const returnLimitation = "STL 0.1.0-beta.1 does not currently expose choice return values; created events cannot verify returned CIDs/order.";
const metadataLimitation = "Canton 3.5.6 Ledger API merges application metadata into engine context and overwrites reserved keys; exact FailureStatus.meta cannot be recovered.";
const interfaceLimitation = "STL 0.1.0-beta.1 does not expose interface views or evaluate the pure Daml Pausable.isPaused function.";

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

  it("test_withdrawRunsWhileUnpaused", async (t) => {
    const { owner, initial } = await setup();
    const transaction = await owner.submit([exercise(initial, "Vault_Withdraw", { amount: "40.0" })]);
    const v = await visible(owner, created(transaction, "Vault"));
    assert.equal(decimal(v.balance), "60");
    const p = await visible(owner, created(transaction, "Payout"));
    assert.equal(decimal(p.amount), "40");
    await t.test("Vault_Withdraw returns the queried Vault and Payout CIDs in tuple order", {
      skip: returnLimitation,
    }, () => {});
  });

  it("test_withdrawRefusesNonPositiveAmount", async (t) => {
    const { owner, initial } = await setup();
    await mustFailWith(owner.submit([exercise(initial, "Vault_Withdraw", { amount: "-10.0" })]), nonPositiveAmount);
    await t.test("eNonPositiveAmount has exactly empty FailureStatus.meta", {
      skip: metadataLimitation,
    }, () => {});
  });

  it("test_withdrawRefusesAmountAboveBalance", async (t) => {
    const { owner, initial } = await setup();
    await mustFailWith(owner.submit([exercise(initial, "Vault_Withdraw", { amount: "100.5" })]), insufficientBalance);
    await t.test("eInsufficientBalance has exactly empty FailureStatus.meta", { skip: metadataLimitation }, () => {});
  });

  it("test_pauseIsVisibleThroughTheView", async (t) => {
    const { admin, owner, initial } = await setup();
    const vault = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
    await visible(owner, vault);
    await t.test("Pause return CID; owner PausableView {paused=True}; Daml isPaused=True", {
      skip: `${returnLimitation} ${interfaceLimitation}`,
    }, () => {});
  });

  it("test_withdrawRefusedWhilePaused", async (t) => {
    const { admin, owner, initial } = await setup();
    const vault = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
    await mustFailWith(owner.submit([exercise(vault, "Vault_Withdraw", { amount: "10.0" })]), enforcedPause);
    await t.test("Pause return CID; eEnforcedPause.meta", { skip: `${returnLimitation} ${metadataLimitation}` }, () => {});
  });

  it("test_redeemStaysOpenWhilePaused", async (t) => {
    const { admin, owner, initial } = await setup();
    const paused = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
    const transaction = await owner.submit([exercise(paused, "Vault_Redeem")]);
    const p = await visible(owner, created(transaction, "Payout"));
    assert.equal(decimal(p.amount), "100");
    assert.equal(p.recipient, owner.partyId);
    const v = await visible(owner, created(transaction, "Vault"));
    assert.equal(decimal(v.balance), "0");
    await t.test("Pause return CID and Redeem returned CID tuple", { skip: returnLimitation }, () => {});
  });

  it("test_pauseWhenPausedFails", async (t) => {
    const { admin, initial } = await setup();
    const vault = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
    await mustFailWith(admin.submit([exercise(vault, "Vault_Pause")]), enforcedPause);
    await t.test("First Pause return CID; eEnforcedPause.meta", { skip: `${returnLimitation} ${metadataLimitation}` }, () => {});
  });

  it("test_emergencyDrainRunsWhilePaused", async (t) => {
    const { admin, owner, initial } = await setup();
    const paused = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
    const transaction = await admin.submit([exercise(paused, "Vault_EmergencyDrain")]);
    const p = await visible(admin, created(transaction, "Payout"));
    assert.equal(decimal(p.amount), "100");
    assert.equal(p.recipient, owner.partyId);
    const v = await visible(admin, created(transaction, "Vault"));
    assert.equal(decimal(v.balance), "0");
    await t.test("Pause return CID and EmergencyDrain returned CID tuple", { skip: returnLimitation }, () => {});
  });

  it("test_emergencyDrainRefusedWhileUnpaused", async (t) => {
    const { admin, initial } = await setup();
    await mustFailWith(admin.submit([exercise(initial, "Vault_EmergencyDrain")]), expectedPause);
    await t.test("eExpectedPause has exactly empty FailureStatus.meta", { skip: metadataLimitation }, () => {});
  });

  it("test_unpauseRestoresOperation", async (t) => {
    const { admin, owner, initial } = await setup();
    const paused = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
    const unpaused = created(await admin.submit([exercise(paused, "Vault_Unpause")]), "Vault");
    await visible(admin, unpaused);
    const transaction = await owner.submit([exercise(unpaused, "Vault_Withdraw", { amount: "40.0" })]);
    const v = await visible(owner, created(transaction, "Vault"));
    assert.equal(decimal(v.balance), "60");
    const p = await visible(owner, created(transaction, "Payout"));
    assert.equal(decimal(p.amount), "40");
    await t.test("Pause/Unpause/Withdraw return values; Daml isPaused=False", {
      skip: `${returnLimitation} ${interfaceLimitation}`,
    }, () => {});
  });

  it("test_unpauseWhenUnpausedFails", async (t) => {
    const { admin, initial } = await setup();
    await mustFailWith(admin.submit([exercise(initial, "Vault_Unpause")]), expectedPause);
    await t.test("eExpectedPause has exactly empty FailureStatus.meta", { skip: metadataLimitation }, () => {});
  });

  it("test_flagSurvivesRedeemAndDrain", async (t) => {
    const { admin, owner, initial } = await setup();
    const paused = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
    const redeemed = created(await owner.submit([exercise(paused, "Vault_Redeem")]), "Vault");
    await visible(owner, redeemed);
    await mustFailWith(owner.submit([exercise(redeemed, "Vault_Withdraw", { amount: "1.0" })]), enforcedPause);
    const drained = created(await admin.submit([exercise(redeemed, "Vault_EmergencyDrain")]), "Vault");
    await visible(admin, drained);
    await t.test("Pause/Redeem/Drain returns; Daml isPaused=True after Redeem and Drain; eEnforcedPause.meta", {
      skip: `${returnLimitation} ${interfaceLimitation} ${metadataLimitation}`,
    }, () => {});
  });

  it("test_ownerCannotFlipOrDrain", async (t) => {
    const { admin, owner, initial } = await setup();
    await mustFailAuthorization(owner.submit([exercise(initial, "Vault_Pause")]));
    const vault = created(await admin.submit([exercise(initial, "Vault_Pause")]), "Vault");
    await mustFailAuthorization(owner.submit([exercise(vault, "Vault_Unpause")]));
    await mustFailAuthorization(owner.submit([exercise(vault, "Vault_EmergencyDrain")]));
    await t.test("Administrator Pause returned CID", { skip: returnLimitation }, () => {});
  });

  it("test_archiveRequiresBothSignatories", async () => {
    const { admin, owner, joint, initial } = await setup();
    await mustFailAuthorization(admin.submit([exercise(initial, "Archive")]));
    await mustFailAuthorization(owner.submit([exercise(initial, "Archive")]));
    await joint.submit([exercise(initial, "Archive")]);
    assert.equal(await query(admin, initial), undefined);
    assert.equal(await query(owner, initial), undefined);
  });

  it("test_payoutArchiveRequiresPayer", async (t) => {
    const { admin, owner, initial } = await setup();
    const transaction = await owner.submit([exercise(initial, "Vault_Withdraw", { amount: "40.0" })]);
    const payout = created(transaction, "Payout");
    await mustFailAuthorization(owner.submit([exercise(payout, "Archive")]));
    await admin.submit([exercise(payout, "Archive")]);
    assert.equal(await query(admin, payout), undefined);
    assert.equal(await query(owner, payout), undefined);
    const v = await visible(owner, created(transaction, "Vault"));
    assert.equal(decimal(v.balance), "60");
    await t.test("Withdraw returned Vault/Payout CIDs in tuple order", { skip: returnLimitation }, () => {});
  });
});
