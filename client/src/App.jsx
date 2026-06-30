import {
  Activity,
  Armchair,
  BarChart3,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  Crown,
  Goal,
  Lock,
  Maximize2,
  Medal,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Swords,
  Table2,
  Target,
  Trophy,
  UserRound,
  XCircle
} from "lucide-react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { adminGet, adminPatch, adminPost, apiGet } from "./api.js";
import stadiumImage from "./assets/stadium-night.png";

const stages = [
  ["all", "Todos"],
  ["group", "Grupos"],
  ["r32", "R32"],
  ["r16", "Octavos"],
  ["qf", "Cuartos"],
  ["sf", "Semis"],
  ["third", "3er puesto"],
  ["final", "Final"]
];

const participantFilters = [
  ["all", "Todos los partidos"],
  ["group", "Fase de grupos"],
  ["r32", "Ronda 32"],
  ["r16", "Octavos"],
  ["qf", "Cuartos"],
  ["sf", "Semifinales"],
  ["final", "Final"],
  ["individual", "Premiaciones individuales"],
  ["bracket", "Llaves"]
];

const navItems = [
  { id: "table", label: "Tabla", icon: Table2 },
  { id: "matches", label: "Partidos", icon: Swords },
  { id: "groups", label: "Grupos", icon: BarChart3 },
  { id: "bracket", label: "Llaves", icon: Shield },
  { id: "awards", label: "Goleadores", icon: Goal }
];

const viewPaths = {
  table: "/",
  matches: "/partidos",
  groups: "/grupos",
  bracket: "/llaves",
  awards: "/goleadores",
  admin: "/admin"
};

function viewFromPath(pathname) {
  const found = Object.entries(viewPaths).find(([, path]) => path === pathname);
  return found?.[0] || "table";
}

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const TEAM_FLAG_CODES = {
  mexico: "MX", sudafrica: "ZA", corea: "KR", chequia: "CZ", canada: "CA", bosnia: "BA", catar: "QA", suiza: "CH",
  brasil: "BR", marruecos: "MA", haiti: "HT", escocia: "GB-SCT", usa: "US", paraguay: "PY", australia: "AU", turquia: "TR",
  alemania: "DE", curazao: "CW", "costa marfil": "CI", ecuador: "EC", holanda: "NL", japon: "JP", suecia: "SE", tunez: "TN",
  belgica: "BE", egipto: "EG", iran: "IR", "n zelanda": "NZ", espana: "ES", "cabo verde": "CV", "a saudita": "SA", uruguay: "UY",
  francia: "FR", senegal: "SN", irak: "IQ", noruega: "NO", argentina: "AR", argelia: "DZ", austria: "AT", jordania: "JO",
  portugal: "PT", "rd congo": "CD", uzbekistan: "UZ", colombia: "CO", inglaterra: "GB-ENG", croacia: "HR", ghana: "GH", panama: "PA"
};

function teamFlagCode(team) {
  return TEAM_FLAG_CODES[normalizeSearchText(team)] || "";
}

function teamFlagUrl(team) {
  const code = teamFlagCode(team);
  return code ? `https://flagcdn.com/w40/${code.toLowerCase()}.png` : "";
}

