import { assertNoError, insertLog, nowIso, requireSupabase } from "../db/supabase.js";
import { recalculateAllScores } from "./scoring.js";

function stageFromApi(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("group")) return "group";
  if (text.includes("32")) return "r32";
  if (text.includes("16") || text.includes("oct")) return "r16";
  if (text.includes("quarter") || text.includes("cuarto")) return "qf";
  if (text.includes("semi")) return "sf";
  if (text.includes("third") || text.includes("tercer")) return "third";
  if (text.includes("final")) return "final";
  return "group";
}

function normalizeStatus(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("finish") || text.includes("finalizado") || text === "ft") return "finished";
  if (text.includes("live") || text.includes("playing") || text.includes("progress")) return "live";
  return "scheduled";
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeGames(payload) {
  const list = Array.isArray(payload) ? payload : payload?.data || payload?.games || payload?.matches || [];
  return list.map((game, index) => ({
    match_id: String(game.match_id || game.id || game.fixture?.id || `API-${index + 1}`),
    home_team: game.home_team || game.home?.name || game.teams?.home?.name || game.homeTeam || "Local",
    away_team: game.away_team || game.away?.name || game.teams?.away?.name || game.awayTeam || "Visitante",
    home_goals: nullableNumber(game.home_goals ?? game.goals?.home),
    away_goals: nullableNumber(game.away_goals ?? game.goals?.away),
    stage: stageFromApi(game.stage || game.round || game.phase),
    status: normalizeStatus(game.status || game.fixture?.status?.short || game.fixture?.status?.long),
    match_date: game.match_date || game.date || game.fixture?.date || null,
    last_updated: nowIso()
  }));
}

async function upsertGames(games) {
  if (!games.length) return;
  const client = requireSupabase();
  const { error } = await client.from("match_results").upsert(games, { onConflict: "match_id" });
  assertNoError(error, "Actualizar partidos");
}

function normalizeScorers(payload) {
  const list = Array.isArray(payload) ? payload : payload?.response || payload?.data || [];
  return list
    .map((item) => ({
      player_name: item.player_name || item.player?.name || item.name,
      team: item.team || item.statistics?.[0]?.team?.name || item.player?.team || null,
      goals: Number(item.goals ?? item.statistics?.[0]?.goals?.total ?? 0),
      last_updated: nowIso()
    }))
    .filter((item) => item.player_name);
}

async function upsertTopScorers(scorers) {
  if (!scorers.length) return;
  const client = requireSupabase();
  const { error } = await client.from("top_scorers_cache").upsert(scorers, { onConflict: "player_name" });
  assertNoError(error, "Actualizar goleadores");
}

export async function hasLiveMatches() {
  const client = requireSupabase();
  const { count, error } = await client
    .from("match_results")
    .select("id", { count: "exact", head: true })
    .eq("status", "live");
  assertNoError(error, "Contar partidos en vivo");
  return (count || 0) > 0;
}

export async function syncExternalData(io = null) {
  const summary = { games: 0, scorers: 0 };

  try {
    const url = process.env.WORLD_CUP_GAMES_URL;
    if (url) {
      const payload = await fetchJson(url);
      const games = normalizeGames(payload);
      await upsertGames(games);
      summary.games = games.length;
      await insertLog("worldcup26.games", "ok", `Actualizados ${games.length} partidos.`);
    }
  } catch (error) {
    await insertLog("worldcup26.games", "error", error.message);
  }

  try {
    if (process.env.RAPIDAPI_KEY) {
      const payload = await fetchJson("https://v3.football.api-sports.io/players/topscorers?league=1&season=2026", {
        headers: {
          "x-rapidapi-key": process.env.RAPIDAPI_KEY,
          "x-rapidapi-host": process.env.RAPIDAPI_HOST || "v3.football.api-sports.io"
        }
      });
      const scorers = normalizeScorers(payload);
      await upsertTopScorers(scorers);
      summary.scorers = scorers.length;
      await insertLog("api-football.topscorers", "ok", `Actualizados ${scorers.length} goleadores.`);
    } else {
      await insertLog("api-football.topscorers", "skipped", "RAPIDAPI_KEY no esta configurada.");
    }
  } catch (error) {
    await insertLog("api-football.topscorers", "error", error.message);
  }

  await recalculateAllScores();
  io?.emit("scores:updated", { at: nowIso(), summary });
  return summary;
}
