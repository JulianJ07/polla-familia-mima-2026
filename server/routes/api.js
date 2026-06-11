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
import { getLeaderboard, getParticipantDetail, recalculateAllScores } from "../services/scoring.js";
import { syncExternalData } from "../services/syncService.js";

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

async function currentPhase() {
  const client = requireSupabase();
  const { count: liveCount, error: liveError } = await client
    .from("match_results")
    .select("id", { count: "exact", head: true })
    .eq("status", "live");
  assertNoError(liveError, "Contar partidos en vivo");
  if (liveCount) return "Partidos en vivo";

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

export function createApiRouter(io) {
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

  router.post("/scores/recalculate", asyncHandler(adminOnly), asyncHandler(async (_req, res) => {
    await recalculateAllScores();
    io.emit("scores:updated", { at: nowIso(), manual: true });
    res.json({ ok: true });
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
      const { data, error: predictionError } = await client
        .from("predictions")
        .select("match_id,predicted_home_goals,predicted_away_goals")
        .in("match_id", matchIds);
      assertNoError(predictionError, "Leer conteo de predicciones");
      predictions = data || [];
    }

    const stats = new Map();
    for (const prediction of predictions) {
      const current = stats.get(prediction.match_id) || { prediction_count: 0, exact_count: 0 };
      current.prediction_count += 1;
      stats.set(prediction.match_id, current);
    }

    const rows = (matches || []).sort(sortMatches).map((match) => {
      const stat = stats.get(match.match_id) || { prediction_count: 0, exact_count: 0 };
      for (const prediction of predictions.filter((item) => item.match_id === match.match_id)) {
        if (
          match.home_goals != null &&
          match.away_goals != null &&
          prediction.predicted_home_goals === match.home_goals &&
          prediction.predicted_away_goals === match.away_goals
        ) {
          stat.exact_count += 1;
        }
      }
      return { ...match, ...stat, stageLabel: stageLabel(match.stage) };
    });
    res.json({ rows });
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
      best_player: individualMap.get(participant.id)?.best_player || null,
      best_goalkeeper: individualMap.get(participant.id)?.best_goalkeeper || null
    }));
    res.json({ topScorers: topScorers || [], results: {}, predictions });
  }));

  router.get("/admin/logs", asyncHandler(adminOnly), asyncHandler(async (_req, res) => {
    const client = requireSupabase();
    const { data, error } = await client.from("sync_logs").select("*").order("created_at", { ascending: false }).limit(50);
    assertNoError(error, "Leer logs");
    res.json({ rows: data || [] });
  }));

  router.post("/admin/sync", asyncHandler(adminOnly), asyncHandler(async (_req, res) => {
    const summary = await syncExternalData(io);
    res.json({ ok: true, summary });
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
