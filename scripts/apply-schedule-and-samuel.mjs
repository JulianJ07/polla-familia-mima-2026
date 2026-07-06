import dotenv from "dotenv";
import { requireSupabase } from "../server/db/supabase.js";
import { recalculateAllScores } from "../server/services/scoring.js";

dotenv.config({ quiet: true });

const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200";

function pairKey(...codes) {
  return codes.map((code) => String(code).toUpperCase()).sort().join("-");
}

function sqlDate(value) {
  return new Date(value).toISOString();
}

function prediction(match_id, home, away, homeGoals, awayGoals, stage) {
  return {
    participant_id: 2,
    match_id,
    predicted_home_team: home,
    predicted_away_team: away,
    predicted_home_goals: homeGoals,
    predicted_away_goals: awayGoals,
    stage
  };
}

const groupSchedulePairs = {
  "G-A-1": ["MEX", "RSA"],
  "G-A-2": ["KOR", "CZE"],
  "G-A-3": ["RSA", "CZE"],
  "G-A-4": ["MEX", "KOR"],
  "G-A-5": ["CZE", "MEX"],
  "G-A-6": ["RSA", "KOR"],
  "G-B-1": ["CAN", "BIH"],
  "G-B-2": ["QAT", "SUI"],
  "G-B-3": ["SUI", "BIH"],
  "G-B-4": ["CAN", "QAT"],
  "G-B-5": ["SUI", "CAN"],
  "G-B-6": ["BIH", "QAT"],
  "G-C-1": ["BRA", "MAR"],
  "G-C-2": ["HAI", "SCO"],
  "G-C-3": ["BRA", "HAI"],
  "G-C-4": ["SCO", "MAR"],
  "G-C-5": ["SCO", "BRA"],
  "G-C-6": ["MAR", "HAI"],
  "G-D-1": ["USA", "PAR"],
  "G-D-2": ["AUS", "TUR"],
  "G-D-3": ["TUR", "PAR"],
  "G-D-4": ["USA", "AUS"],
  "G-D-5": ["TUR", "USA"],
  "G-D-6": ["PAR", "AUS"],
  "G-E-1": ["GER", "CUW"],
  "G-E-2": ["CIV", "ECU"],
  "G-E-3": ["GER", "CIV"],
  "G-E-4": ["ECU", "CUW"],
  "G-E-5": ["ECU", "GER"],
  "G-E-6": ["CUW", "CIV"],
  "G-F-1": ["NED", "JPN"],
  "G-F-2": ["SWE", "TUN"],
  "G-F-3": ["NED", "SWE"],
  "G-F-4": ["TUN", "JPN"],
  "G-F-5": ["JPN", "SWE"],
  "G-F-6": ["TUN", "NED"],
  "G-G-1": ["IRN", "NZL"],
  "G-G-2": ["BEL", "EGY"],
  "G-G-3": ["BEL", "IRN"],
  "G-G-4": ["NZL", "EGY"],
  "G-G-5": ["NZL", "BEL"],
  "G-G-6": ["EGY", "IRN"],
  "G-H-1": ["ESP", "CPV"],
  "G-H-2": ["KSA", "URU"],
  "G-H-3": ["ESP", "KSA"],
  "G-H-4": ["URU", "CPV"],
  "G-H-5": ["URU", "ESP"],
  "G-H-6": ["CPV", "KSA"],
  "G-I-1": ["FRA", "SEN"],
  "G-I-2": ["IRQ", "NOR"],
  "G-I-3": ["FRA", "IRQ"],
  "G-I-4": ["NOR", "SEN"],
  "G-I-5": ["NOR", "FRA"],
  "G-I-6": ["SEN", "IRQ"],
  "G-J-1": ["ARG", "ALG"],
  "G-J-2": ["AUT", "JOR"],
  "G-J-3": ["ARG", "AUT"],
  "G-J-4": ["JOR", "ALG"],
  "G-J-5": ["JOR", "ARG"],
  "G-J-6": ["ALG", "AUT"],
  "G-K-1": ["POR", "COD"],
  "G-K-2": ["UZB", "COL"],
  "G-K-3": ["POR", "UZB"],
  "G-K-4": ["COL", "COD"],
  "G-K-5": ["COL", "POR"],
  "G-K-6": ["COD", "UZB"],
  "G-L-1": ["ENG", "CRO"],
  "G-L-2": ["GHA", "PAN"],
  "G-L-3": ["ENG", "GHA"],
  "G-L-4": ["PAN", "CRO"],
  "G-L-5": ["PAN", "ENG"],
  "G-L-6": ["CRO", "GHA"]
};

