import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const GRADE_NAMES = {
  3: "Highly Relevant",
  2: "Relevant",
  1: "Partially Relevant",
  0: "Irrelevant",
};

function asInteger(value) {
  return Number.isInteger(value) ? value : null;
}

export function validateGradedSet(payload, { requireFrozen = false } = {}) {
  const errors = [];
  if (!payload || typeof payload !== "object") errors.push("payload must be an object");
  if (!String(payload?.schemaVersion ?? "").startsWith("phase1.3a-graded-golden-v2")) errors.push("unsupported schemaVersion");
  if (!Array.isArray(payload?.cases)) errors.push("cases must be an array");
  for (const record of payload?.cases ?? []) {
    if (!record.id) errors.push("case missing id");
    if (record.expectedSource !== null && record.expectedSource !== undefined && record.primaryKnowledgeId !== record.expectedSource) {
      errors.push(`${record.id}: primaryKnowledgeId must preserve expectedSource`);
    }
    const hasReviewMetadata = Boolean(record.humanReviewed && record.reviewer && record.reviewedAt && record.reviewNotes);
    if (record.expectedSource && record.relevanceGrades?.[record.expectedSource] !== 3 && !hasReviewMetadata) {
      errors.push(`${record.id}: expectedSource may be downgraded only after human review metadata is present`);
    }
    for (const [knowledgeId, grade] of Object.entries(record.relevanceGrades ?? {})) {
      if (![0, 1, 2, 3].includes(grade)) errors.push(`${record.id}:${knowledgeId} invalid grade`);
      if (!record.labelRationale) errors.push(`${record.id}:${knowledgeId} missing labelRationale`);
    }
    for (const candidate of record.candidateReviewQueue ?? []) {
      if (candidate.proposedGrade !== null && ![0, 1, 2, 3].includes(candidate.proposedGrade)) errors.push(`${record.id}:${candidate.knowledgeId} invalid proposedGrade`);
      if (candidate.proposedGrade !== null && !candidate.humanReviewed) errors.push(`${record.id}:${candidate.knowledgeId} non-null proposedGrade requires humanReviewed`);
    }
    if (record.frozen && (!record.humanReviewed || !record.reviewer || !record.reviewedAt)) errors.push(`${record.id}: frozen record requires human review metadata`);
  }
  if (requireFrozen && !payload.frozen) errors.push("frozen set required");
  if (requireFrozen && (payload.cases ?? []).some((record) => !record.frozen || !record.humanReviewed || !record.reviewer || !record.reviewedAt || !record.reviewNotes)) errors.push("all cases must be frozen and human reviewed");
  if (requireFrozen && (payload.cases ?? []).some((record) => (record.candidateReviewQueue ?? []).some((candidate) => candidate.proposedGrade === null || !candidate.humanReviewed))) errors.push("all candidate grades must be reviewed before freezing");
  return { valid: errors.length === 0, errors };
}

function gradeAt(record, knowledgeId) {
  const value = record.relevanceGrades?.[knowledgeId];
  return asInteger(value) ?? 0;
}

function firstRelevantRank(record, ranking, threshold) {
  const index = ranking.findIndex((knowledgeId) => gradeAt(record, knowledgeId) >= threshold);
  return index < 0 ? null : index + 1;
}

function gain(grade) {
  return (2 ** grade) - 1;
}

function dcg(ranking, record, limit, threshold = 0) {
  return ranking.slice(0, limit).reduce((sum, knowledgeId, index) => {
    const grade = gradeAt(record, knowledgeId);
    return sum + (grade >= threshold ? gain(grade) : 0) / Math.log2(index + 2);
  }, 0);
}

function idealDcg(record, limit) {
  const grades = Object.values(record.relevanceGrades ?? {})
    .map(asInteger)
    .filter((grade) => grade !== null)
    .sort((left, right) => right - left)
    .slice(0, limit);
  return grades.reduce((sum, grade, index) => sum + gain(grade) / Math.log2(index + 2), 0);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function evaluateRankings(goldenSet, resultRecords, { field, singleLabel = false } = {}) {
  const resultById = new Map((resultRecords ?? []).map((record) => [record.id, record]));
  const rows = [];
  for (const record of goldenSet.cases ?? []) {
    const result = resultById.get(record.id);
    const ranking = Array.isArray(result?.[field]) ? result[field] : null;
    if (!ranking) continue;
    const effectiveRecord = singleLabel
      ? { ...record, relevanceGrades: record.expectedSource ? { [record.expectedSource]: 3 } : {} }
      : record;
    const relevantAt = (limit) => firstRelevantRank(effectiveRecord, ranking.slice(0, limit), 2) !== null;
    const rank = firstRelevantRank(effectiveRecord, ranking, 2);
    const dcg10 = dcg(ranking, effectiveRecord, 10);
    const ideal5 = idealDcg(effectiveRecord, 5);
    rows.push({
      id: record.id,
      rank,
      recallAt5: relevantAt(5),
      recallAt10: relevantAt(10),
      dcgAt10: dcg10,
      ndcgAt5: ideal5 > 0 ? dcg(ranking, effectiveRecord, 5) / ideal5 : 0,
    });
  }
  return {
    cases: rows.length,
    missingResultCases: (goldenSet.cases ?? []).length - rows.length,
    recallAt5: rows.length ? rows.filter((row) => row.recallAt5).length / rows.length : null,
    recallAt10: rows.length ? rows.filter((row) => row.recallAt10).length / rows.length : null,
    mrr: average(rows.map((row) => row.rank ? 1 / row.rank : 0)),
    dcgAt10: average(rows.map((row) => row.dcgAt10)),
    ndcgAt5: average(rows.map((row) => row.ndcgAt5)),
    rows,
  };
}

export function evaluateBoth(goldenSet, resultRecords, fields = ["v1", "hybrid", "reranked"]) {
  const graded = Object.fromEntries(fields.map((field) => [field, evaluateRankings(goldenSet, resultRecords, { field })]));
  const singleLabel = Object.fromEntries(fields.map((field) => [field, evaluateRankings(goldenSet, resultRecords, { field, singleLabel: true })]));
  return { graded, singleLabel };
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function main() {
  const goldenPath = process.env.SERVICEPILOT_GRADED_GOLDEN ?? "data/graded-golden-set-v2.json";
  const resultPaths = (process.env.SERVICEPILOT_GRADED_RESULTS ?? "Optimization_process/phase1.1-real-retrieval-eval.json,Optimization_process/phase1.1-real-retrieval-eval-additional.json").split(",").filter(Boolean);
  const goldenSet = await readJson(goldenPath);
  const validation = validateGradedSet(goldenSet);
  const payloads = await Promise.all(resultPaths.map(readJson));
  const resultRecords = payloads.flatMap((payload) => payload.records ?? []);
  const result = evaluateBoth(goldenSet, resultRecords, ["v1", "bm25", "dense", "hybrid", "reranked"]);
  process.stdout.write(`${JSON.stringify({ goldenPath, validation, resultFiles: resultPaths, ...result }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((error) => { console.error(error); process.exitCode = 1; });
