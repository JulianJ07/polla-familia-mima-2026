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
  const enrichedPredictions = (predictions || []).map((prediction) => {
    const match = matchMap.get(prediction.match_id);
    return {
      ...prediction,
      home_team: match?.home_team,
      away_team: match?.away_team,
      home_goals: match?.home_goals,
      away_goals: match?.away_goals,
      status: match?.status,
      match_date: match?.match_date
    };
  });

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

  return {
    participant,
    totalPoints: breakdown.total,
    breakdown,
    predictions: enrichedPredictions,
    individual,
    groups: groups || []
  };
}
