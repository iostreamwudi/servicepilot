import scaleSet from "../../../../data/eval-csds-scale.json";
import blindSet from "../../../../data/eval-csds-scale-blind.json";
import baseline from "../../../../data/routing-scale-baseline.json";

function authenticated(request: Request) {
  const host = new URL(request.url).hostname;
  return Boolean(request.headers.get("oai-authenticated-user-email")) || host === "localhost" || host === "127.0.0.1";
}

export async function GET(request: Request) {
  if (!authenticated(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const split = url.searchParams.get("split") === "blind" ? "blind" : "regression";
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const category = url.searchParams.get("category");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
  const source = split === "blind" ? blindSet.cases : scaleSet.cases;
  const filtered = source.filter((item) => (!category || item.category === category) && (!query || item.query.toLowerCase().includes(query)));
  return Response.json({
    version: baseline.version,
    split,
    total: filtered.length,
    offset,
    limit,
    summary: baseline,
    dataset: split === "blind" ? { version: blindSet.version, fingerprint: blindSet.freeze.casesSha256, privacy: blindSet.privacy } : { version: scaleSet.version, fingerprint: scaleSet.freeze.casesSha256, privacy: scaleSet.privacy },
    cases: filtered.slice(offset, offset + limit).map((item) => ({ id: item.id, category: item.category, query: item.query, contextRequired: item.contextRequired, expectedSource: item.expectedSource, expectedHandoff: item.expectedHandoff, source: item.source })),
  });
}
