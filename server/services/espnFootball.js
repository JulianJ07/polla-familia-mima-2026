const DEFAULT_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

export class EspnFootballError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = "EspnFootballError";
    this.status = status;
  }
}

function normalizeStatus(type = {}) {
  const name = String(type.name || "").toUpperCase();
  const state = String(type.state || "").toLowerCase();
  if (type.completed || name.includes("FULL_TIME") || name.includes("FINAL")) return "FT";
  if (name.includes("HALFTIME")) return "HT";
  if (state === "in" || name.includes("IN_PROGRESS")) return "LIVE";
  if (name.includes("POSTPONED")) return "PST";
  if (name.includes("CANCELED") || name.includes("CANCELLED")) return "CANC";
  return "NS";
}

function normalizedEvent(event) {
  const competition = event?.competitions?.[0];
  const competitors = competition?.competitors || [];
  const home = competitors.find((entry) => entry.homeAway === "home");
  const away = competitors.find((entry) => entry.homeAway === "away");
  if (!home?.team?.displayName || !away?.team?.displayName) return null;
  return {
    id: String(event.id || ""),
    date: event.date || competition?.date || null,
    status: normalizeStatus(event.status?.type || competition?.status?.type),
    detail: event.status?.type?.detail || competition?.status?.type?.detail || null,
    homeTeam: home.team.displayName,
    awayTeam: away.team.displayName,
    homeGoals: Number.isFinite(Number(home.score)) ? Number(home.score) : null,
    awayGoals: Number.isFinite(Number(away.score)) ? Number(away.score) : null
  };
}

export class EspnFootballClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  get configured() {
    return Boolean(this.fetchImpl);
  }

  async fetchDate(date) {
    const url = new URL(this.baseUrl);
    url.searchParams.set("dates", String(date).replaceAll("-", ""));
    let response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      throw new EspnFootballError(`No se pudo conectar con ESPN: ${error.message}`);
    }
    if (!response.ok) throw new EspnFootballError(`ESPN respondio HTTP ${response.status}.`, { status: response.status });
    const payload = await response.json().catch(() => ({}));
    return (Array.isArray(payload.events) ? payload.events : []).map(normalizedEvent).filter(Boolean);
  }
}
