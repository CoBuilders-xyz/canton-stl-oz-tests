import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  asParty, freshParties, LedgerApiError, singleCreatedContract, startSandbox,
  type CreatedContract, type PartyContext, type SandboxSession,
} from "@cobuilders/canton-stl";

// Original: https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/test/token-cip112-utils-test/daml/OpenZeppelin/Token/Cip112/Utils/Test.daml
const moduleName = "OpenZeppelin.Token.Cip112.Utils.Test";
const templateId = (name: string) => `#openzeppelin-token-cip112-utils-test:${moduleName}:${name}`;
const t1 = "2026-01-01T00:10:00Z";
const t2 = "2026-01-01T00:20:00Z";
const basicAccount = (owner: string) => ({ owner, provider: null, id: "" });
const lockUntil = (holder: string, expiresAt: string | null) => ({
  holders: [holder], expiresAt, expiresAfter: null, context: null,
});

function holdingView(admin: string, account: ReturnType<typeof basicAccount>, amount: string, lock: ReturnType<typeof lockUntil> | null) {
  return { account, instrumentId: { admin, id: "TOK" }, amount, lock, meta: { values: {} } };
}

function allocationView(admin: string, alice: string) {
  return {
    originalAllocationCid: null,
    settlement: { executors: [admin], id: "s", cid: null, meta: { values: {} } },
    allocation: {
      admin, authorizer: basicAccount(alice), transferLegSides: [], settlementDeadline: t2,
      nextIterationFunding: {}, committed: false, meta: { values: {} },
    },
    holdingCids: [], createdAt: t1, numIterations: "0", expiresAt: t2 as string | null,
    availableActions: [], meta: { values: {} },
  };
}

async function create(client: PartyContext, name: string, createArguments: Record<string, unknown>) {
  return singleCreatedContract(await client.submit([{ CreateCommand: { templateId: templateId(name), createArguments } }]));
}

function exercise(contract: CreatedContract, choice: string, choiceArgument: Record<string, unknown>) {
  return { ExerciseCommand: { templateId: contract.templateId, contractId: contract.contractId, choice, choiceArgument } };
}

// The original mustFailWith matches this exact substring, not arbitrary rejection.
async function mustFailWith(submission: Promise<unknown>, expected: string) {
  await assert.rejects(submission, (error: unknown) => {
    assert.ok(error instanceof LedgerApiError);
    const body = error.responseBody as { cause?: unknown };
    assert.equal(typeof body.cause, "string");
    assert.ok((body.cause as string).includes(expected), JSON.stringify(error.responseBody));
    return true;
  });
}

