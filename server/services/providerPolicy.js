import { ACTIVE_API_STATUSES, PRIORITIES, determinePriority, pollingIntervalMinutes } from "./syncPolicy.js";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const EXPECTED_MATCH_WINDOW_MS = 4 * 60 * 60 * 1000;

function timestamp(value) {
  const result = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(result) ? result : null;
}

export function isLiveProviderMatch(match) {
  if (match?.status === "finished") return false;
  return match?.status === "live" ||
    ACTIVE_API_STATUSES.has(String(match?.api_status || "").toUpperCase()) ||
    ["LIVE", "HT"].includes(String(match?.espn_status || "").toUpperCase());
}

export function providerActivity(matches, config, nowInput = new Date()) {
  const now = timestamp(nowInput) ?? Date.now();
  const eligible = (matches || [])
    .filter((match) => match.status !== "finished")
    .map((match) => ({ ...match, priority: determinePriority(match, config) }));
  const live = eligible.filter(isLiveProviderMatch);
  const started = eligible.filter((match) => {
    const start = timestamp(match.match_date);
    return start != null && start <= now && now <= start + EXPECTED_MATCH_WINDOW_MS;
  });
  const upcoming = eligible.filter((match) => {
    const start = timestamp(match.match_date);
    return start != null && start >= now && start <= now + TWO_HOURS_MS;
  });
  const active = [...new Map([...live, ...started, ...upcoming].map((match) => [match.match_id, match])).values()]
    .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority));
  const nextMatchAt = eligible
    .map((match) => timestamp(match.match_date))
    .filter((start) => start != null && start > now)
    .sort((a, b) => a - b)[0] || null;
  return {
    shouldPoll: active.length > 0,
    live,
    started,
    upcoming,
    active,
    highestPriority: active[0]?.priority || null,
    nextMatchAt: nextMatchAt ? new Date(nextMatchAt).toISOString() : null,
    nextWindowAt: nextMatchAt ? new Date(Math.max(now, nextMatchAt - TWO_HOURS_MS)).toISOString() : null
  };
}

function upcomingIntervalMinutes(match, now) {
  const start = timestamp(match.match_date);
  const minutes = start == null ? Number.POSITIVE_INFINITY : Math.max(0, (start - now) / 60_000);
  if (minutes > 60) return 30;
  if (minutes > 30) return 15;
  if (minutes > 8) return 10;
  return { P0: 3, P1: 3, P2: 5, P3: 10 }[match.priority] || 10;
}

export function espnPollingDecision(matches, config, providerState = {}, nowInput = new Date()) {
  const now = timestamp(nowInput) ?? Date.now();
  const activity = providerActivity(matches, config, now);
  const backoffUntil = timestamp(providerState.backoff_until ?? providerState.backoffUntil);
  if (backoffUntil && now < backoffUntil) {
    return { ...activity, due: false, reason: "backoff", dueAt: new Date(backoffUntil).toISOString() };
  }
  if (!activity.shouldPoll) {
    return { ...activity, due: false, reason: "idle", dueAt: activity.nextWindowAt };
  }
  const liveIntervals = activity.live.map((match) => pollingIntervalMinutes(
    match.priority,
    match.api_status || (match.espn_status === "HT" ? "HT" : "1H"),
    match.api_elapsed,
    "normal"
  ));
  const startedIntervals = activity.started.map((match) => pollingIntervalMinutes(
    match.priority,
    match.api_status || "1H",
    match.api_elapsed,
    "normal"
  ));
  const upcomingIntervals = activity.upcoming.map((match) => upcomingIntervalMinutes(match, now));
  const intervalMinutes = Math.min(...liveIntervals, ...startedIntervals, ...upcomingIntervals);
  const lastAttempt = timestamp(providerState.last_attempt_at ?? providerState.lastAttemptAt);
  const dueAt = lastAttempt ? lastAttempt + intervalMinutes * 60_000 : now;
  return {
    ...activity,
    due: now >= dueAt,
    reason: activity.live.length ? "live" : activity.started.length ? "started" : "upcoming",
    intervalMinutes,
    dueAt: new Date(dueAt).toISOString()
  };
}

export function progressiveBackoffMinutes(failureCount) {
  return Math.min(60, 2 ** Math.max(1, Number(failureCount || 1)));
}
