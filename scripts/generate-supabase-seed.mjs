import XLSX from "@e965/xlsx";
import fs from "node:fs";
import path from "node:path";

const input = process.argv[2];
const outDir = process.argv[3] || "supabase";

if (!input) {
  console.error("Usage: node scripts/generate-supabase-seed.mjs <workbook.xlsx> [outDir]");
  process.exit(1);
}

const workbook = XLSX.read(fs.readFileSync(input), { type: "buffer", cellDates: false });
const formatSheet = workbook.Sheets.Formato;
if (!formatSheet) throw new Error('No se encontro la hoja "Formato".');

function raw(sheet, row, col) {
  const ref = XLSX.utils.encode_cell({ r: row, c: col });
  const value = sheet[ref]?.w ?? sheet[ref]?.v ?? "";
  return value == null ? "" : String(value);
}

function cellRef(row, col) {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

function fixMojibake(value) {
  const text = String(value ?? "");
  if (!/[ÃÂ�]/.test(text)) return text.trim();
  return Buffer.from(text, "latin1").toString("utf8").trim();
}

function value(sheet, row, col) {
  return fixMojibake(raw(sheet, row, col));
}

function intValue(sheet, row, col) {
  const text = value(sheet, row, col);
  if (text === "") return null;
  const n = Number(text);
  return Number.isInteger(n) ? n : Number.NaN;
}

function sqlString(value) {
  if (value == null || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  return value == null || Number.isNaN(value) ? "NULL" : String(value);
}

function participantNameFromSheet(sheetName, sheet, warnings) {
  const participantLine = value(sheet, 1, 0);
  const parsed = participantLine.replace(/.*PARTICIPANTE:\s*/i, "").trim();
  if (parsed.toLowerCase() === "yo" && sheetName === "Miguel Fajardo") return "Miguel Fajardo";
  if (parsed) return parsed;
  warnings.push({
    severity: "warning",
    participant: sheetName,
    sheet: sheetName,
    cell: "A2",
    type: "missing_participant_name",
    message: `A2 no trae nombre despues de PARTICIPANTE; se uso el nombre de la hoja: ${sheetName}.`
  });
  return sheetName;
}

const groupBlockColumns = [
  ["A", 0],
  ["B", 5],
  ["C", 10],
  ["D", 15],
  ["E", 20],
  ["F", 25]
];
const secondGroupBlockColumns = [
  ["G", 0],
  ["H", 5],
  ["I", 10],
  ["J", 15],
  ["K", 20],
  ["L", 25]
];

function buildGroupFixtures() {
  const fixtures = [];
  for (const [group, baseCol] of groupBlockColumns) {
    for (let row = 2; row <= 7; row += 1) {
      fixtures.push({
        match_id: `G-${group}-${row - 1}`,
        group_code: group,
        stage: "group",
        row,
        homeCol: baseCol + 1,
        homeScoreCol: baseCol + 2,
        awayScoreCol: baseCol + 3,
        awayCol: baseCol + 4,
        home_team: value(formatSheet, row, baseCol + 1),
        away_team: value(formatSheet, row, baseCol + 4)
      });
    }
  }
  for (const [group, baseCol] of secondGroupBlockColumns) {
    for (let row = 12; row <= 17; row += 1) {
      fixtures.push({
        match_id: `G-${group}-${row - 11}`,
        group_code: group,
        stage: "group",
        row,
        homeCol: baseCol + 1,
        homeScoreCol: baseCol + 2,
        awayScoreCol: baseCol + 3,
        awayCol: baseCol + 4,
        home_team: value(formatSheet, row, baseCol + 1),
        away_team: value(formatSheet, row, baseCol + 4)
      });
    }
  }
  return fixtures;
}

function buildGroupPositionCells() {
  const cells = [];
  for (const [group, baseCol] of groupBlockColumns) {
    for (let row = 8; row <= 11; row += 1) {
      cells.push({
        group_code: group,
        predicted_position: row - 7,
        row,
        labelCol: baseCol + 1,
        teamCol: baseCol + 4
      });
    }
  }
  for (const [group, baseCol] of secondGroupBlockColumns) {
    for (let row = 18; row <= 21; row += 1) {
      cells.push({
        group_code: group,
        predicted_position: row - 17,
        row,
        labelCol: baseCol + 1,
        teamCol: baseCol + 4
      });
    }
  }
  return cells;
}

function buildKnockoutCells() {
  const items = [];
  for (let row = 23; row <= 30; row += 1) {
    items.push({ stage: "r32", match_id: value(formatSheet, row, 0), row, homeCol: 1, homeScoreCol: 2, awayScoreCol: 3, awayCol: 4 });
    items.push({ stage: "r32", match_id: value(formatSheet, row, 5), row, homeCol: 6, homeScoreCol: 7, awayScoreCol: 8, awayCol: 9 });
    items.push({ stage: "r16", match_id: value(formatSheet, row, 10), row, homeCol: 11, homeScoreCol: 12, awayScoreCol: 13, awayCol: 14 });
  }
  for (const idRow of [23, 25, 27, 29]) {
    items.push({
      stage: "qf",
      match_id: value(formatSheet, idRow, 15),
      row: idRow + 1,
      homeCol: 16,
      homeScoreCol: 17,
      awayScoreCol: 18,
      awayCol: 19,
      slotLabel: value(formatSheet, idRow, 16)
    });
  }
  for (const idRow of [23, 26]) {
    items.push({
      stage: "sf",
      match_id: value(formatSheet, idRow, 20),
      row: idRow + 1,
      homeCol: 21,
      homeScoreCol: 22,
      awayScoreCol: 23,
      awayCol: 24,
      slotLabel: value(formatSheet, idRow, 21)
    });
  }
  items.push({ stage: "final", match_id: "FINAL", row: 26, homeCol: 26, homeScoreCol: 27, awayScoreCol: 28, awayCol: 29 });
  items.push({ stage: "third", match_id: "THIRD", row: 30, homeCol: 26, homeScoreCol: 27, awayScoreCol: 28, awayCol: 29 });
  return items.filter((item) => item.match_id);
}

function readPredictionScore(sheet, participant, item, warnings) {
  const homeGoals = intValue(sheet, item.row, item.homeScoreCol);
  const awayGoals = intValue(sheet, item.row, item.awayScoreCol);
  const cells = `${cellRef(item.row, item.homeScoreCol)}, ${cellRef(item.row, item.awayScoreCol)}`;
  if (homeGoals == null && awayGoals == null) {
    warnings.push({
      severity: "info",
      participant,
      sheet: participant,
      cell: cells,
      type: "missing_score",
      message: `Marcador vacio para ${item.match_id}.`
    });
    return null;
  }
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) {
    warnings.push({
      severity: "error",
      participant,
      sheet: participant,
      cell: cells,
      type: "invalid_score",
      message: `Marcador no numerico para ${item.match_id}: ${raw(sheet, item.row, item.homeScoreCol)}-${raw(sheet, item.row, item.awayScoreCol)}.`
    });
    return null;
  }
  return { homeGoals, awayGoals };
}

function readTeamPair(sheet, item) {
  return {
    home_team: value(sheet, item.row, item.homeCol),
    away_team: value(sheet, item.row, item.awayCol)
  };
}

const warnings = [];
const participants = workbook.SheetNames
  .filter((name) => name !== "Formato")
  .map((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName];
    return {
      id: index + 1,
      sheetName,
      name: participantNameFromSheet(sheetName, sheet, warnings),
      sheet
    };
  });

