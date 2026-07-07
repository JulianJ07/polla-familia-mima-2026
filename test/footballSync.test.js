import assert from "node:assert/strict";
import test from "node:test";
import { FootballSyncService, matchEspnFixture } from "../server/services/footballSync.js";

function fixture(status, {
  homeGoals = 1,
  awayGoals = 1,
  homePenalties = null,
  awayPenalties = null
} = {}) {
  return {
    fixture: {
      id: 900,
      date: "2026-06-21T18:00:00.000Z",
      status: { short: status, elapsed: 120 }
    },
    goals: { home: homeGoals, away: awayGoals },
    score: { penalty: { home: homePenalties, away: awayPenalties } }
  };
}

function match(overrides = {}) {
  return {
    match_id: "X1",
    stage: "r32",
    home_team: "Alemania",
    away_team: "Paraguay",
    match_date: "2026-06-21T18:00:00.000Z",
    status: "live",
    source: null,
    manual_override: false,
    locked: false,
    api_final_at: null,
    final_confirmation_count: 0,
    ...overrides
  };
}

function syncServiceFor(initialMatch, patches = []) {
  const client = {
    from(table) {
      return {
        update(patch) {
          patches.push({ table, patch });
          return {
            eq() {
              return {
                select() {
                  return {
                    single: async () => ({ data: { ...initialMatch, ...patch }, error: null })
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  return new FootballSyncService(null, {
    apiClient: { configured: false },
    fallbackClient: { configured: false },
    getClient: () => client,
    clock: () => new Date("2026-06-21T21:00:00.000Z")
  });
}

test("API-Football no cierra eliminatoria empatada sin clasificado", async () => {
  const initial = match();
  const patches = [];
  const service = syncServiceFor(initial, patches);

  const result = await service.processFixture(initial, fixture("FT"), "P1", "normal");

  assert.equal(result.finalChanged, false);
  assert.equal(result.row.status, "live");
  assert.equal(result.row.qualified_team, undefined);
  assert.match(result.row.sync_error, /no informo el clasificado/i);
  assert.equal(result.row.next_sync_at, "2026-06-21T21:10:00.000Z");
  assert.equal(patches[0].patch.status, undefined);
});

test("ESPN fallback reconoce partidos con local y visitante invertidos", () => {
  const candidate = {
    match_id: "O6",
    home_team: "Bélgica",
    away_team: "USA",
    match_date: "2026-07-07T00:00:00.000Z"
  };
  const fixture = {
    homeTeam: "United States",
    awayTeam: "Belgium",
    date: "2026-07-07T00:00:00.000Z"
  };

  assert.deepEqual(matchEspnFixture(candidate, fixture), { match: candidate, reversed: true });
});

test("API-Football cierra eliminatoria decidida por penales", async () => {
  const initial = match();
  const service = syncServiceFor(initial);

  const result = await service.processFixture(initial, fixture("PEN", {
    homeGoals: 1,
    awayGoals: 1,
    homePenalties: 3,
    awayPenalties: 4
  }), "P1", "normal");

  assert.equal(result.finalChanged, true);
  assert.equal(result.row.status, "finished");
  assert.equal(result.row.qualified_team, "Paraguay");
  assert.equal(result.row.decided_by_penalties, true);
  assert.equal(result.row.home_penalties, 3);
  assert.equal(result.row.away_penalties, 4);
});
