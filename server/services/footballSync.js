import { assertNoError, insertLog, nowIso, requireSupabase } from "../db/supabase.js";
import { recalculateAllScores } from "./scoring.js";
import { ApiFootballClient, ApiFootballError } from "./apiFootball.js";
import { EspnFootballClient } from "./espnFootball.js";
import {
  ACTIVE_API_STATUSES,
  DEFAULT_SYNC_CONFIG,
  FINAL_API_STATUSES,
  PRIORITIES,
  SPECIAL_API_STATUSES,
  determinePriority,
  getQuotaState,
  nextSyncAt,
  normalizeSyncConfig,
  normalizeTeamName,
  selectSyncBatches
} from "./syncPolicy.js";

const OPTIONAL_SCHEMA_ERROR = /schema cache|does not exist|could not find|relation .* does not exist|column .* does not exist/i;

const TEAM_ALIASES = new Map(Object.entries({
  belgium: "belgica",
  spain: "espana",
  tunisia: "tunez",
  japan: "japon",
  egypt: "egipto",
  germany: "alemania",
  sweden: "suecia",
  morocco: "marruecos",
  scotland: "escocia",
  brazil: "brasil",
  france: "francia",
  england: "inglaterra",
  norway: "noruega",
  croatia: "croacia",
  panama: "panama",
  algeria: "argelia",
  jordan: "jordania",
  iraq: "irak",
  switzerland: "suiza",
  qatar: "catar",
  "bosnia and herzegovina": "bosnia",
  uzbekistan: "uzbekistan",
  mexico: "mexico",
  canada: "canada",
  haiti: "haiti",
  colombia: "colombia",
  portugal: "portugal",
  argentina: "argentina",
  austria: "austria",
  ghana: "ghana",
  senegal: "senegal",
  uruguay: "uruguay",
  paraguay: "paraguay",
  australia: "australia",
  ecuador: "ecuador",
  "korea republic": "corea",
  "south korea": "corea",
  "czech republic": "chequia",
  czechia: "chequia",
  "ivory coast": "costa marfil",
  "cote d ivoire": "costa marfil",
  netherlands: "holanda",
  "new zealand": "n zelanda",
  "saudi arabia": "a saudita",
  "cape verde": "cabo verde",
  "congo dr": "rd congo",
  "dr congo": "rd congo",
  "united states": "usa",
  turkey: "turquia",
  turkiye: "turquia",
  iran: "iran",
  curacao: "curazao"
}));

function canonicalTeam(value) {
  const normalized = normalizeTeamName(value);
  return TEAM_ALIASES.get(normalized) || normalized;
}

function utcDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function sanitizedFixture(fixture) {
  return {
    fixture: {
      id: fixture?.fixture?.id,
      date: fixture?.fixture?.date,
      status: fixture?.fixture?.status
    },
    league: fixture?.league ? {
      id: fixture.league.id,
      name: fixture.league.name,
      round: fixture.league.round
    } : null,
    teams: fixture?.teams,
    goals: fixture?.goals,
    score: fixture?.score
  };
}

function resultSnapshot(match) {
  return {
    home_goals: match.home_goals,
    away_goals: match.away_goals,
    status: match.status,
    qualified_team: match.qualified_team,
    decided_by_penalties: match.decided_by_penalties,
    source: match.source,
    locked: match.locked,
    manual_override: match.manual_override
  };
}

export function isAutomaticResultProtected(match) {
  return match?.locked === true || (match?.manual_override === true && match?.source !== "api-football");
}

function winnerFromFixture(match, fixture, apiStatus) {
  const homeGoals = fixture?.goals?.home;
  const awayGoals = fixture?.goals?.away;
  if (homeGoals > awayGoals) return match.home_team;
  if (awayGoals > homeGoals) return match.away_team;
  if (apiStatus === "PEN") {
    const homePenalties = fixture?.score?.penalty?.home;
    const awayPenalties = fixture?.score?.penalty?.away;
    if (homePenalties > awayPenalties) return match.home_team;
    if (awayPenalties > homePenalties) return match.away_team;
  }
  return null;
}

