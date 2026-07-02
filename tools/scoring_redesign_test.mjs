import assert from "node:assert/strict";
import scoring from "../harness/scoring.js";

const {
  NTL, validateModel, scoreModel, eligible, dimensionLeader, compositeLeader, compareForTiebreak,
} = scoring;

function makeField(fn) {
  const arr = new Float32Array(NTL);
  for (let i = 0; i < NTL; i++) arr[i] = fn(i);
  return arr;
}

// deterministic synthetic reference: ~20% of cells are "shadow" (i % 5 === 0)
const refTL = makeField((i) => (i % 5 === 0 ? 140 : 80));
const reference = {
  tl: refTL, tl_R: 80, reciprocity: 0, conv_tlR: 0, out_of_plane: 1000, insonified: 0.8,
};

function baseModel(overrides) {
  return {
    tl: refTL.slice(), tl_R: 80, reciprocity: 0, conv_tlR: 0, out_of_plane: 1000,
    ...overrides,
  };
}

// ---- 1. best core TL fit + missing reciprocity => Provisional status is reported
//        honestly, but (project decision) does NOT block ranking eligibility ----
{
  const goodFitNoRecip = baseModel({
    tl: makeField((i) => (i % 5 === 0 ? 140 : 80.1)), // near-perfect illuminated-cell fit
    reciprocity: undefined,
  });
  const mediocreQualified = baseModel({
    tl: makeField((i) => (i % 5 === 0 ? 140 : 95)), // much worse fit, but fully qualified
  });

  const v = validateModel(goodFitNoRecip);
  assert.equal(v.status, "Provisional");
  assert.ok(v.reasons.includes("missing reciprocity result"));

  const scores = {
    good: scoreModel(goodFitNoRecip, reference, NTL),
    mediocre: scoreModel(mediocreQualified, reference, NTL),
  };
  // the number itself is not penalized — it stays the honest, better value
  assert.ok(scores.good.fieldFidelity > scores.mediocre.fieldFidelity);
  // validation status does not gate eligibility (canonical is the only eligibility check)
  assert.equal(eligible("good", scores), true);
  assert.equal(eligible("mediocre", scores), true);
  assert.equal(dimensionLeader("fieldFidelity", ["good", "mediocre"], scores), "good");
}

// ---- 2. NaN or incomplete field data => Invalid ----
{
  const nanModel = baseModel({ tl: makeField((i) => (i === 5 ? NaN : 80)) });
  assert.equal(validateModel(nanModel).status, "Invalid");
  assert.ok(validateModel(nanModel).reasons.includes("NaN in TL field"));

  const incompleteModel = baseModel({ tl: new Float32Array(NTL - 10).fill(80) });
  assert.equal(validateModel(incompleteModel).status, "Invalid");
  assert.ok(validateModel(incompleteModel).reasons.includes("incomplete canonical TL grid"));

  const malformedModel = baseModel({ tl: undefined });
  assert.equal(validateModel(malformedModel).status, "Invalid");
  assert.ok(validateModel(malformedModel).reasons.includes("malformed metrics payload"));
}

// ---- 3. poorer field fidelity + better mask fidelity does not become Field leader ----
{
  const fieldWinner = baseModel({
    tl: makeField((i) => (i % 5 === 0 ? 50 : 80.2)), // great fit where ref is lit, but flips ref-shadow cells to "lit" (bad mask)
  });
  const maskWinner = baseModel({
    tl: makeField((i) => (i % 5 === 0 ? 140 : 95)), // worse fit where ref is lit, but mask matches ref exactly
  });
  const scores = {
    fieldWinner: scoreModel(fieldWinner, reference, NTL),
    maskWinner: scoreModel(maskWinner, reference, NTL),
  };
  assert.ok(scores.fieldWinner.fieldFidelity > scores.maskWinner.fieldFidelity);
  assert.ok(scores.maskWinner.coverageFidelity > scores.fieldWinner.coverageFidelity);
  assert.equal(dimensionLeader("fieldFidelity", ["fieldWinner", "maskWinner"], scores), "fieldWinner");
  assert.equal(dimensionLeader("coverageFidelity", ["fieldWinner", "maskWinner"], scores), "maskWinner");
}

// ---- 4. balanced coverage error behaves correctly under asymmetric class imbalance ----
{
  // reference here is 80% lit / 20% shadow (asymmetric). Model gets EVERY lit cell right
  // and half of the shadow cells wrong (false light) — falseLightRate must reflect the
  // shadow-cell subset ratio (0.5), not be diluted by the 80% lit majority.
  let shadowIdx = 0;
  const model = baseModel({
    tl: makeField((i) => {
      if (i % 5 !== 0) return 80; // lit cells: always correct
      shadowIdx++;
      return shadowIdx % 2 === 0 ? 140 : 50; // half of shadow cells flipped to "lit"
    }),
  });
  const s = scoreModel(model, reference, NTL);
  assert.equal(s.falseShadowRate, 0);
  assert.ok(Math.abs(s.falseLightRate - 0.5) < 0.02, `expected ~0.5, got ${s.falseLightRate}`);
  assert.ok(Math.abs(s.maskError - 0.25) < 0.02, `expected ~0.25, got ${s.maskError}`);
}

// ---- 5. tie-breaking is deterministic ----
{
  const a = { validation: { status: "Qualified" }, canonical: true, coreRmse: 5, maskError: 0.1, receiverErrorMedian: 1, composite: { value: 80 } };
  const b = { validation: { status: "Qualified" }, canonical: true, coreRmse: 6, maskError: 0.1, receiverErrorMedian: 1, composite: { value: 80 } };
  assert.equal(compareForTiebreak("a", "b", { a, b }), -1); // lower coreRmse wins

  const c = { ...a, coreRmse: 5 };
  const d = { ...a, coreRmse: 5, maskError: 0.2 };
  assert.equal(compareForTiebreak("c", "d", { c, d }), -1); // equal core, lower coverage error wins

  const e = { ...a };
  const f = { ...a };
  assert.equal(compareForTiebreak("e", "f", { e, f }), -1); // fully tied -> lexical id
  assert.equal(compareForTiebreak("f", "e", { e, f }), 1);

  const scores = { zeta: a, alpha: { ...a } };
  assert.equal(compositeLeader(["zeta", "alpha"], scores), "alpha"); // fully tied composite -> lexical id
}

// ---- 6. a well-formed canonical payload scores without throwing ----
{
  const model = baseModel({});
  const s = scoreModel(model, reference, NTL);
  assert.equal(s.validation.status, "Qualified");
  assert.ok(Number.isFinite(s.fieldFidelity));
  assert.ok(Number.isFinite(s.coverageFidelity));
  assert.ok(Number.isFinite(s.geometryFidelity));
  assert.ok(Number.isFinite(s.composite.value));
  assert.equal(s.composite.provisional, false);
}

console.log("scoring_redesign_test: all assertions passed");
