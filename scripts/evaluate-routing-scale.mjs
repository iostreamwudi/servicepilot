import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { routeIntent, shouldHandoff } from "../lib/intent-router.ts";

const inputs = process.argv.slice(2);
if (!inputs.length) inputs.push("data/eval-csds-scale.json", "data/eval-csds-scale-blind.json");
const cases = [];
for (const path of inputs) cases.push(...JSON.parse(await readFile(path, "utf8")).cases.map((item) => ({ ...item, datasetFile: path })));

const results = cases.map((item) => {
  const routing = routeIntent(item.query, item.history ?? []);
  const actualSource = routing?.knowledgeId ?? null;
  const actualHandoff = routing ? shouldHandoff(routing.intent, item.query) : true;
  const sourcePassed = actualSource === item.expectedSource;
  const handoffPassed = actualHandoff === item.expectedHandoff;
  return { id: item.id, category: item.category, datasetFile: item.datasetFile, contextRequired: item.contextRequired, sourcePassed, handoffPassed, passed: sourcePassed && handoffPassed, expectedSource: item.expectedSource, actualSource, expectedHandoff: item.expectedHandoff, actualHandoff, routingIntent: routing?.intent ?? null, routingConfidence: routing?.confidence ?? null };
});

function metrics(items) {
  const passed = items.filter((item) => item.passed).length;
  return {
    total: items.length,
    passed,
    passRate: Number((passed / Math.max(items.length, 1)).toFixed(4)),
    sourceAccuracy: Number((items.filter((item) => item.sourcePassed).length / Math.max(items.length, 1)).toFixed(4)),
    handoffAccuracy: Number((items.filter((item) => item.handoffPassed).length / Math.max(items.length, 1)).toFixed(4)),
  };
}

const report = {
  version: "router-v2.0-scale-1",
  generatedAt: new Date().toISOString(),
  sourceFiles: inputs,
  datasetFingerprint: createHash("sha256").update(JSON.stringify(cases.map((item) => item.id))).digest("hex"),
  overall: metrics(results),
  bySplit: Object.fromEntries(inputs.map((path) => [path, metrics(results.filter((item) => item.datasetFile === path))])),
  byCategory: Object.fromEntries([...new Set(results.map((item) => item.category))].sort().map((category) => [category, metrics(results.filter((item) => item.category === category))])),
  contextRequired: metrics(results.filter((item) => item.contextRequired)),
  standalone: metrics(results.filter((item) => !item.contextRequired)),
  failureCounts: { source: results.filter((item) => !item.sourcePassed).length, handoff: results.filter((item) => !item.handoffPassed).length },
  failureSample: results.filter((item) => !item.passed).slice(0, 50),
};

await writeFile("data/routing-scale-baseline.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
