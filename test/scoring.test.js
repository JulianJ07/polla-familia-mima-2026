import assert from "node:assert/strict";
import test from "node:test";
import {
  assignSharedPositions,
  calculateGroupStandings,
  resolveActualGroups,
  resolveBestThirds,
  scorePrediction
} from "../server/services/scoring.js";

function groupMatch(id, home, away, homeGoals, awayGoals, status = "finished") {
  return {
    match_id: `G-${id}`,
    stage: "group",
    home_team: home,
    away_team: away,
    home_goals: homeGoals,
    away_goals: awayGoals,
    status
  };
}

test("fase de grupos: exacto, resultado y pendiente", () => {
  const prediction = { stage: "group", predicted_home_goals: 2, predicted_away_goals: 1 };
  assert.equal(scorePrediction(prediction, groupMatch("A-1", "A", "B", 2, 1)).points, 3);
  assert.equal(scorePrediction(prediction, groupMatch("A-1", "A", "B", 3, 0)).points, 1);
  assert.equal(scorePrediction(prediction, groupMatch("A-1", "A", "B", null, null, "scheduled")).points, 0);
});

test("eliminatorias: respeta ganador y marcador exacto", () => {
  const prediction = {
    stage: "r16",
    predicted_home_team: "Colombia",
    predicted_away_team: "Brasil",
    predicted_home_goals: 2,
    predicted_away_goals: 1
  };
  const exact = { ...groupMatch("A-1", "Colombia", "Brasil", 2, 1), stage: "r16", qualified_team: "Colombia" };
  const winner = { ...exact, home_goals: 1, away_goals: 0 };
  assert.equal(scorePrediction(prediction, exact).points, 5);
  assert.equal(scorePrediction(prediction, winner).points, 3);
});

test("mini-tabla resuelve un empate multiple antes de la diferencia general", () => {
  const matches = [
    groupMatch("A-1", "A", "B", 1, 0),
    groupMatch("A-2", "B", "C", 2, 0),
    groupMatch("A-3", "C", "A", 3, 0),
    groupMatch("A-4", "A", "D", 10, 0),
    groupMatch("A-5", "B", "D", 1, 0),
    groupMatch("A-6", "C", "D", 1, 0)
  ];
  const group = calculateGroupStandings(matches).get("A");
  assert.equal(group.ready, true);
  assert.deepEqual(group.rows.slice(0, 3).map((row) => row.team), ["C", "B", "A"]);
  assert.equal(group.rows.find((row) => row.team === "A").gd, 8);
});

test("reaplica el enfrentamiento directo al subconjunto que sigue empatado", () => {
  const matches = [
    groupMatch("A-1", "A", "B", 0, 1),
    groupMatch("A-2", "A", "C", 1, 0),
    groupMatch("A-3", "B", "C", 1, 2),
    groupMatch("A-4", "A", "D", 1, 0),
    groupMatch("A-5", "B", "D", 10, 0),
    groupMatch("A-6", "C", "D", 1, 0)
  ];
  const rows = calculateGroupStandings(matches).get("A").rows;
  assert.deepEqual(rows.slice(0, 3).map((row) => row.team), ["C", "B", "A"]);
  assert.equal(rows.find((row) => row.team === "B").gd > rows.find((row) => row.team === "C").gd, true);
});

test("un marcador en vivo mueve la tabla publica pero no puntua la polla", () => {
  const liveMatch = {
    ...groupMatch("A-1", "A", "B", null, null, "scheduled"),
    api_status: "2H",
    live_home_goals: 2,
    live_away_goals: 0
  };
  assert.equal(calculateGroupStandings([liveMatch]).get("A").rows.every((row) => row.played === 0), true);
  const publicRows = calculateGroupStandings([liveMatch], { includeLive: true }).get("A").rows;
  assert.equal(publicRows.find((row) => row.team === "A").points, 3);
  assert.equal(scorePrediction({ stage: "group", predicted_home_goals: 2, predicted_away_goals: 0 }, liveMatch).points, 0);
});

test("un empate no resuelto conserva la misma posicion", () => {
  const pairs = [["A", "B"], ["A", "C"], ["A", "D"], ["B", "C"], ["B", "D"], ["C", "D"]];
  const rows = calculateGroupStandings(
    pairs.map(([home, away], index) => groupMatch(`A-${index + 1}`, home, away, 0, 0))
  ).get("A").rows;
  assert.deepEqual(rows.map((row) => row.position), [1, 1, 1, 1]);
  assert.equal(rows.every((row) => row.status === "unresolved"), true);
});

test("mejores terceros permanecen provisionales antes de cerrar los grupos", () => {
  const groups = new Map("ABCDEFGHIJKL".split("").map((groupCode, index) => [groupCode, {
    ready: false,
    rows: [1, 2, 3, 4].map((position) => ({
      team: `${groupCode}${position}`,
      position,
      positionResolved: true,
      points: position === 3 ? 12 - index : 0,
      gd: 0,
      gf: 0
    }))
  }]));
  const result = resolveBestThirds(groups);
  assert.equal(result.ready, false);
  assert.equal(result.rows.length, 12);
  assert.equal(result.rows.every((row) => row.status === "provisional"), true);
});

test("una correccion manual de grupo se muestra sin puntuar antes del cierre", () => {
  const matches = [
    groupMatch("A-1", "A", "B", null, null, "scheduled"),
    groupMatch("A-2", "C", "D", null, null, "scheduled"),
    groupMatch("A-3", "A", "C", null, null, "scheduled"),
    groupMatch("A-4", "B", "D", null, null, "scheduled"),
    groupMatch("A-5", "A", "D", null, null, "scheduled"),
    groupMatch("A-6", "B", "C", null, null, "scheduled")
  ];
  const manual = ["D", "C", "B", "A"].map((team, index) => ({ group_code: "A", team_code: team, final_position: index + 1 }));
  const group = resolveActualGroups(new Map(matches.map((item) => [item.match_id, item])), manual).get("A");
  assert.equal(group.source, "manual");
  assert.equal(group.ready, false);
  assert.deepEqual(group.rows.map((row) => row.team), ["D", "C", "B", "A"]);
});

test("empate en el octavo tercero no inventa un clasificado", () => {
  const groups = new Map("ABCDEFGHIJKL".split("").map((groupCode, index) => {
    const points = index < 7 ? 20 - index : index < 9 ? 5 : 1;
    return [groupCode, {
      ready: true,
      rows: [1, 2, 3, 4].map((position) => ({
        team: `${groupCode}${position}`,
        position,
        positionResolved: true,
        points: position === 3 ? points : 0,
        gd: position === 3 ? points : 0,
        gf: position === 3 ? points : 0
      }))
    }];
  }));
  const result = resolveBestThirds(groups);
  assert.equal(result.ready, false);
  assert.equal(result.source, "needs_manual_tiebreak");
  assert.equal(result.rows.filter((row) => row.status === "unresolved").length, 2);
});

test("el ranking comparte posicion cuando los puntos son iguales", () => {
  const rows = assignSharedPositions([
    { name: "A", total: 9 },
    { name: "B", total: 7 },
    { name: "C", total: 7 },
    { name: "D", total: 3 }
  ], (row) => [row.total]);
  assert.deepEqual(rows.map((row) => row.position), [1, 2, 2, 4]);
});
