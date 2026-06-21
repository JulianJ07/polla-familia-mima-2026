const DEFAULT_BASE_URL = "https://v3.football.api-sports.io";

export class ApiFootballError extends Error {
  constructor(message, { status = null, apiErrors = null, endpoint = null } = {}) {
    super(message);
    this.name = "ApiFootballError";
    this.status = status;
    this.apiErrors = apiErrors;
    this.endpoint = endpoint;
  }
}

function errorMessage(errors) {
  if (!errors) return "Error desconocido de API-Football.";
  if (typeof errors === "string") return errors;
  if (Array.isArray(errors)) return errors.join(" ");
  return Object.values(errors).filter(Boolean).join(" ") || "Error desconocido de API-Football.";
}

export class ApiFootballClient {
  constructor({
    apiKey = process.env.API_FOOTBALL_KEY,
    baseUrl = process.env.API_FOOTBALL_BASE_URL || DEFAULT_BASE_URL,
    rapidApiHost = process.env.API_FOOTBALL_RAPIDAPI_HOST,
    fetchImpl = globalThis.fetch
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.rapidApiHost = rapidApiHost;
    this.fetchImpl = fetchImpl;
  }

  get configured() {
    return Boolean(this.apiKey && this.fetchImpl);
  }

  async request(endpoint, params = {}) {
    if (!this.configured) throw new ApiFootballError("API_FOOTBALL_KEY no esta configurada en el backend.", { endpoint });
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    const headers = this.rapidApiHost
      ? { "x-rapidapi-key": this.apiKey, "x-rapidapi-host": this.rapidApiHost }
      : { "x-apisports-key": this.apiKey };
    let response;
    try {
      response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      throw new ApiFootballError(`No se pudo conectar con API-Football: ${error.message}`, { endpoint });
    }
    const payload = await response.json().catch(() => ({}));
    const hasApiErrors = payload.errors && Object.keys(payload.errors).length > 0;
    if (!response.ok || hasApiErrors) {
      throw new ApiFootballError(
        hasApiErrors ? errorMessage(payload.errors) : `API-Football respondio HTTP ${response.status}.`,
        { status: response.status, apiErrors: payload.errors || null, endpoint }
      );
    }
    return {
      rows: Array.isArray(payload.response) ? payload.response : [],
      results: Number(payload.results || 0),
      paging: payload.paging || null,
      rateLimitRemaining: Number(response.headers.get("x-ratelimit-requests-remaining")) || null,
      rateLimitLimit: Number(response.headers.get("x-ratelimit-requests-limit")) || null
    };
  }

  fetchFixturesByIds(fixtureIds) {
    const ids = [...new Set((fixtureIds || []).map(Number).filter(Number.isFinite))];
    if (!ids.length) return Promise.resolve({ rows: [], results: 0 });
    return this.request("/fixtures", { ids: ids.join("-") });
  }

  fetchTournamentFixtures(leagueId, season) {
    return this.request("/fixtures", { league: leagueId, season });
  }

  fetchTopScorers(leagueId, season) {
    return this.request("/players/topscorers", { league: leagueId, season });
  }
}
