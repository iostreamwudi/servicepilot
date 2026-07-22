import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const evalFiles = [
  "data/eval-csds-full-train.json",
  "data/eval-csds-full-val.json",
  "data/eval-csds-full-test.json",
];
const evaluationSets = await Promise.all(evalFiles.map(async (path) => ({ path, data: JSON.parse(await readFile(path, "utf8")) })));
const corpus = JSON.parse(await readFile("data/knowledge-official-corpus.json", "utf8"));
const curated = JSON.parse(await readFile("data/knowledge-seed.json", "utf8"));
const completeEvaluation = JSON.parse(await readFile("data/routing-csds-complete-baseline.json", "utf8"));
const allCases = evaluationSets.flatMap(({ data }) => data.cases);
const uniqueQueries = new Set(allCases.map((item) => item.query));
const splitStats = Object.fromEntries(evaluationSets.map(({ path, data }) => [data.source.rawSplitSize === 9101 ? "train" : path.includes("-val") ? "val" : "test", {
  rawDialogues: data.source.rawSplitSize,
  eligibleCases: data.cases.length,
  contextRequired: data.sampling.contextRequired,
  fingerprint: data.freeze.casesSha256,
  directIdentifiersFound: data.privacy.directIdentifiersFound,
}]));
const officialCurated = curated.documents.filter((item) => item.sourceType === "official").length;
const internalDemo = curated.documents.filter((item) => item.sourceType === "internal_demo").length;

const manifest = {
  version: "2026.07-real-data-1",
  generatedAt: new Date().toISOString(),
  policy: "公开真实匿名语料仅用于私有研究评测；官方规则原文仅进入待复核区；内部演示流程不得被表述为真实企业业务数据。",
  totals: {
    upstreamDialogues: completeEvaluation.raw.dialogues,
    upstreamTurns: completeEvaluation.raw.turns,
    annotatedQuestions: completeEvaluation.raw.annotatedQuestions,
    upstreamIntents: completeEvaluation.raw.upstreamIntents,
    fullCoverageEvaluationCases: completeEvaluation.overall.total,
    evaluationCases: allCases.length,
    uniqueEvaluationQueries: uniqueQueries.size,
    contextRequiredCases: allCases.filter((item) => item.contextRequired).length,
    officialKnowledgeSources: corpus.sources.length,
    officialKnowledgeChunks: corpus.documents.length,
    curatedKnowledgeDocuments: curated.documents.length,
    totalKnowledgeDocuments: corpus.documents.length + curated.documents.length,
    activeOfficialSummaries: officialCurated,
    internalDemoRules: internalDemo,
  },
  sources: [
    {
      id: "CSDS",
      authenticity: "public_real_anonymized",
      name: evaluationSets[0].data.source.name,
      upstream: evaluationSets[0].data.source.upstream,
      paper: evaluationSets[0].data.source.paper,
      upstreamCommit: evaluationSets[0].data.source.upstreamCommit,
      licenseNote: evaluationSets[0].data.source.licenseNote,
      transformations: ["detokenized", "platform-name-generalized", "secondary-pii-redaction"],
      splitStats,
    },
    ...corpus.sources.map((source) => ({
      id: source.code,
      authenticity: "official_public_rule",
      name: source.title,
      upstream: source.url,
      processedChunks: corpus.documents.filter((item) => item.sourceTitle === source.title).length,
      releaseState: "review",
    })),
    {
      id: "SERVICEPILOT-DEMO-SOP",
      authenticity: "synthetic_internal_demo",
      name: "ServicePilot 演示商城内部流程",
      processedChunks: internalDemo,
      releaseState: "active_demo_only",
    },
  ],
  quality: {
    duplicateEvaluationQueries: allCases.length - uniqueQueries.size,
    directIdentifiersFound: evaluationSets.reduce((sum, item) => sum + item.data.privacy.directIdentifiersFound, 0),
    traceableEvaluationCases: allCases.filter((item) => item.source?.dataset === "CSDS" && item.source?.dialogueId !== undefined).length,
    traceableOfficialChunks: corpus.documents.filter((item) => item.sourceUrl && item.sourceArticle && /^[a-f0-9]{64}$/.test(item.contentSha256)).length,
    fullCoveragePassRate: completeEvaluation.overall.passRate,
    supportedRoutePassRate: completeEvaluation.supported.passRate,
    unsupportedSafeFallbackRate: completeEvaluation.unsupported.safeFallbackRate,
    unsupportedFalsePositiveRoutes: completeEvaluation.unsupported.falsePositiveRoutes,
    completeDatasetFingerprint: completeEvaluation.datasetFingerprint,
  },
};
manifest.manifestSha256 = createHash("sha256").update(JSON.stringify({ totals: manifest.totals, sources: manifest.sources, quality: manifest.quality })).digest("hex");
await writeFile("data/real-data-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ totals: manifest.totals, quality: manifest.quality, manifestSha256: manifest.manifestSha256 }, null, 2));
