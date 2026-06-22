import assert from "node:assert/strict";
import test from "node:test";
import { EspnFootballClient } from "../server/services/espnFootball.js";

function response(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

test("normaliza un resultado final de ESPN", async () => {
  let requestedUrl;
  const client = new EspnFootballClient({
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return response({ events: [{
        id: "401",
        date: "2026-06-21T19:00Z",
        status: { type: { name: "STATUS_FULL_TIME", completed: true, detail: "FT" } },
        competitions: [{ competitors: [
          { homeAway: "away", score: "0", team: { displayName: "Iran" } },
          { homeAway: "home", score: "0", team: { displayName: "Belgium" } }
        ] }]
      }] });
    }
  });
  const rows = await client.fetchDate("2026-06-21");
  assert.match(requestedUrl, /dates=20260621/);
  assert.deepEqual(rows[0], {
    id: "401",
    date: "2026-06-21T19:00Z",
    status: "FT",
    detail: "FT",
    homeTeam: "Belgium",
    awayTeam: "Iran",
    homeGoals: 0,
    awayGoals: 0,
    homePenalties: null,
    awayPenalties: null,
    winnerTeam: null
  });
});

test("distingue un partido en vivo de uno programado", async () => {
  const client = new EspnFootballClient({
    fetchImpl: async () => response({ events: [
      { id: "1", date: "2026-06-21T19:00Z", status: { type: { name: "STATUS_IN_PROGRESS", state: "in" } }, competitions: [{ competitors: [{ homeAway: "home", score: "1", team: { displayName: "Belgium" } }, { homeAway: "away", score: "0", team: { displayName: "Iran" } }] }] },
      { id: "2", date: "2026-06-21T22:00Z", status: { type: { name: "STATUS_SCHEDULED", state: "pre" } }, competitions: [{ competitors: [{ homeAway: "home", score: "0", team: { displayName: "Uruguay" } }, { homeAway: "away", score: "0", team: { displayName: "Cape Verde" } }] }] }
    ] })
  });
  const rows = await client.fetchDate("2026-06-21");
  assert.equal(rows[0].status, "LIVE");
  assert.equal(rows[1].status, "NS");
});

test("mantiene separado el marcador de los penales", async () => {
  const client = new EspnFootballClient({
    fetchImpl: async () => response({ events: [{
      id: "3",
      date: "2026-07-10T20:00Z",
      status: { type: { name: "STATUS_FULL_TIME", completed: true } },
      competitions: [{ competitors: [
        { homeAway: "home", score: "1", shootoutScore: "4", winner: true, team: { displayName: "Colombia" } },
        { homeAway: "away", score: "1", shootoutScore: "3", winner: false, team: { displayName: "Brazil" } }
      ] }]
    }] })
  });
  const [row] = await client.fetchDate("2026-07-10");
  assert.equal(row.homeGoals, 1);
  assert.equal(row.awayGoals, 1);
  assert.equal(row.homePenalties, 4);
  assert.equal(row.awayPenalties, 3);
  assert.equal(row.winnerTeam, "Colombia");
});
