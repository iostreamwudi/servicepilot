import crypto from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateGradedSet } from "./evaluate-graded-golden.mjs";

const inputPath = process.env.SERVICEPILOT_REVIEWED_GOLDEN ?? "/Users/wrf/Downloads/f0563595-1208-4efb-b9ac-09f50756e538_reviewed.json";
const outputPath = process.env.SERVICEPILOT_FROZEN_GOLDEN ?? "data/graded-golden-set-v2-frozen.json";
const freezeActor = process.env.SERVICEPILOT_FREEZE_ACTOR ?? "wrf";
const frozenAt = process.env.SERVICEPILOT_FROZEN_AT ?? new Date().toISOString();

const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
const before = validateGradedSet(payload);
if (!before.valid) throw new Error(`reviewed Golden Set is invalid:\n${before.errors.join("\n")}`);

const cases = (payload.cases ?? []).map((record) => ({
  ...record,
  frozen: true,
  labelStatus: "frozen-human-reviewed",
  candidateReviewQueue: (record.candidateReviewQueue ?? []).map((candidate) => ({ ...candidate, humanReviewed: true })),
}));
const frozen = {
  ...payload,
  status: "frozen-human-reviewed",
  frozen: true,
  frozenAt,
  frozenBy: freezeActor,
  freezePolicy: "Frozen only after every case and candidate has explicit human review metadata; expectedSource remains preserved for legacy single-label evaluation and may be downgraded in graded evaluation after review.",
  counts: {
    ...(payload.counts ?? {}),
    totalRecords: cases.length,
    humanConfirmedRecords: cases.filter((record) => record.humanReviewed).length,
    pendingRecords: cases.filter((record) => !record.humanReviewed).length,
    frozenRecords: cases.filter((record) => record.frozen).length,
    reviewCandidates: cases.reduce((sum, record) => sum + (record.candidateReviewQueue ?? []).length, 0),
  },
  cases,
};
frozen.casesSha256 = crypto.createHash("sha256").update(JSON.stringify(cases)).digest("hex");

const after = validateGradedSet(frozen, { requireFrozen: true });
if (!after.valid) throw new Error(`frozen Golden Set is invalid:\n${after.errors.join("\n")}`);
await fs.writeFile(outputPath, `${JSON.stringify(frozen, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, status: frozen.status, counts: frozen.counts, validation: after }, null, 2));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(0);