const knockoutScheduleNumbers = {
  M3: 73,
  M9: 74,
  M1: 75,
  M4: 76,
  M10: 77,
  M2: 78,
  M11: 79,
  M12: 80,
  M8: 81,
  M7: 82,
  M6: 83,
  M5: 84,
  M15: 85,
  M14: 86,
  M13: 87,
  M16: 88,
  O1: 89,
  O2: 90,
  O3: 91,
  O4: 92,
  O5: 93,
  O6: 94,
  O7: 96,
  O8: 95,
  Q1: 97,
  Q2: 98,
  Q3: 99,
  Q4: 100,
  S1: 101,
  S2: 102,
  THIRD: 103,
  FINAL: 104
};

const samuelPredictionSlotRemap = {
  O1: { match_id: "O2" },
  O2: { match_id: "O1" },
  O3: { match_id: "O5", swapTeams: true },
  O4: { match_id: "O6", swapTeams: true },
  O5: { match_id: "O3" },
  O6: { match_id: "O4" },
  O7: { match_id: "O8", swapTeams: true },
  O8: { match_id: "O7" },
  Q1: { match_id: "Q1", swapTeams: true },
  Q4: { match_id: "Q4", swapTeams: true }
};

function realignSamuelKnockoutPrediction(row) {
  const remap = samuelPredictionSlotRemap[row.match_id];
  if (!remap) return row;
  if (!remap.swapTeams) return { ...row, match_id: remap.match_id };
  return {
    ...row,
    match_id: remap.match_id,
    predicted_home_team: row.predicted_away_team,
    predicted_away_team: row.predicted_home_team,
    predicted_home_goals: row.predicted_away_goals,
    predicted_away_goals: row.predicted_home_goals
  };
}

