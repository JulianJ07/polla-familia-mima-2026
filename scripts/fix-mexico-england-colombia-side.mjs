import { requireSupabase, nowIso } from "../server/db/supabase.js";
import { recalculateAllScores } from "../server/services/scoring.js";

const client = requireSupabase();
const at = nowIso();

const updates = [
  {
    match_id: "Q2",
    patch: {
      away_team: "O5",
      home_goals: null,
      away_goals: null,
      live_home_goals: null,
      live_away_goals: null,
      live_source: null,
      qualified_team: null,
      decided_by_penalties: false,
      home_penalties: null,
      away_penalties: null,
      status: "scheduled",
      source: "worldcup26",
      confirmed_at: null,
      espn_event_id: null,
      espn_status: null,
      last_updated: at
    }
  },
  {
    match_id: "Q3",
    patch: {
      home_team: "Inglaterra",
      home_goals: null,
      away_goals: null,
      live_home_goals: null,
      live_away_goals: null,
      live_source: null,
      qualified_team: null,
      decided_by_penalties: false,
      home_penalties: null,
      away_penalties: null,
      status: "scheduled",
      source: "worldcup26",
      confirmed_at: null,
      espn_event_id: null,
      espn_status: null,
      last_updated: at
    }
  }
];

const changed = [];

for (const update of updates) {
  const { data, error } = await client
    .from("match_results")
    .update(update.patch)
    .eq("match_id", update.match_id)
    .select("match_id,home_team,away_team,status,match_date")
    .single();
  if (error) throw new Error(`Actualizando ${update.match_id}: ${error.message}`);
  changed.push(data);
}

await recalculateAllScores();

console.log(JSON.stringify({ ok: true, changed }, null, 2));
