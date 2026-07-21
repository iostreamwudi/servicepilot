import manifest from "../../../data/real-data-manifest.json";

function authenticated(request: Request) {
  const host = new URL(request.url).hostname;
  return Boolean(request.headers.get("oai-authenticated-user-email")) || host === "localhost" || host === "127.0.0.1";
}

export async function GET(request: Request) {
  if (!authenticated(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  return Response.json(manifest, {
    headers: {
      "cache-control": "private, max-age=300",
      etag: `"${manifest.manifestSha256}"`,
    },
  });
}
