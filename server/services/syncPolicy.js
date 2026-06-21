export const ACTIVE_API_STATUSES = new Set(["1H", "HT", "2H", "ET", "P", "BT"]);
export const FINAL_API_STATUSES = new Set(["FT", "AET", "PEN"]);
export const SPECIAL_API_STATUSES = new Set(["PST", "CANC", "ABD"]);
export const PRIORITIES = ["P0", "P1", "P2", "P3"];

export const DEFAULT_SYNC_CONFIG = {
  enabled: false,
  dailySoftLimit: 90,
  emergencyReserve: 10,
  colombiaTeamName: "Colombia",
  popularTeams: [
    "Brazil",
    "Argentina",
    "Mexico",
    "United States",
    "France",
    "Spain",
    "England",
    "Germany",
    "Portugal",
    "Netherlands",
    "Italy"
  ],
  favoriteTeams: [],
  manualFeaturedFixtureIds: [],
  leagueId: 1,
  season: 2026,
  maxFixturesPerRequest: 20
};

export function normalizeTeamName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeSyncConfig(row = {}) {
  return {
    enabled: row.enabled === true,
    dailySoftLimit: Number(row.daily_soft_limit ?? row.dailySoftLimit ?? DEFAULT_SYNC_CONFIG.dailySoftLimit),
    emergencyReserve: Number(row.emergency_reserve ?? row.emergencyReserve ?? DEFAULT_SYNC_CONFIG.emergencyReserve),
    colombiaTeamName: row.colombia_team_name || row.colombiaTeamName || DEFAULT_SYNC_CONFIG.colombiaTeamName,
    popularTeams: Array.isArray(row.popular_teams ?? row.popularTeams)
      ? (row.popular_teams ?? row.popularTeams)
      : DEFAULT_SYNC_CONFIG.popularTeams,
    favoriteTeams: Array.isArray(row.favorite_teams ?? row.favoriteTeams)
      ? (row.favorite_teams ?? row.favoriteTeams)
      : DEFAULT_SYNC_CONFIG.favoriteTeams,
    manualFeaturedFixtureIds: Array.isArray(row.manual_featured_fixture_ids ?? row.manualFeaturedFixtureIds)
      ? (row.manual_featured_fixture_ids ?? row.manualFeaturedFixtureIds).map(Number).filter(Number.isFinite)
      : [],
    leagueId: Number(row.league_id ?? row.leagueId ?? DEFAULT_SYNC_CONFIG.leagueId),
    season: Number(row.season ?? DEFAULT_SYNC_CONFIG.season),
    maxFixturesPerRequest: Number(row.maxFixturesPerRequest || DEFAULT_SYNC_CONFIG.maxFixturesPerRequest)
  };
}

function hasTeam(match, teamName) {
  const expected = normalizeTeamName(teamName);
  return Boolean(expected && [match.home_team, match.away_team].some((team) => normalizeTeamName(team) === expected));
}

function hasAnyTeam(match, teams) {
  const expected = new Set((teams || []).map(normalizeTeamName));
  return [match.home_team, match.away_team].some((team) => expected.has(normalizeTeamName(team)));
}

function hasTwoTeams(match, teams) {
  const expected = new Set((teams || []).map(normalizeTeamName));
  return [match.home_team, match.away_team].filter((team) => expected.has(normalizeTeamName(team))).length === 2;
}

function groupMatchNumber(match) {
  const value = String(match.match_id || "").match(/^G-[A-L]-(\d+)$/i)?.[1];
  return value ? Number(value) : null;
}