const samuelPredictions = [
  prediction("G-A-1", "México", "Sudáfrica", 2, 1, "group"),
  prediction("G-A-2", "Corea", "Chequia", 1, 0, "group"),
  prediction("G-A-3", "Sudáfrica", "Chequia", 0, 1, "group"),
  prediction("G-A-4", "México", "Corea", 1, 0, "group"),
  prediction("G-A-5", "Chequia", "México", 1, 3, "group"),
  prediction("G-A-6", "Sudáfrica", "Corea", 0, 2, "group"),
  prediction("G-B-1", "Canadá", "Bosnia", 2, 0, "group"),
  prediction("G-B-2", "Catar", "Suiza", 0, 3, "group"),
  prediction("G-B-3", "Suiza", "Bosnia", 2, 0, "group"),
  prediction("G-B-4", "Canadá", "Catar", 4, 1, "group"),
  prediction("G-B-5", "Suiza", "Canadá", 1, 1, "group"),
  prediction("G-B-6", "Bosnia", "Catar", 0, 0, "group"),
  prediction("G-C-1", "Brasil", "Marruecos", 2, 0, "group"),
  prediction("G-C-2", "Haití", "Escocia", 1, 3, "group"),
  prediction("G-C-3", "Brasil", "Haití", 5, 1, "group"),
  prediction("G-C-4", "Escocia", "Marruecos", 0, 1, "group"),
  prediction("G-C-5", "Escocia", "Brasil", 0, 2, "group"),
  prediction("G-C-6", "Marruecos", "Haití", 3, 1, "group"),
  prediction("G-D-1", "USA", "Paraguay", 2, 1, "group"),
  prediction("G-D-2", "Australia", "Turquía", 1, 1, "group"),
  prediction("G-D-3", "Turquía", "Paraguay", 3, 1, "group"),
  prediction("G-D-4", "USA", "Australia", 1, 3, "group"),
  prediction("G-D-5", "Turquía", "USA", 2, 1, "group"),
  prediction("G-D-6", "Paraguay", "Australia", 2, 4, "group"),
  prediction("G-E-1", "Alemania", "Curazao", 4, 0, "group"),
  prediction("G-E-2", "Costa Marfil", "Ecuador", 2, 5, "group"),
  prediction("G-E-3", "Alemania", "Costa Marfil", 3, 1, "group"),
  prediction("G-E-4", "Ecuador", "Curazao", 2, 0, "group"),
  prediction("G-E-5", "Ecuador", "Alemania", 1, 1, "group"),
  prediction("G-E-6", "Curazao", "Costa Marfil", 0, 2, "group"),
  prediction("G-F-1", "Holanda", "Japón", 2, 0, "group"),
  prediction("G-F-2", "Suecia", "Túnez", 3, 1, "group"),
  prediction("G-F-3", "Holanda", "Suecia", 2, 1, "group"),
  prediction("G-F-4", "Túnez", "Japón", 2, 3, "group"),
  prediction("G-F-5", "Japón", "Suecia", 0, 2, "group"),
  prediction("G-F-6", "Túnez", "Holanda", 1, 3, "group"),
  prediction("G-G-1", "Irán", "N. Zelanda", 1, 0, "group"),
  prediction("G-G-2", "Bélgica", "Egipto", 2, 0, "group"),
  prediction("G-G-3", "Bélgica", "Irán", 3, 1, "group"),
  prediction("G-G-4", "N. Zelanda", "Egipto", 0, 1, "group"),
  prediction("G-G-5", "N. Zelanda", "Bélgica", 0, 3, "group"),
  prediction("G-G-6", "Egipto", "Irán", 3, 2, "group"),
  prediction("G-H-1", "España", "Cabo Verde", 5, 1, "group"),
  prediction("G-H-2", "A. Saudita", "Uruguay", 2, 4, "group"),
  prediction("G-H-3", "España", "A. Saudita", 2, 0, "group"),
  prediction("G-H-4", "Uruguay", "Cabo Verde", 2, 0, "group"),
  prediction("G-H-5", "Uruguay", "España", 1, 3, "group"),
  prediction("G-H-6", "Cabo Verde", "A. Saudita", 1, 2, "group"),
  prediction("G-I-1", "Francia", "Senegal", 2, 1, "group"),
  prediction("G-I-2", "Irak", "Noruega", 0, 2, "group"),
  prediction("G-I-3", "Francia", "Irak", 3, 0, "group"),
  prediction("G-I-4", "Noruega", "Senegal", 2, 2, "group"),
  prediction("G-I-5", "Noruega", "Francia", 2, 4, "group"),
  prediction("G-I-6", "Senegal", "Irak", 2, 0, "group"),
  prediction("G-J-1", "Argentina", "Argelia", 4, 1, "group"),
  prediction("G-J-2", "Austria", "Jordania", 2, 0, "group"),
  prediction("G-J-3", "Argentina", "Austria", 2, 0, "group"),
  prediction("G-J-4", "Jordania", "Argelia", 1, 3, "group"),
  prediction("G-J-5", "Jordania", "Argentina", 1, 2, "group"),
  prediction("G-J-6", "Argelia", "Austria", 1, 1, "group"),
  prediction("G-K-1", "Portugal", "RD Congo", 3, 0, "group"),
  prediction("G-K-2", "Uzbekistán", "Colombia", 1, 4, "group"),
  prediction("G-K-3", "Portugal", "Uzbekistán", 2, 0, "group"),
  prediction("G-K-4", "Colombia", "RD Congo", 2, 0, "group"),
  prediction("G-K-5", "Colombia", "Portugal", 2, 2, "group"),
  prediction("G-K-6", "RD Congo", "Uzbekistán", 0, 1, "group"),
  prediction("G-L-1", "Inglaterra", "Croacia", 2, 0, "group"),
  prediction("G-L-2", "Ghana", "Panamá", 1, 1, "group"),
  prediction("G-L-3", "Inglaterra", "Ghana", 3, 1, "group"),
  prediction("G-L-4", "Panamá", "Croacia", 0, 2, "group"),
  prediction("G-L-5", "Panamá", "Inglaterra", 0, 3, "group"),
  prediction("G-L-6", "Croacia", "Ghana", 1, 0, "group"),
  prediction("M1", "Alemania", "Sudáfrica", 2, 0, "r32"),
  prediction("M2", "Francia", "Irán", 6, 2, "r32"),
  prediction("M3", "Corea", "Suiza", 0, 1, "r32"),
  prediction("M4", "Holanda", "Marruecos", 3, 1, "r32"),
  prediction("M5", "Portugal", "Croacia", 3, 1, "r32"),
  prediction("M6", "España", "Austria", 4, 0, "r32"),
  prediction("M7", "Australia", "Noruega", 0, 2, "r32"),
  prediction("M8", "Bélgica", "A. Saudita", 3, 1, "r32"),
  prediction("M9", "Brasil", "Suecia", 3, 2, "r32"),
  prediction("M10", "Ecuador", "Senegal", 2, 1, "r32"),
  prediction("M11", "México", "Costa Marfil", 3, 1, "r32"),
  prediction("M12", "Inglaterra", "Argelia", 3, 0, "r32"),
  prediction("M13", "Argentina", "Uruguay", 3, 1, "r32"),
  prediction("M14", "Turquía", "Egipto", 2, 0, "r32"),
  prediction("M15", "Canadá", "Escocia", 2, 1, "r32"),
  prediction("M16", "Colombia", "USA", 4, 1, "r32"),
  prediction("O1", "Alemania", "Francia", 1, 3, "r16"),
  prediction("O2", "Suiza", "Holanda", 0, 1, "r16"),
  prediction("O3", "Portugal", "España", 3, 2, "r16"),
  prediction("O4", "Noruega", "Bélgica", 1, 2, "r16"),
  prediction("O5", "Brasil", "Senegal", 2, 0, "r16"),
  prediction("O6", "México", "Inglaterra", 1, 3, "r16"),
  prediction("O7", "Argentina", "Turquía", 4, 1, "r16"),
  prediction("O8", "Canadá", "Colombia", 0, 2, "r16"),
  prediction("Q1", "Francia", "Holanda", 2, 0, "qf"),
  prediction("Q2", "Portugal", "Bélgica", 1, 0, "qf"),
  prediction("Q3", "Brasil", "Inglaterra", 2, 3, "qf"),
  prediction("Q4", "Argentina", "Colombia", 1, 2, "qf"),
  prediction("S1", "Francia", "Portugal", 1, 2, "sf"),
  prediction("S2", "Inglaterra", "Colombia", 3, 3, "sf"),
  prediction("FINAL", "Portugal", "Inglaterra", 3, 2, "final"),
  prediction("THIRD", "Francia", "Colombia", 3, 1, "third")
].map(realignSamuelKnockoutPrediction);