describe("OpenZeppelin token utils on a real open Sandbox", { timeout: 180_000 }, () => {
  let sandbox: SandboxSession;
  before(async () => {
    const dar = process.env.OZ_TOKEN_UTILS_DAR;
    if (!dar) throw new Error("Set OZ_TOKEN_UTILS_DAR to the pinned OZ utils test DAR (see README.md).");
    sandbox = await startSandbox({ dars: [dar], cantonVersion: "3.5.6" });
  });
  after(async () => { await sandbox?.stop(); });

  async function setup() {
    const parties = await freshParties(sandbox, ["admin", "alice", "attacker"]);
    const admin = asParty(sandbox, parties.admin);
    const alice = asParty(sandbox, parties.alice);
    const joint = asParty(sandbox, parties.admin, { actAs: [admin.partyId, alice.partyId] });
    // Original setup sets t1. These executed paths do not read ledger time; payload
    // dates stay unchanged. The live-deadline case below is skipped instead of changing time.
    const harness = await create(joint, "Harness", { admin: admin.partyId, owner: alice.partyId });
    return { parties, admin, alice, joint, harness };
  }

  describe("testConsumeLockedRefusesOtherAdmin", () => {
    it("Locked holding from another instrument admin gets the original admin mismatch", async () => {
      const { parties, admin, alice, harness } = await setup();
      const other = (await freshParties(sandbox, ["otherAdmin"])).otherAdmin;
      const creators = asParty(sandbox, other, { actAs: [other.partyId, alice.partyId] });
      const holding = await create(creators, "UnitHolding", { holding: holdingView(other.partyId, basicAccount(alice.partyId), "5.0", lockUntil(other.partyId, t2)) });
      const actors = [admin.partyId, other.partyId];
      await mustFailWith(asParty(sandbox, parties.admin, { actAs: actors }).submit([
        exercise(harness, "Harness_ConsumeLocked", { cid: holding.contractId, expectedAccount: basicAccount(alice.partyId), actors }),
      ]), "'inputHolding.instrumentId.admin' is not equal to");
    });
  });

  describe("testConsumeLockedRefusesOtherAccount", () => {
    it("Locked savings holding gets the original account mismatch", async () => {
      const { admin, alice, joint, harness } = await setup();
      const holding = await create(joint, "UnitHolding", { holding: holdingView(admin.partyId, { ...basicAccount(alice.partyId), id: "savings" }, "5.0", lockUntil(admin.partyId, t2)) });
      await mustFailWith(admin.submit([exercise(harness, "Harness_ConsumeLocked", {
        cid: holding.contractId, expectedAccount: basicAccount(alice.partyId), actors: [admin.partyId],
      })]), "'inputHolding.account' is not equal to");
    });
  });

  describe("testConsumeLockedRefusesUnlockedHolding", () => {
    it("Unlocked holding is refused by the locked-consumption guard", async () => {
      const { admin, alice, joint, harness } = await setup();
      const holding = await create(joint, "UnitHolding", { holding: holdingView(admin.partyId, basicAccount(alice.partyId), "5.0", null) });
      await mustFailWith(admin.submit([exercise(harness, "Harness_ConsumeLocked", {
        cid: holding.contractId, expectedAccount: basicAccount(alice.partyId), actors: [admin.partyId],
      })]), "input holding must be locked");
    });
  });

  describe("testConsumeUnlockedRefusesOtherAdmin", () => {
    it("Unlocked holding from another instrument admin gets the original admin mismatch", async () => {
      const { parties, admin, alice, harness } = await setup();
      const other = (await freshParties(sandbox, ["otherAdmin"])).otherAdmin;
      const holding = await create(asParty(sandbox, other, { actAs: [other.partyId, alice.partyId] }), "UnitHolding", {
        holding: holdingView(other.partyId, basicAccount(alice.partyId), "5.0", null),
      });
      const actors = [admin.partyId, other.partyId];
      await mustFailWith(asParty(sandbox, parties.admin, { actAs: actors }).submit([
        exercise(harness, "Harness_ConsumeUnlocked", { cid: holding.contractId, expectedAccount: basicAccount(alice.partyId), actors }),
      ]), "'inputHolding.instrumentId.admin' is not equal to");
    });
  });

  describe("testConsumeUnlockedRefusesOtherAccount", () => {
    it("Unlocked savings holding gets the original account mismatch", async () => {
      const { admin, alice, joint, harness } = await setup();
      const holding = await create(joint, "UnitHolding", { holding: holdingView(admin.partyId, { ...basicAccount(alice.partyId), id: "savings" }, "5.0", null) });
      await mustFailWith(admin.submit([exercise(harness, "Harness_ConsumeUnlocked", {
        cid: holding.contractId, expectedAccount: basicAccount(alice.partyId), actors: [admin.partyId],
      })]), "'inputHolding.account' is not equal to");
    });
  });

  describe("testConsumeUnlockedRefusesIndefiniteLock", () => {
    it("Indefinitely locked holding gets the original indefinite-lock refusal", async () => {
      const { admin, alice, joint, harness } = await setup();
      const holding = await create(joint, "UnitHolding", { holding: holdingView(admin.partyId, basicAccount(alice.partyId), "5.0", lockUntil(admin.partyId, null)) });
      await mustFailWith(admin.submit([exercise(harness, "Harness_ConsumeUnlocked", {
        cid: holding.contractId, expectedAccount: basicAccount(alice.partyId), actors: [admin.partyId],
      })]), "input holding is locked indefinitely");
    });
  });

  async function expireUnit(admin: PartyContext, harness: CreatedContract, claimedView: ReturnType<typeof allocationView>, cancelActors: string[]) {
    const allocation = await create(admin, "UnitAllocation", { claimedView, admin: admin.partyId });
    return exercise(harness, "Harness_ExpireAllocations", {
      cancelArgs: [{ _1: allocation.contractId, _2: { actors: cancelActors, extraArgs: { context: { values: {} }, meta: { values: {} } } } }],
      actors: [admin.partyId],
    });
  }

  // The originals set t3 in these three tests; all reject before reading expiry time.
  describe("testExpireAllocationsRefusesOtherCancelActors", () => {
    it("Expiry refuses extra cancellation actors with the original mismatch", async () => {
      const { admin, alice, harness } = await setup();
      const command = await expireUnit(admin, harness, allocationView(admin.partyId, alice.partyId), [admin.partyId, alice.partyId]);
      await mustFailWith(admin.submit([command]), "'cancelArg.actors' is not equal to");
    });
  });

  describe("testExpireAllocationsRefusesOtherAdmin", () => {
    it("Expiry refuses an allocation naming another admin", async () => {
      const { admin, alice, harness } = await setup();
      const view = allocationView(admin.partyId, alice.partyId);
      view.allocation.admin = alice.partyId;
      const command = await expireUnit(admin, harness, view, [admin.partyId]);
      await mustFailWith(admin.submit([command]), "'allocation.admin' is not equal to");
    });
  });

  describe("testExpireAllocationsRefusesNoExpiry", () => {
    it("Expiry refuses an allocation without an expiry time", async () => {
      const { admin, alice, harness } = await setup();
      const view = { ...allocationView(admin.partyId, alice.partyId), expiresAt: null };
      const command = await expireUnit(admin, harness, view, [admin.partyId]);
      await mustFailWith(admin.submit([command]), "cannot expire an allocation without an expiry time");
    });
  });

  describe("testExpireAllocationsRefusesLiveAllocation", () => {
    // The original requires ledger t1 strictly before its unchanged t2 deadline.
    // STL beta.2 cannot configure static time; wall-clock would reach the stub
    // cancellation's different failure. No changed date or arbitrary rejection substitutes.
    it.skip("Not checked: live allocation gets the original deadline refusal at t1", () => {});
  });
});