export function determinePriority(match, configInput = DEFAULT_SYNC_CONFIG) {
  const config = normalizeSyncConfig(configInput);
  if (PRIORITIES.includes(match.priority_override)) return match.priority_override;
  const manuallyFeatured = match.featured === true || config.manualFeaturedFixtureIds.includes(Number(match.api_fixture_id));
  if (
    manuallyFeatured ||
    hasTeam(match, config.colombiaTeamName) ||
    match.stage === "final" ||
    match.stage === "sf" ||
    (match.stage === "group" && [5, 6].includes(groupMatchNumber(match)))
  ) return "P0";
  if (
    ["r32", "r16", "qf", "third"].includes(match.stage) ||
    hasAnyTeam(match, config.favoriteTeams) ||
    (match.stage === "group" && hasTwoTeams(match, config.popularTeams))
  ) return "P1";
  if (match.stage === "group" && [3, 4].includes(groupMatchNumber(match))) return "P2";
  return "P3";
}

export function getQuotaState(used, configInput = DEFAULT_SYNC_CONFIG) {
  const config = normalizeSyncConfig(configInput);
  const totalLimit = Math.min(100, config.dailySoftLimit + config.emergencyReserve);
  const remaining = Math.max(0, totalLimit - Number(used || 0));
  const mode = remaining >= 30
    ? "normal"
    : remaining >= 20
      ? "saving"
      : remaining >= 10
        ? "critical"
        : "emergency";
  return { used: Number(used || 0), remaining, totalLimit, mode };
}

export function modeAllowsLivePriority(mode, priority) {
  if (mode === "normal") return true;
  if (mode === "saving") return priority !== "P3";
  if (mode === "critical") return priority === "P0";
  return false;
}

export function pollingIntervalMinutes(priority, apiStatus, elapsed, mode = "normal") {
  if (!modeAllowsLivePriority(mode, priority)) return Number.POSITIVE_INFINITY;
  if (apiStatus === "HT") {
    if (priority === "P0") return 10;
    if (priority === "P1") return 15;
    return mode === "saving" ? 45 : priority === "P2" ? 20 : 45;
  }
  if (mode === "critical") return 10;
  if (mode === "saving") {
    return { P0: 5, P1: 10, P2: 45 }[priority] ?? Number.POSITIVE_INFINITY;
  }
  if (priority === "P0") return Number(elapsed || 0) >= 70 ? 2 : 5;
  if (priority === "P1") return Number(elapsed || 0) >= 70 ? 5 : 10;
  if (priority === "P2") return Number(elapsed || 0) >= 70 ? 10 : 20;
  return 45;
}

export function finalConfirmationMinutes(priority) {
  if (priority === "P0") return [3, 12];
  if (priority === "P1") return [5];
  return [10];
}

function milliseconds(minutes) {
  return minutes * 60 * 1000;
}

function timestamp(value) {
  const result = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(result) ? result : null;
}

export function getSyncDueState(match, nowInput, mode = "normal") {
  const now = timestamp(nowInput) ?? Date.now();
  const start = timestamp(match.match_date);
  if (!match.api_fixture_id || !start || SPECIAL_API_STATUSES.has(match.api_status)) {
    return { due: false, reason: "not_eligible", confirmation: false };
  }
  const priority = PRIORITIES.includes(match.priority) ? match.priority : "P3";
  const lastSynced = timestamp(match.last_synced_at);
  const nextSync = timestamp(match.next_sync_at);

  if (match.api_final_at && FINAL_API_STATUSES.has(match.api_status)) {
    const schedule = finalConfirmationMinutes(priority);
    const confirmationIndex = Number(match.final_confirmation_count || 0);
    if (confirmationIndex >= schedule.length) return { due: false, reason: "confirmed", confirmation: true };
    const scheduledConfirmation = timestamp(match.api_final_at) + milliseconds(schedule[confirmationIndex]);
    const dueAt = Math.max(scheduledConfirmation, nextSync || 0);
    return { due: now >= dueAt, dueAt, reason: "final_confirmation", confirmation: true };
  }

  if (match.status === "finished") return { due: false, reason: "already_final", confirmation: false };

  const preStart = start - milliseconds(8);
  if (now < preStart) return { due: false, dueAt: preStart, reason: "before_window", confirmation: false };
  if (now < start) {
    return {
      due: !lastSynced || lastSynced < preStart,
      dueAt: preStart,
      reason: "pre_match",
      confirmation: false
    };
  }

  const expectedEnd = start + milliseconds(130);
  if (priority === "P3" && !ACTIVE_API_STATUSES.has(match.api_status) && now >= expectedEnd) {
    const firstCheck = expectedEnd + milliseconds(10);
    const lastCheck = expectedEnd + milliseconds(20);
    if (now >= firstCheck && (!lastSynced || lastSynced < firstCheck)) {
      return { due: true, dueAt: firstCheck, reason: "expected_final_first", confirmation: true };
    }
    if (now >= lastCheck && (!lastSynced || lastSynced < lastCheck)) {
      return { due: true, dueAt: lastCheck, reason: "expected_final_last", confirmation: true };
    }
    return { due: false, reason: "p3_checks_complete", confirmation: true };
  }

  const interval = pollingIntervalMinutes(priority, match.api_status, match.api_elapsed, mode);
  if (!Number.isFinite(interval)) return { due: false, reason: "quota_mode", confirmation: false };
  const dueAt = nextSync || (lastSynced ? lastSynced + milliseconds(interval) : now);
  return { due: now >= dueAt, dueAt, reason: ACTIVE_API_STATUSES.has(match.api_status) ? "live" : "started", confirmation: false };
}

