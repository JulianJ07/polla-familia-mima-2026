import {
  Activity,
  Armchair,
  BarChart3,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Crown,
  Goal,
  Lock,
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
import { useEffect, useMemo, useState } from "react";
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
  { id: "bracket", label: "Llaves", icon: Shield },
  { id: "awards", label: "Goleadores", icon: Goal }
];

const viewPaths = {
  table: "/",
  matches: "/partidos",
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

function StatusPill({ status }) {
  const config = {
    finished: ["Finalizado", "status-finished"],
    scheduled: ["Programado", "status-scheduled"]
  }[status] || ["Pendiente", "status-scheduled"];
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
              <span>Actualizado {timeAgo(lastUpdate)}</span>
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
                    <span className="font-display text-4xl text-gold">
                      <AnimatedNumber value={row.totalPoints} />
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
  const dateOptions = [...new Map(
    predictions
      .map((item) => {
        const value = dateOnlyColombia(item.match_date);
        return value ? [value, formatColombiaDay(item.match_date)] : null;
      })
      .filter(Boolean)
  ).entries()].sort(([a], [b]) => a.localeCompare(b));
  const groupOptions = [...new Set(predictions.map(groupCodeFromMatch).filter(Boolean))].sort();
  const groupFilterAvailable = ["all", "group"].includes(detailFilter);
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

  return (
    <div className="panel participant-panel">
      <div className="mb-4 flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="section-title truncate">{detail.participant.name}</h3>
          <p className="text-sm font-semibold text-muted">{formatPoints(detail.totalPoints)} puntos</p>
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
              <select value={matchDateFilter} onChange={(event) => setMatchDateFilter(event.target.value)}>
                <option value="all">Todos los dias</option>
                {dateOptions.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
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

  const columns = [
    { label: "16avos", matches: (byStage.r32 || []).slice(0, 8), side: "left", stage: "r32" },
    { label: "8avos", matches: (byStage.r16 || []).slice(0, 4), side: "left", stage: "r16" },
    { label: "4tos", matches: (byStage.qf || []).slice(0, 2), side: "left", stage: "qf" },
    { label: "Semis", matches: (byStage.sf || []).slice(0, 1), side: "left", stage: "sf" },
    { label: "Semis", matches: (byStage.sf || []).slice(1, 2), side: "right", stage: "sf" },
    { label: "4tos", matches: (byStage.qf || []).slice(2, 4), side: "right", stage: "qf" },
    { label: "8avos", matches: (byStage.r16 || []).slice(4, 8), side: "right", stage: "r16" },
    { label: "16avos", matches: (byStage.r32 || []).slice(8, 16), side: "right", stage: "r32" }
  ];

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

function MatchesView({ matches, stage, setStage }) {
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [matchDetail, setMatchDetail] = useState(null);
  const [matchDetailBusy, setMatchDetailBusy] = useState(false);
  const groupOptions = useMemo(() => {
    const options = [...new Set(matches.map(groupCodeFromMatch).filter(Boolean))].sort();
    return ["all", ...options];
  }, [matches]);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return matches.filter((match) => {
      const stageOk = stage === "all" || match.stage === stage;
      if (!stageOk) return false;
      const groupOk = groupFilter === "all" || groupCodeFromMatch(match) === groupFilter;
      if (!groupOk) return false;
      if (!search) return true;
      return `${match.home_team} ${match.away_team} ${match.stageLabel} ${match.match_id}`.toLowerCase().includes(search);
    });
  }, [groupFilter, matches, query, stage]);

  useEffect(() => {
    if (stage !== "group") setGroupFilter("all");
  }, [stage]);

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

      <div className="match-grid">
        {filtered.map((match, index) => (
          <motion.button
            key={match.match_id}
            type="button"
            className={cx("match-card match-card-button", `match-${match.status || "scheduled"}`)}
            onClick={() => setSelectedMatchId(match.match_id)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: Math.min(index, 10) * 0.018 }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="match-stage">{match.stageLabel}</span>
              <StatusPill status={match.status} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs font-bold text-muted">
              <CalendarClock size={14} />
              <span>{formatColombiaDate(match.match_date)}</span>
            </div>
            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <strong className="truncate text-right text-white">{match.home_team}</strong>
              <span className="score-box">
                {match.home_goals == null ? "-" : match.home_goals} : {match.away_goals == null ? "-" : match.away_goals}
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
        ))}
      </div>

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
  const participantSearchText = participantSearch.trim().toLowerCase();
  const visibleRows = participantSearchText
    ? matchRows.filter((row) => row.name.toLowerCase().includes(participantSearchText))
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
  return (
    <article className={cx("bracket-match", compact && "bracket-match-center", `match-${match?.status || "scheduled"}`)}>
      <div className="bracket-match-top">
        <span className="text-xs font-black text-muted">{match?.match_id || "Pendiente"}</span>
        <CircleDot size={14} className={match?.status === "finished" ? "text-mint" : "text-gold"} />
      </div>
      <p className="bracket-date">{formatColombiaDate(match?.match_date)}</p>
      <div className="bracket-team-list">
        <p className="bracket-team">{match?.home_team || "Local"}</p>
        <p className="bracket-team">{match?.away_team || "Visitante"}</p>
      </div>
      <div className="bracket-score">
        {match?.home_goals == null ? "Pendiente" : `${match.home_goals}-${match.away_goals}`}
      </div>
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

function BracketView({ bracket }) {
  const [zoom, setZoom] = useState(0.76);
  const r32 = bracket.r32 || [];
  const r16 = bracket.r16 || [];
  const qf = bracket.qf || [];
  const sf = bracket.sf || [];
  const finalMatch = bracket.final?.[0];
  const thirdMatch = bracket.third?.[0];
  const width = 2200;
  const height = 1420;

  const columns = [
    { label: "16avos", matches: r32.slice(0, 8), side: "left", stage: "r32" },
    { label: "8avos", matches: r16.slice(0, 4), side: "left", stage: "r16" },
    { label: "4tos", matches: qf.slice(0, 2), side: "left", stage: "qf" },
    { label: "Semis", matches: sf.slice(0, 1), side: "left", stage: "sf" },
    { label: "Semis", matches: sf.slice(1, 2), side: "right", stage: "sf" },
    { label: "4tos", matches: qf.slice(2, 4), side: "right", stage: "qf" },
    { label: "8avos", matches: r16.slice(4, 8), side: "right", stage: "r16" },
    { label: "16avos", matches: r32.slice(8, 16), side: "right", stage: "r32" }
  ];

  function nudgeZoom(delta) {
    setZoom((current) => Math.min(1.2, Math.max(0.58, Number((current + delta).toFixed(2)))));
  }

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Llaves</p>
          <h2 className="page-title">Camino a la copa</h2>
        </div>
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

      <div className="bracket-viewport">
        <div className="bracket-zoom-plane" style={{ width: width * zoom, minHeight: height * zoom }}>
          <div className="tournament-bracket" style={{ width, minHeight: height, transform: `scale(${zoom})` }}>
            {columns.slice(0, 4).map((column) => (
              <BracketColumn key={`${column.side}-${column.stage}`} {...column} />
            ))}
            <div className="tournament-center">
              <h3>FINAL</h3>
              <div className="final-pedestal">
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
        </div>
      </div>
    </section>
  );
}

function AwardsView({ awards }) {
  const [participantQuery, setParticipantQuery] = useState("");
  const leaderGoals = Math.max(1, ...((awards.topScorers || []).map((item) => item.goals)));
  const filteredPredictions = useMemo(() => {
    const search = participantQuery.trim().toLowerCase();
    if (!search) return awards.predictions || [];
    return (awards.predictions || []).filter((item) => item.name.toLowerCase().includes(search));
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
  const showManualOverride = source === "needs_manual_tiebreak" || source === "manual";
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
            Usa este desempate solo si el corte de los 8 mejores terceros necesita conducta del equipo o ranking FIFA.
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

function AdminView({ password, setPassword, leaderboard, onDone }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [logs, setLogs] = useState([]);
  const [newPassword, setNewPassword] = useState("");
  const [adminMatches, setAdminMatches] = useState([]);
  const [scoringControls, setScoringControls] = useState(null);
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
    decided_by_penalties: false
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

  async function loadAdminData() {
    await Promise.all([loadLogs(), loadAdminMatches(), loadScoringControls()]);
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

  async function handleSaveMatch(event) {
    event.preventDefault();
    if (!selectedMatchId || !isAdminUnlocked) return;
    if (!isWholeNumberString(matchForm.home_goals) || !isWholeNumberString(matchForm.away_goals)) {
      setMessage("Los goles deben ser numeros enteros mayores o iguales a 0.");
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
    const search = adminSearch.trim().toLowerCase();
    return adminMatches.filter((match) => {
      const groupCode = matchGroup(match);
      const text = `${match.match_id} ${match.home_team} ${match.away_team} ${match.stageLabel}`.toLowerCase();
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
        decided_by_penalties: false
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
      decided_by_penalties: Boolean(selectedMatch.decided_by_penalties)
    });
  }, [selectedMatch]);

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
  const [bracket, setBracket] = useState({});
  const [awards, setAwards] = useState({});
  const [stage, setStage] = useState("all");
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

  async function refreshAll() {
    setRefreshing(true);
    try {
      const [metaData, leaderboardData, matchesData, bracketData, awardsData] = await Promise.all([
        apiGet("/meta"),
        apiGet("/leaderboard"),
        apiGet("/matches?stage=all"),
        apiGet("/bracket"),
        apiGet("/awards")
      ]);
      setMeta(metaData);
      setLeaderboard(leaderboardData.rows || []);
      setMatches(matchesData.rows || []);
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
      refreshAll();
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
      {activeView === "matches" && <MatchesView matches={matches} stage={stage} setStage={setStage} />}
      {activeView === "bracket" && <BracketView bracket={bracket} />}
      {activeView === "awards" && <AwardsView awards={awards} />}
      {activeView === "admin" && <AdminView password={password} setPassword={setPassword} leaderboard={leaderboard} onDone={refreshAll} />}
    </AppShell>
  );
}
