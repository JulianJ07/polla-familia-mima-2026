import assert from "node:assert/strict";
import test from "node:test";
import { ApiFootballClient, ApiFootballError } from "../server/services/apiFootball.js";

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => payload
  };
}

test("agrupa fixture IDs y envia la clave solo en headers", async () => {
  let requestUrl;
  let requestHeaders;
  const client = new ApiFootballClient({
    apiKey: "secret-test-key",
    fetchImpl: async (url, options) => {
      requestUrl = String(url);
      requestHeaders = options.headers;
      return response({ results: 2, response: [{ fixture: { id: 1 } }, { fixture: { id: 2 } }], errors: [] });
    }
  });
  const result = await client.fetchFixturesByIds([1, 2, 2]);
  assert.match(requestUrl, /ids=1-2/);
  assert.equal(requestUrl.includes("secret-test-key"), false);
  assert.equal(requestHeaders["x-apisports-key"], "secret-test-key");
  assert.equal(result.results, 2);
});

test("propaga claramente una restriccion del plan", async () => {
  const client = new ApiFootballClient({
    apiKey: "secret-test-key",
    fetchImpl: async () => response({
      results: 0,
      response: [],
      errors: { plan: "Free plans do not have access to this season." }
    })
  });
  await assert.rejects(
    () => client.fetchTournamentFixtures(1, 2026),
    (error) => error instanceof ApiFootballError && /Free plans/.test(error.message)
  );
});

test("prueba acceso a la temporada con una consulta minima por fecha", async () => {
  let requestUrl;
  const client = new ApiFootballClient({
    apiKey: "secret-test-key",
    fetchImpl: async (url) => {
      requestUrl = String(url);
      return response({ results: 0, response: [], errors: [] });
    }
  });
  await client.probeSeasonAccess(1, 2026, "2026-06-21");
  assert.match(requestUrl, /league=1/);
  assert.match(requestUrl, /season=2026/);
  assert.match(requestUrl, /date=2026-06-21/);
});
