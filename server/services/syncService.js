import { assertNoError, insertLog, nowIso, requireSupabase } from "../db/supabase.js";
import { recalculateAllScores } from "./scoring.js";

const fifaMatchIdMap = {
  1: "G-A-1", 2: "G-A-2", 3: "G-B-1", 4: "G-D-1", 5: "G-C-2", 6: "G-D-2", 7: "G-C-1", 8: "G-B-2",
  9: "G-E-1", 10: "G-F-1", 11: "G-E-2", 12: "G-F-2", 13: "G-H-1", 14: "G-G-2", 15: "G-H-2", 16: "G-G-1",
  17: "G-I-1", 18: "G-I-2", 19: "G-J-1", 20: "G-J-2", 21: "G-K-1", 22: "G-L-1", 23: "G-L-2", 24: "G-K-2",
  25: "G-A-3", 26: "G-B-3", 27: "G-B-4", 28: "G-A-4", 29: "G-D-4", 30: "G-C-4", 31: "G-D-3", 32: "G-C-3",
  33: "G-E-3", 34: "G-E-4", 35: "G-F-3", 36: "G-F-4", 37: "G-H-4", 38: "G-G-4", 39: "G-H-3", 40: "G-G-3",
  41: "G-I-3", 42: "G-I-4", 43: "G-J-3", 44: "G-J-4", 45: "G-K-3", 46: "G-L-4", 47: "G-K-4", 48: "G-L-3",
  49: "G-C-5", 50: "G-C-6", 51: "G-B-6", 52: "G-A-5", 53: "G-A-6", 54: "G-B-5", 55: "G-E-6", 56: "G-E-5",
  57: "G-D-6", 58: "G-D-5", 59: "G-F-5", 60: "G-F-6", 61: "G-I-6", 62: "G-I-5", 63: "G-G-6", 64: "G-G-5",
  65: "G-H-6", 66: "G-H-5", 67: "G-L-5", 68: "G-L-6", 69: "G-J-6", 70: "G-J-5", 71: "G-K-5", 72: "G-K-6",
  73: "M3", 74: "M9", 75: "M1", 76: "M4", 77: "M10", 78: "M2", 79: "M11", 80: "M12",
  81: "M8", 82: "M7", 83: "M6", 84: "M5", 85: "M15", 86: "M14", 87: "M13", 88: "M16",
  89: "O1", 90: "O2", 91: "O3", 92: "O4", 93: "O5", 94: "O6", 95: "O7", 96: "O8",
  97: "Q1", 98: "Q2", 99: "Q3", 100: "Q4", 101: "S1", 102: "S2", 103: "THIRD", 104: "FINAL"
};

function appMatchIdFromExternal(value) {
  const text = String(value || "");
  const numeric = Number(text);
  if (Number.isInteger(numeric) && fifaMatchIdMap[numeric]) return fifaMatchIdMap[numeric];
  return text;
}

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
  if (text.includes("true") || text.includes("finish") || text.includes("finalizado") || text === "ft") return "finished";
  if (text.includes("live") || text.includes("playing") || text.includes("progress") || text.includes("elapsed")) return "live";
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
  return list.map((game, index) => {
    const status = normalizeStatus(game.finished || game.status || game.time_elapsed || game.fixture?.status?.short || game.fixture?.status?.long);
    const updatedAt = nowIso();
    const homeGoals = nullableNumber(game.home_goals ?? game.home_score ?? game.goals?.home);
    const awayGoals = nullableNumber(game.away_goals ?? game.away_score ?? game.goals?.away);
    return {
      match_id: appMatchIdFromExternal(game.match_id || game.id || game.fixture?.id || `API-${index + 1}`),
      home_team: game.home_team || game.home_team_name_en || game.home?.name || game.teams?.home?.name || game.homeTeam || "Local",
      away_team: game.away_team || game.away_team_name_en || game.away?.name || game.teams?.away?.name || game.awayTeam || "Visitante",
      home_goals: status === "scheduled" ? null : homeGoals,
      away_goals: status === "scheduled" ? null : awayGoals,
      stage: stageFromApi(game.stage || game.round || game.phase || game.type || game.group),
      status,
      match_date: game.match_date || game.date || game.fixture?.date || null,
      last_updated: updatedAt,
      source: "worldcup26",
      confirmed_at: status === "finished" ? updatedAt : null,
      raw_payload: game
    };
  });
}

function isManualAuthority(match) {
  return match?.manual_override === true || match?.locked === true;
}

function shouldPreserveTeamName(value) {
  return value && !/^m\d+\s+(local|visitante)$/i.test(value) && !/^(local|visitante)$/i.test(value);
}

function isSchemaCacheColumnError(error) {
  return /schema cache|column|raw_payload|confirmed_at|manual_override|locked|source/i.test(error?.message || "");
}

function withoutExtendedMatchColumns(match) {
  const { source, confirmed_at, raw_payload, manual_override, locked, ...legacy } = match;
  return legacy;
}

async function readExistingMatches(matchIds) {
  const client = requireSupabase();
  const { data, error } = await client.from("match_results").select("*").in("match_id", matchIds);
  assertNoError(error, "Leer partidos existentes");
  return new Map((data || []).map((match) => [match.match_id, match]));
}

