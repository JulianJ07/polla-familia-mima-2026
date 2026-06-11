import { assertNoError, nowIso, requireSupabase } from "../db/supabase.js";

export const STAGE_LABELS = {
  group: "Fase de grupos",
  r32: "Ronda de 32",
  r16: "Octavos",
  qf: "Cuartos",
  sf: "Semifinal",
  third: "Tercer puesto",
  final: "Final"
};

export const AWARD_CONFIG = {
  top_scorer: { label: "Goleador", field: "top_scorer", points: 5 },
  best_player: { label: "Mejor jugador", field: "best_player", points: 5 },
  best_goalkeeper: { label: "Mejor arquero", field: "best_goalkeeper", points: 6 }
};

const GROUP_CODES = "ABCDEFGHIJKL".split("");
const KNOCKOUT_STAGES = new Set(["r32", "r16", "qf", "sf", "third", "final"]);
const OPTIONAL_SCHEMA_ERROR = /schema cache|does not exist|could not find|relation .* does not exist/i;

const BUILT_IN_AWARD_ALIASES = [
  ["lamine yamal", "yamal"],
  ["l yamal", "yamal"],
  ["l. yamal", "yamal"],
  ["yamal", "yamal"],
  ["mbappe", "mbappe"],
  ["mbappé", "mbappe"],
  ["kylian mbappe", "mbappe"],
  ["kylian mbappé", "mbappe"],
  ["dibu martinez", "dibu martinez"],
  ["dibu martínez", "dibu martinez"],
  ["emiliano martinez", "dibu martinez"],
  ["emiliano martínez", "dibu martinez"],
  ["diogo costa", "diogo costa"],
  ["vitinha", "vitinha"]
];

const BUILT_IN_AWARD_DISPLAY = new Map([
  ["yamal", "Yamal"],
  ["mbappe", "Mbappé"],
  ["dibu martinez", "Dibu Martínez"],
  ["diogo costa", "Diogo Costa"],
  ["vitinha", "Vitinha"],
  ["lautaro martinez", "Lautaro Martínez"],
  ["maignan", "Maignan"]
]);

