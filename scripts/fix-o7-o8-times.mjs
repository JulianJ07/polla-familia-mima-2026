import { requireSupabase, nowIso } from "../server/db/supabase.js";

const client = requireSupabase();
const at = nowIso();

const updates = [
  {
    match_id: "O7",
    match_date: "2026-07-07T20:00:00.000Z",
    note: "Suiza vs Colombia a las 3:00 p.m. Colombia."
  },
  {
    match_id: "O8",
    match_date: "2026-07-07T16:00:00.000Z",
    note: "Argentina/Egipto a las 11:00 a.m. Colombia."
  }
];

const changed = [];

for (const update of updates) {
  const { data, error } = await client
    .from("match_results")
    .update({ match_date: update.match_date, last_updated: at })
    .eq("match_id", update.match_id)
    .select("match_id,home_team,away_team,match_date")
    .single();

  if (error) throw new Error(`Actualizando ${update.match_id}: ${error.message}`);
  changed.push({ ...data, note: update.note });
}

console.log(JSON.stringify({ ok: true, changed }, null, 2));
