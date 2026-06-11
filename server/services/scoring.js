import { assertNoError, nowIso, requireSupabase } from "../db/supabase.js";

const STAGE_LABELS = {
  group: "Fase de grupos",
  r32: "Ronda de 32",
  r16: "Octavos",
  qf: "Cuartos",
  sf: "Semifinal",
  third: "Tercer puesto",
  final: "Final"
};

function cleanName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function sameTeam(a, b) {
  if (!a || !b) return false;
  return cleanName(a) === cleanName(b);
}

function outcome(homeGoals, awayGoals) {
  if (homeGoals == null || awayGoals == null) return null;
  if (homeGoals > awayGoals) return "home";
  if (awayGoals > homeGoals) return "away";
  return "draw";
}

function winnerName(homeGoals, awayGoals, homeTeam, awayTeam) {
  const result = outcome(homeGoals, awayGoals);
  if (result === "home") return homeTeam;
  if (result === "away") return awayTeam;
  return "draw";
}

function matchFinished(match) {
  return match?.status === "finished" && match.home_goals != null && match.away_goals != null;
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
        .map((row, index) => ({ ...row, position: index + 1 }));
      return [groupCode, { ...group, rows }];
    })
  );
}

function predictionVerdict(prediction, match, scored) {
  if (!matchFinished(match)) return "pending";
  if (scored.points > 0) return "hit";
  if (
    prediction.predicted_home_goals === match.home_goals &&
    prediction.predicted_away_goals === match.away_goals
  ) {
    return "hit";
  }
  return "miss";
}

function scorePrediction(prediction, match) {
  if (!match || match.status !== "finished" || match.home_goals == null || match.away_goals == null) {
    return { points: 0, reason: "Pendiente" };
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
  const predictedWinner = winnerName(
    prediction.predicted_home_goals,
    prediction.predicted_away_goals,
    prediction.predicted_home_team,
    prediction.predicted_away_team
  );
  const actualWinner = winnerName(match.home_goals, match.away_goals, match.home_team, match.away_team);
  const winnerCorrect = predictedWinner !== "draw" && sameTeam(predictedWinner, actualWinner);

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
      reasons.push("Campeon correcto");
    }
    if (sameTeam(predictedRunnerUp, actualRunnerUp)) {
      points += 10;
      reasons.push("Subcampeon correcto");
    }
    if (teamsCorrect && exact) {
      points += 12;
      reasons.push("Marcador exacto");
    }
    return { points, reason: reasons.join(", ") || "Sin puntos" };
  }

  return { points: 0, reason: "Sin regla" };
}

async function getMatchMap() {
  const client = requireSupabase();
  const { data, error } = await client.from("match_results").select("*");
  assertNoError(error, "Leer partidos");
  return new Map((data || []).map((match) => [match.match_id, match]));
}

export async function calculateParticipantScore(participantId, providedMatches = null) {
  const client = requireSupabase();
  const matchMap = providedMatches || (await getMatchMap());
  const { data: predictions, error } = await client
    .from("predictions")
    .select("*")
    .eq("participant_id", participantId)
    .order("match_id", { ascending: true });
  assertNoError(error, "Leer predicciones");

  const state = {
    total: 0,
    byCategory: {},
    details: []
  };

  for (const prediction of predictions || []) {
    const match = matchMap.get(prediction.match_id);
    const scored = scorePrediction(prediction, match);
    state.total += scored.points;
    state.byCategory[prediction.stage] = Number(((state.byCategory[prediction.stage] || 0) + scored.points).toFixed(2));
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
      predictedAwayTeam: prediction.predicted_away_team
    });
  }

  state.total = Number(state.total.toFixed(2));
  return state;
}

export async function recalculateAllScores() {
  const client = requireSupabase();
  const { data: participants, error } = await client.from("participants").select("id");
  assertNoError(error, "Leer participantes");
  const matchMap = await getMatchMap();
  const rows = [];

  for (const participant of participants || []) {
    const score = await calculateParticipantScore(participant.id, matchMap);
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

  if ((participants?.length || 0) > 0 && (scores?.length || 0) !== participants.length) {
    await recalculateAllScores();
    return getLeaderboard();
  }

  const scoreMap = new Map((scores || []).map((score) => [score.participant_id, score]));
  const matchMap = await getMatchMap();
  const rows = [];

  for (const participant of participants || []) {
    const score = await calculateParticipantScore(participant.id, matchMap);
    const cached = scoreMap.get(participant.id);
    rows.push({
      id: participant.id,
      name: participant.name,
      totalPoints: Number(cached?.total_points ?? score.total ?? 0),
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

  rows.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
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

  const breakdown = await calculateParticipantScore(participantId);

  const { data: predictions, error: predictionError } = await client
    .from("predictions")
    .select("*")
    .eq("participant_id", participantId)
    .order("stage", { ascending: true })
    .order("match_id", { ascending: true });
  assertNoError(predictionError, "Leer detalle de predicciones");

  const matchMap = await getMatchMap();
  const standingsMap = groupStandings(matchMap);
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

  const { data: groups, error: groupsError } = await client
    .from("group_predictions")
    .select("*")
    .eq("participant_id", participantId)
    .order("group_code", { ascending: true })
    .order("predicted_position", { ascending: true });
  assertNoError(groupsError, "Leer predicciones de grupos");

  const enrichedGroups = (groups || []).map((row) => {
    const group = standingsMap.get(String(row.group_code || "").toUpperCase());
    const actual = group?.rows.find((standing) => sameTeam(standing.team, row.team_code));
    const hasResults = (group?.finishedMatches || 0) > 0;
    return {
      ...row,
      actual_position: actual?.position || null,
      actual_points: actual?.points ?? null,
      actual_gd: actual?.gd ?? null,
      actual_played: actual?.played ?? null,
      group_finished_matches: group?.finishedMatches || 0,
      group_total_matches: group?.totalMatches || 0,
      verdict: !hasResults || !actual ? "pending" : actual.position === row.predicted_position ? "hit" : "miss"
    };
  });

  const actualGroups = [...standingsMap.values()]
    .sort((a, b) => a.groupCode.localeCompare(b.groupCode))
    .map((group) => ({
      group_code: group.groupCode,
      finished_matches: group.finishedMatches,
      total_matches: group.totalMatches,
      rows: group.rows
    }));

  return {
    participant,
    totalPoints: breakdown.total,
    breakdown,
    predictions: enrichedPredictions,
    individual,
    groups: enrichedGroups,
    actualGroups
  };
}