function normalizeConfigUpdate(input = {}) {
  const row = {};
  if (Object.hasOwn(input, "enabled")) row.enabled = input.enabled === true;
  if (Object.hasOwn(input, "dailySoftLimit")) row.daily_soft_limit = Number(input.dailySoftLimit);
  if (Object.hasOwn(input, "emergencyReserve")) row.emergency_reserve = Number(input.emergencyReserve);
  if (Object.hasOwn(input, "colombiaTeamName")) row.colombia_team_name = String(input.colombiaTeamName || "").trim();
  if (Object.hasOwn(input, "popularTeams")) row.popular_teams = input.popularTeams;
  if (Object.hasOwn(input, "favoriteTeams")) row.favorite_teams = input.favoriteTeams;
  if (Object.hasOwn(input, "manualFeaturedFixtureIds")) row.manual_featured_fixture_ids = input.manualFeaturedFixtureIds;
  if (Object.hasOwn(input, "leagueId")) row.league_id = Number(input.leagueId);
  if (Object.hasOwn(input, "season")) row.season = Number(input.season);
  return row;
}

export class FootballSyncService {
  constructor(io, {
    apiClient = new ApiFootballClient(),
    fallbackClient = new EspnFootballClient(),
    getClient = requireSupabase,
    clock = () => new Date(),
    intervalMs = 60_000
  } = {}) {
    this.io = io;
    this.apiClient = apiClient;
    this.fallbackClient = fallbackClient;
    this.getClient = getClient;
    this.clock = clock;
    this.intervalMs = intervalMs;
    this.running = false;
    this.timer = null;
    this.lastRunAt = null;
    this.lastError = null;
    this.migrationRequired = false;
  }

  async loadConfig() {
    const client = this.getClient();
    const { data, error } = await client.from("football_sync_config").select("*").eq("id", 1).maybeSingle();
    if (error && OPTIONAL_SCHEMA_ERROR.test(error.message || "")) {
      this.migrationRequired = true;
      return { ...DEFAULT_SYNC_CONFIG, enabled: false };
    }
    assertNoError(error, "Leer configuracion de API-Football");
    this.migrationRequired = false;
    return normalizeSyncConfig(data || DEFAULT_SYNC_CONFIG);
  }

  async usageToday(endpoint = null) {
    const client = this.getClient();
    let query = client
      .from("football_api_usage")
      .select("id", { count: "exact", head: true })
      .eq("request_date", utcDate(this.clock()));
    if (endpoint) query = query.eq("endpoint", endpoint);
    const { count, error } = await query;
    if (error && OPTIONAL_SCHEMA_ERROR.test(error.message || "")) return 0;
    assertNoError(error, "Contar consultas de API-Football");
    return count || 0;
  }

  async recordUsage({ endpoint, fixtureIds = [], priority = null, trigger, success, error = null, responseStatus = null, responseCount = 0, payload = null }) {
    const client = this.getClient();
    const { error: insertError } = await client.from("football_api_usage").insert({
      request_date: utcDate(this.clock()),
      requested_at: this.clock().toISOString(),
      endpoint,
      fixture_ids: fixtureIds,
      priority,
      trigger,
      response_status: responseStatus,
      success,
      error,
      response_count: responseCount,
      payload
    });
    if (insertError && !OPTIONAL_SCHEMA_ERROR.test(insertError.message || "")) {
      throw new Error(`Registrar consumo de API-Football: ${insertError.message}`);
    }
  }

  async publicStatus() {
    const config = await this.loadConfig();
    const used = await this.usageToday();
    const quota = getQuotaState(used, config);
    return {
      enabled: config.enabled,
      configured: this.apiClient.configured,
      fallbackConfigured: this.fallbackClient.configured,
      fallbackActive: this.migrationRequired || !config.enabled,
      migrationRequired: this.migrationRequired,
      mode: quota.mode,
      used: quota.used,
      remaining: quota.remaining,
      dailyLimit: quota.totalLimit,
      limited: quota.mode === "critical" || quota.mode === "emergency",
      lastRunAt: this.lastRunAt,
      lastError: this.lastError
    };
  }

