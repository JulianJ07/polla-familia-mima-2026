import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { recalculateAllScores } from "../server/services/scoring.js";

const workbookPath = process.argv[2];
const targetNames = ["Patricia García", "Luis Alejandro Patiño"];
if (!workbookPath) {
  console.error("Usage: node scripts/apply-20260621-audit.mjs <workbook.xlsx>");
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY.");
}

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function assertNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function insertInChunks(table, rows, onConflict) {
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await client.from(table).upsert(rows.slice(index, index + 500), {
      onConflict,
      ignoreDuplicates: true
    });
    assertNoError(error, `Insertar ${table}`);
  }
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "polla-apply-audit-"));
const generated = spawnSync(process.execPath, [
  path.resolve("scripts/generate-supabase-seed.mjs"),
  path.resolve(workbookPath),
  tempDir
], { encoding: "utf8" });
if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout || "No se pudo leer el Excel.");

const source = JSON.parse(fs.readFileSync(path.join(tempDir, "seed-data.json"), "utf8"));
const selectedSource = source.participants.filter((participant) => targetNames.includes(participant.name));
if (selectedSource.length !== 2) throw new Error("El Excel no contiene los dos participantes esperados.");

const { data: existing, error: existingError } = await client
  .from("participants")
  .select("id,name")
  .in("name", targetNames);
assertNoError(existingError, "Consultar participantes");
const existingNames = new Set((existing || []).map((participant) => participant.name));
for (const name of targetNames.filter((item) => !existingNames.has(item))) {
  const { error } = await client.from("participants").insert({ name });
  assertNoError(error, `Crear participante ${name}`);
}

const { data: participants, error: participantsError } = await client
  .from("participants")
  .select("id,name")
  .in("name", targetNames);
assertNoError(participantsError, "Recargar participantes");
const databaseIdByName = new Map((participants || []).map((participant) => [participant.name, participant.id]));
const sourceNameById = new Map(selectedSource.map((participant) => [participant.id, participant.name]));
const remap = (row) => ({
  ...row,
  participant_id: databaseIdByName.get(sourceNameById.get(row.participant_id))
});

const predictions = source.predictions.filter((row) => sourceNameById.has(row.participant_id)).map(remap);
const groupPredictions = source.groupPredictions.filter((row) => sourceNameById.has(row.participant_id)).map(remap);
const individualPredictions = source.individualPredictions.filter((row) => sourceNameById.has(row.participant_id)).map(remap);
await insertInChunks("predictions", predictions, "participant_id,match_id");
await insertInChunks("group_predictions", groupPredictions, "participant_id,group_code,predicted_position");
await insertInChunks("individual_predictions", individualPredictions, "participant_id");

const officialSource = "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures";
const resultUpdates = [
  ["G-A-1", {
    home_goals: 2,
    away_goals: 0,
    status: "finished",
    manual_override: true,
    locked: true,
    source: "fifa_official_audit",
    confirmed_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    raw_payload: { source_url: officialSource, audit_date: "2026-06-21", result: "Mexico 2-0 South Africa" }
  }, {}],
  ["G-F-4", {
    home_goals: 0,
    away_goals: 4,
    status: "finished",
    manual_override: true,
    locked: true,
    source: "fifa_official_audit",
    confirmed_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    raw_payload: { source_url: officialSource, audit_date: "2026-06-21", result: "Tunisia 0-4 Japan" }
  }, {}],
  ["G-H-3", {
    home_goals: null,
    away_goals: null,
    status: "scheduled",
    manual_override: false,
    locked: false,
    source: "fifa_official_audit",
    confirmed_at: null,
    last_updated: new Date().toISOString(),
    raw_payload: { source_url: officialSource, audit_date: "2026-06-21", correction: "Premature result removed" }
  }, { status: "finished", home_goals: 3, away_goals: 0, source: "admin" }]
];
for (const [matchId, update, guard] of resultUpdates) {
  let query = client.from("match_results").update(update).eq("match_id", matchId).eq("locked", false);
  for (const [column, value] of Object.entries(guard)) query = query.eq(column, value);
  const { error } = await query;
  assertNoError(error, `Corregir ${matchId}`);
}

await recalculateAllScores();
const { count: auditLogCount, error: auditLogCountError } = await client
  .from("sync_logs")
  .select("id", { count: "exact", head: true })
  .eq("source", "script.20260621_audit");
assertNoError(auditLogCountError, "Consultar log de auditoria");
if (!auditLogCount) {
  const { error: logError } = await client.from("sync_logs").insert({
    source: "script.20260621_audit",
    status: "ok",
    message: "Participantes y resultados oficiales auditados.",
    payload: { participants: 2, predictions: predictions.length, group_predictions: groupPredictions.length, individual_predictions: individualPredictions.length }
  });
  assertNoError(logError, "Registrar auditoria");
}

const verification = [];
for (const participant of participants || []) {
  const [{ count: predictionCount, error: predictionError }, { count: groupCount, error: groupError }] = await Promise.all([
    client.from("predictions").select("id", { count: "exact", head: true }).eq("participant_id", participant.id),
    client.from("group_predictions").select("id", { count: "exact", head: true }).eq("participant_id", participant.id)
  ]);
  assertNoError(predictionError, `Verificar predicciones de ${participant.name}`);
  assertNoError(groupError, `Verificar grupos de ${participant.name}`);
  verification.push({ name: participant.name, predictions: predictionCount, groupPredictions: groupCount });
}
const { count: participantCount, error: countError } = await client
  .from("participants")
  .select("id", { count: "exact", head: true });
assertNoError(countError, "Contar participantes");
const { data: matches, error: matchesError } = await client
  .from("match_results")
  .select("match_id,home_goals,away_goals,status,locked,source")
  .in("match_id", ["G-A-1", "G-F-4", "G-H-3"])
  .order("match_id");
assertNoError(matchesError, "Verificar resultados");

fs.rmSync(tempDir, { recursive: true, force: true });
console.log(JSON.stringify({ participantCount, participants: verification, matches }, null, 2));
