import assert from "node:assert/strict";
import test from "node:test";
import {
  assignSharedPositions,
  calculateGroupStandings,
  inferPredictedKnockoutWinners,
  resolveActualGroups,
  resolveBestThirds,
  scoreLivePrediction,
  scorePrediction
} from "../server/services/scoring.js";
import { getBracketAdvancement } from "../server/services/bracket.js";

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

test("eliminatorias: compara marcador por equipo aunque local y visitante esten invertidos", () => {
  const prediction = {
    stage: "r16",
    predicted_home_team: "Brasil",
    predicted_away_team: "Colombia",
    predicted_home_goals: 1,
    predicted_away_goals: 2
  };
  const exact = { ...groupMatch("A-1", "Colombia", "Brasil", 2, 1), stage: "r16", qualified_team: "Colombia" };
  const winner = { ...exact, home_goals: 1, away_goals: 0 };
  assert.equal(scorePrediction(prediction, exact).points, 5);
  assert.equal(scorePrediction(prediction, winner).points, 3);
});

test("eliminatorias: solo da puntos si el equipo correcto fue elegido ganador", () => {
  const match = { ...groupMatch("A-1", "Colombia", "Brasil", 2, 0), stage: "r16", qualified_team: "Colombia" };
  assert.equal(scorePrediction({
    stage: "r16",
    predicted_home_team: "Colombia",
    predicted_away_team: "Alemania",
    predicted_home_goals: 0,
    predicted_away_goals: 1
  }, match).points, 0);
  assert.equal(scorePrediction({
    stage: "r16",
    predicted_home_team: "Alemania",
    predicted_away_team: "Francia",
    predicted_home_goals: 2,
    predicted_away_goals: 0
  }, match).points, 0);
});

test("cuartos y semifinales: maximo 6, ganador 4", () => {
  const prediction = {
    stage: "qf",
    predicted_home_team: "Marruecos",
    predicted_away_team: "Francia",
    predicted_home_goals: 2,
    predicted_away_goals: 3
  };
  const exact = { ...groupMatch("A-1", "Francia", "Marruecos", 3, 2), stage: "qf", qualified_team: "Francia" };
  assert.equal(scorePrediction(prediction, exact).points, 6);
  assert.equal(scorePrediction(prediction, { ...exact, home_goals: 1, away_goals: 0 }).points, 4);
});

test("los penales no se suman al marcador normal", () => {
  const prediction = {
    stage: "r16",
    predicted_home_team: "Colombia",
    predicted_away_team: "Brasil",
    predicted_home_goals: 1,
    predicted_away_goals: 1,
    predicted_qualified_team: "Colombia"
  };
  const match = {
    ...groupMatch("A-1", "Colombia", "Brasil", 1, 1),
    stage: "r16",
    qualified_team: "Colombia",
    decided_by_penalties: true,
    home_penalties: 4,
    away_penalties: 3
  };
  assert.equal(scorePrediction(prediction, match).points, 5);
});

test("eliminatorias: un empate pronosticado sin clasificado no inventa ganador", () => {
  const prediction = {
    stage: "r16",
    predicted_home_team: "Colombia",
    predicted_away_team: "Brasil",
    predicted_home_goals: 1,
    predicted_away_goals: 1
  };
  const match = {
    ...groupMatch("A-1", "Colombia", "Brasil", 1, 1),
    stage: "r16",
    qualified_team: "Colombia",
    decided_by_penalties: true,
    home_penalties: 4,
    away_penalties: 3
  };
  assert.equal(scorePrediction(prediction, match).points, 0);
});

test("eliminatorias: infiere ganador empatado desde la siguiente ronda de la prediccion", () => {
  const [prediction] = inferPredictedKnockoutWinners([
    {
      match_id: "O1",
      stage: "r16",
      predicted_home_team: "Colombia",
      predicted_away_team: "Brasil",
      predicted_home_goals: 1,
      predicted_away_goals: 1
    },
    {
      match_id: "Q1",
      stage: "qf",
      predicted_home_team: "Brasil",
      predicted_away_team: "Francia",
      predicted_home_goals: 2,
      predicted_away_goals: 0
    }
  ]);
  const match = {
    ...groupMatch("A-1", "Colombia", "Brasil", 1, 1),
    match_id: "O1",
    stage: "r16",
    qualified_team: "Brasil",
    decided_by_penalties: true,
    home_penalties: 3,
    away_penalties: 4
  };
  assert.equal(prediction.predicted_qualified_team, "Brasil");
  assert.equal(scorePrediction(prediction, match).points, 5);
});

