import assert from "node:assert/strict";
import scoring from "../harness/scoring.js";

const { scoreModel, leaderOf } = scoring;

function metric(tl, overrides = {}) {
  return {
    tl: Float32Array.from(tl),
    tl_R: 80,
    reciprocity: 0,
    conv_tlR: 0,
    out_of_plane: 1000,
    canonical: true,
    ...overrides,
  };
}

{
  const reference = metric([80, 80, 130, 130]);
  const cleanCoreWrongMask = metric([80, 80, 80, 80]);
  const noisierCoreRightMask = metric([85, 85, 130, 130]);

  const wrongMaskScore = scoreModel(cleanCoreWrongMask, reference, 4);
  const rightMaskScore = scoreModel(noisierCoreRightMask, reference, 4);

  assert.equal(wrongMaskScore.coreRmse, 0);
  assert.equal(wrongMaskScore.falseLightRate, 1);
  assert.equal(rightMaskScore.falseLightRate, 0);
  assert.ok(
    rightMaskScore.leaderScore < wrongMaskScore.leaderScore,
    `mask-correct model should win: ${rightMaskScore.leaderScore} < ${wrongMaskScore.leaderScore}`,
  );
}

{
  const scores = {
    wide: { leaderScore: 10, canonical: true },
    close: { leaderScore: 10.5, canonical: true },
  };
  const metrics = {
    reference: { out_of_plane: 1000 },
    wide: { out_of_plane: 1800 },
    close: { out_of_plane: 900 },
  };

  assert.equal(leaderOf(["wide", "close"], scores, metrics), "close");
}