  async adminState() {
    const client = this.getClient();
    const [config, status] = await Promise.all([this.loadConfig(), this.publicStatus()]);
    if (this.migrationRequired) return { config, status, matches: [], usage: [] };
    const [{ data: matches, error: matchError }, { data: usage, error: usageError }] = await Promise.all([
      client
        .from("match_results")
        .select("match_id,home_team,away_team,stage,match_date,status,api_fixture_id,api_status,api_elapsed,priority,priority_override,featured,last_synced_at,next_sync_at,sync_error")
        .order("match_date", { ascending: true }),
      client.from("football_api_usage").select("*").order("requested_at", { ascending: false }).limit(30)
    ]);
    assertNoError(matchError, "Leer partidos para sincronizacion");
    assertNoError(usageError, "Leer consumo de API-Football");
    return { config, status, matches: matches || [], usage: usage || [] };
  }

  async saveConfig(input, actor = "admin") {
    const updates = normalizeConfigUpdate(input);
    const proposed = normalizeSyncConfig({ ...DEFAULT_SYNC_CONFIG, ...input });
    if (!Number.isInteger(proposed.dailySoftLimit) || proposed.dailySoftLimit < 1 || proposed.dailySoftLimit > 90) {
      throw new Error("dailySoftLimit debe estar entre 1 y 90.");
    }
    if (!Number.isInteger(proposed.emergencyReserve) || proposed.emergencyReserve < 0 || proposed.emergencyReserve > 20) {
      throw new Error("emergencyReserve debe estar entre 0 y 20.");
    }
    for (const key of ["popularTeams", "favoriteTeams", "manualFeaturedFixtureIds"]) {
      if (Object.hasOwn(input, key) && !Array.isArray(input[key])) throw new Error(`${key} debe ser una lista.`);
    }
    const client = this.getClient();
    const { data, error } = await client
      .from("football_sync_config")
      .upsert({ id: 1, ...updates, updated_at: nowIso(), updated_by: actor }, { onConflict: "id" })
      .select("*")
      .single();
    assertNoError(error, "Guardar configuracion de API-Football");
    await insertLog("admin.live_sync.config", "ok", "Configuracion de API-Football actualizada.", { actor, updates });
    return normalizeSyncConfig(data);
  }

  async updateMatchSettings(matchId, input, actor = "admin") {
    const updates = {};
    if (Object.hasOwn(input, "featured")) updates.featured = input.featured === true;
    if (Object.hasOwn(input, "priorityOverride")) {
      const value = String(input.priorityOverride || "").toUpperCase();
      if (value && !PRIORITIES.includes(value)) throw new Error("Prioridad invalida.");
      updates.priority_override = value || null;
    }
    if (Object.hasOwn(input, "apiFixtureId")) {
      const value = input.apiFixtureId === "" || input.apiFixtureId == null ? null : Number(input.apiFixtureId);
      if (value != null && (!Number.isInteger(value) || value <= 0)) throw new Error("apiFixtureId invalido.");
      updates.api_fixture_id = value;
    }
    if (!Object.keys(updates).length) throw new Error("No hay ajustes de sincronizacion para guardar.");
    updates.next_sync_at = null;
    const client = this.getClient();
    const { data: before, error: beforeError } = await client.from("match_results").select("*").eq("match_id", matchId).maybeSingle();
    assertNoError(beforeError, "Leer partido");
    if (!before) throw new Error("Partido no encontrado.");
    const { data, error } = await client.from("match_results").update(updates).eq("match_id", matchId).select("*").single();
    assertNoError(error, "Guardar ajustes de sincronizacion");
    await insertLog("admin.live_sync.match", "ok", `Sincronizacion ajustada para ${matchId}.`, { actor, before: resultSnapshot(before), updates });
    return data;
  }