const groupFixtures = buildGroupFixtures();
const knockoutItems = buildKnockoutCells();
const groupPositionCells = buildGroupPositionCells();

const matchResults = [];
for (const fixture of groupFixtures) {
  matchResults.push({
    match_id: fixture.match_id,
    home_team: fixture.home_team,
    away_team: fixture.away_team,
    stage: "group"
  });
}
for (const item of knockoutItems) {
  const label = item.slotLabel || "";
  let home = `${item.match_id} local`;
  let away = `${item.match_id} visitante`;
  const labelParts = label.split(/\s+vs\s+/i).map((part) => part.trim()).filter(Boolean);
  if (labelParts.length === 2) {
    home = labelParts[0];
    away = labelParts[1];
  } else if (item.match_id === "FINAL") {
    home = "Finalista 1";
    away = "Finalista 2";
  } else if (item.match_id === "THIRD") {
    home = "Perdedor semifinal 1";
    away = "Perdedor semifinal 2";
  }
  matchResults.push({ match_id: item.match_id, home_team: home, away_team: away, stage: item.stage });
}

const predictions = [];
const predictionComments = [];
const groupPredictions = [];
const individualPredictions = [];

const knockoutPredictionSlotRemap = {
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

function realignKnockoutPrediction(row) {
  const remap = knockoutPredictionSlotRemap[row.match_id];
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

for (const participant of participants) {
  for (const fixture of groupFixtures) {
    const score = readPredictionScore(participant.sheet, participant.name, fixture, warnings);
    if (!score) continue;
    predictions.push({
      participant_id: participant.id,
      match_id: fixture.match_id,
      predicted_home_goals: score.homeGoals,
      predicted_away_goals: score.awayGoals,
      predicted_home_team: fixture.home_team,
      predicted_away_team: fixture.away_team,
      stage: "group"
    });
  }

  for (const positionCell of groupPositionCells) {
    const team = value(participant.sheet, positionCell.row, positionCell.teamCol);
    if (!team) {
      warnings.push({
        severity: "info",
        participant: participant.name,
        sheet: participant.sheetName,
        cell: cellRef(positionCell.row, positionCell.teamCol),
        type: "missing_group_position",
        message: `Equipo vacio para ${positionCell.group_code}${positionCell.predicted_position}.`
      });
      continue;
    }
    groupPredictions.push({
      participant_id: participant.id,
      group_code: positionCell.group_code,
      team_code: team,
      predicted_position: positionCell.predicted_position
    });
  }

  for (const item of knockoutItems) {
    const score = readPredictionScore(participant.sheet, participant.name, item, warnings);
    const teams = readTeamPair(participant.sheet, item);
    if (!teams.home_team || !teams.away_team) {
      warnings.push({
        severity: "info",
        participant: participant.name,
        sheet: participant.sheetName,
        cell: `${cellRef(item.row, item.homeCol)}, ${cellRef(item.row, item.awayCol)}`,
        type: "missing_knockout_teams",
        message: `Equipos vacios para ${item.match_id}.`
      });
    }
    if (!score) continue;
    const predictionRow = realignKnockoutPrediction({
      participant_id: participant.id,
      match_id: item.match_id,
      predicted_home_goals: score.homeGoals,
      predicted_away_goals: score.awayGoals,
      predicted_home_team: teams.home_team || null,
      predicted_away_team: teams.away_team || null,
      stage: item.stage
    });
    predictions.push(predictionRow);
    predictionComments.push({
      participant_id: participant.id,
      participant: participant.name,
      match_id: predictionRow.match_id,
      stage: item.stage,
      home_team: predictionRow.predicted_home_team,
      away_team: predictionRow.predicted_away_team,
      score: `${predictionRow.predicted_home_goals}-${predictionRow.predicted_away_goals}`
    });
  }

  const topScorer = value(participant.sheet, 31, 15);
  const bestPlayer = value(participant.sheet, 32, 15);
  const bestGoalkeeper = value(participant.sheet, 33, 15);
  for (const [key, label, cell, val] of [
    ["top_scorer", "Goleador", "P32", topScorer],
    ["best_player", "Mejor jugador", "P33", bestPlayer],
    ["best_goalkeeper", "Mejor arquero", "P34", bestGoalkeeper]
  ]) {
    if (!val) {
      warnings.push({
        severity: "info",
        participant: participant.name,
        sheet: participant.sheetName,
        cell,
        type: `missing_${key}`,
        message: `${label} vacio.`
      });
    }
  }
  if (topScorer || bestPlayer || bestGoalkeeper) {
    individualPredictions.push({
      participant_id: participant.id,
      top_scorer: topScorer || null,
      best_player: bestPlayer || null,
      best_goalkeeper: bestGoalkeeper || null
    });
  }
}

const lines = [];
lines.push("-- Polla Familia Mima 2026 - seed inicial desde Excel");
lines.push(`-- Fuente: ${path.basename(input)}`);
lines.push(`-- Participantes: ${participants.length}`);
lines.push(`-- Match results placeholders: ${matchResults.length}`);
lines.push(`-- Predictions: ${predictions.length}`);
lines.push(`-- Group predictions: ${groupPredictions.length}`);
lines.push(`-- Individual predictions: ${individualPredictions.length}`);
lines.push(`-- Advertencias/celdas omitidas: ${warnings.length}`);
lines.push("-- Nota: predictions incluye predicted_home_team y predicted_away_team para conservar equipos de eliminatorias.");
lines.push("");
lines.push("BEGIN;");
lines.push("");
lines.push("TRUNCATE TABLE");
lines.push("  scores_cache,");
lines.push("  top_scorers_cache,");
lines.push("  individual_predictions,");
lines.push("  group_predictions,");
lines.push("  predictions,");
lines.push("  match_results,");
lines.push("  participants");
lines.push("RESTART IDENTITY CASCADE;");
lines.push("");

function valuesBlock(rows, columns, mapper) {
  const chunks = [];
  for (const row of rows) {
    chunks.push(`  (${columns.map((column) => mapper(row, column)).join(", ")})`);
  }
  return chunks.join(",\n");
}

lines.push("INSERT INTO participants (id, name, created_at) VALUES");
lines.push(valuesBlock(participants, ["id", "name", "created_at"], (row, column) => {
  if (column === "id") return row.id;
  if (column === "name") return sqlString(row.name);
  return "now()";
}) + ";");
lines.push("");

lines.push("INSERT INTO match_results (match_id, home_team, away_team, home_goals, away_goals, stage, status, match_date, last_updated) VALUES");
lines.push(valuesBlock(matchResults, ["match_id", "home_team", "away_team", "home_goals", "away_goals", "stage", "status", "match_date", "last_updated"], (row, column) => {
  if (["match_id", "home_team", "away_team", "stage"].includes(column)) return sqlString(row[column]);
  if (column === "status") return sqlString("scheduled");
  if (column === "last_updated") return "now()";
  return "NULL";
}) + ";");
lines.push("");

const groupPredictionRows = predictions.filter((row) => row.stage === "group");
const knockoutPredictionRows = predictions.filter((row) => row.stage !== "group");

lines.push("INSERT INTO predictions (participant_id, match_id, predicted_home_goals, predicted_away_goals, predicted_home_team, predicted_away_team, stage) VALUES");
lines.push(valuesBlock(groupPredictionRows, ["participant_id", "match_id", "predicted_home_goals", "predicted_away_goals", "predicted_home_team", "predicted_away_team", "stage"], (row, column) => {
  if (column === "participant_id") return row.participant_id;
  if (column.includes("goals")) return sqlNumber(row[column]);
  return sqlString(row[column]);
}) + ";");
lines.push("");

lines.push("-- Predicciones de eliminatorias con equipos extraidos del Excel.");
for (const comment of predictionComments) {
  lines.push(`-- ${comment.participant}: ${comment.match_id} (${comment.stage}) ${comment.home_team} ${comment.score} ${comment.away_team}`);
}
lines.push("INSERT INTO predictions (participant_id, match_id, predicted_home_goals, predicted_away_goals, predicted_home_team, predicted_away_team, stage) VALUES");
lines.push(valuesBlock(knockoutPredictionRows, ["participant_id", "match_id", "predicted_home_goals", "predicted_away_goals", "predicted_home_team", "predicted_away_team", "stage"], (row, column) => {
  if (column === "participant_id") return row.participant_id;
  if (column.includes("goals")) return sqlNumber(row[column]);
  return sqlString(row[column]);
}) + ";");
lines.push("");

lines.push("INSERT INTO group_predictions (participant_id, group_code, team_code, predicted_position) VALUES");
lines.push(valuesBlock(groupPredictions, ["participant_id", "group_code", "team_code", "predicted_position"], (row, column) => {
  if (column === "participant_id" || column === "predicted_position") return row[column];
  return sqlString(row[column]);
}) + ";");
lines.push("");

lines.push("INSERT INTO individual_predictions (participant_id, top_scorer, best_player, best_goalkeeper) VALUES");
lines.push(valuesBlock(individualPredictions, ["participant_id", "top_scorer", "best_player", "best_goalkeeper"], (row, column) => {
  if (column === "participant_id") return row.participant_id;
  return sqlString(row[column]);
}) + ";");
lines.push("");

lines.push("SELECT setval(pg_get_serial_sequence('participants', 'id'), COALESCE(MAX(id), 1), true) FROM participants;");
lines.push("");
lines.push("COMMIT;");
lines.push("");
lines.push("-- Verificacion de cargas");
lines.push("SELECT 'participants' AS table_name, COUNT(*) AS rows FROM participants");
lines.push("UNION ALL SELECT 'match_results', COUNT(*) FROM match_results");
lines.push("UNION ALL SELECT 'predictions', COUNT(*) FROM predictions");
lines.push("UNION ALL SELECT 'group_predictions', COUNT(*) FROM group_predictions");
lines.push("UNION ALL SELECT 'individual_predictions', COUNT(*) FROM individual_predictions");
lines.push("UNION ALL SELECT 'top_scorers_cache', COUNT(*) FROM top_scorers_cache");
lines.push("UNION ALL SELECT 'scores_cache', COUNT(*) FROM scores_cache;");
lines.push("");
lines.push("SELECT stage, COUNT(*) AS prediction_rows FROM predictions GROUP BY stage ORDER BY stage;");

const report = {
  source: input,
  generated_at: new Date().toISOString(),
  counts: {
    participants: participants.length,
    match_results: matchResults.length,
    predictions: predictions.length,
    group_predictions: groupPredictions.length,
    individual_predictions: individualPredictions.length,
    warnings: warnings.length
  },
  participants: participants.map(({ id, sheetName, name }) => ({ id, sheetName, name })),
  warnings
};

const warningLines = [
  "# Seed extraction report",
  "",
  `Fuente: ${path.basename(input)}`,
  "",
  "## Counts",
  "",
  ...Object.entries(report.counts).map(([key, count]) => `- ${key}: ${count}`),
  "",
  "## Participants",
  "",
  ...report.participants.map((participant) => `- ${participant.id}. ${participant.name} (hoja: ${participant.sheetName})`),
  "",
  "## Celdas vacias o ambiguas",
  "",
  warnings.length
    ? warnings.map((warning) => `- [${warning.severity}] ${warning.participant} / ${warning.sheet} / ${warning.cell}: ${warning.message}`).join("\n")
    : "Sin advertencias."
];

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "seed.sql"), lines.join("\n"), "utf8");
fs.writeFileSync(path.join(outDir, "seed-report.json"), JSON.stringify(report, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "seed-report.md"), warningLines.join("\n"), "utf8");
fs.writeFileSync(path.join(outDir, "seed-data.json"), JSON.stringify({
  participants: participants.map(({ id, sheetName, name }) => ({ id, sheetName, name })),
  predictions,
  groupPredictions,
  individualPredictions
}, null, 2), "utf8");

console.log(JSON.stringify(report.counts, null, 2));
