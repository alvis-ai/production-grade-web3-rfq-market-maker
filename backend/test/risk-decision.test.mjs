import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRiskDecisionRepository } from "../dist/modules/risk/risk-decision.repository.js";

test("InMemoryRiskDecisionRepository stores idempotent approved and rejected decisions", async () => {
  const repository = new InMemoryRiskDecisionRepository();

  const approved = await repository.saveDecision({
    quoteId: "q_approved",
    decision: {
      status: "approved",
      policyVersion: "test-risk-v1",
    },
  });
  const approvedReplay = await repository.saveDecision({
    quoteId: "q_approved",
    decision: {
      status: "approved",
      policyVersion: "test-risk-v1",
    },
  });

  assert.equal(approved.riskDecisionId, "rd_q_approved");
  assert.equal(approved.decision, "approved");
  assert.equal(approved.reasonCode, undefined);
  assert.equal(approvedReplay.riskDecisionId, approved.riskDecisionId);

  const rejected = await repository.saveDecision({
    quoteId: "q_rejected",
    decision: {
      status: "rejected",
      reasonCode: "SLIPPAGE_TOO_WIDE",
      policyVersion: "test-risk-v1",
    },
  });

  assert.equal(rejected.decision, "rejected");
  assert.equal(rejected.reasonCode, "SLIPPAGE_TOO_WIDE");
});

test("InMemoryRiskDecisionRepository rejects malformed decision payload envelopes before storing", async () => {
  const repository = new InMemoryRiskDecisionRepository();

  await assert.rejects(repository.saveDecision(undefined), /Risk decision input must be an object/);

  await assert.rejects(
    repository.saveDecision({
      quoteId: "q_missing_decision",
    }),
    /Risk decision decision must be an object/,
  );

  await assert.rejects(
    repository.saveDecision({
      quoteId: "q_null_decision",
      decision: null,
    }),
    /Risk decision decision must be an object/,
  );

  assert.equal(await repository.findByQuoteId("q_missing_decision"), undefined);
  assert.equal(await repository.findByQuoteId("q_null_decision"), undefined);
});

test("InMemoryRiskDecisionRepository rejects conflicts and unsafe decisions", async () => {
  const repository = new InMemoryRiskDecisionRepository();

  await assert.rejects(
    repository.saveDecision({
      quoteId: " ",
      decision: {
        status: "approved",
        policyVersion: "test-risk-v1",
      },
    }),
    /Risk decision quoteId must be a non-empty string/,
  );

  await assert.rejects(
    repository.saveDecision({
      quoteId: new String("q_approved"),
      decision: {
        status: "approved",
        policyVersion: "test-risk-v1",
      },
    }),
    /Risk decision quoteId must be a primitive string/,
  );

  await assert.rejects(
    repository.saveDecision({
      quoteId: "q.bad",
      decision: {
        status: "approved",
        policyVersion: "test-risk-v1",
      },
    }),
    /Risk decision quoteId must contain only letters, numbers, underscore, colon, or hyphen/,
  );

  await assert.rejects(
    repository.saveDecision({
      quoteId: "q".repeat(129),
      decision: {
        status: "approved",
        policyVersion: "test-risk-v1",
      },
    }),
    /Risk decision quoteId must be 128 characters or fewer/,
  );

  await assert.rejects(
    repository.saveDecision({
      quoteId: "q".repeat(126),
      decision: {
        status: "approved",
        policyVersion: "test-risk-v1",
      },
    }),
    /Risk decision riskDecisionId must be 128 characters or fewer/,
  );

  await assert.rejects(
    repository.findByQuoteId("q/bad"),
    /Risk decision quoteId must contain only letters, numbers, underscore, colon, or hyphen/,
  );

  await assert.rejects(
    repository.findByQuoteId(new String("q_approved")),
    /Risk decision quoteId must be a primitive string/,
  );

  await assert.rejects(
    repository.saveDecision({
      quoteId: "q_bad_policy",
      decision: {
        status: "approved",
        policyVersion: "",
      },
    }),
    /Risk decision policyVersion must be a non-empty string/,
  );

  await assert.rejects(
    repository.saveDecision({
      quoteId: "q_bad_reason",
      decision: {
        status: "rejected",
        reasonCode: "UNKNOWN_REASON",
        policyVersion: "test-risk-v1",
      },
    }),
    /Risk decision reasonCode must be a stable risk reject reason/,
  );

  await repository.saveDecision({
    quoteId: "q_conflict",
    decision: {
      status: "approved",
      policyVersion: "test-risk-v1",
    },
  });

  await assert.rejects(
    repository.saveDecision({
      quoteId: "q_conflict",
      decision: {
        status: "rejected",
        reasonCode: "TOKEN_NOT_ALLOWED",
        policyVersion: "test-risk-v1",
      },
    }),
    /Risk decision conflict for q_conflict/,
  );
});

test("InMemoryRiskDecisionRepository returns defensive copies", async () => {
  const repository = new InMemoryRiskDecisionRepository();
  const stored = await repository.saveDecision({
    quoteId: "q_copy",
    decision: {
      status: "approved",
      policyVersion: "test-risk-v1",
    },
  });

  stored.policyVersion = "mutated";
  const reloaded = await repository.findByQuoteId("q_copy");

  assert.notEqual(reloaded, stored);
  assert.equal(reloaded.policyVersion, "test-risk-v1");
});