async function upsertGames(games) {
  const summary = {
    received: games.length,
    updated: 0,
    skippedLocked: 0,
    source: "worldcup26"
  };
  if (!games.length) return summary;

  const client = requireSupabase();
  const existing = await readExistingMatches(games.map((game) => game.match_id));
  const unlockedGames = [];

  for (const game of games) {
    const current = existing.get(game.match_id);
    if (isManualAuthority(current)) {
      summary.skippedLocked += 1;
      continue;
    }
    unlockedGames.push({
      ...game,
      home_team: shouldPreserveTeamName(current?.home_team) ? current.home_team : game.home_team,
      away_team: shouldPreserveTeamName(current?.away_team) ? current.away_team : game.away_team,
      stage: current?.stage || game.stage,
      match_date: game.match_date || current?.match_date || null,
      confirmed_at: game.status === "finished" ? current?.confirmed_at || game.confirmed_at : null
    });
  }

  if (!unlockedGames.length) return summary;

  const { error } = await client.from("match_results").upsert(unlockedGames, { onConflict: "match_id" });
  if (error) {
    if (isSchemaCacheColumnError(error)) {
      const legacyRows = unlockedGames.map(withoutExtendedMatchColumns);
      const { error: legacyError } = await client.from("match_results").upsert(legacyRows, { onConflict: "match_id" });
      assertNoError(legacyError, "Actualizar partidos");
      summary.schemaWarning = "La base no tiene columnas de override; ejecuta la migracion SQL.";
    } else {
      assertNoError(error, "Actualizar partidos");
    }
  }

  summary.updated = unlockedGames.length;
  return summary;
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

function topScorersSyncHours() {
  const hours = Number(process.env.TOP_SCORERS_SYNC_HOURS || 12);
  return Number.isFinite(hours) && hours > 0 ? hours : 12;
}

async function lastSuccessfulTopScorersSync() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("sync_logs")
    .select("created_at")
    .eq("source", "api-football.topscorers")
    .eq("status", "ok")
    .order("created_at", { ascending: false })
    .limit(1);
  assertNoError(error, "Leer ultima sync de goleadores");
  return data?.[0]?.created_at || null;
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

export async function syncGames(_io = null) {
  try {
    const url = process.env.WORLD_CUP_GAMES_URL;
    if (!url) {
      const summary = { updated: 0, skippedLocked: 0, skipped: true, source: "worldcup26", reason: "WORLD_CUP_GAMES_URL no esta configurada." };
      await insertLog("worldcup26.games", "skipped", summary.reason);
      return summary;
    }

    const payload = await fetchJson(url);
    const games = normalizeGames(payload);
    const summary = await upsertGames(games);
    await insertLog(
      "worldcup26.games",
      "ok",
      `Actualizados ${summary.updated} partidos. Omitidos por bloqueo: ${summary.skippedLocked}.`,
      summary
    );
    return summary;
  } catch (error) {
    await insertLog("worldcup26.games", "error", error.message);
    return { updated: 0, skippedLocked: 0, source: "worldcup26", error: error.message };
  }
}

export async function syncTopScorers(options = {}) {
  try {
    if (!process.env.RAPIDAPI_KEY) {
      const summary = { updated: 0, skipped: true, source: "api-football", reason: "RAPIDAPI_KEY no esta configurada." };
      await insertLog("api-football.topscorers", "skipped", summary.reason);
      return summary;
    }

    const intervalHours = topScorersSyncHours();
    const lastSync = await lastSuccessfulTopScorersSync();
    if (lastSync && !options.force) {
      const elapsedHours = (Date.now() - new Date(lastSync).getTime()) / 3600000;
      if (elapsedHours < intervalHours) {
        const remaining = Math.max(0, intervalHours - elapsedHours);
        const reason = `Rate limit interno: faltan ${remaining.toFixed(1)} horas.`;
        const summary = {
          updated: 0,
          skipped: true,
          source: "api-football",
          reason,
          lastSync,
          intervalHours
        };
        await insertLog("api-football.topscorers", "skipped", reason, summary);
        return summary;
      }
    }

    const payload = await fetchJson("https://v3.football.api-sports.io/players/topscorers?league=1&season=2026", {
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": process.env.RAPIDAPI_HOST || "v3.football.api-sports.io"
      }
    });
    const scorers = normalizeScorers(payload);
    await upsertTopScorers(scorers);
    const summary = { updated: scorers.length, skipped: false, source: "api-football", intervalHours };
    await insertLog("api-football.topscorers", "ok", `Actualizados ${scorers.length} goleadores.`, summary);
    return summary;
  } catch (error) {
    await insertLog("api-football.topscorers", "error", error.message);
    return { updated: 0, skipped: false, source: "api-football", error: error.message };
  }
}

export async function syncExternalData(io = null, options = {}) {
  const {
    includeGames = true,
    includeTopScorers = false,
    forceTopScorers = false
  } = options || {};

  const summary = {
    games: includeGames
      ? await syncGames(io)
      : { updated: 0, skipped: true, source: "worldcup26", reason: "includeGames=false" },
    topScorers: includeTopScorers
      ? await syncTopScorers({ force: forceTopScorers })
      : { updated: 0, skipped: true, source: "api-football", reason: "includeTopScorers=false" }
  };

  await recalculateAllScores();
  io?.emit("scores:updated", { at: nowIso(), summary });
  return summary;
}