  async discoverFixtures({ trigger = "admin" } = {}) {
    if (this.running) throw new Error("Ya hay una sincronizacion en curso.");
    this.running = true;
    try {
      const config = await this.loadConfig();
      const used = await this.usageToday();
      const quota = getQuotaState(used, config);
      if (quota.remaining < 1) throw new Error("No quedan consultas de API-Football para hoy.");
      let result;
      try {
        result = await this.apiClient.fetchTournamentFixtures(config.leagueId, config.season);
        await this.recordUsage({ endpoint: "/fixtures:discover", trigger, success: true, responseCount: result.results });
      } catch (error) {
        await this.recordUsage({
          endpoint: "/fixtures:discover",
          trigger,
          success: false,
          responseStatus: error.status,
          error: error.message,
          payload: error.apiErrors || null
        });
        throw error;
      }
      const client = this.getClient();
      const { data: matches, error: matchError } = await client.from("match_results").select("*");
      assertNoError(matchError, "Leer partidos para descubrir fixtures");
      const mapped = [];
      for (const fixture of result.rows) {
        const apiDate = new Date(fixture.fixture.date).getTime();
        const match = (matches || []).find((candidate) => {
          const dateDifference = Math.abs(new Date(candidate.match_date).getTime() - apiDate);
          return dateDifference <= 24 * 60 * 60 * 1000 &&
            canonicalTeam(candidate.home_team) === canonicalTeam(fixture.teams.home.name) &&
            canonicalTeam(candidate.away_team) === canonicalTeam(fixture.teams.away.name);
        });
        if (!match) continue;
        const { error } = await client.from("match_results").update({
          api_fixture_id: fixture.fixture.id,
          api_status: fixture.fixture.status.short,
          sync_error: null
        }).eq("match_id", match.match_id);
        assertNoError(error, `Mapear ${match.match_id}`);
        mapped.push({ matchId: match.match_id, apiFixtureId: fixture.fixture.id });
      }
      await insertLog("api-football.discover", "ok", `${mapped.length} fixtures vinculados.`, { mapped, total: result.results });
      return { mapped, totalFixtures: result.results };
    } finally {
      this.running = false;
    }
  }

  async processFixture(match, fixture, priority, quotaMode) {
    const client = this.getClient();
    const apiStatus = String(fixture?.fixture?.status?.short || "").toUpperCase();
    const homeGoals = fixture?.goals?.home;
    const awayGoals = fixture?.goals?.away;
    const now = this.clock().toISOString();
    const updates = {
      api_status: apiStatus || null,
      api_elapsed: fixture?.fixture?.status?.elapsed ?? null,
      last_synced_at: now,
      priority,
      sync_error: SPECIAL_API_STATUSES.has(apiStatus) ? `Estado especial ${apiStatus}` : null,
      raw_payload: sanitizedFixture(fixture)
    };
    let finalChanged = false;
    let firstFinal = false;

    if (ACTIVE_API_STATUSES.has(apiStatus)) {
      if (match.locked) {
        updates.sync_error = "Actualizacion en vivo omitida: partido bloqueado.";
      } else {
        updates.live_home_goals = homeGoals;
        updates.live_away_goals = awayGoals;
      }
    } else if (apiStatus === "NS") {
      updates.live_home_goals = null;
      updates.live_away_goals = null;
    } else if (FINAL_API_STATUSES.has(apiStatus)) {
      updates.live_home_goals = homeGoals;
      updates.live_away_goals = awayGoals;
      firstFinal = !match.api_final_at;
      const confirmationCount = firstFinal ? 0 : Number(match.final_confirmation_count || 0) + 1;
      updates.api_final_at = match.api_final_at || now;
      updates.final_confirmation_count = confirmationCount;
      const resultDiffers = match.home_goals !== homeGoals || match.away_goals !== awayGoals || match.status !== "finished";
      const protectedResult = isAutomaticResultProtected(match);
      if (resultDiffers && protectedResult) {
        updates.sync_error = "Resultado API diferente; protegido por ajuste manual o bloqueo.";
        await client.from("match_result_audit").insert({
          match_id: match.match_id,
          actor: "scheduler",
          source: "api-football-conflict",
          reason: updates.sync_error,
          previous_value: resultSnapshot(match),
          new_value: { home_goals: homeGoals, away_goals: awayGoals, api_status: apiStatus },
          created_at: now
        });
      } else if (resultDiffers) {
        if (match.status === "finished") {
          const { error: auditError } = await client.from("match_result_audit").insert({
            match_id: match.match_id,
            actor: "scheduler",
            source: "api-football-correction",
            reason: "API-Football reporto una correccion oficial durante la ventana de confirmacion.",
            previous_value: resultSnapshot(match),
            new_value: { home_goals: homeGoals, away_goals: awayGoals, api_status: apiStatus },
            created_at: now
          });
          assertNoError(auditError, "Auditar correccion oficial");
        }
        updates.home_goals = homeGoals;
        updates.away_goals = awayGoals;
        updates.status = "finished";
        updates.confirmed_at = now;
        updates.source = "api-football";
        updates.manual_override = false;
        if (match.stage !== "group") {
          updates.qualified_team = winnerFromFixture(match, fixture, apiStatus);
          updates.decided_by_penalties = apiStatus === "PEN";
        }
        finalChanged = true;
      }
    }

    updates.next_sync_at = nextSyncAt({ ...match, ...updates }, now, quotaMode);
    const { data, error } = await client
      .from("match_results")
      .update(updates)
      .eq("match_id", match.match_id)
      .select("*")
      .single();
    assertNoError(error, `Actualizar ${match.match_id} desde API-Football`);
    this.io?.emit("match:updated", {
      at: now,
      matchId: match.match_id,
      groupCode: String(match.match_id).match(/^G-([A-L])-/)?.[1] || null,
      row: data,
      final: FINAL_API_STATUSES.has(apiStatus)
    });
    return { row: data, finalChanged, firstFinal, priority };
  }

