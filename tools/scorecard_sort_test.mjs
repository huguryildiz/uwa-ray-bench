import assert from "node:assert/strict";
import scoring from "../harness/scoring.js";

const { sortScorecardRows } = scoring;

function names(rows) {
  return rows.map((r) => r.id);
}

const rows = [
  { id: "fugu", values: { core: 12.22, fps: 58 } },
  { id: "opus", values: { core: 13.65, fps: null } },
  { id: "gpt", values: { core: 8.53, fps: 61 } },
  { id: "gemini", values: { core: 24.25, fps: 42 } },
  { id: "fable", values: { core: 12.3, fps: 55 } },
  { id: "reference", fixed: true, values: { core: 0, fps: 60 } },
];

assert.equal(typeof sortScorecardRows, "function");

assert.deepEqual(
  names(sortScorecardRows(rows, "core", "asc")),
  ["gpt", "fugu", "fable", "opus", "gemini", "reference"],
);

assert.deepEqual(
  names(sortScorecardRows(rows, "core", "desc")),
  ["gemini", "opus", "fable", "fugu", "gpt", "reference"],
);

assert.deepEqual(
  names(sortScorecardRows(rows, "fps", "desc")),
  ["gpt", "fugu", "fable", "gemini", "opus", "reference"],
);

assert.deepEqual(
  names(sortScorecardRows(rows, "missing", "asc")),
  ["fugu", "opus", "gpt", "gemini", "fable", "reference"],
);
