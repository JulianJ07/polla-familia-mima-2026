import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { getLeaderboard } from "../server/services/scoring.js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY.");
}

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function assertNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function fetchAll(query, context) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query.range(from, from + 999);
    assertNoError(error, context);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

function outcome(home, away) {
  if (home > away) return 1;
  if (home < away) return -1;
  return 0;
}

const [{ data: participants, error: participantError }, { data: matches, error: matchError }, predictions] = await Promise.all([
  client.from("participants").select("id,name").order("name"),
  client.from("match_results").select("match_id,home_goals,away_goals,status").eq("stage", "group"),
  fetchAll(client.from("predictions").select("participant_id,match_id,predicted_home_goals,predicted_away_goals").eq("stage", "group"), "Leer predicciones de grupo")
]);
assertNoError(participantError, "Leer participantes");
assertNoError(matchError, "Leer resultados de grupo");

const finished = new Map((matches || [])
  .filter((match) => match.status === "finished" && match.home_goals != null && match.away_goals != null)
  .map((match) => [match.match_id, match]));
const expected = new Map((participants || []).map((participant) => [participant.id, 0]));
const seen = new Set();
const duplicates = [];
for (const prediction of predictions) {
  const key = `${prediction.participant_id}:${prediction.match_id}`;
  if (seen.has(key)) duplicates.push(key);
  seen.add(key);
  const match = finished.get(prediction.match_id);
  if (!match) continue;
  const exact = prediction.predicted_home_goals === match.home_goals && prediction.predicted_away_goals === match.away_goals;
  const points = exact
    ? 3
    : outcome(prediction.predicted_home_goals, prediction.predicted_away_goals) === outcome(match.home_goals, match.away_goals)
      ? 1
      : 0;
  expected.set(prediction.participant_id, (expected.get(prediction.participant_id) || 0) + points);
}

const leaderboard = await getLeaderboard();
const differences = leaderboard
  .filter((row) => Number(row.totalPoints) !== Number(expected.get(row.id) || 0))
  .map((row) => ({ id: row.id, name: row.name, backend: row.totalPoints, independent: expected.get(row.id) || 0 }));

const report = {
  participants: participants?.length || 0,
  finishedGroupMatches: finished.size,
  groupPredictions: predictions.length,
  duplicatePredictions: duplicates.length,
  scoreDifferences: differences,
  topFive: leaderboard.slice(0, 5).map((row) => ({ position: row.position, name: row.name, points: row.totalPoints }))
};
console.log(JSON.stringify(report, null, 2));
if (duplicates.length || differences.length) process.exitCode = 1;