function normalizedText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\./g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function titleCase(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function cleanName(value) {
  return normalizedText(value);
}

function sameTeam(a, b) {
  if (!a || !b) return false;
  return cleanName(a) === cleanName(b);
}

function buildAwardAliasMaps(rows = []) {
  const aliasMap = new Map();
  const displayMap = new Map(BUILT_IN_AWARD_DISPLAY);

  for (const [alias, canonical] of BUILT_IN_AWARD_ALIASES) {
    aliasMap.set(normalizedText(alias), normalizedText(canonical));
  }

  for (const row of rows || []) {
    const alias = normalizedText(row.alias);
    const canonical = normalizedText(row.canonical_name);
    if (!alias || !canonical) continue;
    aliasMap.set(alias, canonical);
    displayMap.set(canonical, String(row.canonical_name || "").trim() || titleCase(canonical));
  }

  return { aliasMap, displayMap };
}

function normalizeAwardWithMaps(value, maps) {
  const key = normalizedText(value);
  if (!key) return "";
  return maps.aliasMap.get(key) || key;
}

function displayAwardWithMaps(value, maps) {
  const canonical = normalizeAwardWithMaps(value, maps);
  if (!canonical) return "";
  return maps.displayMap.get(canonical) || titleCase(canonical);
}

export function normalizeAwardName(value, aliases = []) {
  return normalizeAwardWithMaps(value, buildAwardAliasMaps(aliases));
}

export function displayAwardName(value, aliases = []) {
  return displayAwardWithMaps(value, buildAwardAliasMaps(aliases));
}

function outcome(homeGoals, awayGoals) {
  if (homeGoals == null || awayGoals == null) return null;
  if (homeGoals > awayGoals) return "home";
  if (awayGoals > homeGoals) return "away";
  return "draw";
}

function winnerNameFromGoals(homeGoals, awayGoals, homeTeam, awayTeam) {
  const result = outcome(homeGoals, awayGoals);
  if (result === "home") return homeTeam;
  if (result === "away") return awayTeam;
  return result === "draw" ? "draw" : null;
}

function matchFinished(match) {
  return match?.status === "finished" && match.home_goals != null && match.away_goals != null;
}

function isKnockoutStage(stage) {
  return KNOCKOUT_STAGES.has(stage);
}

function actualWinnerName(match) {
  if (!matchFinished(match)) return null;
  if (!isKnockoutStage(match.stage)) {
    return winnerNameFromGoals(match.home_goals, match.away_goals, match.home_team, match.away_team);
  }
  if (match.qualified_team) return match.qualified_team;
  const byGoals = winnerNameFromGoals(match.home_goals, match.away_goals, match.home_team, match.away_team);
  return byGoals === "draw" ? null : byGoals;
}

function predictedWinnerName(prediction) {
  const byGoals = winnerNameFromGoals(
    prediction.predicted_home_goals,
    prediction.predicted_away_goals,
    prediction.predicted_home_team,
    prediction.predicted_away_team
  );
  return byGoals === "draw" ? null : byGoals;
}

function knockoutWinnerPending(match) {
  return matchFinished(match) && isKnockoutStage(match.stage) && !actualWinnerName(match);
}

function stageSortValue(stage) {
  return {
    group: 1,
    r32: 2,
    r16: 3,
    qf: 4,
    sf: 5,
    third: 6,
    final: 7
  }[stage] || 99;
}

function groupFromMatch(match) {
  if (match?.stage !== "group") return null;
  const [, groupCode] = String(match.match_id || "").match(/^G-([A-L])-/i) || [];
  return groupCode?.toUpperCase() || null;
}

function emptyStanding(team) {
  return {
    team,
    played: 0,
    points: 0,
    gf: 0,
    ga: 0,
    gd: 0
  };
}

function groupStandings(matchMap) {
  const groups = new Map();

  for (const match of matchMap.values()) {
    const groupCode = groupFromMatch(match);
    if (!groupCode) continue;

    if (!groups.has(groupCode)) {
      groups.set(groupCode, {
        groupCode,
        rows: new Map(),
        totalMatches: 0,
        finishedMatches: 0
      });
    }

    const group = groups.get(groupCode);
    group.totalMatches += 1;
    for (const team of [match.home_team, match.away_team].filter(Boolean)) {
      if (!group.rows.has(cleanName(team))) group.rows.set(cleanName(team), emptyStanding(team));
    }

    if (!matchFinished(match)) continue;

    group.finishedMatches += 1;
    const home = group.rows.get(cleanName(match.home_team));
    const away = group.rows.get(cleanName(match.away_team));
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.gf += match.home_goals;
    home.ga += match.away_goals;
    away.gf += match.away_goals;
    away.ga += match.home_goals;
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;

    if (match.home_goals > match.away_goals) {
      home.points += 3;
    } else if (match.away_goals > match.home_goals) {
      away.points += 3;
    } else {
      home.points += 1;
      away.points += 1;
    }
  }

  return new Map(
    [...groups.entries()].map(([groupCode, group]) => {
      const rows = [...group.rows.values()]
        .sort((a, b) =>
          b.points - a.points ||
          b.gd - a.gd ||
          b.gf - a.gf ||
          a.team.localeCompare(b.team)
        )
        .map((row, index) => ({ ...row, position: index + 1, source: "calculated" }));
      return [groupCode, { ...group, rows, ready: group.totalMatches > 0 && group.finishedMatches === group.totalMatches, source: "calculated" }];
    })
  );
}

function resolveActualGroups(matchMap, manualRows = []) {
  const calculated = groupStandings(matchMap);
  const manualByGroup = new Map();

  for (const row of manualRows || []) {
    const groupCode = String(row.group_code || "").toUpperCase();
    if (!groupCode) continue;
    if (!manualByGroup.has(groupCode)) manualByGroup.set(groupCode, []);
    manualByGroup.get(groupCode).push(row);
  }

  const allGroups = new Set([...GROUP_CODES, ...calculated.keys(), ...manualByGroup.keys()]);
  const resolved = new Map();

  for (const groupCode of [...allGroups].sort()) {
    const base = calculated.get(groupCode) || {
      groupCode,
      rows: [],
      totalMatches: 0,
      finishedMatches: 0,
      ready: false,
      source: "calculated"
    };
    const manual = (manualByGroup.get(groupCode) || []).sort((a, b) => a.final_position - b.final_position);
    const hasManual = manual.length >= 4;

    if (!hasManual) {
      resolved.set(groupCode, { ...base, manualRows: manual });
      continue;
    }

    const rows = manual.map((row) => {
      const calculatedRow = base.rows.find((item) => sameTeam(item.team, row.team_code));
      return {
        team: row.team_code,
        position: row.final_position,
        played: calculatedRow?.played ?? null,
        points: calculatedRow?.points ?? null,
        gf: calculatedRow?.gf ?? null,
        ga: calculatedRow?.ga ?? null,
        gd: calculatedRow?.gd ?? null,
        source: row.source || "manual"
      };
    });

    resolved.set(groupCode, {
      ...base,
      rows,
      ready: true,
      source: "manual",
      manualRows: manual
    });
  }

  return resolved;
}

function resolveBestThirds(actualGroups, manualRows = []) {
  const manual = (manualRows || []).filter((row) => row.team_code).slice(0, 8);
  if (manual.length === 8) {
    return {
      ready: true,
      source: "manual",
      rows: manual.map((row, index) => ({
        rank: index + 1,
        team: row.team_code,
        groupCode: row.group_code || null,
        source: row.source || "manual"
      }))
    };
  }

  const allReady = GROUP_CODES.every((groupCode) => actualGroups.get(groupCode)?.ready);
  if (!allReady) {
    return {
      ready: false,
      source: "pending",
      rows: []
    };
  }

  const candidates = GROUP_CODES
    .map((groupCode) => {
      const group = actualGroups.get(groupCode);
      const row = group?.rows.find((item) => item.position === 3);
      return row ? { ...row, groupCode } : null;
    })
    .filter((row) => row && row.points != null && row.gd != null && row.gf != null);

  if (candidates.length < GROUP_CODES.length) {
    return {
      ready: false,
      source: "pending_metrics",
      rows: candidates
        .sort((a, b) => String(a.groupCode).localeCompare(String(b.groupCode)))
        .map((row, index) => ({ ...row, rank: index + 1, source: "calculated" }))
    };
  }

  const ranked = candidates
    .sort((a, b) =>
      Number(b.points || 0) - Number(a.points || 0) ||
      Number(b.gd || 0) - Number(a.gd || 0) ||
      Number(b.gf || 0) - Number(a.gf || 0) ||
      String(a.team).localeCompare(String(b.team))
    )
    .map((row, index) => ({ ...row, rank: index + 1, source: "calculated" }));

  const cutoff = ranked[7];
  const boundaryTie = cutoff
    ? ranked.filter((row) =>
      Number(row.points || 0) === Number(cutoff.points || 0) &&
      Number(row.gd || 0) === Number(cutoff.gd || 0) &&
      Number(row.gf || 0) === Number(cutoff.gf || 0)
    )
    : [];
  const needsManualTiebreak = boundaryTie.some((row) => row.rank <= 8) && boundaryTie.some((row) => row.rank > 8);

  return {
    ready: ranked.length >= 8 && !needsManualTiebreak,
    source: needsManualTiebreak ? "needs_manual_tiebreak" : "calculated",
    rows: ranked.slice(0, 8),
    tiebreakNote: needsManualTiebreak
      ? "Empate en el corte de clasificación: falta conducta del equipo o ranking FIFA."
      : null
  };
}

function normalizeAwardResults(rows = [], maps) {
  const result = new Map();
  for (const [key, config] of Object.entries(AWARD_CONFIG)) {
    const row = (rows || []).find((item) => item.key === key) || {};
    const winnerName = row.winner_name || "";
    result.set(key, {
      key,
      label: config.label,
      winner_name: winnerName || null,
      winner_display: winnerName ? displayAwardWithMaps(winnerName, maps) : null,
      canonical_winner: winnerName ? normalizeAwardWithMaps(winnerName, maps) : "",
      points: Number(row.points ?? config.points),
      is_confirmed: row.is_confirmed === true
    });
  }
  return result;
}

async function optionalSelect(client, table, select = "*") {
  const { data, error } = await client.from(table).select(select);
  if (error && OPTIONAL_SCHEMA_ERROR.test(error.message || "")) return [];
  assertNoError(error, `Leer ${table}`);
  return data || [];
}

async function getMatchMap() {
  const client = requireSupabase();
  const { data, error } = await client.from("match_results").select("*");
  assertNoError(error, "Leer partidos");
  return new Map((data || []).map((match) => [match.match_id, match]));
}

async function fetchAllRows(queryBuilder, context, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryBuilder.range(from, from + pageSize - 1);
    assertNoError(error, context);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function buildScoringContext(matchMap) {
  const client = requireSupabase();
  const [manualGroupRows, manualBestThirdRows, awardRows, aliasRows] = await Promise.all([
    optionalSelect(client, "group_final_standings", "*"),
    optionalSelect(client, "best_thirds_final", "*"),
    optionalSelect(client, "award_results", "*"),
    optionalSelect(client, "award_name_aliases", "*")
  ]);
  const awardAliases = buildAwardAliasMaps(aliasRows);
  const actualGroups = resolveActualGroups(matchMap, manualGroupRows);

  return {
    actualGroups,
    bestThirds: resolveBestThirds(actualGroups, manualBestThirdRows),
    awardResults: normalizeAwardResults(awardRows, awardAliases),
    awardAliases,
    rawAliases: aliasRows,
    manualGroupRows,
    manualBestThirdRows
  };
}

function predictionVerdict(prediction, match, scored) {
  if (!matchFinished(match) || knockoutWinnerPending(match)) return "pending";
  if (scored.points > 0) return "hit";
  if (
    prediction.predicted_home_goals === match.home_goals &&
    prediction.predicted_away_goals === match.away_goals
  ) {
    return "hit";
  }
  return "miss";
}

function predictionHitStats(prediction, match) {
  if (!prediction || !matchFinished(match) || knockoutWinnerPending(match)) {
    return { exact: false, partial: false };
  }

  const exact =
    prediction.predicted_home_goals === match.home_goals &&
    prediction.predicted_away_goals === match.away_goals;
  if (exact) return { exact: true, partial: false };

  if (prediction.stage === "group") {
    const predictedOutcome = outcome(prediction.predicted_home_goals, prediction.predicted_away_goals);
    const actualOutcome = outcome(match.home_goals, match.away_goals);
    return { exact: false, partial: predictedOutcome != null && predictedOutcome === actualOutcome };
  }

  const predictedWinner = predictedWinnerName(prediction);
  const actualWinner = actualWinnerName(match);
  return {
    exact: false,
    partial: Boolean(predictedWinner && actualWinner && sameTeam(predictedWinner, actualWinner))
  };
}

function scorePrediction(prediction, match) {
  if (!match || match.status !== "finished" || match.home_goals == null || match.away_goals == null) {
    return { points: 0, reason: "Pendiente" };
  }

  if (knockoutWinnerPending(match)) {
    return { points: 0, reason: "Clasificado pendiente" };
  }

  const exact =
    prediction.predicted_home_goals === match.home_goals &&
    prediction.predicted_away_goals === match.away_goals;

  if (prediction.stage === "group") {
    const predictedOutcome = outcome(prediction.predicted_home_goals, prediction.predicted_away_goals);
    const actualOutcome = outcome(match.home_goals, match.away_goals);
    if (exact) return { points: 3, reason: "Marcador exacto" };
    if (predictedOutcome === actualOutcome) return { points: 1, reason: "Resultado correcto" };
    return { points: 0, reason: "Sin puntos" };
  }

  const teamsCorrect =
    sameTeam(prediction.predicted_home_team, match.home_team) &&
    sameTeam(prediction.predicted_away_team, match.away_team);
  const predictedWinner = predictedWinnerName(prediction);
  const actualWinner = actualWinnerName(match);
  const winnerCorrect = Boolean(predictedWinner && actualWinner && sameTeam(predictedWinner, actualWinner));

  if (prediction.stage === "r32" || prediction.stage === "r16") {
    if (teamsCorrect && exact) return { points: 5, reason: "Llave y marcador exacto" };
    if (winnerCorrect) return { points: 3, reason: "Ganador correcto" };
    return { points: 0, reason: "Sin puntos" };
  }

  if (prediction.stage === "qf" || prediction.stage === "sf") {
    if (teamsCorrect && exact) return { points: 6, reason: "Llave y marcador exacto" };
    if (winnerCorrect) return { points: 4, reason: "Ganador correcto" };
    return { points: 0, reason: "Sin puntos" };
  }

  if (prediction.stage === "third") {
    const actualFourth = sameTeam(actualWinner, match.home_team) ? match.away_team : match.home_team;
    const predictedFourth = sameTeam(predictedWinner, prediction.predicted_home_team)
      ? prediction.predicted_away_team
      : prediction.predicted_home_team;
    let points = 0;
    const reasons = [];
    if (winnerCorrect) {
      points += 5;
      reasons.push("Tercero correcto");
    }
    if (sameTeam(predictedFourth, actualFourth)) {
      points += 4;
      reasons.push("Cuarto correcto");
    }
    if (teamsCorrect && exact) {
      points += 3;
      reasons.push("Marcador exacto");
    }
    return { points, reason: reasons.join(", ") || "Sin puntos" };
  }

  if (prediction.stage === "final") {
    const actualRunnerUp = sameTeam(actualWinner, match.home_team) ? match.away_team : match.home_team;
    const predictedRunnerUp = sameTeam(predictedWinner, prediction.predicted_home_team)
      ? prediction.predicted_away_team
      : prediction.predicted_home_team;
    let points = 0;
    const reasons = [];
    if (winnerCorrect) {
      points += 15;
      reasons.push("Campeón correcto");
    }
    if (sameTeam(predictedRunnerUp, actualRunnerUp)) {
      points += 10;
      reasons.push("Subcampeón correcto");
    }
    if (teamsCorrect && exact) {
      points += 12;
      reasons.push("Marcador exacto");
    }
    return { points, reason: reasons.join(", ") || "Sin puntos" };
  }

  return { points: 0, reason: "Sin regla" };
}

function addScore(state, category, points) {
  state.total += points;
  state.byCategory[category] = Number(((state.byCategory[category] || 0) + points).toFixed(2));
}

function createScoreState(matchMap) {
  return {
    total: 0,
    byCategory: {},
    details: [],
    exactHits: 0,
    partialHits: 0,
    matchesPlayed: [...matchMap.values()].filter(matchFinished).length
  };
}

function addMatchScoresFromRows(predictions, state, matchMap) {
  for (const prediction of predictions || []) {
    const match = matchMap.get(prediction.match_id);
    const scored = scorePrediction(prediction, match);
    const hitStats = predictionHitStats(prediction, match);
    if (hitStats.exact) state.exactHits += 1;
    else if (hitStats.partial) state.partialHits += 1;
    addScore(state, prediction.stage, scored.points);
    state.details.push({
      type: "match",
      matchId: prediction.match_id,
      stage: prediction.stage,
      stageLabel: STAGE_LABELS[prediction.stage],
      label: match ? `${match.home_team} vs ${match.away_team}` : `${prediction.predicted_home_team || ""} vs ${prediction.predicted_away_team || ""}`.trim(),
      predicted: `${prediction.predicted_home_goals ?? "-"}-${prediction.predicted_away_goals ?? "-"}`,
      actual: match?.home_goals == null ? null : `${match.home_goals}-${match.away_goals}`,
      status: match?.status || "scheduled",
      date: match?.match_date || null,
      reason: scored.reason,
      points: scored.points,
      predictedHomeTeam: prediction.predicted_home_team,
      predictedAwayTeam: prediction.predicted_away_team,
      qualifiedTeam: match?.qualified_team || null
    });
  }
}

function addGroupScoresFromRows(groups, state, context) {
  const predictedThirdTeams = [];

  for (const row of groups || []) {
    const groupCode = String(row.group_code || "").toUpperCase();
    const group = context.actualGroups.get(groupCode);
    const actual = group?.rows.find((standing) => sameTeam(standing.team, row.team_code));
    const points = group?.ready && actual?.position === row.predicted_position ? 1 : 0;
    if (points) addScore(state, "group_positions", points);
    if (row.predicted_position === 3) predictedThirdTeams.push(row.team_code);
    state.details.push({
      type: "group_position",
      stage: "group_positions",
      stageLabel: "Posiciones de grupo",
      groupCode,
      label: `Grupo ${groupCode} - ${row.team_code}`,
      predicted: `#${row.predicted_position}`,
      actual: actual?.position ? `#${actual.position}` : null,
      status: group?.ready ? "finished" : "scheduled",
      reason: group?.ready ? (points ? "Posición correcta" : "Sin puntos") : "Grupo pendiente",
      points
    });
  }

  const bestThirdSet = new Set((context.bestThirds.rows || []).map((row) => cleanName(row.team)));
  let bestThirdPoints = 0;
  const uniqueThirds = [...new Set(predictedThirdTeams.map(cleanName))];
  if (context.bestThirds.ready) {
    bestThirdPoints = uniqueThirds.filter((team) => bestThirdSet.has(team)).length * 0.5;
  }
  if (bestThirdPoints) addScore(state, "best_thirds", bestThirdPoints);
  state.details.push({
    type: "best_thirds",
    stage: "best_thirds",
    stageLabel: "Mejores terceros",
    label: "Mejores terceros",
    predicted: predictedThirdTeams.join(", "),
    actual: context.bestThirds.ready ? context.bestThirds.rows.map((row) => row.team).join(", ") : null,
    status: context.bestThirds.ready ? "finished" : "scheduled",
    reason: context.bestThirds.ready ? "Mejores terceros evaluados" : "Mejores terceros pendientes",
    points: bestThirdPoints
  });
}

function addAwardScoresFromRow(individual, state, context) {
  for (const [key, config] of Object.entries(AWARD_CONFIG)) {
    const result = context.awardResults.get(key);
    const pick = individual?.[config.field] || "";
    const normalizedPick = normalizeAwardWithMaps(pick, context.awardAliases);
    const points = result?.is_confirmed && normalizedPick && normalizedPick === result.canonical_winner
      ? result.points
      : 0;
    if (points) addScore(state, "individual_awards", points);
    state.details.push({
      type: "award",
      stage: "individual_awards",
      stageLabel: "Premios individuales",
      label: config.label,
      predicted: pick ? displayAwardWithMaps(pick, context.awardAliases) : "-",
      actual: result?.winner_display || null,
      status: result?.is_confirmed ? "finished" : "scheduled",
      reason: result?.is_confirmed ? (points ? "Premio correcto" : "Sin puntos") : "En juego",
      points
    });
  }
}

export function evaluateMatchPrediction(prediction, match) {
  if (!prediction) {
    return {
      status: "sin_prediccion",
      label: "Sin predicción",
      icon: "-",
      points: 0,
      reason: "Sin predicción"
    };
  }

  const scored = scorePrediction(prediction, match);
  if (!matchFinished(match)) {
    return {
      status: "pendiente",
      label: "Pendiente",
      icon: "-",
      points: 0,
      reason: scored.reason
    };
  }

  if (knockoutWinnerPending(match)) {
    return {
      status: "pendiente",
      label: "Clasificado pendiente",
      icon: "-",
      points: 0,
      reason: scored.reason
    };
  }

  const hitStats = predictionHitStats(prediction, match);
  if (hitStats.exact) {
    return {
      status: "exacto",
      label: "Exacto",
      icon: "target",
      points: scored.points,
      reason: scored.reason
    };
  }
  if (hitStats.partial || scored.points > 0) {
    return {
      status: "parcial",
      label: "Parcial",
      icon: "check",
      points: scored.points,
      reason: scored.reason
    };
  }
  return {
    status: "fallo",
    label: "Falló",
    icon: "x",
    points: 0,
    reason: scored.reason
  };
}

export async function calculateParticipantScore(participantId, providedMatches = null, providedContext = null) {
  const client = requireSupabase();
  const matchMap = providedMatches || (await getMatchMap());
  const context = providedContext || (await buildScoringContext(matchMap));
  const { data: predictions, error: predictionError } = await client
    .from("predictions")
    .select("*")
    .eq("participant_id", participantId)
    .order("match_id", { ascending: true });
  assertNoError(predictionError, "Leer predicciones");

  const { data: groups, error: groupError } = await client
    .from("group_predictions")
    .select("*")
    .eq("participant_id", participantId)
    .order("group_code", { ascending: true })
    .order("predicted_position", { ascending: true });
  assertNoError(groupError, "Leer predicciones de grupos");

  const { data: individual, error: individualError } = await client
    .from("individual_predictions")
    .select("*")
    .eq("participant_id", participantId)
    .maybeSingle();
  assertNoError(individualError, "Leer predicciones individuales");

  const state = createScoreState(matchMap);
  addMatchScoresFromRows(predictions, state, matchMap);
  addGroupScoresFromRows(groups, state, context);
  addAwardScoresFromRow(individual, state, context);

  state.total = Number(state.total.toFixed(2));
  return state;
}

async function calculateAllParticipantScores(participants, matchMap, context) {
  const client = requireSupabase();
  const [predictions, groupPredictions, individualPredictions] = await Promise.all([
    fetchAllRows(client.from("predictions").select("*"), "Leer predicciones"),
    fetchAllRows(client.from("group_predictions").select("*"), "Leer predicciones de grupos"),
    fetchAllRows(client.from("individual_predictions").select("*"), "Leer predicciones individuales")
  ]);

  const predictionsByParticipant = new Map();
  for (const prediction of predictions) {
    const rows = predictionsByParticipant.get(prediction.participant_id) || [];
    rows.push(prediction);
    predictionsByParticipant.set(prediction.participant_id, rows);
  }

  const groupsByParticipant = new Map();
  for (const row of groupPredictions) {
    const rows = groupsByParticipant.get(row.participant_id) || [];
    rows.push(row);
    groupsByParticipant.set(row.participant_id, rows);
  }

  const individualByParticipant = new Map((individualPredictions || []).map((row) => [row.participant_id, row]));
  const scores = new Map();

  for (const participant of participants || []) {
    const state = createScoreState(matchMap);
    const matchRows = (predictionsByParticipant.get(participant.id) || [])
      .sort((a, b) => String(a.match_id).localeCompare(String(b.match_id), undefined, { numeric: true }));
    const groupRows = (groupsByParticipant.get(participant.id) || [])
      .sort((a, b) => String(a.group_code).localeCompare(String(b.group_code)) || a.predicted_position - b.predicted_position);
    addMatchScoresFromRows(matchRows, state, matchMap);
    addGroupScoresFromRows(groupRows, state, context);
    addAwardScoresFromRow(individualByParticipant.get(participant.id), state, context);
    state.total = Number(state.total.toFixed(2));
    scores.set(participant.id, state);
  }

  return scores;
}

export async function recalculateAllScores() {
  const client = requireSupabase();
  const { data: participants, error } = await client.from("participants").select("id");
  assertNoError(error, "Leer participantes");
  const matchMap = await getMatchMap();
  const context = await buildScoringContext(matchMap);
  const scoreMap = await calculateAllParticipantScores(participants || [], matchMap, context);
  const rows = [];

  for (const participant of participants || []) {
    const score = scoreMap.get(participant.id);
    rows.push({
      participant_id: participant.id,
      total_points: score.total,
      last_calculated: nowIso()
    });
  }

  if (rows.length) {
    const { error: upsertError } = await client
      .from("scores_cache")
      .upsert(rows, { onConflict: "participant_id" });
    assertNoError(upsertError, "Guardar puntajes");
  }
}

export async function getLeaderboard() {
  const client = requireSupabase();
  const { data: participants, error } = await client
    .from("participants")
    .select("id,name,created_at")
    .order("name", { ascending: true });
  assertNoError(error, "Leer participantes");

  const { data: scores, error: scoresError } = await client
    .from("scores_cache")
    .select("participant_id,total_points,last_calculated");
  assertNoError(scoresError, "Leer scores_cache");

  const scoreMap = new Map((scores || []).map((score) => [score.participant_id, score]));
  const matchMap = await getMatchMap();
  const context = await buildScoringContext(matchMap);
  const calculatedScores = await calculateAllParticipantScores(participants || [], matchMap, context);
  const rows = [];

  for (const participant of participants || []) {
    const score = calculatedScores.get(participant.id);
    const cached = scoreMap.get(participant.id);
    rows.push({
      id: participant.id,
      name: participant.name,
      totalPoints: Number(score.total ?? cached?.total_points ?? 0),
      exactHits: score.exactHits,
      partialHits: score.partialHits,
      matchesPlayed: score.matchesPlayed,
      byCategory: score.byCategory,
      recent: score.details
        .filter((item) => item.type === "match")
        .slice(-5)
        .map((item) => ({
          matchId: item.matchId,
          label: item.label,
          ok: item.points > 0,
          points: item.points
        })),
      lastCalculated: cached?.last_calculated || null
    });
  }

  rows.sort((a, b) =>
    b.totalPoints - a.totalPoints ||
    b.exactHits - a.exactHits ||
    b.partialHits - a.partialHits ||
    a.name.localeCompare(b.name)
  );
  return rows.map((row, index) => ({ ...row, position: index + 1 }));
}

export async function getParticipantDetail(participantId) {
  const client = requireSupabase();
  const { data: participant, error } = await client
    .from("participants")
    .select("*")
    .eq("id", participantId)
    .maybeSingle();
  assertNoError(error, "Leer participante");
  if (!participant) return null;

  const matchMap = await getMatchMap();
  const context = await buildScoringContext(matchMap);
  const breakdown = await calculateParticipantScore(participantId, matchMap, context);

  const { data: predictions, error: predictionError } = await client
    .from("predictions")
    .select("*")
    .eq("participant_id", participantId)
    .order("stage", { ascending: true })
    .order("match_id", { ascending: true });
  assertNoError(predictionError, "Leer detalle de predicciones");

  const enrichedPredictions = (predictions || [])
    .map((prediction) => {
      const match = matchMap.get(prediction.match_id);
      const scored = scorePrediction(prediction, match);
      return {
        ...prediction,
        stageLabel: STAGE_LABELS[prediction.stage],
        home_team: match?.home_team,
        away_team: match?.away_team,
        home_goals: match?.home_goals,
        away_goals: match?.away_goals,
        qualified_team: match?.qualified_team || null,
        status: match?.status,
        match_date: match?.match_date,
        points: scored.points,
        reason: scored.reason,
        verdict: predictionVerdict(prediction, match, scored),
        predicted_score: `${prediction.predicted_home_goals ?? "-"}-${prediction.predicted_away_goals ?? "-"}`,
        actual_score: matchFinished(match) ? `${match.home_goals}-${match.away_goals}` : null
      };
    })
    .sort((a, b) => stageSortValue(a.stage) - stageSortValue(b.stage) || String(a.match_id).localeCompare(String(b.match_id), undefined, { numeric: true }));

  const { data: individual, error: individualError } = await client
    .from("individual_predictions")
    .select("*")
    .eq("participant_id", participantId)
    .maybeSingle();
  assertNoError(individualError, "Leer predicciones individuales");

  const { data: topScorers, error: topScorersError } = await client
    .from("top_scorers_cache")
    .select("player_name,goals")
    .order("goals", { ascending: false })
    .order("player_name")
    .limit(12);
  assertNoError(topScorersError, "Leer goleadores para premios");

  const { data: groups, error: groupsError } = await client
    .from("group_predictions")
    .select("*")
    .eq("participant_id", participantId)
    .order("group_code", { ascending: true })
    .order("predicted_position", { ascending: true });
  assertNoError(groupsError, "Leer predicciones de grupos");

  const bestThirdSet = new Set((context.bestThirds.rows || []).map((row) => cleanName(row.team)));
  const enrichedGroups = (groups || []).map((row) => {
    const group = context.actualGroups.get(String(row.group_code || "").toUpperCase());
    const actual = group?.rows.find((standing) => sameTeam(standing.team, row.team_code));
    const isBestThirdHit = row.predicted_position === 3 && context.bestThirds.ready && bestThirdSet.has(cleanName(row.team_code));
    return {
      ...row,
      actual_position: actual?.position || null,
      actual_points: actual?.points ?? null,
      actual_gd: actual?.gd ?? null,
      actual_played: actual?.played ?? null,
      group_finished_matches: group?.finishedMatches || 0,
      group_total_matches: group?.totalMatches || 0,
      group_source: group?.source || "calculated",
      best_third_hit: isBestThirdHit,
      verdict: !group?.ready || !actual ? "pending" : actual.position === row.predicted_position ? "hit" : "miss"
    };
  });

  const actualGroups = [...context.actualGroups.values()]
    .sort((a, b) => a.groupCode.localeCompare(b.groupCode))
    .map((group) => ({
      group_code: group.groupCode,
      finished_matches: group.finishedMatches,
      total_matches: group.totalMatches,
      ready: group.ready,
      source: group.source,
      rows: group.rows
    }));

  const individualAwards = Object.entries(AWARD_CONFIG).map(([key, config]) => {
    const result = context.awardResults.get(key);
    const pick = individual?.[config.field] || null;
    const normalizedPick = normalizeAwardWithMaps(pick, context.awardAliases);
    const hit = result?.is_confirmed && normalizedPick && normalizedPick === result.canonical_winner;
    return {
      key,
      label: config.label,
      value: pick,
      displayValue: pick ? displayAwardWithMaps(pick, context.awardAliases) : null,
      winner: result?.winner_display || null,
      status: !result?.is_confirmed ? "pending" : hit ? "hit" : "miss",
      labelStatus: !result?.is_confirmed ? "En juego" : hit ? "Ganó" : "Perdió",
      points: hit ? result.points : 0
    };
  });

  return {
    participant,
    totalPoints: breakdown.total,
    breakdown,
    predictions: enrichedPredictions,
    individual,
    individualAwards,
    topScorerLeaders: topScorers || [],
    groups: enrichedGroups,
    actualGroups,
    bestThirds: context.bestThirds
  };
}

export async function getAwardOptions() {
  const client = requireSupabase();
  const aliasRows = await optionalSelect(client, "award_name_aliases", "*");
  const maps = buildAwardAliasMaps(aliasRows);
  const { data, error } = await client.from("individual_predictions").select("*");
  assertNoError(error, "Leer opciones de premios");

  const options = {};
  for (const [key, config] of Object.entries(AWARD_CONFIG)) {
    const byCanonical = new Map();
    for (const row of data || []) {
      const value = row[config.field];
      const canonical = normalizeAwardWithMaps(value, maps);
      if (!canonical) continue;
      if (!byCanonical.has(canonical)) {
        byCanonical.set(canonical, {
          value: displayAwardWithMaps(value, maps),
          canonical,
          label: displayAwardWithMaps(value, maps),
          variations: []
        });
      }
      if (value && !byCanonical.get(canonical).variations.includes(value)) {
        byCanonical.get(canonical).variations.push(value);
      }
    }
    options[key] = [...byCanonical.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  return options;
}

export async function getScoringAdminState() {
  const client = requireSupabase();
  const matchMap = await getMatchMap();
  const context = await buildScoringContext(matchMap);
  const awardOptions = await getAwardOptions();
  const awards = Object.fromEntries(context.awardResults.entries());
  const thirdOptions = [...context.actualGroups.values()]
    .flatMap((group) => {
      const third = group.rows.find((row) => row.position === 3);
      return third ? [{
        value: `${group.groupCode}|${third.team}`,
        label: `Grupo ${group.groupCode} - ${third.team}`,
        team_code: third.team,
        group_code: group.groupCode
      }] : [];
    })
    .sort((a, b) => a.group_code.localeCompare(b.group_code));

  return {
    groups: [...context.actualGroups.values()]
      .sort((a, b) => a.groupCode.localeCompare(b.groupCode))
      .map((group) => ({
        group_code: group.groupCode,
        ready: group.ready,
        source: group.source,
        finished_matches: group.finishedMatches,
        total_matches: group.totalMatches,
        rows: group.rows,
        manual_rows: group.manualRows || []
      })),
    bestThirds: context.bestThirds,
    bestThirdsManual: context.manualBestThirdRows,
    thirdOptions,
    awards,
    awardOptions,
    aliases: context.rawAliases
  };
}
