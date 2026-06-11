import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoError, requireSupabase } from "../server/db/supabase.js";
import { recalculateAllScores } from "../server/services/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const seedPath = path.join(rootDir, "supabase", "seed.sql");
const sourceParticipantNames = new Map([
  ["17", "Jorge Márquez"],
  ["20", "Alejandro Márquez"]
]);

function rowsForInsert(sql, table) {
  const re = new RegExp(`INSERT INTO ${table} \\(([^)]*)\\) VALUES\\n([\\s\\S]*?);`, "g");
  const blocks = [];
  let match;
  while ((match = re.exec(sql))) {
    blocks.push({
      columns: match[1].split(",").map((column) => column.trim()),
      values: match[2]
    });
  }
  return blocks;
}

function splitRows(values) {
  const rows = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let index = 0; index < values.length; index += 1) {
    const char = values[index];
    const next = values[index + 1];
    if (inString) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (char === "'") {
        inString = false;
      }
      continue;
    }
    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      current += char;
      if (depth === 0) {
        rows.push(current.trim().replace(/,$/, ""));
        current = "";
      }
      continue;
    }
    if (depth === 0 && (char === "," || /\s/.test(char))) continue;
    current += char;
  }

  return rows;
}

function parseRow(row) {
  const inner = row.trim().replace(/^\(/, "").replace(/\)$/, "");
  const values = [];
  let current = "";
  let inString = false;

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    const next = inner[index + 1];
    if (inString) {
      if (char === "'" && next === "'") {
        current += "'";
        index += 1;
      } else if (char === "'") {
        inString = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'") {
      inString = true;
      continue;
    }
    if (char === ",") {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());

  return values.map((value) => (value.toLowerCase() === "null" ? null : value));
}

function collectSeedRows(sql, table) {
  const rows = [];
  for (const block of rowsForInsert(sql, table)) {
    for (const row of splitRows(block.values)) {
      const values = parseRow(row);
      const object = Object.fromEntries(block.columns.map((column, index) => [column, values[index]]));
      if (sourceParticipantNames.has(String(object.participant_id))) rows.push(object);
    }
  }
  return rows;
}

function numberColumns(row, columns) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      columns.includes(key) && value != null ? Number(value) : value
    ])
  );
}

async function participantIdMap(client) {
  const names = [...sourceParticipantNames.values()];
  const { data, error } = await client.from("participants").select("id,name").in("name", names);
  assertNoError(error, "Leer participantes Jorge/Alejandro");
  const byName = new Map((data || []).map((row) => [row.name, row.id]));
  return new Map(
    [...sourceParticipantNames.entries()].map(([seedId, name]) => [seedId, byName.get(name) || Number(seedId)])
  );
}

function remapParticipants(rows, ids) {
  return rows.map((row) => ({
    ...row,
    participant_id: ids.get(String(row.participant_id)) || Number(row.participant_id)
  }));
}

async function main() {
  const client = requireSupabase();
  const sql = fs.readFileSync(seedPath, "utf8");
  const ids = await participantIdMap(client);

  const predictions = remapParticipants(collectSeedRows(sql, "predictions"), ids).map((row) =>
    numberColumns(row, ["participant_id", "predicted_home_goals", "predicted_away_goals"])
  );
  const groupPredictions = remapParticipants(collectSeedRows(sql, "group_predictions"), ids).map((row) =>
    numberColumns(row, ["participant_id", "predicted_position"])
  );
  const individualPredictions = remapParticipants(collectSeedRows(sql, "individual_predictions"), ids).map((row) =>
    numberColumns(row, ["participant_id"])
  );

  const { error: predictionError } = await client
    .from("predictions")
    .upsert(predictions, { onConflict: "participant_id,match_id" });
  assertNoError(predictionError, "Actualizar predicciones Jorge/Alejandro");

  const { error: groupError } = await client
    .from("group_predictions")
    .upsert(groupPredictions, { onConflict: "participant_id,group_code,predicted_position" });
  assertNoError(groupError, "Actualizar grupos Jorge/Alejandro");

  const { error: individualError } = await client
    .from("individual_predictions")
    .upsert(individualPredictions, { onConflict: "participant_id" });
  assertNoError(individualError, "Actualizar premios Jorge/Alejandro");

  await recalculateAllScores();
  console.log(`Correcciones aplicadas: ${predictions.length} partidos, ${groupPredictions.length} grupos, ${individualPredictions.length} premios.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