function TeamFlag({ team, className = "" }) {
  const flagUrl = teamFlagUrl(team);
  const fallback = (teamFlagCode(team) || "--").slice(0, 2);

  return (
    <span className={cx("team-flag", className)} aria-hidden="true">
      {flagUrl ? <img src={flagUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="team-flag-fallback">{fallback}</span>}
    </span>
  );
}

function formatPoints(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function timeAgo(value) {
  if (!value) return "sin calcular";
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return "sin calcular";
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} dias`;
}

function formatColombiaDate(value) {
  if (!value) return "Horario por confirmar";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horario por confirmar";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

function formatBracketDate(value) {
  if (!value) return "Horario por confirmar";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horario por confirmar";
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = String(byType.weekday || "")
    .replace(/\.$/, "")
    .toLowerCase();
  const period = String(byType.dayPeriod || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace("a.m.", "a.m")
    .replace("p.m.", "p.m");
  return `${weekday}, ${byType.day}-${byType.month} ${byType.hour}:${byType.minute} ${period}`.trim();
}

function formatColombiaDay(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(date);
}

function formatColombiaDateTime(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const period = String(byType.dayPeriod || "")
    .toLowerCase()
    .replace(/\s?a\.\s?m\./i, "a.m.")
    .replace(/\s?p\.\s?m\./i, "p.m.");
  return `${byType.day} ${byType.month} ${byType.year}, ${byType.hour}:${byType.minute} ${period}`.trim();
}

function colombiaParts(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateOnlyColombia(value) {
  const parts = colombiaParts(value);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const GROUP_MATCH_DURATION_MS = 2 * 60 * 60 * 1000;
const KNOCKOUT_MATCH_DURATION_MS = 3.5 * 60 * 60 * 1000;

function expectedMatchDurationMs(match) {
  return ["r32", "r16", "qf", "sf", "third", "final"].includes(match?.stage)
    ? KNOCKOUT_MATCH_DURATION_MS
    : GROUP_MATCH_DURATION_MS;
}

function matchStartTime(match) {
  const start = new Date(match?.match_date).getTime();
  return Number.isNaN(start) ? null : start;
}

function isMatchToday(match, now = Date.now()) {
  return Boolean(match?.match_date) && dateOnlyColombia(match.match_date) === dateOnlyColombia(now);
}

function isMatchInCurrentRound(match, now = Date.now()) {
  const start = matchStartTime(match);
  if (start == null) return false;
  const currentDay = dateOnlyColombia(now);
  return dateOnlyColombia(start) === currentDay || dateOnlyColombia(start + expectedMatchDurationMs(match)) === currentDay;
}

function isMatchPlaying(match, now = Date.now()) {
  if (match?.status === "finished") return false;
  const start = matchStartTime(match);
  return start != null && now >= start && now < start + expectedMatchDurationMs(match);
}

function sortMatchesForDisplay(a, b, now = Date.now()) {
  const startA = matchStartTime(a) ?? Number.POSITIVE_INFINITY;
  const startB = matchStartTime(b) ?? Number.POSITIVE_INFINITY;
  const todayA = isMatchInCurrentRound(a, now);
  const todayB = isMatchInCurrentRound(b, now);
  const playingA = isMatchPlaying(a, now);
  const playingB = isMatchPlaying(b, now);

  if (playingA !== playingB) return playingA ? -1 : 1;
  if (todayA !== todayB) return todayA ? -1 : 1;

  if (todayA && todayB) return startA - startB;

  const futureA = startA >= now;
  const futureB = startB >= now;
  if (futureA !== futureB) return futureA ? -1 : 1;
  return futureA ? startA - startB : startB - startA;
}

function datetimeLocalColombia(value) {
  const parts = colombiaParts(value);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function colombiaDateTimeToIso(value) {
  if (!value) return null;
  return new Date(`${value}:00-05:00`).toISOString();
}

function groupCodeFromMatch(match) {
  const [, groupCode] = String(match?.match_id || "").match(/^G-([A-L])-/i) || [];
  return groupCode?.toUpperCase() || "";
}

function AnimatedNumber({ value }) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (latest) => formatPoints(latest));

  useEffect(() => {
    const controls = animate(motionValue, Number(value || 0), {
      duration: 0.8,
      ease: "easeOut"
    });
    return controls.stop;
  }, [motionValue, value]);

  return <motion.span>{rounded}</motion.span>;
}

function StatusPill({ status, playing = false }) {
  const config = playing ? ["Jugando", "status-playing"] : ({
    finished: ["Finalizado", "status-finished"],
    scheduled: ["Programado", "status-scheduled"]
  }[status] || ["Pendiente", "status-scheduled"]);
  return <span className={cx("status-pill", config[1])}>{config[0]}</span>;
}

function AppShell({ activeView, setActiveView, meta, onRefresh, refreshing, children }) {
  return (
    <div className="app-shell min-h-screen text-ink">
      <header className="app-header">
        <div className="app-header-inner">
          <button className="brand-mark" type="button" aria-label="Torneo">
            <Trophy size={22} />
          </button>
          <div className="brand-copy">
            <span className="brand-kicker">Triple ola 2026</span>
            <h1 className="brand-title">Polla Familia Mima 2026</h1>
            <p className="brand-subtitle">{meta.currentPhase || "Previa del torneo"}</p>
          </div>
          <button
            className="icon-button header-action"
            type="button"
            onClick={onRefresh}
            title="Actualizar"
            aria-label="Actualizar"
          >
            <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
          </button>
          <button
            className={cx("icon-button header-action", activeView === "admin" && "icon-button-active")}
            type="button"
            onClick={() => setActiveView("admin")}
            title="Admin"
            aria-label="Admin"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <aside className="app-nav-shell">
        <nav className="app-nav" aria-label="Navegacion principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                className={cx("nav-button", active && "nav-button-active")}
                onClick={() => setActiveView(item.id)}
                type="button"
                title={item.label}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}

function LeaderboardView({ leaderboard, meta, onSelectParticipant, selectedParticipant, participantDetail }) {
  const lastUpdate = leaderboard[0]?.lastCalculated || meta.lastCalculated;
  const hasLiveScores = leaderboard.some((row) => Number(row.liveMatchCount || 0) > 0);
  return (
    <>
      <section className="hero-section">
        <img className="hero-stadium" src={stadiumImage} alt="" />
        <div className="hero-overlay" />
        <div className="hero-content">
          <div className="hero-heading">
            <div>
              <p className="eyebrow">Tabla de posiciones</p>
              <h2 className="hero-title">Marcador familiar</h2>
            </div>
            <div className="hero-meta-card">
              <CalendarClock size={16} />
              <span>{hasLiveScores ? "Puntos provisionales en vivo" : `Actualizado ${timeAgo(lastUpdate)}`}</span>
            </div>
          </div>

          <div className="leaderboard-shell">
            <div className="leaderboard-table">
              <div className="leaderboard-header">
                <span>Posicion</span>
                <span>Nombre</span>
                <span>Puntos</span>
                <span className="leaderboard-stat-col">Exactos</span>
                <span className="leaderboard-stat-col">Parciales</span>
                <span className="leaderboard-stat-col">Jugados</span>
              </div>
              <div className="divide-y divide-white/8">
                {leaderboard.map((row, index) => (
                  <motion.button
                    key={row.id}
                    type="button"
                    aria-pressed={selectedParticipant === row.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, delay: Math.min(index, 8) * 0.025 }}
                    className={cx(
                      "leaderboard-row",
                      row.position === 1 && "rank-gold",
                      row.position === 2 && "rank-silver",
                      row.position === 3 && "rank-bronze",
                      selectedParticipant === row.id && "leaderboard-row-selected"
                    )}
                    onClick={() => onSelectParticipant(row.id)}
                  >
                    <span className="flex items-center gap-2 font-black text-white">
                      #{row.position}
                      {row.position === 1 && (
                        <motion.span animate={{ rotate: [-8, 8, -8] }} transition={{ duration: 1.8, repeat: Infinity }}>
                          <Crown className="text-gold" size={19} />
                        </motion.span>
                      )}
                    </span>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="player-avatar">
                        {row.name.slice(0, 1)}
                      </span>
                      <span className="truncate text-left font-extrabold text-white">{row.name}</span>
                      {row.position === 12 && (
                        <span className="special-chip">
                          <Armchair size={13} /> Doceavo
                        </span>
                      )}
                    </span>
                    <span className="leaderboard-points-cell font-display text-4xl text-gold">
                      <AnimatedNumber value={row.totalPoints} />
                      {row.liveMatchCount > 0 && (
                        <small className="live-points-chip">
                          {row.provisionalPoints > 0 ? `+${row.provisionalPoints} en vivo` : "En vivo"}
                        </small>
                      )}
                    </span>
                    <span className="leaderboard-metric leaderboard-stat-col">
                      <strong>{row.exactHits || 0}</strong>
                      <small>exactos</small>
                    </span>
                    <span className="leaderboard-metric leaderboard-stat-col">
                      <strong>{row.partialHits || 0}</strong>
                      <small>parciales</small>
                    </span>
                    <span className="leaderboard-metric leaderboard-stat-col">
                      <strong>{row.matchesPlayed || 0}</strong>
                      <small>jugados</small>
                    </span>
                    <span className="leaderboard-mobile-stats">
                      <span><strong>{row.exactHits || 0}</strong> exactos</span>
                      <span><strong>{row.partialHits || 0}</strong> parciales</span>
                      <span><strong>{row.matchesPlayed || 0}</strong> jugados</span>
                    </span>
                  </motion.button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 py-5 lg:grid-cols-[340px_minmax(0,1fr)]">
            <CategoryPodium leaderboard={leaderboard.slice(0, 3)} />
            <ParticipantPanel detail={participantDetail} />
          </div>
        </div>
      </section>
    </>
  );
}

function CategoryPodium({ leaderboard }) {
  return (
    <div className="panel">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="section-title">Podio</h3>
        <Medal className="text-gold" size={21} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {leaderboard.map((row) => (
          <div
            key={row.id}
            className={cx(
              "stat-tile podium-tile",
              row.position === 1 && "podium-gold",
              row.position === 2 && "podium-silver",
              row.position === 3 && "podium-bronze"
            )}
          >
            <span className="text-xs font-black uppercase text-muted">#{row.position}</span>
            <strong className="truncate text-lg text-white">{row.name}</strong>
            <span className="font-display text-4xl text-gold">{formatPoints(row.totalPoints)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ParticipantPanel({ detail }) {
  const [detailFilter, setDetailFilter] = useState("all");
  const [matchDateFilter, setMatchDateFilter] = useState("all");
  const [matchGroupFilter, setMatchGroupFilter] = useState("all");
  const dateInputRef = useRef(null);

  useEffect(() => {
    setDetailFilter("all");
    setMatchDateFilter("all");
    setMatchGroupFilter("all");
  }, [detail?.participant?.id]);

  useEffect(() => {
    if (!["all", "group"].includes(detailFilter)) setMatchGroupFilter("all");
  }, [detailFilter]);

  if (!detail) {
    return (
      <div className="panel grid min-h-44 place-items-center text-center text-sm font-semibold text-muted">
        <UserRound className="mb-3 text-mint" size={28} />
        Selecciona un participante
      </div>
    );
  }

  const predictions = detail.predictions || [];
  const activeMatchFilter = ["all", "group", "r32", "r16", "qf", "sf", "third", "final"].includes(detailFilter);
  const selectedDayLabel = matchDateFilter === "all" ? "Todos los dias" : formatColombiaDay(`${matchDateFilter}T12:00:00-05:00`);
  const groupOptions = [...new Set(predictions.map(groupCodeFromMatch).filter(Boolean))].sort();
  const groupFilterAvailable = ["all", "group"].includes(detailFilter);
  const groupFilterLabel = !groupFilterAvailable ? "No aplica para esta fase" : matchGroupFilter === "all" ? "Todos los grupos" : `Grupo ${matchGroupFilter}`;
  const stageFilteredPredictions =
    detailFilter === "all" ? predictions : activeMatchFilter ? predictions.filter((item) => item.stage === detailFilter) : [];
  const visiblePredictions = stageFilteredPredictions.filter((item) => {
    const dateOk = matchDateFilter === "all" || dateOnlyColombia(item.match_date) === matchDateFilter;
    const groupOk = matchGroupFilter === "all" || (item.stage === "group" && groupCodeFromMatch(item) === matchGroupFilter);
    return dateOk && groupOk;
  });
  const groups = (detail.groups || []).reduce((acc, row) => {
    acc[row.group_code] ||= [];
    acc[row.group_code].push(row);
    return acc;
  }, {});
  const stageBuckets = visiblePredictions.reduce((acc, item) => {
    const label = item.stageLabel || item.stage;
    acc[label] ||= [];
    acc[label].push(item);
    return acc;
  }, {});
  const hits = predictions.filter((item) => item.verdict === "hit").length;
  const misses = predictions.filter((item) => item.verdict === "miss").length;

  function openDatePicker(event) {
    if (event.target?.closest?.("button")) return;
    const input = dateInputRef.current;
    if (!input) return;
    input.focus();
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
      } catch {
        input.focus();
      }
    }
  }

  return (
    <div className="panel participant-panel">
      <div className="mb-4 flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="section-title truncate">{detail.participant.name}</h3>
          <p className="text-sm font-semibold text-muted">{formatPoints(detail.totalPoints)} puntos</p>
          {detail.liveMatchCount > 0 && <span className="live-points-chip">{detail.provisionalPoints > 0 ? `+${formatPoints(detail.provisionalPoints)} en vivo` : "En vivo"}</span>}
        </div>
        <BarChart3 className="text-mint" />
      </div>

      <div className="participant-summary-grid">
        <div className="mini-stat">
          <span>{formatPoints(detail.totalPoints)}</span>
          <small>puntos</small>
        </div>
        <div className="mini-stat">
          <span>{hits}</span>
          <small>aciertos cerrados</small>
        </div>
        <div className="mini-stat">
          <span>{misses}</span>
          <small>fallos cerrados</small>
        </div>
        <div className="mini-stat">
          <span>{predictions.length}</span>
          <small>pronosticos</small>
        </div>
      </div>

      <div className="participant-filter-tabs">
        {participantFilters.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={cx("participant-filter-button", detailFilter === id && "participant-filter-button-active")}
            onClick={() => setDetailFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {detailFilter === "group" && <GroupPredictionSection groups={groups} />}
      {detailFilter === "individual" && <IndividualAwardsPanel detail={detail} />}
      {detailFilter === "bracket" && <ParticipantBracketPreview predictions={predictions} />}
      {activeMatchFilter && (
        <div className="prediction-section">
          <div className="prediction-section-title">
            <h4>Partidos</h4>
            <span>{visiblePredictions.length} marcadores</span>
          </div>
          <div className="participant-match-filters">
            <label className="participant-match-filter">
              Dia
              <span className="participant-date-input-wrap" onClick={openDatePicker}>
                <CalendarDays size={16} />
                <input
                  ref={dateInputRef}
                  type="date"
                  value={matchDateFilter === "all" ? "" : matchDateFilter}
                  onInput={(event) => setMatchDateFilter(event.currentTarget.value || "all")}
                  onChange={(event) => setMatchDateFilter(event.target.value || "all")}
                  aria-label="Filtrar por dia"
                />
                {matchDateFilter !== "all" && (
                  <button type="button" onClick={() => setMatchDateFilter("all")} aria-label="Limpiar dia">
                    <XCircle size={15} />
                  </button>
                )}
              </span>
              <small>{selectedDayLabel}</small>
            </label>
            <label className="participant-match-filter">
              Grupo
              <select
                value={matchGroupFilter}
                onChange={(event) => setMatchGroupFilter(event.target.value)}
                disabled={!groupFilterAvailable}
              >
                <option value="all">{groupFilterAvailable ? "Todos los grupos" : "No aplica"}</option>
                {groupOptions.map((groupCode) => (
                  <option key={groupCode} value={groupCode}>Grupo {groupCode}</option>
                ))}
              </select>
              <small>{groupFilterLabel}</small>
            </label>
          </div>
          <PredictionList stageBuckets={stageBuckets} />
        </div>
      )}
    </div>
  );
}

function GroupPredictionSection({ groups }) {
  return (
    <div className="prediction-section">
      <div className="prediction-section-title">
        <h4>Grupos</h4>
        <span>verde si coincide la posicion actual/final</span>
      </div>
      <div className="group-prediction-grid">
        {Object.entries(groups).map(([groupCode, rows]) => (
          <article key={groupCode} className="group-prediction-card">
            <div className="mb-2 flex items-center justify-between">
              <strong>Grupo {groupCode}</strong>
              <span className="text-xs font-black text-muted">
                {rows[0]?.group_finished_matches || 0}/{rows[0]?.group_total_matches || 6}
              </span>
            </div>
            <div className="space-y-2">
              {rows.map((row) => {
                const groupHasResults = Number(row.group_finished_matches || 0) > 0;
                return (
                  <div key={`${groupCode}-${row.predicted_position}`} className={cx("prediction-row", `prediction-${row.verdict}`)}>
                    <span className="prediction-rank">#{row.predicted_position}</span>
                    <span className="min-w-0 flex-1 truncate font-extrabold text-white">{row.team_code}</span>
                    <span className="text-right text-xs font-bold text-muted">
                      {groupHasResults && row.actual_position ? `real #${row.actual_position} - ${row.actual_points} pts` : "pendiente"}
                    </span>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function PredictionList({ stageBuckets }) {
  const entries = Object.entries(stageBuckets);
  if (!entries.length) {
    return (
      <div className="rounded-md border border-white/10 bg-white/6 p-4 text-sm font-bold text-muted">
        No hay pronosticos en este filtro.
      </div>
    );
  }

  return (
    <div className="prediction-stage-stack">
      {entries.map(([label, items]) => (
        <div key={label}>
          <p className="mb-2 text-xs font-black uppercase text-mint">{label}</p>
          <div className="prediction-list">
            {items.map((item) => (
              <article key={item.match_id} className={cx("prediction-card", `prediction-${item.verdict}`)}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-black text-muted">{item.match_id}</span>
                    <span className="text-xs font-bold text-muted">{formatColombiaDate(item.match_date)}</span>
                  </div>
                  <p className="mt-1 truncate font-extrabold text-white">
                    {item.predicted_home_team || item.home_team || "Local"} vs {item.predicted_away_team || item.away_team || "Visitante"}
                  </p>
                  <p className="truncate text-xs font-semibold text-muted">
                    Real: {item.home_team || "Pendiente"} vs {item.away_team || "Pendiente"} - {item.actual_score || "sin resultado"}
                  </p>
                </div>
                <div className="prediction-score">
                  <strong>{item.predicted_score}</strong>
                  <small>{item.reason}</small>
                  <span>{formatPoints(item.points)} pts</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IndividualAwardsPanel({ detail }) {
  const awards = detail.individualAwards || [];
  const leaders = detail.topScorerLeaders || [];
  return (
    <div className="prediction-section">
      <div className="prediction-section-title">
        <h4>Premiaciones individuales</h4>
        <span>sin fotos, solo estado de la apuesta</span>
      </div>
      <div className="individual-awards-grid">
        {awards.map((award) => {
          const label = award.status === "hit" ? "Gano" : award.status === "miss" ? "Perdio" : "En juego";
          return (
            <article key={award.key} className={cx("individual-award-card", `award-state-${award.status}`)}>
              <p className="text-xs font-black uppercase text-muted">{award.label}</p>
              <strong className="truncate text-white">{award.displayValue || award.value || "-"}</strong>
              <span className="individual-award-status">{label}</span>
              <small>{formatPoints(award.points || 0)} pts</small>
            </article>
          );
        })}
      </div>
      {!!leaders.length && (
        <div className="mt-3 rounded-md border border-white/10 bg-white/6 p-3 text-xs font-bold text-muted">
          Lider goleador actual: {leaders.map((player) => `${player.player_name} (${player.goals})`).join(", ")}
        </div>
      )}
    </div>
  );
}

function predictionToBracketMatch(item) {
  return {
    match_id: item.match_id,
    home_team: item.predicted_home_team || "Local",
    away_team: item.predicted_away_team || "Visitante",
    home_goals: item.predicted_home_goals,
    away_goals: item.predicted_away_goals,
    status: item.status || "scheduled",
    match_date: item.match_date
  };
}

const BRACKET_VISUAL_ORDER = {
  r32Left: ["M3", "M4", "M1", "M10", "M9", "M2", "M11", "M12"],
  r16Left: ["O1", "O2", "O3", "O4"],
  qfLeft: ["Q1", "Q2"],
  sfLeft: ["S1"],
  sfRight: ["S2"],
  qfRight: ["Q3", "Q4"],
  r16Right: ["O5", "O6", "O7", "O8"],
  r32Right: ["M6", "M5", "M8", "M7", "M14", "M16", "M15", "M13"]
};

function orderMatchesById(matches = [], order = []) {
  const byId = new Map(matches.map((match) => [String(match.match_id || ""), match]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean);
  return ordered.length || order.length ? ordered : matches;
}

function buildBracketColumns(byStage) {
  const r32 = byStage.r32 || [];
  const r16 = byStage.r16 || [];
  const qf = byStage.qf || [];
  const sf = byStage.sf || [];

  return [
    { label: "16avos", matches: orderMatchesById(r32, BRACKET_VISUAL_ORDER.r32Left), side: "left", stage: "r32" },
    { label: "8avos", matches: orderMatchesById(r16, BRACKET_VISUAL_ORDER.r16Left), side: "left", stage: "r16" },
    { label: "4tos", matches: orderMatchesById(qf, BRACKET_VISUAL_ORDER.qfLeft), side: "left", stage: "qf" },
    { label: "Semis", matches: orderMatchesById(sf, BRACKET_VISUAL_ORDER.sfLeft), side: "left", stage: "sf" },
    { label: "Semis", matches: orderMatchesById(sf, BRACKET_VISUAL_ORDER.sfRight), side: "right", stage: "sf" },
    { label: "4tos", matches: orderMatchesById(qf, BRACKET_VISUAL_ORDER.qfRight), side: "right", stage: "qf" },
    { label: "8avos", matches: orderMatchesById(r16, BRACKET_VISUAL_ORDER.r16Right), side: "right", stage: "r16" },
    { label: "16avos", matches: orderMatchesById(r32, BRACKET_VISUAL_ORDER.r32Right), side: "right", stage: "r32" }
  ];
}

function ParticipantBracketPreview({ predictions }) {
  const byStage = predictions
    .filter((item) => ["r32", "r16", "qf", "sf", "third", "final"].includes(item.stage))
    .reduce((acc, item) => {
      acc[item.stage] ||= [];
      acc[item.stage].push(predictionToBracketMatch(item));
      return acc;
    }, {});

  const hasBracket = Object.values(byStage).some((items) => items.length);
  if (!hasBracket) {
    return (
      <div className="prediction-section">
        <div className="rounded-md border border-white/10 bg-white/6 p-4 text-sm font-bold text-muted">
          Este participante no tiene llaves cargadas.
        </div>
      </div>
    );
  }

  const columns = buildBracketColumns(byStage);

  return (
    <div className="prediction-section">
      <div className="prediction-section-title">
        <h4>Llaves</h4>
        <span>prediccion individual del participante</span>
      </div>
      <div className="participant-bracket-viewport">
        <div className="tournament-bracket participant-tournament">
          {columns.slice(0, 4).map((column) => (
            <BracketColumn key={`${column.side}-${column.stage}`} {...column} />
          ))}
          <div className="tournament-center">
            <h3>FINAL</h3>
            <div className="final-pedestal">
              <div>
                <h4>Final</h4>
                <BracketMatchCard match={(byStage.final || [])[0]} compact />
              </div>
              <div>
                <h4>3er puesto</h4>
                <BracketMatchCard match={(byStage.third || [])[0]} compact />
              </div>
            </div>
          </div>
          {columns.slice(4).map((column) => (
            <BracketColumn key={`${column.side}-${column.stage}`} {...column} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MatchCard({ match, index, clockNow, onSelect }) {
  const playing = isMatchPlaying(match, clockNow);
  const today = isMatchToday(match, clockNow);

  return (
    <motion.button
      type="button"
      className={cx(
        "match-card match-card-button",
        playing ? "match-playing" : `match-${match.status || "scheduled"}`,
        today && "match-today"
      )}
      onClick={() => onSelect(match.match_id)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: Math.min(index, 10) * 0.018 }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="match-stage">{match.stageLabel}</span>
        <StatusPill status={match.status} playing={playing} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs font-bold text-muted">
        <CalendarClock size={14} />
        <span>{formatColombiaDate(match.match_date)}</span>
        {today && <span className="today-chip">Hoy</span>}
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <strong className="truncate text-right text-white">{match.home_team}</strong>
        <span className="score-box">
          {match.display_home_goals == null ? "-" : match.display_home_goals} : {match.display_away_goals == null ? "-" : match.display_away_goals}
        </span>
        <strong className="truncate text-white">{match.away_team}</strong>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="mini-stat">
          <span>{match.prediction_count || 0}</span>
          <small>pronosticos</small>
        </div>
        <div className="mini-stat">
          <span>{match.exact_count || 0}</span>
          <small>marcadores exactos</small>
        </div>
        <div className="mini-stat">
          <span>{match.result_count || 0}</span>
          <small>resultados acertados</small>
        </div>
      </div>
    </motion.button>
  );
}

function MatchesView({ matches, stage, setStage, openMatchId, onOpenMatchHandled }) {
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [matchDetail, setMatchDetail] = useState(null);
  const [matchDetailBusy, setMatchDetailBusy] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const groupOptions = useMemo(() => {
    const options = [...new Set(matches.map(groupCodeFromMatch).filter(Boolean))].sort();
    return ["all", ...options];
  }, [matches]);
  const filtered = useMemo(() => {
    const search = normalizeSearchText(query);
    return matches
      .filter((match) => {
        const stageOk = stage === "all" || match.stage === stage;
        if (!stageOk) return false;
        const groupOk = groupFilter === "all" || groupCodeFromMatch(match) === groupFilter;
        if (!groupOk) return false;
        if (!search) return true;
        return normalizeSearchText(`${match.home_team} ${match.away_team} ${match.stageLabel} ${match.match_id}`).includes(search);
      })
      .sort((a, b) => sortMatchesForDisplay(a, b, clockNow));
  }, [clockNow, groupFilter, matches, query, stage]);
  const currentRoundMatches = filtered.filter((match) => isMatchInCurrentRound(match, clockNow));
  const remainingMatches = filtered.filter((match) => !isMatchInCurrentRound(match, clockNow));

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (stage !== "group") setGroupFilter("all");
  }, [stage]);

  useEffect(() => {
    if (!openMatchId) return;
    setSelectedMatchId(openMatchId);
    onOpenMatchHandled?.();
  }, [onOpenMatchHandled, openMatchId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedMatchId) {
      setMatchDetail(null);
      return undefined;
    }

    setMatchDetailBusy(true);
    apiGet(`/matches/${encodeURIComponent(selectedMatchId)}/predictions`)
      .then((data) => {
        if (!cancelled) setMatchDetail(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setMatchDetail({
            error: error.message,
            match: matches.find((match) => match.match_id === selectedMatchId) || null,
            rows: []
          });
        }
      })
      .finally(() => {
        if (!cancelled) setMatchDetailBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [matches, selectedMatchId]);

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Partidos</p>
          <h2 className="page-title">Resultados vs pronosticos</h2>
        </div>
        <label className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" />
        </label>
      </div>

      <div className="stage-tabs">
        {stages.map(([id, label]) => (
          <button key={id} className={cx("tab-button", stage === id && "tab-button-active")} onClick={() => setStage(id)} type="button">
            {label}
          </button>
        ))}
      </div>

      {stage === "group" && groupOptions.length > 1 && (
        <div className="group-filter-tabs">
          {groupOptions.map((groupCode) => (
            <button
              key={groupCode}
              className={cx("group-filter-button", groupFilter === groupCode && "group-filter-button-active")}
              onClick={() => setGroupFilter(groupCode)}
              type="button"
            >
              {groupCode === "all" ? "Todos" : groupCode}
            </button>
          ))}
        </div>
      )}

      {!!currentRoundMatches.length && (
        <div className="match-section match-section-today">
          <div className="match-section-heading">
            <div>
              <p className="eyebrow">Jornada actual</p>
              <h3>Partidos de hoy</h3>
            </div>
            <span>{currentRoundMatches.length} partidos</span>
          </div>
          <div className="match-grid match-grid-today">
            {currentRoundMatches.map((match, index) => (
              <MatchCard key={match.match_id} match={match} index={index} clockNow={clockNow} onSelect={setSelectedMatchId} />
            ))}
          </div>
        </div>
      )}

      {!!remainingMatches.length && (
        <div className="match-section">
          <div className="match-section-heading match-section-heading-secondary">
            <h3>{currentRoundMatches.length ? "Proximos y anteriores" : "Partidos"}</h3>
            <span>{remainingMatches.length} partidos</span>
          </div>
          <div className="match-grid">
            {remainingMatches.map((match, index) => (
              <MatchCard key={match.match_id} match={match} index={index} clockNow={clockNow} onSelect={setSelectedMatchId} />
            ))}
          </div>
        </div>
      )}

      {selectedMatchId && (
        <MatchDetailModal
          detail={matchDetail}
          busy={matchDetailBusy}
          onClose={() => setSelectedMatchId(null)}
        />
      )}
    </section>
  );
}

function MatchStatusIcon({ status }) {
  if (status === "exacto") return <Target size={17} />;
  if (status === "parcial") return <CheckCircle2 size={17} />;
  if (status === "fallo") return <XCircle size={17} />;
  return <Minus size={17} />;
}

function MatchDetailModal({ detail, busy, onClose }) {
  const [participantSearch, setParticipantSearch] = useState("");
  const match = detail?.match;
  const finished = match?.status === "finished" && match.home_goals != null && match.away_goals != null;
  const matchRows = detail?.rows || [];
  const participantSearchText = normalizeSearchText(participantSearch);
  const visibleRows = participantSearchText
    ? matchRows.filter((row) => normalizeSearchText(row.name).includes(participantSearchText))
    : matchRows;

  useEffect(() => {
    setParticipantSearch("");
  }, [match?.match_id]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <motion.div
        className="match-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Detalle de pronosticos del partido"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="match-detail-header">
          <div className="min-w-0">
            <p className="eyebrow">{match?.stageLabel || "Partido"}</p>
            <h3 className="section-title truncate">
              {match ? `${match.home_team || "Local"} vs ${match.away_team || "Visitante"}` : "Cargando partido"}
            </h3>
            <p className="text-sm font-bold text-muted">{formatColombiaDate(match?.match_date)}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Cerrar" aria-label="Cerrar">
            <XCircle size={18} />
          </button>
        </div>

        <div className="match-detail-score">
          <span>{finished ? `${match.home_goals}-${match.away_goals}` : "Programado / sin resultado"}</span>
          <small>{match?.match_id || ""}</small>
        </div>

        <div className="match-detail-tools">
          <label className="match-detail-search">
            <Search size={16} />
            <input
              value={participantSearch}
              onChange={(event) => setParticipantSearch(event.target.value)}
              placeholder="Buscar participante"
            />
          </label>
          <span>{busy ? "cargando" : `${visibleRows.length}/${matchRows.length} visibles`}</span>
        </div>

        {detail?.error && (
          <div className="rounded-md border border-red-300/20 bg-red-400/10 p-3 text-sm font-bold text-red-100">
            {detail.error}
          </div>
        )}

        <div className="match-detail-table-wrap">
          <div className="match-detail-table">
            <div className="match-detail-row match-detail-row-head">
              <span>Participante</span>
              <span>Pronostico</span>
              <span>Resultado</span>
              <span>Puntos</span>
            </div>
            {busy && (
              <div className="match-detail-empty">Cargando pronosticos...</div>
            )}
            {!busy && visibleRows.map((row) => (
              <div key={row.participantId} className={cx("match-detail-row", `match-prediction-${row.status}`)}>
                <span className="truncate font-extrabold text-white">{row.name}</span>
                <span className="min-w-0">
                  {row.prediction ? (
                    <>
                      <strong>{row.prediction.score}</strong>
                      <small>{row.prediction.homeTeam || "Local"} vs {row.prediction.awayTeam || "Visitante"}</small>
                    </>
                  ) : (
                    <strong>-</strong>
                  )}
                </span>
                <span className="match-detail-status">
                  <MatchStatusIcon status={row.status} />
                  {row.statusLabel}
                </span>
                <span className="font-display text-2xl text-gold">{formatPoints(row.points)}</span>
              </div>
            ))}
            {!busy && !visibleRows.length && (
              <div className="match-detail-empty">
                {participantSearchText ? "No hay participantes que coincidan con la busqueda." : "No hay datos de pronosticos para este partido."}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function BracketMatchCard({ match, compact = false }) {
  const homeScore = match?.home_goals;
  const awayScore = match?.away_goals;
  const hasScore = homeScore != null && awayScore != null;
  const penalties = match?.decided_by_penalties && match.home_penalties != null && match.away_penalties != null
    ? `Pen. ${match.home_penalties}-${match.away_penalties}`
    : null;

  function teamRow(team, score, side) {
    const qualified = match?.qualified_team && normalizeSearchText(match.qualified_team) === normalizeSearchText(team);
    return (
      <div className={cx("bracket-team-row", qualified && "qualified")} title={team || ""}>
        <TeamFlag team={team} className="bracket-flag" />
        <span className="bracket-team-name">{team || (side === "home" ? "Local" : "Visitante")}</span>
        <span className="bracket-team-score">{hasScore ? score : "-"}</span>
      </div>
    );
  }

  return (
    <article data-match-id={match?.match_id || undefined} className={cx("bracket-match", compact && "bracket-match-center", `match-${match?.status || "scheduled"}`)}>
      <p className="bracket-date">{formatBracketDate(match?.match_date)}</p>
      <div className="bracket-team-list">
        {teamRow(match?.home_team, homeScore, "home")}
        {teamRow(match?.away_team, awayScore, "away")}
      </div>
      {penalties && <div className="bracket-score">{penalties}</div>}
    </article>
  );
}

function BracketColumn({ label, matches, side, stage }) {
  return (
    <div className={cx("tournament-column", `tournament-${stage}`, side)}>
      <h3>{label}</h3>
      <div className="tournament-slots">
        {matches.map((match) => (
          <div key={match.match_id} className="bracket-slot">
            <BracketMatchCard match={match} />
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketBoard({ columns, finalMatch, thirdMatch, width, height, zoom, complete = false }) {
  return (
    <div
      className={cx("tournament-bracket", complete && "tournament-bracket-complete")}
      style={{ width, minHeight: height, transform: `scale(${zoom})`, "--bracket-zoom": zoom }}
    >
      {columns.slice(0, 4).map((column) => (
        <BracketColumn key={`${column.side}-${column.stage}`} {...column} />
      ))}
      <div className="tournament-center">
        <h3>Mundial 2026</h3>
        <div className="final-pedestal">
          <div className="trophy-core" aria-hidden="true">
            <Trophy size={86} />
            <span>FINAL</span>
          </div>
          <div>
            <h4>Final</h4>
            <BracketMatchCard match={finalMatch} compact />
          </div>
          <div>
            <h4>3er puesto</h4>
            <BracketMatchCard match={thirdMatch} compact />
          </div>
        </div>
      </div>
      {columns.slice(4).map((column) => (
        <BracketColumn key={`${column.side}-${column.stage}`} {...column} />
      ))}
    </div>
  );
}

function BracketView({ bracket }) {
  const [zoom, setZoom] = useState(0.76);
  const [showComplete, setShowComplete] = useState(false);
  const [completeZoom, setCompleteZoom] = useState(0.46);
  const r32 = bracket.r32 || [];
  const r16 = bracket.r16 || [];
  const qf = bracket.qf || [];
  const sf = bracket.sf || [];
  const finalMatch = bracket.final?.[0];
  const thirdMatch = bracket.third?.[0];
  const finishedR32 = r32.filter((match) => match.status === "finished").length;
  const width = 2160;
  const height = 1360;

  const columns = buildBracketColumns({ r32, r16, qf, sf });

  function nudgeZoom(delta) {
    setZoom((current) => Math.min(1.2, Math.max(0.58, Number((current + delta).toFixed(2)))));
  }

  function nudgeCompleteZoom(delta) {
    setCompleteZoom((current) => Math.min(1, Math.max(0.34, Number((current + delta).toFixed(2)))));
  }

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Llaves</p>
          <h2 className="page-title">Camino a la copa</h2>
          <p className="section-subtitle">{finishedR32}/16 partidos de 16avos finalizados</p>
        </div>
        <div className="bracket-heading-actions">
          <button type="button" className="secondary-button bracket-full-button" onClick={() => setShowComplete(true)}>
            <Maximize2 size={16} />
            Ver llaves completas
          </button>
          <div className="zoom-controls">
            <button type="button" className="icon-button" onClick={() => nudgeZoom(-0.08)} title="Alejar" aria-label="Alejar">
              <Minus size={16} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" className="icon-button" onClick={() => nudgeZoom(0.08)} title="Acercar" aria-label="Acercar">
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="bracket-viewport">
        <div className="bracket-zoom-plane" style={{ width: width * zoom, minHeight: height * zoom }}>
          <BracketBoard columns={columns} finalMatch={finalMatch} thirdMatch={thirdMatch} width={width} height={height} zoom={zoom} />
        </div>
      </div>

      {showComplete && (
        <div className="modal-backdrop bracket-fullscreen-backdrop" role="presentation" onMouseDown={() => setShowComplete(false)}>
          <motion.div
            className="bracket-fullscreen-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Llaves completas"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="bracket-fullscreen-header">
              <div>
                <p className="eyebrow">Llaves completas</p>
                <h3>Mundial 2026</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowComplete(false)} title="Cerrar" aria-label="Cerrar">
                <XCircle size={18} />
              </button>
            </div>
            <div className="bracket-fullscreen-tools">
              <button type="button" className="icon-button" onClick={() => nudgeCompleteZoom(-0.06)} title="Alejar" aria-label="Alejar llaves completas">
                <Minus size={16} />
              </button>
              <span>{Math.round(completeZoom * 100)}%</span>
              <button type="button" className="icon-button" onClick={() => nudgeCompleteZoom(0.06)} title="Acercar" aria-label="Acercar llaves completas">
                <Plus size={16} />
              </button>
            </div>
            <div className="bracket-complete-viewport">
              <div className="bracket-zoom-plane bracket-complete-plane" style={{ width: width * completeZoom, minHeight: height * completeZoom }}>
                <BracketBoard columns={columns} finalMatch={finalMatch} thirdMatch={thirdMatch} width={width} height={height} zoom={completeZoom} complete />
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </section>
  );
}

function StandingsView({ standings, onOpenMatch }) {
  const groups = standings.groups || [];
  const thirds = standings.bestThirds?.rows || [];
  const definitive = standings.status === "definitive";
  const [selectedGroupCode, setSelectedGroupCode] = useState(null);

  useEffect(() => {
    if (selectedGroupCode && groups.some((group) => group.groupCode === selectedGroupCode)) return;
    setSelectedGroupCode(standings.defaultGroupCode || groups[0]?.groupCode || "A");
  }, [groups, selectedGroupCode, standings.defaultGroupCode]);

  const selectedGroup = groups.find((group) => group.groupCode === selectedGroupCode) || groups[0];
  const syncLimited = standings.sync?.limited;

  if (!selectedGroup) {
    return (
      <section className="page-section standings-page">
        <div className="panel empty-standings">Las tablas de grupos estaran disponibles cuando se carguen los partidos.</div>
      </section>
    );
  }

  return (
    <section className="page-section standings-page">
      <div className="section-heading standings-heading">
        <div>
          <p className="eyebrow">Tabla de posiciones</p>
          <h2 className="page-title">Asi van los grupos</h2>
          <p className="standings-summary">
            {standings.finishedMatches || 0} de {standings.totalMatches || 72} partidos finalizados.
            {!definitive && " Los marcadores en vivo generan posiciones provisionales; la polla solo puntua resultados finales."}
          </p>
          <p className="standings-updated">Actualizado {timeAgo(standings.lastUpdated || standings.at)}</p>
        </div>
        <div className="standings-heading-status">
          <span className={cx("standings-status", definitive && "standings-status-final")}>
            {definitive ? "Definitivo" : "Provisional"}
          </span>
          {syncLimited && <span className="standings-status standings-status-limited">Cuota limitada</span>}
        </div>
      </div>

      <div className="group-selector-shell">
        <label className="group-selector-mobile">
          <span>Consultar grupo</span>
          <select value={selectedGroup.groupCode} onChange={(event) => setSelectedGroupCode(event.target.value)}>
            {groups.map((group) => <option key={group.groupCode} value={group.groupCode}>Grupo {group.groupCode}</option>)}
          </select>
        </label>
        <div className="group-selector-tabs" aria-label="Seleccionar grupo">
          {groups.map((group) => (
            <button
              className={cx("group-selector-button", selectedGroup.groupCode === group.groupCode && "group-selector-button-active")}
              type="button"
              key={group.groupCode}
              onClick={() => setSelectedGroupCode(group.groupCode)}
            >
              {group.groupCode}
              {group.liveMatches > 0 && <span className="group-live-dot" />}
            </button>
          ))}
        </div>
      </div>

      <article className="panel group-card selected-group-card">
        <header className="group-card-heading">
          <div>
            <p className="eyebrow">Grupo {selectedGroup.groupCode}</p>
            <h3 className="section-title">Posiciones</h3>
            {selectedGroup.liveMatches > 0 && <span className="group-live-label">En vivo · posiciones provisionales</span>}
          </div>
          <span className={cx("group-progress", selectedGroup.ready && "group-progress-final")}>
            {selectedGroup.finishedMatches}/{selectedGroup.totalMatches}
          </span>
        </header>
        <div className="group-table" role="table" aria-label={`Posiciones del grupo ${selectedGroup.groupCode}`}>
          <div className="group-table-row group-table-header" role="row">
            <span>Pos</span><span>Seleccion</span><span>PJ</span><span>PG</span><span>PE</span><span>PP</span>
            <span>GF</span><span>GC</span><span>DG</span><span>Pts</span>
          </div>
          {(selectedGroup.rows || []).map((row) => (
            <div className={cx("group-table-row", `qualification-${row.qualification || "out"}`)} role="row" key={`${selectedGroup.groupCode}-${row.team}`}>
              <span className="group-position" data-label="Posicion">#{row.position}{row.tied ? "=" : ""}</span>
              <strong className="group-team" data-label="Seleccion"><TeamFlag team={row.team} />{row.team}</strong>
              <span data-label="PJ">{row.played}</span>
              <span data-label="PG">{row.wins}</span>
              <span data-label="PE">{row.draws}</span>
              <span data-label="PP">{row.losses}</span>
              <span data-label="GF">{row.gf}</span>
              <span data-label="GC">{row.ga}</span>
              <span data-label="DG">{row.gd > 0 ? `+${row.gd}` : row.gd}</span>
              <strong className="group-points" data-label="Pts">{row.points}</strong>
              {row.status === "unresolved" && <small className="group-tie-note">Empate por resolver manualmente</small>}
            </div>
          ))}
        </div>

        <div className="qualification-legend">
          <span><i className="legend-direct" /> Clasifica directamente</span>
          <span><i className="legend-third" /> En zona de mejores terceros</span>
          <span><i className="legend-out" /> Fuera de clasificacion provisional</span>
        </div>

        <div className="group-matches-section">
          <div className="group-matches-heading">
            <h4>Partidos del grupo</h4>
            <span>{selectedGroup.matches?.length || 0} partidos</span>
          </div>
          <div className="group-matches-list">
            {(selectedGroup.matches || []).map((match) => (
              <button className={cx("group-match-row", match.live && "group-match-live", match.special && "group-match-special")} type="button" key={match.matchId} onClick={() => onOpenMatch?.(match.matchId)}>
                <span className="group-match-teams">
                  <TeamFlag team={match.homeTeam} />
                  <span className="group-match-name">{match.homeTeam}</span>
                  <b>vs</b>
                  <span className="group-match-name">{match.awayTeam}</span>
                  <TeamFlag team={match.awayTeam} />
                </span>
                <span className="group-match-date">{formatColombiaDate(match.matchDate)}</span>
                <strong className="group-match-score">{match.homeGoals == null ? "-" : match.homeGoals} : {match.awayGoals == null ? "-" : match.awayGoals}</strong>
                <span className="group-match-state">{match.live ? `En vivo ${match.elapsed || ""}'` : match.special ? match.apiStatus : match.status === "finished" ? "Finalizado" : "Programado"}</span>
              </button>
            ))}
          </div>
        </div>
      </article>

      <article className="panel thirds-panel">
        <div className="thirds-heading">
          <div><p className="eyebrow">Clasificacion</p><h3 className="section-title">Mejores terceros</h3></div>
          <span className="standings-status">{standings.bestThirds?.status === "definitive" ? "Definitivo" : "Provisional"}</span>
        </div>
        {standings.bestThirds?.tiebreakNote && <p className="standings-warning">{standings.bestThirds.tiebreakNote}</p>}
        <div className="thirds-table" role="table" aria-label="Tabla de mejores terceros">
          <div className="thirds-row thirds-header" role="row">
            <span>Pos</span><span>Seleccion</span><span>Grupo</span><span>Pts</span><span>DG</span><span>GF</span><span>Estado</span>
          </div>
          {thirds.map((row) => {
            const inZone = row.inQualificationZone || row.classified === true;
            return (
              <div className={cx("thirds-row", inZone && "thirds-row-in-zone")} role="row" key={`${row.groupCode}-${row.team}`}>
                <strong data-label="Pos">#{row.rank}{row.tied ? "=" : ""}</strong>
                <strong className="group-team" data-label="Seleccion"><TeamFlag team={row.team} />{row.team}</strong>
                <span data-label="Grupo">{row.groupCode}</span><span data-label="Pts">{row.points}</span>
                <span data-label="DG">{row.gd > 0 ? `+${row.gd}` : row.gd}</span><span data-label="GF">{row.gf}</span>
                <span className={cx("third-status", inZone && "third-status-in", !inZone && "third-status-out")} data-label="Estado">
                  {row.status === "unresolved" ? "Por resolver" : inZone ? "En zona" : "Fuera de zona"}
                </span>
              </div>
            );
          })}
        </div>
      </article>
    </section>
  );
}

function AwardsView({ awards }) {
  const [participantQuery, setParticipantQuery] = useState("");
  const leaderGoals = Math.max(1, ...((awards.topScorers || []).map((item) => item.goals)));
  const filteredPredictions = useMemo(() => {
    const search = normalizeSearchText(participantQuery);
    if (!search) return awards.predictions || [];
    return (awards.predictions || []).filter((item) => normalizeSearchText(item.name).includes(search));
  }, [awards.predictions, participantQuery]);

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Goleadores</p>
          <h2 className="page-title">Apuestas individuales</h2>
        </div>
        <label className="search-box awards-search">
          <Search size={17} />
          <input
            value={participantQuery}
            onChange={(event) => setParticipantQuery(event.target.value)}
            placeholder="Buscar participante"
          />
        </label>
      </div>

      <div className="awards-layout">
        <div className="panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="section-title">Tabla de goleadores</h3>
            <Goal className="text-gold" size={26} />
          </div>
          <div className="space-y-3">
            {(awards.topScorers || []).map((player, index) => (
              <div key={player.player_name} className={cx("scorer-row", index === 0 && "scorer-row-leader")}>
                <span className="scorer-rank">#{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold text-white">{player.player_name}</p>
                  <div className="scorer-meter">
                    <div className="scorer-meter-value" style={{ width: `${(player.goals / leaderGoals) * 100}%` }} />
                  </div>
                </div>
                <strong className="font-display text-3xl text-gold">{player.goals}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="panel awards-predictions-panel">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <h3 className="section-title">Participantes</h3>
            <span className="text-xs font-black uppercase text-muted">{filteredPredictions.length} visibles</span>
          </div>
          <div className="award-grid">
          {filteredPredictions.map((item) => (
            <article key={item.participant_id} className="award-card">
              <div className="mb-3 flex items-center justify-between">
                <strong className="truncate text-white">{item.name}</strong>
                <Trophy size={18} className="text-gold" />
              </div>
              <AwardLine
                label="Goleador"
                value={item.top_scorer_display || item.top_scorer}
                canonical={item.top_scorer_canonical}
                result={awards.results?.top_scorer}
              />
              <AwardLine
                label="Balon de Oro"
                value={item.best_player_display || item.best_player}
                canonical={item.best_player_canonical}
                result={awards.results?.best_player}
              />
              <AwardLine
                label="Guante de Oro"
                value={item.best_goalkeeper_display || item.best_goalkeeper}
                canonical={item.best_goalkeeper_canonical}
                result={awards.results?.best_goalkeeper}
              />
            </article>
          ))}
          {!filteredPredictions.length && (
            <div className="rounded-md border border-white/10 bg-white/6 p-4 text-sm font-bold text-muted">
              No hay participantes con ese nombre.
            </div>
          )}
          </div>
        </div>
      </div>
    </section>
  );
}

function AwardLine({ label, value, canonical, result }) {
  const confirmed = result?.is_confirmed;
  const hit = confirmed && canonical && canonical === result?.canonical_winner;
  return (
    <div className="award-line">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase text-muted">{label}</p>
        <p className="truncate font-bold text-white">{value || "-"}</p>
      </div>
      <span className={cx("award-status", hit ? "award-status-hit" : "award-status-pending")}>
        {hit ? `+${formatPoints(result.points)}` : confirmed ? "sin puntos" : "en juego"}
      </span>
    </div>
  );
}

function isWholeNumberString(value) {
  if (value === "" || value == null) return true;
  return /^\d+$/.test(String(value));
}

function thirdValue(row) {
  return row ? `${row.group_code || row.groupCode || ""}|${row.team_code || row.team || ""}` : "";
}

function parseThirdValue(value) {
  const [group_code, team_code] = String(value || "").split("|");
  return { group_code, team_code };
}

function GroupFinalControl({ controls, selectedGroupCode, setSelectedGroupCode, form, setForm, onSave, busy }) {
  const groups = controls?.groups || [];
  const group = groups.find((item) => item.group_code === selectedGroupCode) || groups[0];
  const positions = [1, 2, 3, 4];
  const teams = [...new Set((group?.rows || []).map((row) => row.team).filter(Boolean))];
  const selectedTeams = form[group?.group_code] || positions.map((position) => group?.manual_rows?.find((row) => row.final_position === position)?.team_code || group?.rows?.[position - 1]?.team || "");
  const tiebreakLabels = {
    head_to_head_points: "puntos directos",
    head_to_head_goal_difference: "DG directa",
    head_to_head_goals: "GF directos",
    overall_goal_difference: "DG general",
    overall_goals: "GF generales"
  };

  function updatePosition(index, value) {
    const next = [...selectedTeams];
    next[index] = value;
    setForm((current) => ({ ...current, [group.group_code]: next }));
  }

  if (!groups.length) return null;

  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="section-title">Posiciones de grupo</h3>
        <Medal className="text-gold" size={22} />
      </div>
      <label className="field-label">
        Grupo
        <select className="text-input" value={group?.group_code || selectedGroupCode} onChange={(event) => setSelectedGroupCode(event.target.value)}>
          {groups.map((item) => (
            <option key={item.group_code} value={item.group_code}>Grupo {item.group_code}</option>
          ))}
        </select>
      </label>
      <div className="space-y-2">
        {(group?.rows || []).map((row) => (
          <div key={`${group.group_code}-${row.team}`} className="detail-row">
            <div className="min-w-0">
              <p className="truncate font-bold text-white">#{row.position} {row.team}</p>
              <p className="truncate text-xs text-muted">
                {row.points == null ? "sin tabla calculada" : `${row.points} pts, DG ${row.gd}, GF ${row.gf}`}
              </p>
              {row.tiebreakApplied?.length > 0 && (
                <p className="truncate text-xs text-gold">Desempate: {row.tiebreakApplied.map((rule) => tiebreakLabels[rule] || rule).join(" · ")}</p>
              )}
            </div>
            <span className="text-xs font-black uppercase text-mint">{group.source}</span>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {positions.map((position, index) => (
          <label key={position} className="field-label">
            Posicion {position}
            <select className="text-input" value={selectedTeams[index] || ""} onChange={(event) => updatePosition(index, event.target.value)}>
              <option value="">Seleccionar</option>
              {teams.map((team) => (
                <option key={team} value={team}>{team}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button className="secondary-button" type="button" onClick={() => onSave(group.group_code, selectedTeams)} disabled={busy}>
        <CheckCircle2 size={18} /> Guardar posiciones
      </button>
    </div>
  );
}

function BestThirdsControl({ controls, form, setForm, onSave, busy }) {
  const options = controls?.thirdOptions || [];
  const calculated = controls?.bestThirds?.rows || [];
  const source = controls?.bestThirds?.source;
  const ready = controls?.bestThirds?.ready;
  const note = controls?.bestThirds?.tiebreakNote;
  const showManualOverride = true;
  const slots = Array.from({ length: 8 }, (_, index) => index);

  function updateSlot(index, value) {
    const next = [...form];
    next[index] = value;
    setForm(next);
  }

  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="section-title">Mejores terceros</h3>
        <Table2 className="text-mint" size={22} />
      </div>
      <div className="space-y-2">
        {calculated.length ? calculated.map((row) => (
          <div key={`${row.rank}-${row.team}`} className="detail-row">
            <div className="min-w-0">
              <p className="truncate font-bold text-white">#{row.rank} {row.team}</p>
              <p className="truncate text-xs text-muted">
                Grupo {row.groupCode || row.group_code || "-"} | {row.points ?? "-"} pts | DG {row.gd ?? "-"} | GF {row.gf ?? "-"}
              </p>
            </div>
            <span className="text-xs font-black uppercase text-muted">{row.source || source}</span>
          </div>
        )) : (
          <div className="rounded-md border border-white/10 bg-white/6 p-3 text-sm font-bold text-muted">
            Pendiente de cerrar todos los grupos.
          </div>
        )}
      </div>
      <div className={cx("admin-message", ready ? "admin-message-ok" : "admin-message-soft")}>
        {ready
          ? "Calculado automaticamente con puntos, diferencia de gol y goles a favor."
          : note || "Se calculara automaticamente cuando todos los grupos tengan tabla final con metricas completas."}
      </div>
      {showManualOverride && (
        <>
          <div className="admin-message admin-message-soft">
            Puedes corregir manualmente los 8 terceros si el calculo automatico o el desempate oficial requiere ajuste. No se asignan puntos antes de cerrar los grupos.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {slots.map((slot) => (
              <label key={slot} className="field-label">
                Cupo {slot + 1}
                <select className="text-input" value={form[slot] || ""} onChange={(event) => updateSlot(slot, event.target.value)}>
                  <option value="">Seleccionar</option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button className="secondary-button" type="button" onClick={() => onSave(form)} disabled={busy}>
            <CheckCircle2 size={18} /> Guardar desempate
          </button>
        </>
      )}
    </div>
  );
}

function AwardResultsControl({ controls, form, setForm, onSave, busy }) {
  const awardLabels = {
    top_scorer: "Goleador",
    best_player: "Balon de Oro",
    best_goalkeeper: "Guante de Oro"
  };

  function updateAward(key, patch) {
    setForm((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        ...patch
      }
    }));
  }

  return (
    <div className="panel space-y-4 lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="section-title">Premios individuales</h3>
        <Trophy className="text-gold" size={22} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {Object.entries(awardLabels).map(([key, label]) => {
          const award = form[key] || {};
          const options = controls?.awardOptions?.[key] || [];
          return (
            <div key={key} className="award-admin-card">
              <label className="field-label">
                {label}
                <select className="text-input" value={award.winner_name || ""} onChange={(event) => updateAward(key, { winner_name: event.target.value })}>
                  <option value="">En juego</option>
                  {options.map((option) => (
                    <option key={option.canonical} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Puntos
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  step="0.5"
                  value={award.points ?? ""}
                  onChange={(event) => updateAward(key, { points: event.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-muted">
                <input
                  type="checkbox"
                  checked={Boolean(award.is_confirmed)}
                  onChange={(event) => updateAward(key, { is_confirmed: event.target.checked })}
                />
                Confirmado
              </label>
            </div>
          );
        })}
      </div>
      <button className="secondary-button" type="button" onClick={() => onSave(form)} disabled={busy}>
        <CheckCircle2 size={18} /> Guardar premios
      </button>
    </div>
  );
}

function LiveSyncControl({ state, form, setForm, selectedMatch, syncMatchForm, setSyncMatchForm, onSaveConfig, onSaveMatch, onForce, onDiscover, onRun, busy }) {
  const status = state?.status || {};
  const migrationRequired = status.migrationRequired;
  const updateList = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="panel live-sync-panel lg:col-span-2">
      <div className="live-sync-heading">
        <div>
          <p className="eyebrow">API-Football</p>
          <h3 className="section-title">Actualizacion inteligente</h3>
        </div>
        <span className={cx("sync-mode-pill", `sync-mode-${status.mode || "offline"}`)}>{status.mode || "sin configurar"}</span>
      </div>

      {migrationRequired && <div className="admin-warning">Falta ejecutar la migracion 20260622_provider_resilience.sql para habilitar el control resiliente de proveedores.</div>}
      {status.lastError && <div className="admin-warning">{status.lastError}</div>}
      {status.apiAccessAvailable === false && <div className="admin-warning">API-Football 2026 no disponible: {status.apiAccessReason || "acceso no confirmado"}. Se comprobara nuevamente cada 24 horas.</div>}
      {status.espnLastError && <div className="admin-warning">Respaldo ESPN en espera: {status.espnLastError}</div>}

      <div className="sync-stat-grid">
        <div><span>Usadas hoy</span><strong>{status.used || 0}</strong></div>
        <div><span>Disponibles</span><strong>{status.remaining ?? 0}</strong></div>
        <div><span>Limite</span><strong>{status.dailyLimit || 100}</strong></div>
        <div><span>API key</span><strong>{status.configured ? "Lista" : "Falta"}</strong></div>
        <div><span>Acceso API 2026</span><strong>{status.apiAccessAvailable === true ? "Disponible" : status.apiAccessAvailable === false ? "No disponible" : "Sin comprobar"}</strong></div>
        <div><span>Ultima prueba API</span><strong>{status.apiAccessCheckedAt ? timeAgo(status.apiAccessCheckedAt) : "Nunca"}</strong></div>
        <div><span>Ultimo ESPN correcto</span><strong>{status.espnLastSuccessAt ? timeAgo(status.espnLastSuccessAt) : "Nunca"}</strong></div>
        <div><span>Fallos ESPN</span><strong>{status.espnConsecutiveFailures || 0}</strong></div>
      </div>

      <div className="live-sync-config-grid">
        <label className="field-label">
          <span>API-Football (gestion automatica diaria)</span>
          <select className="text-input" value={form.enabled ? "on" : "off"} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.value === "on" }))}>
            <option value="off">Desactivada</option><option value="on">Activada</option>
          </select>
        </label>
        <label className="field-label">Limite normal<input className="text-input" type="number" min="1" max="90" value={form.dailySoftLimit || 90} onChange={(event) => setForm((current) => ({ ...current, dailySoftLimit: Number(event.target.value) }))} /></label>
        <label className="field-label">Reserva de emergencia<input className="text-input" type="number" min="0" max="20" value={form.emergencyReserve ?? 10} onChange={(event) => setForm((current) => ({ ...current, emergencyReserve: Number(event.target.value) }))} /></label>
        <label className="field-label">Nombre de Colombia<input className="text-input" value={form.colombiaTeamName || ""} onChange={(event) => setForm((current) => ({ ...current, colombiaTeamName: event.target.value }))} /></label>
        <label className="field-label live-sync-list-field">Equipos populares, separados por coma<textarea className="text-input" rows="3" value={form.popularTeamsText || ""} onChange={(event) => updateList("popularTeamsText", event.target.value)} /></label>
        <label className="field-label live-sync-list-field">Favoritos adicionales, separados por coma<textarea className="text-input" rows="3" value={form.favoriteTeamsText || ""} onChange={(event) => updateList("favoriteTeamsText", event.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-3">
        <button className="secondary-button" type="button" onClick={onSaveConfig} disabled={busy || migrationRequired}><CheckCircle2 size={17} /> Guardar configuracion</button>
        <button className="secondary-button" type="button" onClick={onRun} disabled={busy}><RefreshCw size={17} /> Ejecutar ciclo</button>
        <button className="secondary-button" type="button" onClick={onDiscover} disabled={busy || migrationRequired}><Search size={17} /> Descubrir fixture IDs</button>
      </div>

      {selectedMatch && (
        <div className="sync-match-control">
          <div>
            <p className="font-extrabold text-white">{selectedMatch.match_id}: {selectedMatch.home_team} vs {selectedMatch.away_team}</p>
            <p className="text-xs font-bold text-muted">Estado API: {selectedMatch.api_status || "sin mapear"} · Ultima sync: {timeAgo(selectedMatch.last_synced_at)}</p>
          </div>
          <label className="field-label">Fixture ID<input className="text-input" type="number" min="1" value={syncMatchForm.apiFixtureId || ""} onChange={(event) => setSyncMatchForm((current) => ({ ...current, apiFixtureId: event.target.value }))} /></label>
          <label className="field-label">Prioridad manual<select className="text-input" value={syncMatchForm.priorityOverride || ""} onChange={(event) => setSyncMatchForm((current) => ({ ...current, priorityOverride: event.target.value }))}><option value="">Automatica</option>{["P0", "P1", "P2", "P3"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="sync-featured-check"><input type="checkbox" checked={Boolean(syncMatchForm.featured)} onChange={(event) => setSyncMatchForm((current) => ({ ...current, featured: event.target.checked }))} /> Partido destacado</label>
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" type="button" onClick={onSaveMatch} disabled={busy || migrationRequired}>Guardar prioridad</button>
            <button className="primary-button" type="button" onClick={onForce} disabled={busy || migrationRequired || !syncMatchForm.apiFixtureId}>Forzar sincronizacion</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminView({ password, setPassword, leaderboard, onDone }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [logs, setLogs] = useState([]);
  const [newPassword, setNewPassword] = useState("");
  const [adminMatches, setAdminMatches] = useState([]);
  const [scoringControls, setScoringControls] = useState(null);
  const [liveSyncState, setLiveSyncState] = useState(null);
  const [liveSyncForm, setLiveSyncForm] = useState({});
  const [syncMatchForm, setSyncMatchForm] = useState({ apiFixtureId: "", priorityOverride: "", featured: false });
  const [selectedGroupCode, setSelectedGroupCode] = useState("A");
  const [groupFinalForm, setGroupFinalForm] = useState({});
  const [bestThirdsForm, setBestThirdsForm] = useState(Array.from({ length: 8 }, () => ""));
  const [awardsForm, setAwardsForm] = useState({});
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [adminStageFilter, setAdminStageFilter] = useState("group");
  const [adminGroupFilter, setAdminGroupFilter] = useState("all");
  const [adminDateFilter, setAdminDateFilter] = useState("");
  const [adminSearch, setAdminSearch] = useState("");
  const [matchForm, setMatchForm] = useState({
    home_team: "",
    away_team: "",
    home_goals: "",
    away_goals: "",
    status: "scheduled",
    match_date: "",
    manual_override: true,
    locked: false,
    qualified_team: "",
    decided_by_penalties: false,
    home_penalties: "",
    away_penalties: ""
  });

  function nullableNumber(value) {
    return value === "" || value == null ? null : Number(value);
  }

  function matchGroup(match) {
    const [, groupCode] = String(match.match_id || "").match(/^G-([A-L])-/i) || [];
    return groupCode?.toUpperCase() || "";
  }

  async function loadLogs() {
    if (!password) return;
    const data = await adminGet("/admin/logs", password);
    setLogs(data.rows || []);
  }

  async function loadAdminMatches() {
    const data = await apiGet("/matches?stage=all");
    setAdminMatches(data.rows || []);
  }

  async function loadScoringControls() {
    if (!password) return;
    const data = await adminGet("/admin/scoring-controls", password);
    setScoringControls(data);
  }

  async function loadLiveSync() {
    if (!password) return;
    const data = await adminGet("/admin/live-sync", password);
    setLiveSyncState(data);
  }

  async function loadAdminData() {
    await Promise.all([loadLogs(), loadAdminMatches(), loadScoringControls(), loadLiveSync()]);
  }

  async function handleUnlock(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await loadAdminData();
      setIsAdminUnlocked(true);
      setMessage("Admin desbloqueado.");
    } catch (error) {
      setIsAdminUnlocked(false);
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRecalculate() {
    setBusy(true);
    setMessage("");
    try {
      await adminPost("/scores/recalculate", password);
      setMessage("Tabla recalculada.");
      await loadAdminData();
      onDone();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function splitTeamList(value) {
    return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  }

  async function handleSaveLiveSyncConfig() {
    setBusy(true);
    setMessage("");
    try {
      await adminPatch("/admin/live-sync/config", password, {
        enabled: Boolean(liveSyncForm.enabled),
        dailySoftLimit: Number(liveSyncForm.dailySoftLimit || 90),
        emergencyReserve: Number(liveSyncForm.emergencyReserve ?? 10),
        colombiaTeamName: liveSyncForm.colombiaTeamName || "Colombia",
        popularTeams: splitTeamList(liveSyncForm.popularTeamsText),
        favoriteTeams: splitTeamList(liveSyncForm.favoriteTeamsText)
      });
      setMessage("Configuracion de sincronizacion guardada.");
      await loadLiveSync();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRunLiveSync() {
    setBusy(true);
    setMessage("");
    try {
      const result = await adminPost("/admin/sync", password);
      setMessage(result.requests ? `${result.requests} consulta(s) ejecutadas.` : "No habia partidos pendientes de actualizacion.");
      await loadAdminData();
      onDone();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscoverFixtures() {
    setBusy(true);
    setMessage("");
    try {
      const result = await adminPost("/admin/live-sync/discover", password);
      setMessage(`${result.mapped?.length || 0} fixture IDs vinculados.`);
      await loadAdminData();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSyncMatch() {
    if (!selectedMatchId) return;
    setBusy(true);
    setMessage("");
    try {
      await adminPatch(`/admin/live-sync/matches/${encodeURIComponent(selectedMatchId)}`, password, {
        apiFixtureId: syncMatchForm.apiFixtureId,
        priorityOverride: syncMatchForm.priorityOverride,
        featured: Boolean(syncMatchForm.featured)
      });
      setMessage("Prioridad y mapeo del partido guardados.");
      await loadAdminData();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleForceSync() {
    if (!selectedMatchId) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await adminPost("/admin/live-sync/force", password, { match_id: selectedMatchId });
      setMessage(`Sincronizacion forzada: ${result.processed || 0} partido(s) procesado(s).`);
      await loadAdminData();
      onDone();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveMatch(event) {
    event.preventDefault();
    if (!selectedMatchId || !isAdminUnlocked) return;
    if (!isWholeNumberString(matchForm.home_goals) || !isWholeNumberString(matchForm.away_goals)) {
      setMessage("Los goles deben ser numeros enteros mayores o iguales a 0.");
      return;
    }
    if (!isWholeNumberString(matchForm.home_penalties) || !isWholeNumberString(matchForm.away_penalties)) {
      setMessage("Los penales deben ser numeros enteros mayores o iguales a 0.");
      return;
    }
    if (matchForm.status === "finished" && (matchForm.home_goals === "" || matchForm.away_goals === "")) {
      setMessage("Si el partido esta finished, debes escribir goles local y visitante.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        home_goals: nullableNumber(matchForm.home_goals),
        away_goals: nullableNumber(matchForm.away_goals),
        status: matchForm.status,
        match_date: colombiaDateTimeToIso(matchForm.match_date),
        manual_override: matchForm.manual_override,
        locked: matchForm.locked
      };
      if (selectedMatch?.stage !== "group") {
        payload.qualified_team = matchForm.qualified_team || null;
        payload.decided_by_penalties = matchForm.decided_by_penalties;
        payload.home_penalties = matchForm.decided_by_penalties ? nullableNumber(matchForm.home_penalties) : null;
        payload.away_penalties = matchForm.decided_by_penalties ? nullableNumber(matchForm.away_penalties) : null;
      }
      await adminPatch(`/admin/matches/${encodeURIComponent(selectedMatchId)}`, password, payload);
      setMessage("Resultado manual guardado y tabla recalculada.");
      Promise.all([loadAdminData(), Promise.resolve(onDone())]).catch((error) => setMessage(error.message));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await adminPost("/admin/password", password, { newPassword });
      setPassword(newPassword);
      setNewPassword("");
      setIsAdminUnlocked(true);
      setMessage("Password admin actualizado.");
      await loadAdminData();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveGroupFinal(groupCode, teams) {
    const cleanTeams = (teams || []).map((team) => String(team || "").trim());
    if (cleanTeams.length !== 4 || cleanTeams.some((team) => !team) || new Set(cleanTeams).size !== 4) {
      setMessage("Selecciona cuatro equipos distintos para el grupo.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await adminPost("/admin/group-final-standings", password, {
        group_code: groupCode,
        rows: cleanTeams.map((team, index) => ({ team_code: team, final_position: index + 1 }))
      });
      setMessage(`Grupo ${groupCode} guardado y tabla recalculada.`);
      await loadAdminData();
      onDone();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveBestThirds(values) {
    const rows = (values || []).map(parseThirdValue).filter((row) => row.team_code);
    if (rows.length !== 8 || new Set(rows.map((row) => row.team_code)).size !== 8) {
      setMessage("Selecciona exactamente 8 mejores terceros distintos.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await adminPost("/admin/best-thirds-final", password, { rows });
      setMessage("Desempate de mejores terceros guardado y tabla recalculada.");
      await loadAdminData();
      onDone();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAwards(form) {
    const awards = Object.entries(form || {}).map(([key, row]) => ({
      key,
      winner_name: row.winner_name || null,
      points: Number(row.points),
      is_confirmed: Boolean(row.is_confirmed)
    }));
    if (awards.some((award) => award.is_confirmed && !award.winner_name)) {
      setMessage("Para confirmar un premio debes seleccionar ganador.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await adminPost("/admin/awards", password, { awards });
      setMessage("Premios guardados y tabla recalculada.");
      await loadAdminData();
      onDone();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedMatch = useMemo(
    () => adminMatches.find((match) => match.match_id === selectedMatchId) || null,
    [adminMatches, selectedMatchId]
  );

  const groupOptions = useMemo(() => {
    const options = [...new Set(adminMatches.map(matchGroup).filter(Boolean))].sort();
    return ["all", ...options];
  }, [adminMatches]);

  const filteredAdminMatches = useMemo(() => {
    const search = normalizeSearchText(adminSearch);
    return adminMatches.filter((match) => {
      const groupCode = matchGroup(match);
      const text = normalizeSearchText(`${match.match_id} ${match.home_team} ${match.away_team} ${match.stageLabel}`);
      const stageOk = adminStageFilter === "all" || match.stage === adminStageFilter;
      const groupOk = adminGroupFilter === "all" || groupCode === adminGroupFilter;
      const dateOk = !adminDateFilter || dateOnlyColombia(match.match_date) === adminDateFilter;
      const searchOk = !search || text.includes(search);
      return stageOk && groupOk && dateOk && searchOk;
    });
  }, [adminDateFilter, adminGroupFilter, adminMatches, adminSearch, adminStageFilter]);

  useEffect(() => {
    if (!filteredAdminMatches.length) {
      if (selectedMatchId) setSelectedMatchId("");
      return;
    }
    if (!selectedMatchId || !filteredAdminMatches.some((match) => match.match_id === selectedMatchId)) {
      setSelectedMatchId(filteredAdminMatches[0].match_id);
    }
  }, [filteredAdminMatches, selectedMatchId]);

  useEffect(() => {
    if (!selectedMatch) {
      setMatchForm({
        home_team: "",
        away_team: "",
        home_goals: "",
        away_goals: "",
        status: "scheduled",
        match_date: "",
        manual_override: true,
        locked: false,
        qualified_team: "",
        decided_by_penalties: false,
        home_penalties: "",
        away_penalties: ""
      });
      return;
    }
    setMatchForm({
      home_team: selectedMatch.home_team || "",
      away_team: selectedMatch.away_team || "",
      home_goals: selectedMatch.home_goals ?? "",
      away_goals: selectedMatch.away_goals ?? "",
      status: selectedMatch.status || "scheduled",
      match_date: datetimeLocalColombia(selectedMatch.match_date),
      manual_override: selectedMatch.manual_override ?? true,
      locked: selectedMatch.locked ?? false,
      qualified_team: selectedMatch.qualified_team || "",
      decided_by_penalties: Boolean(selectedMatch.decided_by_penalties),
      home_penalties: selectedMatch.home_penalties ?? "",
      away_penalties: selectedMatch.away_penalties ?? ""
    });
    setSyncMatchForm({
      apiFixtureId: selectedMatch.api_fixture_id || "",
      priorityOverride: selectedMatch.priority_override || "",
      featured: Boolean(selectedMatch.featured)
    });
  }, [selectedMatch]);

  useEffect(() => {
    if (!liveSyncState?.config) return;
    const config = liveSyncState.config;
    setLiveSyncForm({
      enabled: Boolean(config.enabled),
      dailySoftLimit: config.dailySoftLimit ?? 90,
      emergencyReserve: config.emergencyReserve ?? 10,
      colombiaTeamName: config.colombiaTeamName || "Colombia",
      popularTeamsText: (config.popularTeams || []).join(", "),
      favoriteTeamsText: (config.favoriteTeams || []).join(", ")
    });
  }, [liveSyncState]);

  useEffect(() => {
    if (!scoringControls) return;
    const nextGroups = {};
    for (const group of scoringControls.groups || []) {
      nextGroups[group.group_code] = [1, 2, 3, 4].map((position) =>
        group.manual_rows?.find((row) => row.final_position === position)?.team_code ||
        group.rows?.find((row) => row.position === position)?.team ||
        ""
      );
    }
    setGroupFinalForm(nextGroups);
    const manualThirds = scoringControls.bestThirdsManual || [];
    const calculatedThirds = scoringControls.bestThirds?.rows || [];
    const thirds = (manualThirds.length ? manualThirds : calculatedThirds)
      .slice(0, 8)
      .map(thirdValue);
    setBestThirdsForm([...thirds, ...Array.from({ length: Math.max(0, 8 - thirds.length) }, () => "")]);
    const nextAwards = {};
    for (const [key, award] of Object.entries(scoringControls.awards || {})) {
      nextAwards[key] = {
        winner_name: award.winner_display || award.winner_name || "",
        points: award.points ?? "",
        is_confirmed: Boolean(award.is_confirmed)
      };
    }
    setAwardsForm(nextAwards);
  }, [scoringControls]);

  const selectedIsKnockoutFinished = selectedMatch && selectedMatch.stage !== "group" && matchForm.status === "finished";
  const selectedScoreIsTie =
    matchForm.home_goals !== "" &&
    matchForm.away_goals !== "" &&
    Number(matchForm.home_goals) === Number(matchForm.away_goals);
  const showQualifiedWarning = selectedIsKnockoutFinished && selectedScoreIsTie && !matchForm.qualified_team;

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h2 className="page-title">Carga manual</h2>
        </div>
        <Lock className="text-gold" size={30} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="panel space-y-4">
          <form className="space-y-3" onSubmit={handleUnlock}>
            <label className="field-label">
              Password
              <input
                className="text-input"
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setIsAdminUnlocked(false);
                }}
              />
            </label>
            <button className="primary-button w-full" type="submit" disabled={busy || !password}>
              <Lock size={18} /> {isAdminUnlocked ? "Admin activo" : "Entrar al admin"}
            </button>
          </form>

          {isAdminUnlocked && (
            <>
              <div className="flex flex-wrap gap-3">
                <button className="secondary-button" type="button" onClick={handleRecalculate} disabled={busy}>
                  <RefreshCw size={18} /> Recalcular
                </button>
              </div>
              <form className="space-y-3 border-t border-white/10 pt-4" onSubmit={handlePasswordChange}>
                <label className="field-label">
                  Nuevo password admin
                  <input className="text-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                </label>
                <button className="primary-button" type="submit" disabled={busy || newPassword.length < 6}>
                  <Lock size={18} /> Cambiar password
                </button>
              </form>
            </>
          )}
          {message && <p className="admin-message">{message}</p>}
        </div>

        <div className="panel">
          <h3 className="section-title mb-4">Tabla</h3>
          <div className="space-y-2">
            {leaderboard.slice(0, 8).map((row) => (
              <div key={row.id} className="detail-row">
                <div className="min-w-0">
                  <p className="truncate font-bold text-white">#{row.position} {row.name}</p>
                  <p className="truncate text-xs text-muted">Ultimo calculo: {timeAgo(row.lastCalculated)}</p>
                </div>
                <span className="points-pill">{formatPoints(row.totalPoints)}</span>
              </div>
            ))}
          </div>
        </div>

        {isAdminUnlocked && (
          <LiveSyncControl
            state={liveSyncState}
            form={liveSyncForm}
            setForm={setLiveSyncForm}
            selectedMatch={selectedMatch}
            syncMatchForm={syncMatchForm}
            setSyncMatchForm={setSyncMatchForm}
            onSaveConfig={handleSaveLiveSyncConfig}
            onSaveMatch={handleSaveSyncMatch}
            onForce={handleForceSync}
            onDiscover={handleDiscoverFixtures}
            onRun={handleRunLiveSync}
            busy={busy}
          />
        )}

        {isAdminUnlocked ? (
          <form className="panel space-y-4 lg:col-span-2" onSubmit={handleSaveMatch}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="section-title">Resultado manual</h3>
              {selectedMatch && (
                <span className="admin-context-pill">
                  {selectedMatch.stageLabel} - {selectedMatch.match_id}
                </span>
              )}
            </div>

            <div className="admin-filter-grid">
              <label className="field-label">
                Fase
                <select
                  className="text-input"
                  value={adminStageFilter}
                  onChange={(event) => {
                    setAdminStageFilter(event.target.value);
                    if (!["all", "group"].includes(event.target.value)) setAdminGroupFilter("all");
                  }}
                >
                  {stages.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Grupo
                <select
                  className="text-input"
                  value={adminGroupFilter}
                  disabled={!["all", "group"].includes(adminStageFilter)}
                  onChange={(event) => setAdminGroupFilter(event.target.value)}
                >
                  {groupOptions.map((option) => (
                    <option key={option} value={option}>{option === "all" ? "Todos" : `Grupo ${option}`}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Calendario
                <span className="date-input-wrap">
                  <CalendarDays size={16} />
                  <input
                    type="date"
                    value={adminDateFilter}
                    onChange={(event) => setAdminDateFilter(event.target.value)}
                  />
                </span>
              </label>
              <label className="field-label">
                Buscar
                <input
                  className="text-input"
                  value={adminSearch}
                  onChange={(event) => setAdminSearch(event.target.value)}
                  placeholder="Equipo o partido"
                />
              </label>
            </div>

            <div className="admin-match-picker">
              {filteredAdminMatches.map((match) => (
                <button
                  key={match.match_id}
                  type="button"
                  className={cx("admin-match-option", selectedMatchId === match.match_id && "admin-match-option-active")}
                  onClick={() => setSelectedMatchId(match.match_id)}
                >
                  <span className="font-black text-mint">{match.match_id}</span>
                  <span className="min-w-0 flex-1 truncate text-left font-extrabold text-white">{match.home_team} vs {match.away_team}</span>
                  <span className="text-xs font-bold text-muted">{formatColombiaDate(match.match_date)}</span>
                </button>
              ))}
              {!filteredAdminMatches.length && (
                <div className="rounded-md border border-white/10 bg-white/6 p-4 text-sm font-bold text-muted">
                  No hay partidos con esos filtros.
                </div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="field-label">
                Equipo local
                <input
                  className="text-input read-only-input"
                  value={matchForm.home_team}
                  readOnly
                  aria-readonly="true"
                />
              </label>
              <label className="field-label">
                Equipo visitante
                <input
                  className="text-input read-only-input"
                  value={matchForm.away_team}
                  readOnly
                  aria-readonly="true"
                />
              </label>
              <label className="field-label">
                Goles local
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={matchForm.home_goals}
                  onChange={(event) => setMatchForm((current) => ({ ...current, home_goals: event.target.value }))}
                />
              </label>
              <label className="field-label">
                Goles visitante
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={matchForm.away_goals}
                  onChange={(event) => setMatchForm((current) => ({ ...current, away_goals: event.target.value }))}
                />
              </label>
              <label className="field-label">
                Estado
                <select
                  className="text-input"
                  value={matchForm.status}
                  onChange={(event) => setMatchForm((current) => ({ ...current, status: event.target.value }))}
                >
                  <option value="scheduled">scheduled</option>
                  <option value="finished">finished</option>
                </select>
              </label>
              <label className="field-label">
                Fecha y hora Colombia
                <input
                  className="text-input"
                  type="datetime-local"
                  value={matchForm.match_date}
                  onChange={(event) => setMatchForm((current) => ({ ...current, match_date: event.target.value }))}
                />
              </label>
              {selectedIsKnockoutFinished && (
                <label className="field-label">
                  Equipo clasificado
                  <select
                    className="text-input"
                    value={matchForm.qualified_team}
                    onChange={(event) => setMatchForm((current) => ({ ...current, qualified_team: event.target.value }))}
                  >
                    <option value="">Seleccionar</option>
                    <option value={matchForm.home_team}>{matchForm.home_team || "Equipo local"}</option>
                    <option value={matchForm.away_team}>{matchForm.away_team || "Equipo visitante"}</option>
                  </select>
                </label>
              )}
              {selectedIsKnockoutFinished && matchForm.decided_by_penalties && (
                <>
                  <label className="field-label">
                    Penales local
                    <input className="text-input" type="number" min="0" value={matchForm.home_penalties} onChange={(event) => setMatchForm((current) => ({ ...current, home_penalties: event.target.value }))} />
                  </label>
                  <label className="field-label">
                    Penales visitante
                    <input className="text-input" type="number" min="0" value={matchForm.away_penalties} onChange={(event) => setMatchForm((current) => ({ ...current, away_penalties: event.target.value }))} />
                  </label>
                </>
              )}
            </div>
            {showQualifiedWarning && (
              <div className="admin-warning">
                Este partido terminó empatado. Selecciona el equipo clasificado para calcular correctamente los puntos.
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm font-bold text-muted">
                <input
                  type="checkbox"
                  checked={matchForm.manual_override}
                  onChange={(event) => setMatchForm((current) => ({ ...current, manual_override: event.target.checked }))}
                />
                manual_override
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-muted">
                <input
                  type="checkbox"
                  checked={matchForm.locked}
                  onChange={(event) => setMatchForm((current) => ({ ...current, locked: event.target.checked }))}
                />
                locked
              </label>
              {selectedIsKnockoutFinished && (
                <label className="flex items-center gap-2 text-sm font-bold text-muted">
                  <input
                    type="checkbox"
                    checked={matchForm.decided_by_penalties}
                    onChange={(event) => setMatchForm((current) => ({ ...current, decided_by_penalties: event.target.checked }))}
                  />
                  Definido por penales
                </label>
              )}
            </div>
            <button className="primary-button" type="submit" disabled={busy || !selectedMatchId}>
              <CheckCircle2 size={18} /> Guardar resultado
            </button>
          </form>
        ) : (
          <div className="panel locked-admin-panel lg:col-span-2">
            <Lock className="text-gold" size={28} />
            <div>
              <h3 className="section-title">Resultado manual bloqueado</h3>
              <p className="text-sm font-semibold text-muted">Ingresa el password admin para actualizar partidos.</p>
            </div>
          </div>
        )}

        {isAdminUnlocked && scoringControls && (
          <div className="admin-scoring-grid lg:col-span-2">
            <GroupFinalControl
              controls={scoringControls}
              selectedGroupCode={selectedGroupCode}
              setSelectedGroupCode={setSelectedGroupCode}
              form={groupFinalForm}
              setForm={setGroupFinalForm}
              onSave={handleSaveGroupFinal}
              busy={busy}
            />
            <BestThirdsControl
              controls={scoringControls}
              form={bestThirdsForm}
              setForm={setBestThirdsForm}
              onSave={handleSaveBestThirds}
              busy={busy}
            />
            <AwardResultsControl
              controls={scoringControls}
              form={awardsForm}
              setForm={setAwardsForm}
              onSave={handleSaveAwards}
              busy={busy}
            />
          </div>
        )}

        {isAdminUnlocked && (
          <div className="panel lg:col-span-2">
            <h3 className="section-title mb-4">Logs de admin</h3>
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className={cx("detail-row log-row", `log-${log.status || "unknown"}`)}>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-white">{log.source}</p>
                    <p className="truncate text-xs text-muted">{log.message}</p>
                    <p className="truncate text-xs font-bold text-muted">{formatColombiaDateTime(log.created_at)}</p>
                  </div>
                  <span className="text-xs font-black uppercase text-mint">{log.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState(() => viewFromPath(window.location.pathname));
  const [meta, setMeta] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [matches, setMatches] = useState([]);
  const [standings, setStandings] = useState({ groups: [], bestThirds: { rows: [] } });
  const [bracket, setBracket] = useState({});
  const [awards, setAwards] = useState({});
  const [stage, setStage] = useState("all");
  const [openMatchId, setOpenMatchId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState(null);
  const [participantDetail, setParticipantDetail] = useState(null);
  const [password, setPassword] = useState(() => localStorage.getItem("polla-admin-password") || "");
  const [toast, setToast] = useState("");

  function navigateView(view) {
    setActiveView(view);
    const nextPath = viewPaths[view] || "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
  }

  function openMatchFromStandings(matchId) {
    setStage("group");
    setOpenMatchId(matchId);
    navigateView("matches");
  }

  async function refreshAll() {
    setRefreshing(true);
    try {
      const [metaData, leaderboardData, matchesData, standingsData, bracketData, awardsData] = await Promise.all([
        apiGet("/meta"),
        apiGet("/leaderboard"),
        apiGet("/matches?stage=all"),
        apiGet("/standings"),
        apiGet("/bracket"),
        apiGet("/awards")
      ]);
      setMeta(metaData);
      setLeaderboard(leaderboardData.rows || []);
      setMatches(matchesData.rows || []);
      setStandings(standingsData || { groups: [], bestThirds: { rows: [] } });
      setBracket(bracketData.stages || {});
      setAwards(awardsData || {});
      setSelectedParticipant((current) => current || leaderboardData.rows?.[0]?.id || null);
    } catch (error) {
      setToast(error.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    if (!selectedParticipant) return;
    apiGet(`/participants/${selectedParticipant}`)
      .then(setParticipantDetail)
      .catch((error) => setToast(error.message));
  }, [selectedParticipant, leaderboard]);

  useEffect(() => {
    localStorage.setItem("polla-admin-password", password);
  }, [password]);

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;
    const socket = io(socketUrl, { path: "/socket.io" });
    socket.on("scores:updated", () => {
      setToast("Puntajes actualizados");
      Promise.all([
        apiGet("/meta"),
        apiGet("/leaderboard"),
        apiGet("/matches?stage=all"),
        apiGet("/standings"),
        apiGet("/bracket")
      ]).then(([metaData, leaderboardData, matchesData, standingsData, bracketData]) => {
        setMeta(metaData);
        setLeaderboard(leaderboardData.rows || []);
        setMatches(matchesData.rows || []);
        setStandings(standingsData || { groups: [], bestThirds: { rows: [] } });
        setBracket(bracketData.stages || {});
      }).catch((error) => setToast(error.message));
    });
    socket.on("match:updated", (event) => {
      if (event?.row?.match_id) {
        setMatches((current) => current.map((match) => match.match_id === event.row.match_id ? { ...match, ...event.row } : match));
      }
      apiGet("/standings").then(setStandings).catch((error) => setToast(error.message));
    });
    socket.on("live-sync:status", (status) => {
      setStandings((current) => ({ ...current, sync: status }));
    });
    socket.on("awards:updated", () => {
      apiGet("/awards").then(setAwards).catch((error) => setToast(error.message));
    });
    socket.on("goal", (event) => setToast(event.message || "Gol actualizado"));
    return () => socket.close();
  }, []);

  useEffect(() => {
    const handlePopState = () => setActiveView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <AppShell activeView={activeView} setActiveView={navigateView} meta={meta} onRefresh={refreshAll} refreshing={refreshing}>
      {toast && (
        <button className="toast" type="button" onClick={() => setToast("")}>
          {toast}
        </button>
      )}
      {activeView === "table" && (
        <LeaderboardView
          leaderboard={leaderboard}
          meta={meta}
          onSelectParticipant={setSelectedParticipant}
          selectedParticipant={selectedParticipant}
          participantDetail={participantDetail}
        />
      )}
      {activeView === "matches" && (
        <MatchesView
          matches={matches}
          stage={stage}
          setStage={setStage}
          openMatchId={openMatchId}
          onOpenMatchHandled={() => setOpenMatchId(null)}
        />
      )}
      {activeView === "groups" && <StandingsView standings={standings} onOpenMatch={openMatchFromStandings} />}
      {activeView === "bracket" && <BracketView bracket={bracket} />}
      {activeView === "awards" && <AwardsView awards={awards} />}
      {activeView === "admin" && <AdminView password={password} setPassword={setPassword} leaderboard={leaderboard} onDone={refreshAll} />}
    </AppShell>
  );
}