  async maybeSyncTopScorers(processed, config, quota, trigger) {
    const currentQuota = getQuotaState(await this.usageToday(), config);
    if (currentQuota.mode !== "normal" || currentQuota.remaining < 1) return false;
    if (!processed.some((item) => item.firstFinal && ["P0", "P1"].includes(item.priority) && item.finalChanged)) return false;
    if (await this.usageToday("/players/topscorers") >= 3) return false;
    let result;
    try {
      result = await this.apiClient.fetchTopScorers(config.leagueId, config.season);
      await this.recordUsage({ endpoint: "/players/topscorers", trigger, success: true, responseCount: result.results });
    } catch (error) {
      await this.recordUsage({ endpoint: "/players/topscorers", trigger, success: false, responseStatus: error.status, error: error.message });
      return false;
    }
    const rows = result.rows.map((entry) => ({
      player_name: entry.player?.name,
      team: entry.statistics?.[0]?.team?.name || null,
      goals: Number(entry.statistics?.[0]?.goals?.total || 0),
      last_updated: this.clock().toISOString()
    })).filter((row) => row.player_name);
    if (rows.length) {
      const client = this.getClient();
      const { error } = await client.from("top_scorers_cache").upsert(rows, { onConflict: "player_name" });
      assertNoError(error, "Actualizar goleadores");
      this.io?.emit("awards:updated", { at: this.clock().toISOString() });
    }
    return true;
  }

