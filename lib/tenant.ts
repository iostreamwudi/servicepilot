export const PRODUCTION_ORG_ID = "org-qingyu-production";
export const TEST_ORG_ID = "org-qingyu";

/**
 * Tenant selection is deliberately derived from the trusted edge context.
 * Client-controlled headers must never be enough to switch a production
 * request into the demo tenant.
 */
export function tenantIdForRequest(request: Request) {
  const host = new URL(request.url).hostname;
  const environment = request.headers.get("x-servicepilot-environment");
  return environment === "test" || ((host === "localhost" || host === "127.0.0.1") && environment === "test") ? TEST_ORG_ID : PRODUCTION_ORG_ID;
}
