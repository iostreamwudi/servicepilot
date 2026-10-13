import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [allCasesPath, outputPath, ...rawOptions] = process.argv.slice(2);
const seedOption = rawOptions.find((value) => value.startsWith("--seed="));
const versionOption = rawOptions.find((value) => value.startsWith("--version="));
const seed = seedOption?.slice("--seed=".length) || "servicepilot-generalization-v1";
const datasetVersion = versionOption?.slice("--version=".length) || null;
const excludePaths = rawOptions.filter((value) => !value.startsWith("--seed=") && !value.startsWith("--version="));
if (!allCasesPath || !outputPath || !excludePaths.length) {
  throw new Error("Usage: node scripts/select-csds-generalization.mjs <all-cases.json> <output.json> [--seed=value] [--version=value] <exclude.json...>");
}

const source = JSON.parse(await readFile(allCasesPath, "utf8"));
const sourceSplit = source.cases?.[0]?.source?.split ?? "unknown";
const excludedDialogueIds = new Set();
for (const path of excludePaths) {
  const data = JSON.parse(await readFile(path, "utf8"));
  for (const item of data.cases ?? []) {
    if (item.source?.dataset === "CSDS" && item.source?.dialogueId !== undefined) excludedDialogueIds.add(String(item.source.dialogueId));
  }
}

const categories = ["refund", "invoice", "address", "damage"];
const selected = [];
const selectedDialogueIds = new Set();
for (const category of categories) {
  const seenDialogues = new Set();
  const candidates = (source.cases ?? [])
    .filter((item) => item.category === `real-${category}` && !excludedDialogueIds.has(String(item.source?.dialogueId)) && !selectedDialogueIds.has(String(item.source?.dialogueId)))
    .map((item) => ({
      item,
      rank: createHash("sha256").update(`${seed}:${item.source?.dialogueId}:${item.id}:${item.query}`).digest("hex"),
    }))
    .sort((left, right) => left.rank.localeCompare(right.rank));
  for (const candidate of candidates) {
    const dialogueId = String(candidate.item.source?.dialogueId);
    if (seenDialogues.has(dialogueId)) continue;
    seenDialogues.add(dialogueId);
    selectedDialogueIds.add(dialogueId);
    selected.push({ ...candidate.item, id: candidate.item.id.replace("csds-val-", "csds-generalization-") });
    if (seenDialogues.size === 25) break;
  }
  if (seenDialogues.size !== 25) throw new Error(`Not enough unseen ${category} dialogues: ${seenDialogues.size}/25`);
}

const casesSha256 = createHash("sha256").update(JSON.stringify(selected.map((item) => ({
  id: item.id, query: item.query, history: item.history, expectedSource: item.expectedSource, expectedHandoff: item.expectedHandoff,
})))).digest("hex");

const result = {
  version: datasetVersion || `1.0-csds-${sourceSplit}-new-agent100`,
  description: "从用户提供的CSDS原始数据抽取的100条新完整Agent泛化测试；按DialogueID排除指定的既有端到端评测对话，并保证每个对话最多一条。",
  source: source.source,
  sampling: {
    method: "deterministic-stratified-sha256-dialogue-grouped",
    seed,
    split: sourceSplit,
    quotas: Object.fromEntries(categories.map((category) => [category, 25])),
    total: selected.length,
    excludedDialogueCount: excludedDialogueIds.size,
    contextRequired: selected.filter((item) => item.contextRequired).length,
  },
  privacy: source.privacy,
  freeze: { locked: true, casesSha256 },
  cases: selected,
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, total: selected.length, casesSha256, contextRequired: result.sampling.contextRequired }));
