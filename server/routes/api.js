import express from "express";
import {
  assertNoError,
  getAdminPassword,
  insertLog,
  isSupabaseConfigured,
  nowIso,
  requireSupabase,
  setSetting
} from "../db/supabase.js";
import {
  AWARD_CONFIG,
  displayAwardName,
  evaluateMatchPrediction,
  getLeaderboard,
  getParticipantDetail,
  getScoringAdminState,
  getTournamentStandings,
  normalizeAwardName,
  recalculateAllScores
} from "../services/scoring.js";
import { applyBracketAdvancement } from "../services/bracket.js";

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function adminOnly(req, res, next) {
  const expected = await getAdminPassword();
  if (!expected) {
    return res.status(500).json({ error: "ADMIN_PASSWORD no esta configurado." });
  }
  const provided = req.header("x-admin-password") || req.body?.password;
  if (provided !== expected) {
    return res.status(401).json({ error: "Password de admin invalido." });
  }
  next();
}

function syncOnly(req, res, next) {
  const expected = process.env.SYNC_SECRET;
  if (!expected) return res.status(503).json({ error: "SYNC_SECRET no esta configurado." });
  if (req.header("x-sync-secret") !== expected) return res.status(401).json({ error: "Sync secret invalido." });
  next();
}

function parseBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function optionalInteger(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function optionalDate(value) {
  if (value === "" || value == null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function cleanName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\./g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sameTeamName(a, b) {
  return Boolean(a && b && cleanName(a) === cleanName(b));
}

function isKnockoutStage(stage) {
  return ["r32", "r16", "qf", "sf", "third", "final"].includes(stage);
}

function valuesDiffer(nextValue, currentValue, key) {
  if (nextValue == null && currentValue == null) return false;
  if (key === "match_date") {
    const nextTime = nextValue ? new Date(nextValue).getTime() : null;
    const currentTime = currentValue ? new Date(currentValue).getTime() : null;
    return nextTime !== currentTime;
  }
  return String(nextValue ?? "") !== String(currentValue ?? "");
}

function stageLabel(stage) {
  return {
    group: "Grupos",
    r32: "Ronda de 32",
    r16: "Octavos",
    qf: "Cuartos",
    sf: "Semis",
    third: "Tercer puesto",
    final: "Final"
  }[stage] || stage;
}

function sortMatches(a, b) {
  const stageOrder = { group: 1, r32: 2, r16: 3, qf: 4, sf: 5, third: 6, final: 7 };
  return (
    String(a.match_date || "9999").localeCompare(String(b.match_date || "9999")) ||
    (stageOrder[a.stage] || 99) - (stageOrder[b.stage] || 99) ||
    String(a.match_id).localeCompare(String(b.match_id), undefined, { numeric: true })
  );
}

async function countRows(table) {
  const client = requireSupabase();
  const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
  assertNoError(error, `Contar ${table}`);
  return count || 0;
}

async function fetchAll(queryBuilder, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryBuilder.range(from, from + pageSize - 1);
    assertNoError(error, "Leer pagina de datos");
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function currentPhase() {
  const client = requireSupabase();
  const { data: upcoming, error } = await client
    .from("match_results")
    .select("stage,match_date")
    .neq("status", "finished")
    .order("match_date", { ascending: true, nullsFirst: false })
    .limit(1);
  assertNoError(error, "Leer fase actual");
  if (!upcoming?.length) return "Torneo finalizado";
  const labels = {
    group: "Fase de grupos",
    r32: "Ronda de 32",
    r16: "Octavos",
    qf: "Cuartos",
    sf: "Semifinales",
    third: "Tercer puesto",
    final: "Final"
  };
  return labels[upcoming[0].stage] || "Previa";
}

export function createApiRouter(io, footballSync) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      app: "Polla Familia Mima 2026",
      database: "supabase",
      supabaseConfigured: isSupabaseConfigured,
      at: nowIso()
    });
  });

  router.get("/meta", asyncHandler(async (_req, res) => {
    const client = requireSupabase();
    const { data: lastScore, error } = await client
      .from("scores_cache")
      .select("last_calculated")
      .order("last_calculated", { ascending: false })
      .limit(1);
    assertNoError(error, "Leer ultima actualizacion");

    res.json({
      name: "Polla Familia Mima 2026",
      currentPhase: await currentPhase(),
      lastCalculated: lastScore?.[0]?.last_calculated || null,
      participantCount: await countRows("participants"),
      matchCount: await countRows("match_results")
    });
  }));

  router.get("/leaderboard", asyncHandler(async (_req, res) => {
    res.json({ rows: await getLeaderboard(), at: nowIso() });
  }));

  router.get("/standings", asyncHandler(async (_req, res) => {
    res.json({
      ...(await getTournamentStandings()),
      sync: footballSync ? await footballSync.publicStatus() : null,
      at: nowIso()
    });
  }));

  router.get("/live-sync/status", asyncHandler(async (_req, res) => {
    res.json(footballSync ? await footballSync.publicStatus() : { enabled: false, configured: false });
  }));

  router.post("/scores/recalculate", asyncHandler(adminOnly), asyncHandler(async (_req, res) => {
    await recalculateAllScores();
    io.emit("scores:updated", { at: nowIso(), manual: true });
    res.json({ ok: true });
  }));

  router.post("/cron/sync", syncOnly, asyncHandler(async (_req, res) => {
    if (!footballSync) return res.status(503).json({ error: "Sincronizador no disponible." });
    res.json(await footballSync.runOnce({ trigger: "external_cron" }));
  }));

  router.get("/participants", asyncHandler(async (_req, res) => {
    const client = requireSupabase();
    const { data, error } = await client.from("participants").select("id,name,created_at").order("name");
    assertNoError(error, "Leer participantes");
    res.json({ rows: data || [] });
  }));

  router.get("/participants/:id", asyncHandler(async (req, res) => {
    const detail = await getParticipantDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ error: "Participante no encontrado." });
    res.json(detail);
  }));

  router.get("/matches", asyncHandler(async (req, res) => {
    const client = requireSupabase();
    const stage = req.query.stage;
    let query = client.from("match_results").select("*");
    if (stage && stage !== "all") query = query.eq("stage", stage);
    const { data: matches, error } = await query;
    assertNoError(error, "Leer partidos");

    const matchIds = (matches || []).map((match) => match.match_id);
    let predictions = [];
    if (matchIds.length) {
      predictions = await fetchAll(client
        .from("predictions")
        .select("*")
        .in("match_id", matchIds));
    }

    const stats = new Map();
    for (const prediction of predictions) {
      const current = stats.get(prediction.match_id) || { prediction_count: 0, exact_count: 0, result_count: 0 };
      current.prediction_count += 1;
      stats.set(prediction.match_id, current);
    }

    const rows = (matches || []).sort(sortMatches).map((match) => {
      const stat = stats.get(match.match_id) || { prediction_count: 0, exact_count: 0, result_count: 0 };
      for (const prediction of predictions.filter((item) => item.match_id === match.match_id)) {
        const result = evaluateMatchPrediction(prediction, match);
        if (result.status === "exacto") {
          stat.exact_count += 1;
        } else if (result.status === "parcial") {
          stat.result_count += 1;
        }
      }
      const live = match.status === "live" || ["1H", "HT", "2H", "ET", "P", "BT", "LIVE"].includes(match.api_status || match.espn_status);
      return {
        ...match,
        display_home_goals: live ? match.live_home_goals : match.home_goals,
        display_away_goals: live ? match.live_away_goals : match.away_goals,
        ...stat,
        stageLabel: stageLabel(match.stage)
      };
    });
    res.json({ rows });
  }));

  router.get("/matches/:matchId/predictions", asyncHandler(async (req, res) => {
    const client = requireSupabase();
    const matchId = String(req.params.matchId);
    const { data: match, error: matchError } = await client
      .from("match_results")
      .select("*")
      .eq("match_id", matchId)
      .maybeSingle();
    assertNoError(matchError, "Leer partido");
    if (!match) return res.status(404).json({ error: "Partido no encontrado." });

    const [{ data: participants, error: participantError }, { data: predictions, error: predictionError }] =
      await Promise.all([
        client.from("participants").select("id,name").order("name"),
        client.from("predictions").select("*").eq("match_id", matchId)
      ]);
    assertNoError(participantError, "Leer participantes");
    assertNoError(predictionError, "Leer predicciones del partido");

    const predictionMap = new Map((predictions || []).map((prediction) => [prediction.participant_id, prediction]));
    const rows = (participants || []).map((participant) => {
      const prediction = predictionMap.get(participant.id) || null;
      const result = evaluateMatchPrediction(prediction, match);
      return {
        participantId: participant.id,
        name: participant.name,
        prediction: prediction
          ? {
              matchId: prediction.match_id,
              homeTeam: prediction.predicted_home_team,
              awayTeam: prediction.predicted_away_team,
              homeGoals: prediction.predicted_home_goals,
              awayGoals: prediction.predicted_away_goals,
              score: `${prediction.predicted_home_goals ?? "-"}-${prediction.predicted_away_goals ?? "-"}`
            }
          : null,
        status: result.status,
        statusLabel: result.label,
        icon: result.icon,
        points: result.points,
        reason: result.reason
      };
    });

    res.json({
      match: {
        ...match,
        stageLabel: stageLabel(match.stage),
        score: match.home_goals == null ? null : `${match.home_goals}-${match.away_goals}`
      },
      rows
    });
  }));

  router.get("/bracket", asyncHandler(async (_req, res) => {
    const client = requireSupabase();
    const knockoutStages = ["r32", "r16", "qf", "sf", "third", "final"];
    const { data, error } = await client
      .from("match_results")
      .select("*")
      .in("stage", knockoutStages);
    assertNoError(error, "Leer llaves");
    const order = { r32: 1, r16: 2, qf: 3, sf: 4, third: 5, final: 6 };
    const grouped = (data || [])
      .sort((a, b) => (order[a.stage] || 99) - (order[b.stage] || 99) || String(a.match_id).localeCompare(String(b.match_id), undefined, { numeric: true }))
      .reduce((acc, row) => {
        acc[row.stage] ||= [];
        acc[row.stage].push(row);
        return acc;
      }, {});
    res.json({ stages: grouped });
  }));

  router.get("/awards", asyncHandler(async (_req, res) => {
    const client = requireSupabase();
    const scoringState = await getScoringAdminState();
    const aliases = scoringState.aliases || [];
    const [{ data: topScorers, error: scorersError }, { data: participants, error: participantsError }, { data: individual, error: individualError }] =
      await Promise.all([
        client.from("top_scorers_cache").select("*").order("goals", { ascending: false }).order("player_name").limit(12),
        client.from("participants").select("id,name").order("name"),
        client.from("individual_predictions").select("*")
      ]);
    assertNoError(scorersError, "Leer goleadores");
    assertNoError(participantsError, "Leer participantes para premios");
    assertNoError(individualError, "Leer predicciones individuales");

    const individualMap = new Map((individual || []).map((row) => [row.participant_id, row]));
    const predictions = (participants || []).map((participant) => ({
      participant_id: participant.id,
      name: participant.name,
      top_scorer: individualMap.get(participant.id)?.top_scorer || null,
      top_scorer_display: displayAwardName(individualMap.get(participant.id)?.top_scorer, aliases),
      top_scorer_canonical: normalizeAwardName(individualMap.get(participant.id)?.top_scorer, aliases),
      best_player: individualMap.get(participant.id)?.best_player || null,
      best_player_display: displayAwardName(individualMap.get(participant.id)?.best_player, aliases),
      best_player_canonical: normalizeAwardName(individualMap.get(participant.id)?.best_player, aliases),
      best_goalkeeper: individualMap.get(participant.id)?.best_goalkeeper || null,
      best_goalkeeper_display: displayAwardName(individualMap.get(participant.id)?.best_goalkeeper, aliases),
      best_goalkeeper_canonical: normalizeAwardName(individualMap.get(participant.id)?.best_goalkeeper, aliases)
    }));
    res.json({ topScorers: topScorers || [], results: scoringState.awards || {}, predictions });
  }));

  router.get("/admin/logs", asyncHandler(adminOnly), asyncHandler(async (_req, res) => {
    const client = requireSupabase();
    const { data, error } = await client.from("sync_logs").select("*").order("created_at", { ascending: false }).limit(50);
    assertNoError(error, "Leer logs");
    res.json({ rows: data || [] });
  }));

  router.get("/admin/live-sync", asyncHandler(adminOnly), asyncHandler(async (_req, res) => {
    if (!footballSync) return res.status(503).json({ error: "Sincronizador no disponible." });
    res.json(await footballSync.adminState());
  }));

  router.patch("/admin/live-sync/config", asyncHandler(adminOnly), asyncHandler(async (req, res) => {
    if (!footballSync) return res.status(503).json({ error: "Sincronizador no disponible." });
    res.json({ ok: true, config: await footballSync.saveConfig(req.body || {}, "admin") });
  }));

  router.patch("/admin/live-sync/matches/:matchId", asyncHandler(adminOnly), asyncHandler(async (req, res) => {
    if (!footballSync) return res.status(503).json({ error: "Sincronizador no disponible." });
    res.json({ ok: true, row: await footballSync.updateMatchSettings(String(req.params.matchId), req.body || {}, "admin") });
  }));

  router.post("/admin/live-sync/force", asyncHandler(adminOnly), asyncHandler(async (req, res) => {
    if (!footballSync) return res.status(503).json({ error: "Sincronizador no disponible." });
    const matchId = String(req.body?.match_id || "").trim();
    if (!matchId) return res.status(400).json({ error: "Debes seleccionar un partido." });
    res.json(await footballSync.runOnce({ trigger: "admin_force", forceMatchIds: [matchId] }));
  }));

  router.post("/admin/live-sync/discover", asyncHandler(adminOnly), asyncHandler(async (_req, res) => {
    if (!footballSync) return res.status(503).json({ error: "Sincronizador no disponible." });
    res.json({ ok: true, ...(await footballSync.discoverFixtures({ trigger: "admin_discover" })) });
  }));

  router.post("/admin/sync", asyncHandler(adminOnly), asyncHandler(async (_req, res) => {
    if (!footballSync) return res.status(503).json({ error: "Sincronizador no disponible." });
    res.json(await footballSync.runOnce({ trigger: "admin" }));
  }));

  router.post("/admin/groups/recalculate", asyncHandler(adminOnly), asyncHandler(async (_req, res) => {
    await recalculateAllScores();
    await insertLog("admin.groups.recalculate", "ok", "Grupos y puntuacion recalculados manualmente.");
    io.emit("scores:updated", { at: nowIso(), manual: true, groups: true });
    res.json({ ok: true, standings: await getTournamentStandings() });
  }));

  router.patch("/admin/matches/:matchId", asyncHandler(adminOnly), asyncHandler(async (req, res) => {
    const client = requireSupabase();
    const matchId = String(req.params.matchId);
    const body = req.body || {};
    const updates = {};
    const errors = [];

    for (const [key, label] of [
      ["home_goals", "Goles local"],
      ["away_goals", "Goles visitante"],
      ["home_penalties", "Penales local"],
      ["away_penalties", "Penales visitante"]
    ]) {
      if (!hasOwn(body, key)) continue;
      const parsed = optionalInteger(body[key]);
      if (parsed === undefined) errors.push(`${label} debe ser un entero mayor o igual a 0.`);
      else updates[key] = parsed;
    }

    if (hasOwn(body, "status")) {
      const status = String(body.status || "").trim();
      if (!["scheduled", "finished"].includes(status)) errors.push("Status invalido.");
      else updates.status = status;
    }

    if (hasOwn(body, "match_date")) {
      const parsed = optionalDate(body.match_date);
      if (parsed === undefined) errors.push("Fecha del partido invalida.");
      else updates.match_date = parsed;
    }

    if (hasOwn(body, "manual_override")) updates.manual_override = parseBoolean(body.manual_override);
    if (hasOwn(body, "locked")) updates.locked = parseBoolean(body.locked);

    const { data: existing, error: readError } = await client
      .from("match_results")
      .select("*")
      .eq("match_id", matchId)
      .maybeSingle();
    assertNoError(readError, "Leer partido");
    if (!existing) return res.status(404).json({ error: "Partido no encontrado." });

    const nextStatus = updates.status || existing.status;
    const nextHomeGoals = hasOwn(updates, "home_goals") ? updates.home_goals : existing.home_goals;
    const nextAwayGoals = hasOwn(updates, "away_goals") ? updates.away_goals : existing.away_goals;
    const isKnockout = isKnockoutStage(existing.stage);

    if (nextStatus === "finished" && (nextHomeGoals == null || nextAwayGoals == null)) {
      errors.push("Si el partido esta finished, los goles deben ser enteros validos.");
    }

    if (hasOwn(body, "qualified_team") || (isKnockout && nextStatus === "finished")) {
      const provided = hasOwn(body, "qualified_team") ? String(body.qualified_team || "").trim() : String(existing.qualified_team || "").trim();
      if (!isKnockout || nextStatus !== "finished") {
        updates.qualified_team = null;
      } else if (provided) {
        if (sameTeamName(provided, existing.home_team)) updates.qualified_team = existing.home_team;
        else if (sameTeamName(provided, existing.away_team)) updates.qualified_team = existing.away_team;
        else errors.push("Equipo clasificado debe ser el equipo local o visitante.");
      } else if (nextHomeGoals != null && nextAwayGoals != null && nextHomeGoals !== nextAwayGoals) {
        updates.qualified_team = nextHomeGoals > nextAwayGoals ? existing.home_team : existing.away_team;
      } else if (hasOwn(body, "qualified_team")) {
        updates.qualified_team = null;
      }
    }

    if (hasOwn(body, "decided_by_penalties")) {
      updates.decided_by_penalties = isKnockout && nextStatus === "finished" ? parseBoolean(body.decided_by_penalties) : false;
    } else if (!isKnockout || nextStatus !== "finished") {
      updates.decided_by_penalties = false;
    }
    if (!isKnockout || nextStatus !== "finished" || updates.decided_by_penalties === false) {
      updates.home_penalties = null;
      updates.away_penalties = null;
    }

    if (errors.length) return res.status(400).json({ error: errors.join(" ") });
    if (!Object.keys(updates).length) return res.status(400).json({ error: "No hay cambios para guardar." });

    const correctionFields = ["home_goals", "away_goals", "home_penalties", "away_penalties", "status", "match_date", "qualified_team", "decided_by_penalties"];
    const changedMatchData = correctionFields.some((field) => hasOwn(updates, field) && valuesDiffer(updates[field], existing[field], field));
    if (changedMatchData) updates.manual_override = true;

    updates.source = "admin";
    updates.last_updated = nowIso();
    if (nextStatus === "finished") updates.confirmed_at = nowIso();
    else if (hasOwn(updates, "status")) updates.confirmed_at = null;

    const { data: updated, error } = await client
      .from("match_results")
      .update(updates)
      .eq("match_id", matchId)
      .select("*")
      .single();
    assertNoError(error, "Guardar resultado manual");

    const { error: auditError } = await client.from("match_result_audit").insert({
      match_id: matchId,
      actor: "admin",
      source: "admin-manual-correction",
      reason: "Resultado editado desde el panel de administracion.",
      previous_value: existing,
      new_value: updated,
      created_at: nowIso()
    });
    if (auditError && !/schema cache|does not exist|could not find/i.test(auditError.message || "")) {
      assertNoError(auditError, "Auditar resultado manual");
    }

    const bracketChanges = await applyBracketAdvancement(client, updated, {
      actor: "admin",
      source: "admin-bracket-advance",
      reason: `Clasificado propagado desde ${matchId}.`
    });

    await recalculateAllScores();
    const payload = { matchId, updates };
    await insertLog("admin.match", "ok", `Resultado manual guardado para ${matchId}.`, payload);
    for (const row of bracketChanges) {
      io.emit("match:updated", { at: nowIso(), matchId: row.match_id, row, bracket: true });
    }
    io.emit("scores:updated", { at: nowIso(), manual: true, matchId });
    res.json({ ok: true, row: updated, bracketChanges });
  }));

  router.get("/admin/scoring-controls", asyncHandler(adminOnly), asyncHandler(async (_req, res) => {
    res.json(await getScoringAdminState());
  }));

  router.post("/admin/group-final-standings", asyncHandler(adminOnly), asyncHandler(async (req, res) => {
    const client = requireSupabase();
    const groupCode = String(req.body?.group_code || "").trim().toUpperCase();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!/^[A-L]$/.test(groupCode)) return res.status(400).json({ error: "Grupo invalido." });
    if (rows.length !== 4) return res.status(400).json({ error: "Debes guardar cuatro posiciones para el grupo." });

    const normalizedRows = rows.map((row) => ({
      group_code: groupCode,
      team_code: String(row.team_code || "").trim(),
      final_position: Number(row.final_position),
      source: "manual",
      updated_at: nowIso()
    }));
    const positions = new Set(normalizedRows.map((row) => row.final_position));
    const teams = new Set(normalizedRows.map((row) => cleanName(row.team_code)));
    if ([...positions].some((position) => !Number.isInteger(position) || position < 1 || position > 4) || positions.size !== 4) {
      return res.status(400).json({ error: "Las posiciones deben ser 1, 2, 3 y 4." });
    }
    if ([...teams].some((team) => !team) || teams.size !== 4) {
      return res.status(400).json({ error: "No se pueden repetir equipos en el grupo." });
    }

    const { error: deleteError } = await client.from("group_final_standings").delete().eq("group_code", groupCode);
    assertNoError(deleteError, "Limpiar posiciones finales");
    const { error: insertError } = await client.from("group_final_standings").insert(normalizedRows);
    assertNoError(insertError, "Guardar posiciones finales");
    await recalculateAllScores();
    await insertLog("admin.groups", "ok", `Posiciones finales guardadas para grupo ${groupCode}.`, { groupCode, rows: normalizedRows });
    io.emit("scores:updated", { at: nowIso(), manual: true, groupCode });
    res.json({ ok: true });
  }));

  router.post("/admin/best-thirds-final", asyncHandler(adminOnly), asyncHandler(async (req, res) => {
    const client = requireSupabase();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length !== 8) return res.status(400).json({ error: "Debes seleccionar exactamente 8 mejores terceros." });

    const normalizedRows = rows.map((row) => ({
      team_code: String(row.team_code || "").trim(),
      group_code: String(row.group_code || "").trim().toUpperCase() || null,
      source: "manual",
      updated_at: nowIso()
    }));
    const teams = new Set(normalizedRows.map((row) => cleanName(row.team_code)));
    if ([...teams].some((team) => !team) || teams.size !== 8) {
      return res.status(400).json({ error: "Los mejores terceros deben ser 8 equipos distintos." });
    }
    if (normalizedRows.some((row) => row.group_code && !/^[A-L]$/.test(row.group_code))) {
      return res.status(400).json({ error: "Grupo invalido en mejores terceros." });
    }

    const { error: deleteError } = await client.from("best_thirds_final").delete().neq("team_code", "");
    assertNoError(deleteError, "Limpiar mejores terceros");
    const { error: insertError } = await client.from("best_thirds_final").insert(normalizedRows);
    assertNoError(insertError, "Guardar mejores terceros");
    await recalculateAllScores();
    await insertLog("admin.best_thirds", "ok", "Mejores terceros guardados.", { rows: normalizedRows });
    io.emit("scores:updated", { at: nowIso(), manual: true, bestThirds: true });
    res.json({ ok: true });
  }));

  router.post("/admin/awards", asyncHandler(adminOnly), asyncHandler(async (req, res) => {
    const client = requireSupabase();
    const rows = Array.isArray(req.body?.awards) ? req.body.awards : [];
    const allowedKeys = new Set(Object.keys(AWARD_CONFIG));
    if (!rows.length) return res.status(400).json({ error: "No hay premios para guardar." });

    const normalizedRows = rows.map((row) => {
      const key = String(row.key || "").trim();
      const config = AWARD_CONFIG[key];
      const winner = String(row.winner_name || "").trim();
      const points = Number(row.points ?? config?.points);
      const isConfirmed = parseBoolean(row.is_confirmed);
      return {
        key,
        winner_name: winner || null,
        points,
        is_confirmed: isConfirmed,
        updated_at: nowIso()
      };
    });

    if (normalizedRows.some((row) => !allowedKeys.has(row.key))) {
      return res.status(400).json({ error: "Premio invalido." });
    }
    if (normalizedRows.some((row) => !Number.isFinite(row.points) || row.points <= 0)) {
      return res.status(400).json({ error: "Los puntos de premios deben ser positivos." });
    }
    if (normalizedRows.some((row) => row.is_confirmed && !row.winner_name)) {
      return res.status(400).json({ error: "Para confirmar un premio debes seleccionar ganador." });
    }

    const { error } = await client.from("award_results").upsert(normalizedRows, { onConflict: "key" });
    assertNoError(error, "Guardar premios individuales");
    await recalculateAllScores();
    await insertLog("admin.awards", "ok", "Premios individuales guardados.", { rows: normalizedRows });
    io.emit("scores:updated", { at: nowIso(), manual: true, awards: true });
    res.json({ ok: true });
  }));

  router.post("/admin/password", asyncHandler(adminOnly), asyncHandler(async (req, res) => {
    const nextPassword = String(req.body?.newPassword || "").trim();
    if (nextPassword.length < 6) {
      return res.status(400).json({ error: "El nuevo password debe tener al menos 6 caracteres." });
    }
    await setSetting("admin_password", nextPassword);
    await insertLog("admin", "ok", "Password admin actualizado.");
    res.json({ ok: true });
  }));

  router.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: error.message || "Error interno" });
  });

  return router;
}
