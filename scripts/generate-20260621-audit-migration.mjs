import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workbookPath = process.argv[2];
const outputPath = process.argv[3] || "supabase/migrations/20260621_participants_and_official_results.sql";
const targetNames = ["Patricia García", "Luis Alejandro Patiño"];

if (!workbookPath) {
  console.error("Usage: node scripts/generate-20260621-audit-migration.mjs <workbook.xlsx> [output.sql]");
  process.exit(1);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertBlocks(sql, table) {
  const pattern = new RegExp(`INSERT INTO ${table} \\(([^)]+)\\) VALUES\\r?\\n([\\s\\S]*?);`, "g");
  return [...sql.matchAll(pattern)].map((match) => ({
    columns: match[1].split(",").map((column) => column.trim()),
    body: match[2]
  }));
}

function rowsForIds(sql, table, ids) {
  const rows = [];
  for (const block of insertBlocks(sql, table)) {
    for (const line of block.body.split(/\r?\n/)) {
      const normalized = line.trim().replace(/,$/, "");
      const match = normalized.match(/^\((\d+),\s*([\s\S]*)\)$/);
      if (!match || !ids.has(Number(match[1]))) continue;
      rows.push({ participantId: Number(match[1]), columns: block.columns.slice(1), values: match[2] });
    }
  }
  return rows;
}

function participantInsert(table, rows, participantById) {
  if (!rows.length) return `-- ${table}: no hay filas diligenciadas para migrar.\n`;
  const columns = rows[0].columns;
  const values = rows.map((row) => `  (${sqlString(participantById.get(row.participantId))}, ${row.values})`).join(",\n");
  return [
    `INSERT INTO ${table} (participant_id, ${columns.join(", ")})`,
    `SELECT p.id, v.${columns.join(", v.")}`,
    "FROM (VALUES",
    values,
    `) AS v(participant_name, ${columns.join(", ")})`,
    "JOIN participants p ON p.name = v.participant_name",
    table === "predictions"
      ? "ON CONFLICT (participant_id, match_id) DO NOTHING;"
      : table === "group_predictions"
        ? "ON CONFLICT (participant_id, group_code, predicted_position) DO NOTHING;"
        : "ON CONFLICT (participant_id) DO NOTHING;",
    ""
  ].join("\n");
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "polla-audit-"));
const generator = path.resolve("scripts/generate-supabase-seed.mjs");
const generated = spawnSync(process.execPath, [generator, path.resolve(workbookPath), tempDir], {
  encoding: "utf8"
});
if (generated.status !== 0) {
  throw new Error(generated.stderr || generated.stdout || "No se pudo leer el Excel.");
}

const report = JSON.parse(fs.readFileSync(path.join(tempDir, "seed-report.json"), "utf8"));
const seedSql = fs.readFileSync(path.join(tempDir, "seed.sql"), "utf8");
const selected = report.participants.filter((participant) => targetNames.includes(participant.name));
if (selected.length !== targetNames.length) {
  throw new Error(`No se encontraron los dos participantes requeridos: ${selected.map((item) => item.name).join(", ")}`);
}
const participantById = new Map(selected.map((participant) => [participant.id, participant.name]));
const ids = new Set(participantById.keys());
const predictionRows = rowsForIds(seedSql, "predictions", ids);
const groupRows = rowsForIds(seedSql, "group_predictions", ids);
const individualRows = rowsForIds(seedSql, "individual_predictions", ids);

const lines = [
  "-- Auditoria Polla Familia Mima 2026 - 2026-06-21",
  `-- Fuente: ${path.basename(workbookPath)}`,
  "-- Migracion aditiva e idempotente: no elimina ni reinicia datos.",
  `-- Predicciones extraidas: ${predictionRows.length}; posiciones de grupo: ${groupRows.length}; individuales: ${individualRows.length}.`,
  "",
  "BEGIN;",
  "",
  ...targetNames.flatMap((name) => [
    "INSERT INTO participants (name)",
    `SELECT ${sqlString(name)}`,
    `WHERE NOT EXISTS (SELECT 1 FROM participants WHERE name = ${sqlString(name)});`,
    ""
  ]),
  participantInsert("predictions", predictionRows, participantById),
  participantInsert("group_predictions", groupRows, participantById),
  participantInsert("individual_predictions", individualRows, participantById),
  "INSERT INTO scores_cache (participant_id, total_points, last_calculated)",
  "SELECT id, 0, now() FROM participants",
  `WHERE name IN (${targetNames.map(sqlString).join(", ")})`,
  "ON CONFLICT (participant_id) DO NOTHING;",
  "",
  "-- Resultados contrastados con FIFA Match Centre el 2026-06-21.",
  "UPDATE match_results",
  "SET home_goals = 2, away_goals = 0, status = 'finished', manual_override = true, locked = true,",
  "    source = 'fifa_official_audit', confirmed_at = now(), last_updated = now(),",
  "    raw_payload = jsonb_build_object('source_url', 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures', 'audit_date', '2026-06-21', 'result', 'Mexico 2-0 South Africa')",
  "WHERE match_id = 'G-A-1' AND locked IS NOT TRUE;",
  "",
  "UPDATE match_results",
  "SET home_goals = 0, away_goals = 4, status = 'finished', manual_override = true, locked = true,",
  "    source = 'fifa_official_audit', confirmed_at = now(), last_updated = now(),",
  "    raw_payload = jsonb_build_object('source_url', 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures', 'audit_date', '2026-06-21', 'result', 'Tunisia 0-4 Japan')",
  "WHERE match_id = 'G-F-4' AND locked IS NOT TRUE;",
  "",
  "-- Este partido aun no figura como finalizado en FIFA; queda disponible para una carga futura.",
  "UPDATE match_results",
  "SET home_goals = NULL, away_goals = NULL, status = 'scheduled', manual_override = false, locked = false,",
  "    source = 'fifa_official_audit', confirmed_at = NULL, last_updated = now(),",
  "    raw_payload = jsonb_build_object('source_url', 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures', 'audit_date', '2026-06-21', 'correction', 'Premature result removed')",
  "WHERE match_id = 'G-H-3' AND locked IS NOT TRUE",
  "  AND status = 'finished' AND home_goals = 3 AND away_goals = 0 AND source = 'admin';",
  "",
  "INSERT INTO sync_logs (source, status, message, payload)",
  "SELECT 'migration.20260621_audit', 'ok', 'Participantes y resultados oficiales auditados.',",
  `       jsonb_build_object('participants', ${targetNames.length}, 'predictions', ${predictionRows.length}, 'group_predictions', ${groupRows.length}, 'individual_predictions', ${individualRows.length})`,
  "WHERE NOT EXISTS (SELECT 1 FROM sync_logs WHERE source = 'migration.20260621_audit');",
  "",
  "COMMIT;",
  ""
];

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(path.resolve(outputPath), lines.join("\n"), "utf8");
fs.rmSync(tempDir, { recursive: true, force: true });
console.log(JSON.stringify({ outputPath: path.resolve(outputPath), participants: selected, predictions: predictionRows.length, groupPredictions: groupRows.length, individualPredictions: individualRows.length }, null, 2));
