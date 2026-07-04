import { requireSupabase, nowIso } from "../server/db/supabase.js";
import { applyBracketAdvancement } from "../server/services/bracket.js";
import { recalculateAllScores } from "../server/services/scoring.js";

const client = requireSupabase();
const sourceMatchIds = ["M13", "M14", "M15", "M16"];
const at = nowIso();

const { data: matches, error } = await client
  .from("match_results")
  .select("*")
  .in("match_id", sourceMatchIds);

if (error) throw new Error(`Leyendo partidos de origen: ${error.message}`);

const byId = new Map((matches || []).map((match) => [match.match_id, match]));
const changed = [];

for (const matchId of sourceMatchIds) {
  const match = byId.get(matchId);
  if (!match) throw new Error(`No se encontro ${matchId}.`);
  const rows = await applyBracketAdvancement(client, match, {
    actor: "codex",
    source: "bracket-branch-correction",
    reason: "Correccion de rama: Colombia debe enfrentar a Suiza en octavos.",
    at
  });
  changed.push(...rows);
}

await recalculateAllScores();

console.log(JSON.stringify({
  ok: true,
  changed: changed.map((row) => ({
    match_id: row.match_id,
    home_team: row.home_team,
    away_team: row.away_team
  }))
}, null, 2));
