import { assertNoError, insertLog, nowIso, requireSupabase } from "../db/supabase.js";
import { recalculateAllScores } from "./scoring.js";
import { ApiFootballClient, ApiFootballError } from "./apiFootball.js";
import { EspnFootballClient } from "./espnFootball.js";
import { espnPollingDecision, progressiveBackoffMinutes, providerActivity } from "./providerPolicy.js";
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
const ACCESS_DENIED_ERROR = /plan|access|season|temporada|not have access|not available/i;
const MANUAL_SOURCES = new Set(["admin", "manual", "fifa_official_audit"]);

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

export function espnScoreboardDatesForMatch(matchDate) {
  const base = matchDate ? new Date(matchDate).getTime() : Number.NaN;
  if (!Number.isFinite(base)) return [];
  const oneDay = 24 * 60 * 60 * 1000;
  return [-oneDay, 0, oneDay]
    .map((offset) => utcDate(new Date(base + offset)))
    .filter((date, index, all) => all.indexOf(date) === index);
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
  return match?.locked === true || match?.manual_override === true || MANUAL_SOURCES.has(String(match?.source || "").toLowerCase());
}

export function providerCanReplaceFinal(match, provider) {
  if (isAutomaticResultProtected(match)) return false;
  if (match?.status !== "finished") return true;
  if (provider === "espn") return false;
  if (provider === "api-football") return [null, "", "espn", "api-football", "worldcup26"].includes(match?.source ?? null);
  return false;
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

function penaltyScoreFromFixture(fixture, side) {
  const value = fixture?.score?.penalty?.[side];
  return Number.isInteger(value) ? value : null;
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

  async loadProviderStates() {
    const client = this.getClient();
    const { data, error } = await client.from("football_provider_state").select("*");
    if (error && OPTIONAL_SCHEMA_ERROR.test(error.message || "")) {
      this.migrationRequired = true;
      return new Map();
    }
    assertNoError(error, "Leer estado de proveedores");
    return new Map((data || []).map((row) => [row.provider, row]));
  }

  async saveProviderState(provider, updates) {
    const client = this.getClient();
    const row = { provider, ...updates, updated_at: this.clock().toISOString() };
    const { data, error } = await client
      .from("football_provider_state")
      .upsert(row, { onConflict: "provider" })
      .select("*")
      .single();
    if (error && OPTIONAL_SCHEMA_ERROR.test(error.message || "")) {
      this.migrationRequired = true;
      return { provider, ...updates };
    }
    assertNoError(error, `Guardar estado de ${provider}`);
    return data;
  }

  async setApiEnabled(enabled, actor) {
    const client = this.getClient();
    const { error } = await client.from("football_sync_config").update({
      enabled,
      updated_at: this.clock().toISOString(),
      updated_by: actor
    }).eq("id", 1);
    if (error && !OPTIONAL_SCHEMA_ERROR.test(error.message || "")) assertNoError(error, "Actualizar acceso API-Football");
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
    const [used, providerStates] = await Promise.all([this.usageToday(), this.loadProviderStates()]);
    const quota = getQuotaState(used, config);
    const apiState = providerStates.get("api-football") || {};
    const espnState = providerStates.get("espn") || {};
    return {
      enabled: config.enabled,
      configured: this.apiClient.configured,
      fallbackConfigured: this.fallbackClient.configured,
      fallbackActive: espnState.access_available !== false,
      migrationRequired: this.migrationRequired,
      mode: quota.mode,
      used: quota.used,
      remaining: quota.remaining,
      dailyLimit: quota.totalLimit,
      limited: quota.mode === "critical" || quota.mode === "emergency",
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      apiAccessAvailable: apiState.access_available ?? null,
      apiAccessCheckedAt: apiState.access_checked_at || null,
      apiAccessReason: apiState.access_reason || null,
      apiBackoffUntil: apiState.backoff_until || null,
      espnLastSuccessAt: espnState.last_success_at || null,
      espnLastAttemptAt: espnState.last_attempt_at || null,
      espnLastError: espnState.last_error || null,
      espnBackoffUntil: espnState.backoff_until || null,
      espnConsecutiveFailures: Number(espnState.consecutive_failures || 0)
    };
  }

  async adminState() {
    const client = this.getClient();
    const [config, status, providerStates] = await Promise.all([this.loadConfig(), this.publicStatus(), this.loadProviderStates()]);
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
    return { config, status, providers: [...providerStates.values()], matches: matches || [], usage: usage || [] };
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
    let liveChanged = false;

    if (ACTIVE_API_STATUSES.has(apiStatus)) {
      if (isAutomaticResultProtected(match)) {
        updates.sync_error = "Actualizacion en vivo omitida: prevalece el resultado manual.";
      } else if (match.status !== "finished") {
        liveChanged = match.live_home_goals !== homeGoals || match.live_away_goals !== awayGoals || match.status !== "live";
        updates.live_home_goals = homeGoals;
        updates.live_away_goals = awayGoals;
        updates.live_source = "api-football";
        updates.status = "live";
        updates.home_goals = null;
        updates.away_goals = null;
        updates.source = null;
        updates.confirmed_at = null;
        updates.qualified_team = null;
        updates.decided_by_penalties = false;
        updates.home_penalties = null;
        updates.away_penalties = null;
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
      const qualifiedTeam = match.stage === "group" ? null : winnerFromFixture(match, fixture, apiStatus);
      const decidedByPenalties = match.stage !== "group" && apiStatus === "PEN";
      const homePenalties = decidedByPenalties ? penaltyScoreFromFixture(fixture, "home") : null;
      const awayPenalties = decidedByPenalties ? penaltyScoreFromFixture(fixture, "away") : null;
      const resultDiffers = match.home_goals !== homeGoals ||
        match.away_goals !== awayGoals ||
        match.status !== "finished" ||
        (match.qualified_team || null) !== qualifiedTeam ||
        Boolean(match.decided_by_penalties) !== decidedByPenalties;
      if (resultDiffers && !providerCanReplaceFinal(match, "api-football")) {
        updates.sync_error = "Resultado API diferente; prevalece una fuente manual de mayor prioridad.";
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
        updates.live_source = null;
        updates.home_penalties = homePenalties;
        updates.away_penalties = awayPenalties;
        if (match.stage !== "group") {
          updates.qualified_team = qualifiedTeam;
          updates.decided_by_penalties = decidedByPenalties;
        } else {
          updates.qualified_team = null;
          updates.decided_by_penalties = false;
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
    return { row: data, finalChanged, liveChanged, firstFinal, priority };
  }

  async maybeProbeApiAccess(config, currentState = {}, trigger = "scheduler") {
    const now = this.clock();
    const checkedAt = currentState.access_checked_at ? new Date(currentState.access_checked_at).getTime() : 0;
    const backoffUntil = currentState.backoff_until ? new Date(currentState.backoff_until).getTime() : 0;
    if (checkedAt && now.getTime() - checkedAt < 24 * 60 * 60 * 1000) return currentState;
    if (backoffUntil && now.getTime() < backoffUntil) return currentState;
    if (!this.apiClient.configured) {
      return this.saveProviderState("api-football", {
        access_checked_at: now.toISOString(),
        access_available: false,
        access_reason: "API_FOOTBALL_KEY no esta configurada.",
        last_error: "API_FOOTBALL_KEY no esta configurada.",
        backoff_until: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
      });
    }

    const attemptedAt = now.toISOString();
    try {
      const result = await this.apiClient.probeSeasonAccess(config.leagueId, config.season, utcDate(now));
      await this.recordUsage({ endpoint: "/fixtures:access-probe", trigger, success: true, responseCount: result.results });
      await this.setApiEnabled(true, "access-probe");
      const state = await this.saveProviderState("api-football", {
        last_attempt_at: attemptedAt,
        last_success_at: attemptedAt,
        last_error: null,
        consecutive_failures: 0,
        backoff_until: null,
        access_checked_at: attemptedAt,
        access_available: true,
        access_reason: `Acceso confirmado para league=${config.leagueId}, season=${config.season}.`
      });
      await insertLog("api-football.access", "ok", state.access_reason, { trigger, results: result.results });
      return state;
    } catch (error) {
      const denied = ACCESS_DENIED_ERROR.test(error.message || "");
      const retryMs = denied ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
      await this.recordUsage({
        endpoint: "/fixtures:access-probe",
        trigger,
        success: false,
        responseStatus: error.status,
        error: error.message,
        payload: error.apiErrors || null
      });
      if (denied) await this.setApiEnabled(false, "access-probe");
      const state = await this.saveProviderState("api-football", {
        last_attempt_at: attemptedAt,
        last_error: error.message,
        consecutive_failures: Number(currentState.consecutive_failures || 0) + 1,
        backoff_until: new Date(now.getTime() + retryMs).toISOString(),
        access_checked_at: denied ? attemptedAt : currentState.access_checked_at || null,
        access_available: denied ? false : currentState.access_available ?? null,
        access_reason: error.message
      });
      await insertLog("api-football.access", denied ? "unavailable" : "error", error.message, {
        trigger,
        retryAt: state.backoff_until,
        apiErrors: error.apiErrors || null
      });
      return state;
    }
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

  async runEspnFallback({ trigger = "scheduler", matches = null, config = DEFAULT_SYNC_CONFIG, providerState = {}, force = false } = {}) {
    if (!this.fallbackClient.configured) return { provider: "espn", requests: 0, processed: 0, finalChanged: 0, reason: "not_configured" };
    const client = this.getClient();
    if (!matches) {
      const { data, error } = await client.from("match_results").select("*");
      assertNoError(error, "Leer partidos para respaldo ESPN");
      matches = data || [];
    }
    const decision = espnPollingDecision(matches, config, providerState, this.clock());
    if (!decision.due && !force) {
      return { provider: "espn", requests: 0, processed: 0, finalChanged: 0, reason: decision.reason, dueAt: decision.dueAt };
    }
    if (!decision.active.length) {
      return { provider: "espn", requests: 0, processed: 0, finalChanged: 0, reason: "idle", dueAt: decision.nextWindowAt };
    }

    const attemptedAt = this.clock().toISOString();
    const dates = new Set(decision.active.flatMap((match) => espnScoreboardDatesForMatch(match.match_date)));
    await this.saveProviderState("espn", { last_attempt_at: attemptedAt });
    const fixtures = [];
    try {
      for (const date of dates) fixtures.push(...await this.fallbackClient.fetchDate(date));
      providerState = await this.saveProviderState("espn", {
        last_attempt_at: attemptedAt,
        last_success_at: this.clock().toISOString(),
        last_error: null,
        consecutive_failures: 0,
        backoff_until: null,
        access_available: true,
        access_reason: "Respaldo ESPN disponible."
      });
    } catch (error) {
      const failures = Number(providerState.consecutive_failures || 0) + 1;
      const backoffMinutes = progressiveBackoffMinutes(failures);
      const retryAt = new Date(this.clock().getTime() + backoffMinutes * 60_000).toISOString();
      await this.saveProviderState("espn", {
        last_attempt_at: attemptedAt,
        last_error: error.message,
        consecutive_failures: failures,
        backoff_until: retryAt,
        access_available: false,
        access_reason: error.message
      });
      await insertLog("espn.sync", "error", error.message, { trigger, failures, retryAt });
      return { provider: "espn", requests: dates.size, processed: 0, finalChanged: 0, error: error.message, retryAt };
    }

    let processed = 0;
    let finalChanged = 0;
    for (const fixture of fixtures) {
      const fixtureTime = new Date(fixture.date).getTime();
      const match = decision.active.find((candidate) =>
        Math.abs(new Date(candidate.match_date).getTime() - fixtureTime) <= 4 * 60 * 60 * 1000 &&
        canonicalTeam(candidate.home_team) === canonicalTeam(fixture.homeTeam) &&
        canonicalTeam(candidate.away_team) === canonicalTeam(fixture.awayTeam)
      );
      if (!match) continue;
      const updatedAt = this.clock().toISOString();
      const nextEspnAt = decision.intervalMinutes
        ? new Date(this.clock().getTime() + decision.intervalMinutes * 60_000).toISOString()
        : null;
      const updates = {
        espn_event_id: fixture.id,
        espn_status: fixture.status,
        espn_last_synced_at: updatedAt,
        espn_next_sync_at: nextEspnAt,
        raw_payload: { provider: "espn", event_id: fixture.id, status: fixture.status, detail: fixture.detail }
      };
      let final = false;
      let resultChanged = false;

      if (["LIVE", "HT"].includes(fixture.status) && Number.isInteger(fixture.homeGoals) && Number.isInteger(fixture.awayGoals)) {
        if (!isAutomaticResultProtected(match)) {
          updates.live_home_goals = fixture.homeGoals;
          updates.live_away_goals = fixture.awayGoals;
          updates.live_source = "espn";
          updates.status = "live";
          updates.home_goals = null;
          updates.away_goals = null;
          updates.source = null;
          updates.confirmed_at = null;
          updates.qualified_team = null;
          updates.decided_by_penalties = false;
          updates.home_penalties = null;
          updates.away_penalties = null;
          resultChanged = match.live_home_goals !== fixture.homeGoals || match.live_away_goals !== fixture.awayGoals || match.status !== "live";
        }
      } else if (fixture.status === "FT" && Number.isInteger(fixture.homeGoals) && Number.isInteger(fixture.awayGoals)) {
        final = true;
        if (providerCanReplaceFinal(match, "espn")) {
          let qualifiedTeam = null;
          let decidedByPenalties = false;
          if (match.stage !== "group") {
            if (fixture.homeGoals > fixture.awayGoals) qualifiedTeam = match.home_team;
            else if (fixture.awayGoals > fixture.homeGoals) qualifiedTeam = match.away_team;
            else if (Number.isInteger(fixture.homePenalties) && Number.isInteger(fixture.awayPenalties) && fixture.homePenalties !== fixture.awayPenalties) {
              qualifiedTeam = fixture.homePenalties > fixture.awayPenalties ? match.home_team : match.away_team;
              decidedByPenalties = true;
            } else if (fixture.winnerTeam) {
              qualifiedTeam = canonicalTeam(fixture.winnerTeam) === canonicalTeam(match.home_team) ? match.home_team :
                canonicalTeam(fixture.winnerTeam) === canonicalTeam(match.away_team) ? match.away_team : null;
              decidedByPenalties = Boolean(qualifiedTeam && fixture.homeGoals === fixture.awayGoals);
            }
          }
          if (match.stage === "group" || qualifiedTeam) {
            Object.assign(updates, {
              home_goals: fixture.homeGoals,
              away_goals: fixture.awayGoals,
              status: "finished",
              source: "espn",
              manual_override: false,
              confirmed_at: updatedAt,
              last_updated: updatedAt,
              live_home_goals: fixture.homeGoals,
              live_away_goals: fixture.awayGoals,
              live_source: null,
              qualified_team: qualifiedTeam,
              decided_by_penalties: decidedByPenalties,
              home_penalties: decidedByPenalties ? fixture.homePenalties : null,
              away_penalties: decidedByPenalties ? fixture.awayPenalties : null
            });
            resultChanged = true;
            finalChanged += 1;
          } else {
            updates.sync_error = "ESPN marco el partido final, pero no informo el clasificado de la eliminatoria.";
          }
        } else if (match.status === "finished" && (match.home_goals !== fixture.homeGoals || match.away_goals !== fixture.awayGoals)) {
          updates.sync_error = "ESPN difiere del resultado final confirmado; se conserva el ultimo resultado valido.";
        }
      }

      const { data: row, error: updateError } = await client
        .from("match_results")
        .update(updates)
        .eq("match_id", match.match_id)
        .select("*")
        .single();
      assertNoError(updateError, `Actualizar ${match.match_id} desde ESPN`);
      if (!resultChanged) continue;
      processed += 1;
      this.io?.emit("match:updated", {
        at: updatedAt,
        matchId: match.match_id,
        groupCode: String(match.match_id).match(/^G-([A-L])-/)?.[1] || null,
        row,
        final
      });
    }
    if (finalChanged) await recalculateAllScores();
    if (processed) this.io?.emit("scores:updated", { at: this.clock().toISOString(), source: "espn" });
    await insertLog("espn.sync", "ok", `${processed} partido(s) actualizados desde ESPN.`, {
      trigger,
      requests: dates.size,
      processed,
      finalChanged,
      intervalMinutes: decision.intervalMinutes
    });
    return { provider: "espn", requests: dates.size, processed, finalChanged, lastSuccessAt: providerState.last_success_at };
  }

  async runOnce({ trigger = "scheduler", forceMatchIds = [] } = {}) {
    if (this.running) return { ok: false, skipped: "locked", message: "Ya hay una sincronizacion en curso." };
    this.running = true;
    this.lastError = null;
    let fallbackResult = null;
    try {
      let config = await this.loadConfig();
      const providerStates = await this.loadProviderStates();
      if (this.migrationRequired) return { ok: false, skipped: "migration_required" };
      const client = this.getClient();
      const { data: matches, error } = await client.from("match_results").select("*");
      assertNoError(error, "Leer partidos para sincronizar");

      const apiState = await this.maybeProbeApiAccess(config, providerStates.get("api-football") || {}, trigger);
      config = { ...config, enabled: apiState.access_available === true };
      const activity = providerActivity(matches || [], config, this.clock());
      fallbackResult = await this.runEspnFallback({
        trigger,
        matches: matches || [],
        config,
        providerState: providerStates.get("espn") || {}
      });
      this.lastRunAt = this.clock().toISOString();
      if (!activity.shouldPoll && !forceMatchIds.length) {
        return { ok: true, reason: "idle_no_live_or_upcoming", nextWindowAt: activity.nextWindowAt, espn: fallbackResult };
      }
      if (!this.apiClient.configured) return { ok: true, apiFootballSkipped: "api_key_missing", espn: fallbackResult };
      if (!config.enabled && !forceMatchIds.length) {
        return { ok: true, apiFootballSkipped: "season_unavailable", apiAccessReason: apiState.access_reason, espn: fallbackResult };
      }
      const apiBackoffUntil = apiState.backoff_until ? new Date(apiState.backoff_until).getTime() : 0;
      if (apiBackoffUntil > this.clock().getTime() && !forceMatchIds.length) {
        return { ok: true, apiFootballSkipped: "provider_backoff", apiBackoffUntil: apiState.backoff_until, espn: fallbackResult };
      }

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
        return { ok: true, requests: 0, reason: "no_due_matches", quota: selection.quota, espn: fallbackResult };
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
          await this.saveProviderState("api-football", {
            last_attempt_at: this.clock().toISOString(),
            last_success_at: this.clock().toISOString(),
            last_error: null,
            consecutive_failures: 0,
            backoff_until: null,
            access_available: true
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
          const accessDenied = ACCESS_DENIED_ERROR.test(apiError.message || "");
          if (accessDenied) await this.setApiEnabled(false, "runtime-access-error");
          await this.saveProviderState("api-football", {
            last_attempt_at: this.clock().toISOString(),
            last_error: apiError.message,
            consecutive_failures: Number(apiState.consecutive_failures || 0) + 1,
            backoff_until: retryAt,
            access_checked_at: accessDenied ? this.clock().toISOString() : apiState.access_checked_at || null,
            access_available: accessDenied ? false : apiState.access_available ?? null,
            access_reason: accessDenied ? apiError.message : apiState.access_reason || null
          });
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

      const finalScoresChanged = processed.some((item) => item.finalChanged);
      const liveScoresChanged = processed.some((item) => item.liveChanged);
      if (finalScoresChanged) {
        await recalculateAllScores();
      }
      if (finalScoresChanged || liveScoresChanged) {
        this.io?.emit("scores:updated", {
          at: this.clock().toISOString(),
          source: "api-football",
          provisional: liveScoresChanged && !finalScoresChanged
        });
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
      return { ok: true, requests, processed: processed.length, quota: selection.quota, scorersUpdated, espn: fallbackResult };
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