export function nextSyncAt(match, nowInput, mode = "normal") {
  const now = timestamp(nowInput) ?? Date.now();
  if (FINAL_API_STATUSES.has(match.api_status)) {
    const schedule = finalConfirmationMinutes(match.priority);
    const index = Number(match.final_confirmation_count || 0);
    const finalAt = timestamp(match.api_final_at) || now;
    return index < schedule.length ? new Date(finalAt + milliseconds(schedule[index])).toISOString() : null;
  }
  if (SPECIAL_API_STATUSES.has(match.api_status)) return null;
  const interval = pollingIntervalMinutes(match.priority, match.api_status, match.api_elapsed, mode);
  return Number.isFinite(interval) ? new Date(now + milliseconds(interval)).toISOString() : null;
}

function isSimultaneousPollingWindow(match, now) {
  const start = timestamp(match.match_date);
  if (!start || match.status === "finished" || SPECIAL_API_STATUSES.has(match.api_status)) return false;
  return now >= start - milliseconds(8) && now <= start + milliseconds(240);
}

export function selectSyncBatches(matches, configInput, used, nowInput = new Date()) {
  const config = normalizeSyncConfig(configInput);
  const quota = getQuotaState(used, config);
  const now = timestamp(nowInput) ?? Date.now();
  const prioritized = (matches || [])
    .filter((match) => match.api_fixture_id)
    .map((match) => ({ ...match, priority: determinePriority(match, config) }));
  const due = prioritized
    .map((match) => ({ match, dueState: getSyncDueState(match, now, quota.mode) }))
    .filter(({ dueState }) => dueState.due);
  if (!due.length || quota.remaining <= 0) return { batches: [], quota, prioritized, due: [] };

  const hasDueLive = due.some(({ dueState }) => !dueState.confirmation);
  const simultaneous = hasDueLive
    ? prioritized.filter((match) => isSimultaneousPollingWindow(match, now) && modeAllowsLivePriority(quota.mode, match.priority))
    : [];
  const selectedById = new Map();
  for (const item of due) selectedById.set(Number(item.match.api_fixture_id), item.match);
  for (const match of simultaneous) selectedById.set(Number(match.api_fixture_id), match);
  const selected = [...selectedById.values()].sort((a, b) =>
    PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
    String(a.match_date).localeCompare(String(b.match_date))
  );
  const highestPriority = selected[0]?.priority || "P3";
  const batches = [];
  for (let index = 0; index < selected.length; index += config.maxFixturesPerRequest) {
    if (batches.length >= quota.remaining) break;
    batches.push(selected.slice(index, index + config.maxFixturesPerRequest));
  }
  return { batches, quota, prioritized, due, highestPriority };
}