  async runEspnFallback({ trigger = "scheduler" } = {}) {
    if (!this.fallbackClient.configured) return { provider: "espn", requests: 0, processed: 0, finalChanged: 0 };
    const client = this.getClient();
    const now = this.clock();
    const windowStart = new Date(now.getTime() - 18 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    const { data: matches, error } = await client
      .from("match_results")
      .select("match_id,home_team,away_team,stage,match_date,status,home_goals,away_goals,source,manual_override,locked")
      .gte("match_date", windowStart.toISOString())
      .lte("match_date", windowEnd.toISOString());
    assertNoError(error, "Leer partidos para respaldo ESPN");

    const dates = new Set();
    for (const match of matches || []) dates.add(utcDate(match.match_date));
    const fixtures = [];
    for (const date of dates) fixtures.push(...await this.fallbackClient.fetchDate(date));

    let processed = 0;
    let finalChanged = 0;
    for (const fixture of fixtures) {
      const fixtureTime = new Date(fixture.date).getTime();
      const match = (matches || []).find((candidate) =>
        Math.abs(new Date(candidate.match_date).getTime() - fixtureTime) <= 4 * 60 * 60 * 1000 &&
        canonicalTeam(candidate.home_team) === canonicalTeam(fixture.homeTeam) &&
        canonicalTeam(candidate.away_team) === canonicalTeam(fixture.awayTeam)
      );
      if (!match || fixture.status === "NS" || isAutomaticResultProtected(match)) continue;
      if (!Number.isInteger(fixture.homeGoals) || !Number.isInteger(fixture.awayGoals)) continue;
      const final = fixture.status === "FT";
      const nextStatus = final ? "finished" : "live";
      const differs = match.home_goals !== fixture.homeGoals || match.away_goals !== fixture.awayGoals || match.status !== nextStatus;
      if (!differs) continue;
      const updatedAt = this.clock().toISOString();
      const updates = {
        home_goals: fixture.homeGoals,
        away_goals: fixture.awayGoals,
        status: nextStatus,
        source: "espn",
        manual_override: false,
        last_updated: updatedAt,
        raw_payload: { provider: "espn", event_id: fixture.id, status: fixture.status, detail: fixture.detail }
      };
      if (final) updates.confirmed_at = updatedAt;
      const { data: row, error: updateError } = await client
        .from("match_results")
        .update(updates)
        .eq("match_id", match.match_id)
        .select("*")
        .single();
      assertNoError(updateError, `Actualizar ${match.match_id} desde ESPN`);
      processed += 1;
      if (final) finalChanged += 1;
      this.io?.emit("match:updated", {
        at: updatedAt,
        matchId: match.match_id,
        groupCode: String(match.match_id).match(/^G-([A-L])-/)?.[1] || null,
        row,
        final
      });
    }
    if (finalChanged) await recalculateAllScores();
    if (processed) {
      this.io?.emit("scores:updated", { at: this.clock().toISOString(), source: "espn" });
      await insertLog("espn.sync", "ok", `${processed} partido(s) actualizados desde ESPN.`, { trigger, processed, finalChanged });
    }
    return { provider: "espn", requests: dates.size, processed, finalChanged };
  }

  async runOnce({ trigger = "scheduler", forceMatchIds = [] } = {}) {
    if (this.running) return { ok: false, skipped: "locked", message: "Ya hay una sincronizacion en curso." };
    this.running = true;
    this.lastError = null;
    let fallbackResult = null;
    try {
      const config = await this.loadConfig();
      fallbackResult = await this.runEspnFallback({ trigger });
      this.lastRunAt = this.clock().toISOString();
      if (this.migrationRequired) return { ok: true, migrationRequired: true, ...fallbackResult };
      if (!this.apiClient.configured) return { ok: true, apiFootballSkipped: "api_key_missing", ...fallbackResult };
      if (!config.enabled && !forceMatchIds.length) return { ok: true, apiFootballSkipped: "disabled", ...fallbackResult };

      const client = this.getClient();
      const { data: matches, error } = await client.from("match_results").select("*");
      assertNoError(error, "Leer partidos para sincronizar");
      const used = await this.usageToday();
      let selection = selectSyncBatches(matches || [], config, used, this.clock());
      if (forceMatchIds.length) {
        const quota = getQuotaState(used, config);
        const requested = new Set(forceMatchIds.map(String));
        const forced = (matches || [])
          .filter((match) => requested.has(String(match.match_id)) || requested.has(String(match.api_fixture_id)))
          .filter((match) => match.api_fixture_id)
          .map((match) => ({ ...match, priority: determinePriority(match, config) }));
        selection = { batches: forced.length && quota.remaining ? [forced.slice(0, config.maxFixturesPerRequest)] : [], quota, highestPriority: forced[0]?.priority || "P0" };
      }
      if (!selection.batches.length) {
        this.lastRunAt = this.clock().toISOString();
        return { ok: true, requests: 0, reason: "no_due_matches", quota: selection.quota };
      }

      const processed = [];
      let requests = 0;
      for (const batch of selection.batches) {
        const fixtureIds = batch.map((match) => Number(match.api_fixture_id));
        let response;
        try {
          response = await this.apiClient.fetchFixturesByIds(fixtureIds);
          requests += 1;
          await this.recordUsage({
            endpoint: "/fixtures:ids",
            fixtureIds,
            priority: selection.highestPriority,
            trigger,
            success: true,
            responseCount: response.results
          });
        } catch (apiError) {
          requests += 1;
          await this.recordUsage({
            endpoint: "/fixtures:ids",
            fixtureIds,
            priority: selection.highestPriority,
            trigger,
            success: false,
            responseStatus: apiError.status,
            error: apiError.message,
            payload: apiError.apiErrors || null
          });
          const backoffMinutes = /plan|access|season|temporada/i.test(apiError.message) ? 24 * 60 : 15;
          const retryAt = new Date(this.clock().getTime() + backoffMinutes * 60 * 1000).toISOString();
          const { error: backoffError } = await client
            .from("match_results")
            .update({ last_synced_at: this.clock().toISOString(), next_sync_at: retryAt, sync_error: apiError.message })
            .in("match_id", batch.map((match) => match.match_id));
          assertNoError(backoffError, "Programar reintento de API-Football");
          throw apiError;
        }
        const matchByFixture = new Map(batch.map((match) => [Number(match.api_fixture_id), match]));
        const returnedFixtureIds = new Set();
        for (const fixture of response.rows) {
          const match = matchByFixture.get(Number(fixture?.fixture?.id));
          if (!match) continue;
          returnedFixtureIds.add(Number(fixture.fixture.id));
          processed.push(await this.processFixture(match, fixture, match.priority, selection.quota.mode));
        }
        const missingMatches = batch.filter((match) => !returnedFixtureIds.has(Number(match.api_fixture_id)));
        if (missingMatches.length) {
          const retryAt = new Date(this.clock().getTime() + 60 * 60 * 1000).toISOString();
          const { error: missingError } = await client
            .from("match_results")
            .update({
              last_synced_at: this.clock().toISOString(),
              next_sync_at: retryAt,
              sync_error: "API-Football no devolvio este fixture ID. Revisa el mapeo."
            })
            .in("match_id", missingMatches.map((match) => match.match_id));
          assertNoError(missingError, "Registrar fixtures ausentes");
        }
      }

      if (processed.some((item) => item.finalChanged)) {
        await recalculateAllScores();
        this.io?.emit("scores:updated", { at: this.clock().toISOString(), source: "api-football" });
      }
      const scorersUpdated = await this.maybeSyncTopScorers(processed, config, selection.quota, trigger);
      this.lastRunAt = this.clock().toISOString();
      await insertLog("api-football.sync", "ok", `${requests} consulta(s), ${processed.length} partido(s) procesado(s).`, {
        trigger,
        requests,
        processed: processed.map((item) => item.row.match_id),
        mode: selection.quota.mode,
        scorersUpdated
      });
      this.io?.emit("live-sync:status", await this.publicStatus());
      return { ok: true, requests, processed: processed.length, quota: selection.quota, scorersUpdated };
    } catch (error) {
      this.lastError = error.message;
      this.lastRunAt = this.clock().toISOString();
      const status = error instanceof ApiFootballError ? "api_error" : "error";
      await insertLog("api-football.sync", status, error.message, { trigger, apiErrors: error.apiErrors || null });
      this.io?.emit("live-sync:status", await this.publicStatus().catch(() => ({ lastError: error.message })));
      if (error instanceof ApiFootballError && fallbackResult) {
        return { ok: true, apiFootballError: error.message, ...fallbackResult };
      }
      throw error;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer || process.env.ENABLE_CRON !== "true") return false;
    this.timer = setInterval(() => {
      this.runOnce({ trigger: "scheduler" }).catch((error) => console.error(`[api-football] ${error.message}`));
    }, this.intervalMs);
    this.timer.unref?.();
    setTimeout(() => {
      this.runOnce({ trigger: "startup" }).catch((error) => console.error(`[api-football] ${error.message}`));
    }, 5_000).unref?.();
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function createFootballSyncService(io, options) {
  return new FootballSyncService(io, options);
}
