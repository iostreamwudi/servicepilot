import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const paths = [
  "data/eval-csds-full-train.json",
  "data/eval-csds-full-val.json",
  "data/eval-csds-full-test.json",
];
const seenQueries = new Set();
for (const path of paths) {
  const data = JSON.parse(await readFile(path, "utf8"));
  const before = data.cases.length;
  data.cases = data.cases.filter((item) => {
    if (seenQueries.has(item.query)) return false;
    seenQueries.add(item.query);
    return true;
  });
  data.sampling.total = data.cases.length;
  data.sampling.contextRequired = data.cases.filter((item) => item.contextRequired).length;
  data.sampling.crossSplitDeduplication = "train-first exact-query exclusion";
  data.sampling.quotas = Object.fromEntries(["refund", "invoice", "address", "damage"].map((category) => [category, data.cases.filter((item) => item.category === `real-${category}`).length]));
  data.freeze.casesSha256 = createHash("sha256").update(JSON.stringify(data.cases.map((item) => ({ id: item.id, query: item.query, expectedSource: item.expectedSource, expectedHandoff: item.expectedHandoff })))).digest("hex");
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`${path}: ${before} -> ${data.cases.length}`);
}
