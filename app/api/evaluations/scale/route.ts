import trainSet from "../../../../data/eval-csds-full-train.json";
import valSet from "../../../../data/eval-csds-full-val.json";
import testSet from "../../../../data/eval-csds-full-test.json";
import baseline from "../../../../data/routing-full-baseline.json";
import completeBaseline from "../../../../data/routing-csds-complete-baseline.json";
import manifest from "../../../../data/real-data-manifest.json";

function authenticated(request: Request) {
  const host = new URL(request.url).hostname;
  return Boolean(request.headers.get("oai-authenticated-user-email")) || host === "localhost" || host === "127.0.0.1";
}

const datasets = { train: trainSet, val: valSet, test: testSet } as const;
type Split = keyof typeof datasets;

export async function GET(request: Request) {
  if (!authenticated(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const splitParam = url.searchParams.get("split") ?? "all";
  if (!["all", "train", "val", "test"].includes(splitParam)) return Response.json({ error: "Invalid split" }, { status: 400 });
  const split = splitParam as Split | "all";
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const category = url.searchParams.get("category");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
  const selected = split === "all" ? Object.entries(datasets) : [[split, datasets[split]]];
  const source = selected.flatMap(([sourceSplit, dataset]) => dataset.cases.map((item) => ({ ...item, sourceSplit })));
  const filtered = source.filter((item) => (!category || item.category === category) && (!query || item.query.toLowerCase().includes(query)));
  return Response.json({
    version: baseline.version,
    split,
    total: filtered.length,
    offset,
    limit,
    summary: baseline,
    completeSummary: completeBaseline,
    manifest,
    datasets: Object.fromEntries(selected.map(([name, dataset]) => [name, { version: dataset.version, fingerprint: dataset.freeze.casesSha256, total: dataset.cases.length, privacy: dataset.privacy }])),
    cases: filtered.slice(offset, offset + limit).map((item) => ({ id: item.id, category: item.category, query: item.query, history: item.history, contextRequired: item.contextRequired, expectedSource: item.expectedSource, expectedHandoff: item.expectedHandoff, source: item.source, sourceSplit: item.sourceSplit, transformations: item.transformations })),
  });
}
