import assert from "node:assert/strict";
import test from "node:test";
import {
  determinePriority,
  getQuotaState,
  getSyncDueState,
  pollingIntervalMinutes,
  selectSyncBatches
} from "../server/services/syncPolicy.js";
import { isAutomaticResultProtected } from "../server/services/footballSync.js";

const config = {
  enabled: true,
  dailySoftLimit: 90,
  emergencyReserve: 10,
  colombiaTeamName: "Colombia",
  popularTeams: ["Brazil", "Argentina", "France", "Spain"],
  favoriteTeams: ["Uruguay"],
  manualFeaturedFixtureIds: []
};

function match(overrides = {}) {
  return {
    match_id: "G-A-1",
    home_team: "Team A",
    away_team: "Team B",
    stage: "group",
    match_date: "2026-06-21T18:00:00.000Z",
    status: "scheduled",
    api_fixture_id: 100,
    api_status: "NS",
    api_elapsed: null,
    last_synced_at: null,
    next_sync_at: null,
    priority: "P3",
    priority_override: null,
    featured: false,
    api_final_at: null,
    final_confirmation_count: 0,
    ...overrides
  };
}

test("asigna prioridades configurables", () => {
  assert.equal(determinePriority(match({ home_team: "Colombia" }), config), "P0");
  assert.equal(determinePriority(match({ match_id: "G-A-6" }), config), "P0");
  assert.equal(determinePriority(match({ home_team: "Brazil", away_team: "Argentina" }), config), "P1");
  assert.equal(determinePriority(match({ home_team: "Uruguay" }), config), "P1");
  assert.equal(determinePriority(match({ match_id: "G-A-3" }), config), "P2");
  assert.equal(determinePriority(match({ priority_override: "P1" }), config), "P1");
});

test("protege la cuota con los cuatro modos", () => {
  assert.equal(getQuotaState(10, config).mode, "normal");
  assert.equal(getQuotaState(72, config).mode, "saving");
  assert.equal(getQuotaState(85, config).mode, "critical");
  assert.equal(getQuotaState(92, config).mode, "emergency");
});

test("aplica frecuencias por prioridad, minuto y modo", () => {
  assert.equal(pollingIntervalMinutes("P0", "2H", 71, "normal"), 2);
  assert.equal(pollingIntervalMinutes("P0", "HT", 45, "normal"), 10);
  assert.equal(pollingIntervalMinutes("P1", "2H", 71, "normal"), 5);
  assert.equal(pollingIntervalMinutes("P2", "1H", 20, "saving"), 45);
  assert.equal(Number.isFinite(pollingIntervalMinutes("P3", "1H", 20, "saving")), false);
  assert.equal(pollingIntervalMinutes("P0", "2H", 80, "critical"), 10);
});

test("agrupa partidos simultaneos en una sola consulta", () => {
  const now = new Date("2026-06-21T18:10:00.000Z");
  const matches = [
    match({ api_fixture_id: 1, home_team: "Colombia", api_status: "1H", api_elapsed: 10 }),
    match({ api_fixture_id: 2, home_team: "Brazil", away_team: "Argentina", api_status: "1H", api_elapsed: 10 }),
    match({ api_fixture_id: 3, match_id: "G-B-1", api_status: "1H", api_elapsed: 10 })
  ];
  const result = selectSyncBatches(matches, config, 0, now);
  assert.equal(result.batches.length, 1);
  assert.deepEqual(result.batches[0].map((row) => row.api_fixture_id), [1, 2, 3]);
  assert.equal(result.highestPriority, "P0");
});

test("no consulta cuando no hay partidos en ventana", () => {
  const result = selectSyncBatches(
    [match({ match_date: "2026-06-23T18:00:00.000Z" })],
    config,
    0,
    new Date("2026-06-21T18:00:00.000Z")
  );
  assert.equal(result.batches.length, 0);
});

test("en emergencia conserva una confirmacion final", () => {
  const finalMatch = match({
    status: "finished",
    api_status: "FT",
    api_final_at: "2026-06-21T20:00:00.000Z",
    final_confirmation_count: 0,
    priority: "P1"
  });
  const due = getSyncDueState(finalMatch, new Date("2026-06-21T20:06:00.000Z"), "emergency");
  assert.equal(due.due, true);
  assert.equal(due.confirmation, true);
});

test("respeta el backoff antes de confirmar un resultado final", () => {
  const finalMatch = match({
    status: "finished",
    api_status: "FT",
    api_final_at: "2026-06-21T20:00:00.000Z",
    final_confirmation_count: 0,
    next_sync_at: "2026-06-21T20:20:00.000Z",
    priority: "P1"
  });
  const due = getSyncDueState(finalMatch, new Date("2026-06-21T20:06:00.000Z"), "normal");
  assert.equal(due.due, false);
  assert.equal(due.confirmation, true);
});

test("un resultado manual o bloqueado prevalece sobre la API", () => {
  assert.equal(isAutomaticResultProtected({ locked: true, manual_override: false, source: "api-football" }), true);
  assert.equal(isAutomaticResultProtected({ locked: false, manual_override: true, source: "admin" }), true);
  assert.equal(isAutomaticResultProtected({ locked: false, manual_override: false, source: "api-football" }), false);
});
