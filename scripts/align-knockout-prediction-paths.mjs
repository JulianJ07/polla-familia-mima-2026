import { requireSupabase } from "../server/db/supabase.js";
import { recalculateAllScores } from "../server/services/scoring.js";

const client = requireSupabase();

const ROUND_LINKS = [
  ["O1", "M3", "M4", "winner"],
  ["O2", "M1", "M2", "winner"],
  ["O3", "M9", "M10", "winner"],
  ["O4", "M11", "M12", "winner"],
  ["O5", "M6", "M5", "winner"],
  ["O6", "M8", "M7", "winner"],
  ["O7", "M15", "M16", "winner"],
  ["O8", "M14", "M13", "winner"],
  ["Q1", "O1", "O2", "winner"],
  ["Q2", "O3", "O5", "winner"],
  ["Q3", "O4", "O6", "winner"],
  ["Q4", "O7", "O8", "winner"],
  ["S1", "Q1", "Q2", "winner"],
  ["S2", "Q3", "Q4", "winner"],
  ["FINAL", "S1", "S2", "winner"],
  ["THIRD", "S1", "S2", "loser"]
];

function normalizeTeam(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sameTeam(a, b) {
  return Boolean(a && b && normalizeTeam(a) === normalizeTeam(b));
}

function outcome(row) {
  if (row?.predicted_home_goals == null || row?.predicted_away_goals == null) return null;
  if (row.predicted_home_goals > row.predicted_away_goals) return "home";
  if (row.predicted_away_goals > row.predicted_home_goals) return "away";
  return "draw";
}

function winnerTeam(row, preferred) {
  const result = outcome(row);
  if (result === "home") return row.predicted_home_team;
  if (result === "away") return row.predicted_away_team;
  if (sameTeam(preferred, row?.predicted_home_team) || sameTeam(preferred, row?.predicted_away_team)) return preferred;
  return row?.predicted_home_team || row?.predicted_away_team || preferred || null;
}

function loserTeam(row, preferred) {
  const result = outcome(row);
  if (result === "home") return row.predicted_away_team;
  if (result === "away") return row.predicted_home_team;
  if (sameTeam(preferred, row?.predicted_home_team) || sameTeam(preferred, row?.predicted_away_team)) return preferred;
  return row?.predicted_away_team || row?.predicted_home_team || preferred || null;
}

function goalSourceForTeam(row, team) {
  if (sameTeam(row?.predicted_home_team, team)) return "home";
  if (sameTeam(row?.predicted_away_team, team)) return "away";
  return null;
}

function goalsFromSource(row, source) {
  return source === "away" ? row.predicted_away_goals : row.predicted_home_goals;
}

function oppositeSource(source) {
  if (source === "home") return "away";
  if (source === "away") return "home";
  return null;
}

function remapGoals(row, homeTeam, awayTeam) {
  const homeSource = goalSourceForTeam(row, homeTeam);
  const awaySource = goalSourceForTeam(row, awayTeam);
  if (homeSource && awaySource) {
    return {
      predicted_home_goals: goalsFromSource(row, homeSource),
      predicted_away_goals: goalsFromSource(row, awaySource)
    };
  }
  if (homeSource) {
    return {
      predicted_home_goals: goalsFromSource(row, homeSource),
      predicted_away_goals: goalsFromSource(row, oppositeSource(homeSource))
    };
  }
  if (awaySource) {
    return {
      predicted_home_goals: goalsFromSource(row, oppositeSource(awaySource)),
      predicted_away_goals: goalsFromSource(row, awaySource)
    };
  }
  return {
    predicted_home_goals: row.predicted_home_goals,
    predicted_away_goals: row.predicted_away_goals
  };
}

function rowPatch(row, homeTeam, awayTeam) {
  const goals = remapGoals(row, homeTeam, awayTeam);
  return {
    predicted_home_team: homeTeam,
    predicted_away_team: awayTeam,
    predicted_home_goals: goals.predicted_home_goals,
    predicted_away_goals: goals.predicted_away_goals
  };
}

function changed(row, patch) {
  return Object.entries(patch).some(([key, value]) => row[key] !== value);
}

async function restoreQuarterSlotsIfNeeded() {
  const { data, error } = await client
    .from("predictions")
    .select("match_id,predicted_home_team,predicted_away_team")
    .in("match_id", ["Q2", "Q3"]);
  if (error) throw new Error(`Leyendo predicciones Q2/Q3: ${error.message}`);

  const q2 = data.filter((row) => row.match_id === "Q2");
  const q3 = data.filter((row) => row.match_id === "Q3");
  const q2WithEngland = q2.filter((row) => sameTeam(row.predicted_home_team, "Inglaterra") || sameTeam(row.predicted_away_team, "Inglaterra")).length;
  const q3WithEngland = q3.filter((row) => sameTeam(row.predicted_home_team, "Inglaterra") || sameTeam(row.predicted_away_team, "Inglaterra")).length;
  const q3WithSpainOrPortugal = q3.filter((row) =>
    ["Espana", "Portugal"].some((team) => sameTeam(row.predicted_home_team, team) || sameTeam(row.predicted_away_team, team))
  ).length;

  if (!(q2WithEngland > q3WithEngland && q3WithSpainOrPortugal > 0)) {
    return false;
  }

  for (const [from, to] of [["Q2", "__tmp_Q2"], ["Q3", "Q2"], ["__tmp_Q2", "Q3"]]) {
    const { error: updateError } = await client
      .from("predictions")
      .update({ match_id: to })
      .eq("match_id", from);
    if (updateError) throw new Error(`Restaurando ${from} -> ${to}: ${updateError.message}`);
  }
  return true;
}

async function alignPaths() {
  const { data: rows, error } = await client
    .from("predictions")
    .select("id,participant_id,match_id,predicted_home_goals,predicted_away_goals,predicted_home_team,predicted_away_team,stage")
    .neq("stage", "group")
    .order("participant_id", { ascending: true });
  if (error) throw new Error(`Leyendo predicciones de llaves: ${error.message}`);

  const byParticipant = new Map();
  for (const row of rows) {
    if (!byParticipant.has(row.participant_id)) byParticipant.set(row.participant_id, new Map());
    byParticipant.get(row.participant_id).set(row.match_id, row);
  }

  const updates = [];
  for (const matches of byParticipant.values()) {
    for (const [targetId, homeSourceId, awaySourceId, resultType] of ROUND_LINKS) {
      const target = matches.get(targetId);
      const homeSource = matches.get(homeSourceId);
      const awaySource = matches.get(awaySourceId);
      if (!target || !homeSource || !awaySource) continue;

      const pick = resultType === "loser" ? loserTeam : winnerTeam;
      const homeTeam = pick(homeSource, target.predicted_home_team);
      const awayTeam = pick(awaySource, target.predicted_away_team);
      if (!homeTeam || !awayTeam) continue;

      const patch = rowPatch(target, homeTeam, awayTeam);
      if (!changed(target, patch)) continue;

      Object.assign(target, patch);
      updates.push({ id: target.id, match_id: target.match_id, patch });
    }
  }

  for (const update of updates) {
    const { error: updateError } = await client
      .from("predictions")
      .update(update.patch)
      .eq("id", update.id);
    if (updateError) throw new Error(`Actualizando prediccion ${update.id} (${update.match_id}): ${updateError.message}`);
  }

  return updates;
}

const restoredQuarterSlots = await restoreQuarterSlotsIfNeeded();
const updates = await alignPaths();
await recalculateAllScores();

console.log(JSON.stringify({
  ok: true,
  restoredQuarterSlots,
  alignedPredictions: updates.length,
  sample: updates.slice(0, 12)
}, null, 2));
