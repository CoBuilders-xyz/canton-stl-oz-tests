import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  asParty, freshParties, singleCreatedContract, startSandbox,
  type CreatedContract, type PartyContext, type SandboxSession,
} from "@cobuilders/canton-stl";

// Original: https://github.com/OpenZeppelin/canton-contracts/blob/1899f7a4326c9e1b6b76cb434e490e2e82331d9c/test/token-cip112-v1-test/daml/OpenZeppelin/Token/Cip112/V1/Test/Sandbox.daml#L23-L35
const templateId = "#openzeppelin-token-cip112-v1:OpenZeppelin.Token.Cip112.V1.Holding:TokenHolding";

// Daml Decimal has scale 10; compare integer units without floating-point rounding.
function decimal(value: string) {
  assert.match(value, /^-?\d+(?:\.\d{1,10})?$/);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(10, "0"));
}

function holdingAmounts(contracts: CreatedContract[], owner: string, holdingTemplate: string) {
  return contracts.filter((contract) => contract.templateId === holdingTemplate)
    .map((contract) => contract.createArgument.holding as { account: { owner: string | null }; amount: string })
    .filter((holding) => holding.account.owner === owner)
    .map((holding) => decimal(holding.amount))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

describe("OpenZeppelin token holdings on a real open Sandbox", { timeout: 180_000 }, () => {
  let sandbox: SandboxSession;
  before(async () => {
    const dar = process.env.OZ_TOKEN_DAR;
    if (!dar) throw new Error("Set OZ_TOKEN_DAR to the pinned OZ token package DAR (see README.md).");
    sandbox = await startSandbox({ dars: [dar], cantonVersion: "3.5.6" });
  });
  after(async () => { await sandbox?.stop(); });

  describe("sandboxMintAndQuery", () => {
    it("Alice sees exactly 100, Bob sees exactly 50, and neither sees the other holding", async () => {
      // The original shared setup also allocates app, fixes t1, creates TokenRules and obtains
      // its disclosure, and constructs settlement/legs. These four assertions use none of them.
      const parties = await freshParties(sandbox, ["admin", "alice", "bob"]);
      const alice = asParty(sandbox, parties.alice);
      const bob = asParty(sandbox, parties.bob);
      async function mint(owner: PartyContext, amount: string) {
        const joint = asParty(sandbox, parties.admin, { actAs: [parties.admin.partyId, owner.partyId] });
        return singleCreatedContract(await joint.submit([{ CreateCommand: {
          templateId,
          createArguments: { holding: {
            account: { owner: owner.partyId, provider: null, id: "" },
            instrumentId: { admin: parties.admin.partyId, id: "TOK" },
            amount, lock: null, meta: { values: {} },
          } },
        } }]));
      }

      const aliceHolding = await mint(alice, "100.0");
      const bobHolding = await mint(bob, "50.0");
      const aliceAmounts = holdingAmounts(await alice.contracts(), alice.partyId, aliceHolding.templateId);
      assert.deepEqual(aliceAmounts, [decimal("100.0")]);
      const bobAmounts = holdingAmounts(await bob.contracts(), bob.partyId, bobHolding.templateId);
      assert.deepEqual(bobAmounts, [decimal("50.0")]);
      const bobViewOfAlice = (await bob.contracts()).find((contract) => contract.contractId === aliceHolding.contractId);
      assert.equal(bobViewOfAlice, undefined);
      const aliceViewOfBob = (await alice.contracts()).find((contract) => contract.contractId === bobHolding.contractId);
      assert.equal(aliceViewOfBob, undefined);
    });
  });

  describe("sandboxTransferLifecycle", () => {
    // Outside this PoC's scope. The original needs the admin-only TokenRules disclosure,
    // static time t1 inside its fixed t0/t2 window, and Completed/Pending choice results.
    // STL beta.2 cannot supply those disclosures, configure that clock, or expose those results.
    it.skip("Outside this PoC's scope", () => {});
  });

  describe("sandboxMintAndBurn", () => {
    // Outside this PoC's scope: the original mint-offer/accept and burn-request/accept
    // workflow is not ported; this placeholder executes none of its commands or assertions.
    it.skip("Outside this PoC's scope", () => {});
  });
});
