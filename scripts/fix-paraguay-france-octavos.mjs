import { requireSupabase, nowIso } from "../server/db/supabase.js";
import { applyBracketAdvancement } from "../server/services/bracket.js";
import { recalculateAllScores } from "../server/services/scoring.js";

const client = requireSupabase();
const at = nowIso();

const { data: o3, error: o3Error } = await client
  .from("match_results")
  .update({
    away_team: "Noruega",
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
    espn_last_synced_at: null,
    espn_next_sync_at: null,
    last_updated: at
  })
  .eq("match_id", "O3")
  .select("*")
  .single();

if (o3Error) throw new Error(`Actualizando O3: ${o3Error.message}`);

const { data: o2, error: o2Error } = await client
  .from("match_results")
  .update({
    home_team: "Paraguay",
    away_team: "Francia",
    home_goals: 0,
    away_goals: 1,
    live_home_goals: 0,
    live_away_goals: 1,
    live_source: null,
    qualified_team: "Francia",
    decided_by_penalties: false,
    home_penalties: null,
    away_penalties: null,
    status: "finished",
    source: "espn",
    manual_override: false,
    confirmed_at: at,
    raw_payload: {
      provider: "espn",
      event_id: "760503",
      status: "FT",
      detail: "FT",
      correction: "Paraguay 0-1 Francia en octavos."
    },
    espn_event_id: "760503",
    espn_status: "FT",
    espn_last_synced_at: at,
    espn_next_sync_at: null,
    last_updated: at
  })
  .eq("match_id", "O2")
  .select("*")
  .single();

if (o2Error) throw new Error(`Actualizando O2: ${o2Error.message}`);

const bracketRows = await applyBracketAdvancement(client, o2, {
  actor: "codex",
  source: "bracket-branch-correction",
  reason: "Correccion de octavos: Paraguay enfrento a Francia y Francia clasifico.",
  at
});

await recalculateAllScores();

console.log(JSON.stringify({
  ok: true,
  changed: [
    {
      match_id: o2.match_id,
      home_team: o2.home_team,
      away_team: o2.away_team,
      home_goals: o2.home_goals,
      away_goals: o2.away_goals,
      qualified_team: o2.qualified_team
    },
    {
      match_id: o3.match_id,
      home_team: o3.home_team,
      away_team: o3.away_team,
      status: o3.status
    },
    ...bracketRows.map((row) => ({
      match_id: row.match_id,
      home_team: row.home_team,
      away_team: row.away_team
    }))
  ]
}, null, 2));