const samuelGroupPredictions = Object.entries({
  A: ["México", "Corea", "Sudáfrica", "Chequia"],
  B: ["Canadá", "Suiza", "Bosnia", "Catar"],
  C: ["Brasil", "Marruecos", "Escocia", "Haití"],
  D: ["Australia", "Turquía", "USA", "Paraguay"],
  E: ["Alemania", "Ecuador", "Costa Marfil", "Curazao"],
  F: ["Holanda", "Suecia", "Japón", "Túnez"],
  G: ["Bélgica", "Egipto", "Irán", "N. Zelanda"],
  H: ["España", "Uruguay", "A. Saudita", "Cabo Verde"],
  I: ["Francia", "Senegal", "Noruega", "Irak"],
  J: ["Argentina", "Austria", "Argelia", "Jordania"],
  K: ["Colombia", "Portugal", "Uzbekistán", "RD Congo"],
  L: ["Inglaterra", "Croacia", "Ghana", "Panamá"]
}).flatMap(([group_code, teams]) =>
  teams.map((team_code, index) => ({
    participant_id: 2,
    group_code,
    team_code,
    predicted_position: index + 1
  }))
);

async function fetchScheduleUpdates() {
  const response = await fetch(ESPN_SCOREBOARD_URL);
  if (!response.ok) throw new Error(`ESPN schedule error: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  const events = payload.events || [];
  if (events.length !== 104) throw new Error(`Se esperaban 104 eventos y llegaron ${events.length}.`);

  const byTeamPair = new Map();
  const byNumber = new Map();

  events.forEach((event, index) => {
    const competitors = event.competitions?.[0]?.competitors || [];
    const codes = competitors.map((item) => item.team?.abbreviation).filter(Boolean);
    if (codes.length === 2) byTeamPair.set(pairKey(...codes), event.date);
    byNumber.set(index + 1, event.date);
  });

  const updates = [];
  for (const [match_id, codes] of Object.entries(groupSchedulePairs)) {
    const date = byTeamPair.get(pairKey(...codes));
    if (!date) throw new Error(`No se encontro horario para ${match_id} (${codes.join(" vs ")}).`);
    updates.push({ match_id, match_date: sqlDate(date), last_updated: new Date().toISOString() });
  }

  for (const [match_id, number] of Object.entries(knockoutScheduleNumbers)) {
    const date = byNumber.get(number);
    if (!date) throw new Error(`No se encontro horario para ${match_id} (partido FIFA ${number}).`);
    updates.push({ match_id, match_date: sqlDate(date), last_updated: new Date().toISOString() });
  }

  return updates;
}

async function applySchedule(client, updates) {
  for (const update of updates) {
    const { error } = await client
      .from("match_results")
      .update({ match_date: update.match_date, last_updated: update.last_updated })
      .eq("match_id", update.match_id);
    if (error) throw new Error(`Actualizando ${update.match_id}: ${error.message}`);
  }
}

async function replaceSamuelPredictions(client) {
  for (const table of ["predictions", "group_predictions", "individual_predictions"]) {
    const { error } = await client.from(table).delete().eq("participant_id", 2);
    if (error) throw new Error(`Limpiando ${table}: ${error.message}`);
  }

  const { error: predictionsError } = await client.from("predictions").insert(samuelPredictions);
  if (predictionsError) throw new Error(`Insertando predicciones Samuel: ${predictionsError.message}`);

  const { error: groupsError } = await client.from("group_predictions").insert(samuelGroupPredictions);
  if (groupsError) throw new Error(`Insertando grupos Samuel: ${groupsError.message}`);

  const { error: individualError } = await client.from("individual_predictions").insert({
    participant_id: 2,
    top_scorer: "Mbappé",
    best_player: "Vitinha",
    best_goalkeeper: "Diogo Costa"
  });
  if (individualError) throw new Error(`Insertando individuales Samuel: ${individualError.message}`);
}

async function countRows(client, table, participantId = null) {
  let query = client.from(table).select("id", { count: "exact", head: true });
  if (participantId != null) query = query.eq("participant_id", participantId);
  const { count, error } = await query;
  if (error) throw new Error(`Contando ${table}: ${error.message}`);
  return count || 0;
}

const client = requireSupabase();
const scheduleUpdates = await fetchScheduleUpdates();
await applySchedule(client, scheduleUpdates);
await replaceSamuelPredictions(client);
await recalculateAllScores();

console.log(JSON.stringify({
  ok: true,
  scheduleUpdated: scheduleUpdates.length,
  samuel: {
    predictions: await countRows(client, "predictions", 2),
    groupPredictions: await countRows(client, "group_predictions", 2),
    individualPredictions: await countRows(client, "individual_predictions", 2)
  },
  totals: {
    matchResults: await countRows(client, "match_results"),
    predictions: await countRows(client, "predictions"),
    groupPredictions: await countRows(client, "group_predictions"),
    individualPredictions: await countRows(client, "individual_predictions")
  }
}, null, 2));
