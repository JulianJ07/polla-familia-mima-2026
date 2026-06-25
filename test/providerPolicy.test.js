import assert from "node:assert/strict";
import test from "node:test";
import { espnPollingDecision, progressiveBackoffMinutes, providerActivity } from "../server/services/providerPolicy.js";

const config = {
  enabled: true,
  dailySoftLimit: 90,
  emergencyReserve: 10,
  colombiaTeamName: "Colombia",
  popularTeams: [],
  favoriteTeams: [],
  manualFeaturedFixtureIds: []
};

function match(overrides = {}) {
  return {
    match_id: "G-A-1",
    home_team: "Equipo A",
    away_team: "Equipo B",
    stage: "group",
    match_date: "2026-06-21T20:00:00.000Z",
    status: "scheduled",
    api_status: "NS",
    espn_status: "NS",
    ...overrides
  };
}

test("no consulta proveedores sin partidos en vivo ni dentro de dos horas", () => {
  const now = new Date("2026-06-21T16:00:00.000Z");
  const activity = providerActivity([match()], config, now);
  assert.equal(activity.shouldPoll, false);
  assert.equal(activity.nextWindowAt, "2026-06-21T18:00:00.000Z");
  assert.equal(espnPollingDecision([match()], config, {}, now).reason, "idle");
});

test("consulta cerca del inicio sin repetir cada minuto", () => {
  const now = new Date("2026-06-21T18:10:00.000Z");
  const decision = espnPollingDecision([match()], config, {
    last_attempt_at: "2026-06-21T18:00:00.000Z"
  }, now);
  assert.equal(decision.reason, "upcoming");
  assert.equal(decision.intervalMinutes, 30);
  assert.equal(decision.due, false);
});

test("un partido P0 en vivo usa su frecuencia prioritaria", () => {
  const now = new Date("2026-06-21T20:06:00.000Z");
  const live = match({ home_team: "Colombia", status: "live", espn_status: "LIVE" });
  const decision = espnPollingDecision([live], config, {
    last_attempt_at: "2026-06-21T20:00:00.000Z"
  }, now);
  assert.equal(decision.highestPriority, "P0");
  assert.equal(decision.intervalMinutes, 5);
  assert.equal(decision.due, true);
});

test("consulta un partido que ya debio comenzar aunque aun figure programado", () => {
  const now = new Date("2026-06-21T20:06:00.000Z");
  const decision = espnPollingDecision([match()], config, {}, now);
  assert.equal(decision.reason, "started");
  assert.equal(decision.due, true);
});

test("revisa partidos recientes que quedaron sin resultado", () => {
  const now = new Date("2026-06-22T03:30:00.000Z");
  const decision = espnPollingDecision([match()], config, {}, now);
  assert.equal(decision.reason, "missed_result_check");
  assert.equal(decision.intervalMinutes, 60);
  assert.equal(decision.due, true);
});

test("aplica backoff exponencial con tope de una hora", () => {
  assert.equal(progressiveBackoffMinutes(1), 2);
  assert.equal(progressiveBackoffMinutes(4), 16);
  assert.equal(progressiveBackoffMinutes(10), 60);
});