test("final y tercer puesto: suma posiciones y exacto por equipo", () => {
  const final = { ...groupMatch("A-1", "Espana", "Colombia", 1, 2), stage: "final", qualified_team: "Colombia" };
  assert.equal(scorePrediction({
    stage: "final",
    predicted_home_team: "Colombia",
    predicted_away_team: "Espana",
    predicted_home_goals: 2,
    predicted_away_goals: 1
  }, final).points, 37);
  assert.equal(scorePrediction({
    stage: "final",
    predicted_home_team: "Colombia",
    predicted_away_team: "Espana",
    predicted_home_goals: 1,
    predicted_away_goals: 0
  }, final).points, 25);

  const third = { ...groupMatch("A-1", "Francia", "Brasil", 2, 1), stage: "third", qualified_team: "Francia" };
  assert.equal(scorePrediction({
    stage: "third",
    predicted_home_team: "Brasil",
    predicted_away_team: "Francia",
    predicted_home_goals: 1,
    predicted_away_goals: 2
  }, third).points, 12);
});

test("la llave propaga ganadores y perdedores a los slots correctos", () => {
  assert.deepEqual(getBracketAdvancement({
    match_id: "M4",
    status: "finished",
    home_team: "Holanda",
    away_team: "Marruecos",
    qualified_team: "Marruecos"
  }), [{
    fromMatchId: "M4",
    matchId: "O1",
    field: "away_team",
    team: "Marruecos",
    result: "winner"
  }]);

  assert.deepEqual(getBracketAdvancement({
    match_id: "M14",
    status: "finished",
    home_team: "Australia",
    away_team: "Egipto",
    qualified_team: "Egipto"
  }), [{
    fromMatchId: "M14",
    matchId: "O8",
    field: "home_team",
    team: "Egipto",
    result: "winner"
  }]);

  assert.deepEqual(getBracketAdvancement({
    match_id: "M15",
    status: "finished",
    home_team: "Suiza",
    away_team: "Argelia",
    qualified_team: "Suiza"
  }), [{
    fromMatchId: "M15",
    matchId: "O7",
    field: "home_team",
    team: "Suiza",
    result: "winner"
  }]);

  assert.deepEqual(getBracketAdvancement({
    match_id: "M16",
    status: "finished",
    home_team: "Colombia",
    away_team: "Ghana",
    qualified_team: "Colombia"
  }), [{
    fromMatchId: "M16",
    matchId: "O7",
    field: "away_team",
    team: "Colombia",
    result: "winner"
  }]);

  assert.deepEqual(getBracketAdvancement({
    match_id: "S2",
    status: "finished",
    home_team: "Argentina",
    away_team: "Brasil",
    qualified_team: "Brasil"
  }), [{
    fromMatchId: "S2",
    matchId: "FINAL",
    field: "away_team",
    team: "Brasil",
    result: "winner"
  }, {
    fromMatchId: "S2",
    matchId: "THIRD",
    field: "away_team",
    team: "Argentina",
    result: "loser"
  }]);
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

test("un marcador en vivo mueve las tablas y suma puntos provisionales", () => {
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
  assert.equal(scoreLivePrediction({ stage: "group", predicted_home_goals: 2, predicted_away_goals: 0 }, liveMatch).points, 3);
  assert.equal(scoreLivePrediction({ stage: "group", predicted_home_goals: 1, predicted_away_goals: 0 }, liveMatch).points, 1);
});

test("los puntos en vivo desaparecen cuando el partido deja de estar jugando", () => {
  const scheduled = {
    ...groupMatch("A-1", "A", "B", null, null, "scheduled"),
    api_status: "NS",
    live_home_goals: 2,
    live_away_goals: 0
  };
  assert.equal(scoreLivePrediction({ stage: "group", predicted_home_goals: 2, predicted_away_goals: 0 }, scheduled).points, 0);
  assert.equal(scoreLivePrediction(
    { stage: "group", predicted_home_goals: 2, predicted_away_goals: 0 },
    { ...scheduled, status: "finished", espn_status: "LIVE", home_goals: 2, away_goals: 0 }
  ).points, 0);
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
