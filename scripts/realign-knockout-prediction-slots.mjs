import { requireSupabase, nowIso } from "../server/db/supabase.js";
import { recalculateAllScores } from "../server/services/scoring.js";

const client = requireSupabase();
const at = nowIso();

const remaps = [
  { from: "O1", to: "O2" },
  { from: "O2", to: "O1" },
  { from: "O3", to: "O5", swapTeams: true },
  { from: "O4", to: "O6", swapTeams: true },
  { from: "O5", to: "O3" },
  { from: "O6", to: "O4" },
  { from: "O7", to: "O8", swapTeams: true },
  { from: "O8", to: "O7" },
  { from: "Q1", to: "Q1", swapTeams: true },
  { from: "Q4", to: "Q4", swapTeams: true }
];

function normalizeTeam(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function countRows(matchId) {
  const { count, error } = await client
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .eq("match_id", matchId);
  if (error) throw new Error(`Contando ${matchId}: ${error.message}`);
  return count || 0;
}

async function updateByMatchId(matchId, patch) {
  const { error } = await client
    .from("predictions")
    .update(patch)
    .eq("match_id", matchId);
  if (error) throw new Error(`Actualizando ${matchId}: ${error.message}`);
}

const { data: o5Rows, error: o5Error } = await client
  .from("predictions")
  .select("predicted_home_team,predicted_away_team")
  .eq("match_id", "O5");
if (o5Error) throw new Error(`Verificando O5: ${o5Error.message}`);

const staleO5Rows = (o5Rows || []).filter((row) => normalizeTeam(row.predicted_home_team) === "brasil").length;
if (!staleO5Rows) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: "Las predicciones de O5 ya no parecen estar en la rama vieja de Brasil."
  }, null, 2));
} else {

const before = {};
for (const id of [...new Set(remaps.flatMap((item) => [item.from, item.to]))]) {
  before[id] = await countRows(id);
}

for (const remap of remaps) {
  await updateByMatchId(remap.from, { match_id: `__tmp_${remap.from}` });
}

for (const remap of remaps) {
  const patch = { match_id: remap.to };
  if (remap.swapTeams) {
    const { data, error } = await client
      .from("predictions")
      .select("id,predicted_home_team,predicted_away_team,predicted_home_goals,predicted_away_goals")
      .eq("match_id", `__tmp_${remap.from}`);
    if (error) throw new Error(`Leyendo ${remap.from} para invertir: ${error.message}`);

    for (const row of data || []) {
      const { error: rowError } = await client
        .from("predictions")
        .update({
          match_id: remap.to,
          predicted_home_team: row.predicted_away_team,
          predicted_away_team: row.predicted_home_team,
          predicted_home_goals: row.predicted_away_goals,
          predicted_away_goals: row.predicted_home_goals
        })
        .eq("id", row.id);
      if (rowError) throw new Error(`Invirtiendo ${remap.from} -> ${remap.to}: ${rowError.message}`);
    }
  } else {
    await updateByMatchId(`__tmp_${remap.from}`, patch);
  }
}

await recalculateAllScores();

const after = {};
for (const id of Object.keys(before)) {
  after[id] = await countRows(id);
}

console.log(JSON.stringify({
  ok: true,
  at,
  remaps,
  before,
  after
}, null, 2));
}
