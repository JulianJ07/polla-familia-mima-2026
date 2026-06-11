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
  Trophy,
  UserRound,
  XCircle
} from "lucide-react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { adminPatch, adminPost, apiGet } from "./api.js";
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
    finished: ["Finalizado", "bg-mint/15 text-mint"],
    live: ["En vivo", "bg-red-400/15 text-red-200"],
    scheduled: ["Programado", "bg-white/10 text-muted"]
  }[status] || ["Pendiente", "bg-white/10 text-muted"];
  return <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold", config[1])}>{config[0]}</span>;
}

function AppShell({ activeView, setActiveView, meta, onRefresh, refreshing, children }) {
  return (
    <div className="min-h-screen bg-night text-ink">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-night/86 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <button className="grid size-10 place-items-center rounded-md border border-gold/35 bg-gold/10 text-gold shadow-glow" type="button">
            <Trophy size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl tracking-normal text-white sm:text-3xl">Polla Familia Mima 2026</h1>
            <p className="truncate text-xs font-semibold text-muted">{meta.currentPhase || "Previa del torneo"}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onRefresh}
            title="Actualizar"
            aria-label="Actualizar"
          >
            <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
          </button>
          <button
            className={cx("icon-button", activeView === "admin" && "border-gold/50 text-gold")}
            type="button"
            onClick={() => setActiveView("admin")}
            title="Admin"
            aria-label="Admin"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-night/92 px-3 py-2 backdrop-blur-xl lg:bottom-auto lg:right-auto lg:top-16 lg:h-[calc(100vh-4rem)] lg:w-20 lg:border-r lg:border-t-0 lg:px-2 lg:py-4">
        <nav className="mx-auto grid max-w-lg grid-cols-4 gap-2 lg:flex lg:h-full lg:flex-col lg:items-center">
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

      <main className="pt-16 lg:pl-20">{children}</main>
    </div>
  );
}

function LeaderboardView({ leaderboard, meta, onSelectParticipant, selectedParticipant, participantDetail }) {
  const lastUpdate = leaderboard[0]?.lastCalculated || meta.lastCalculated;
  return (
    <>
      <section className="relative min-h-[calc(100svh-4rem)] overflow-hidden">
        <img className="absolute inset-0 h-full w-full object-cover opacity-50" src={stadiumImage} alt="" />
        <div className="absolute inset-0 bg-gradient-to-b from-night/45 via-night/88 to-night" />
        <div className="relative mx-auto flex min-h-[calc(100svh-4rem)] max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase text-mint">Tabla de posiciones</p>
              <h2 className="font-display text-5xl tracking-normal text-white sm:text-6xl">Marcador familiar</h2>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-muted">
              <CalendarClock size={16} />
              <span>{timeAgo(lastUpdate)}</span>
            </div>
          </div>

          <div className="leaderboard-shell">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[72px_minmax(220px,1fr)_130px_210px] items-center gap-3 border-b border-white/10 px-4 py-3 text-xs font-extrabold uppercase text-muted">
                <span>Posicion</span>
                <span>Nombre</span>
                <span>Puntos</span>
                <span>Ultimos partidos</span>
              </div>
              <div className="divide-y divide-white/8">
                {leaderboard.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={cx(
                      "leaderboard-row",
                      row.position === 1 && "rank-gold",
                      row.position === 2 && "rank-silver",
                      row.position === 3 && "rank-bronze",
                      selectedParticipant === row.id && "ring-1 ring-mint/60"
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
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white/10 font-black text-white">
                        {row.name.slice(0, 1)}
                      </span>
                      <span className="truncate text-left font-extrabold text-white">{row.name}</span>
                      {row.position === 12 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-1 text-xs font-black text-gold">
                          <Armchair size={13} /> Doceavo
                        </span>
                      )}
                    </span>
                    <span className="font-display text-4xl text-gold">
                      <AnimatedNumber value={row.totalPoints} />
                    </span>
                    <span className="flex gap-1.5">
                      {row.recent.length ? (
                        row.recent.map((chip) => (
                          <span
                            key={chip.matchId}
                            className={cx("result-chip", chip.ok ? "bg-mint/18 text-mint" : "bg-white/10 text-muted")}
                            title={`${chip.label}: ${chip.points} pts`}
                          >
                            {chip.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-muted">Sin partidos</span>
                      )}
                    </span>
                  </button>
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
          <div key={row.id} className="stat-tile">
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
  if (!detail) {
    return (
      <div className="panel grid min-h-44 place-items-center text-center text-sm font-semibold text-muted">
        <UserRound className="mb-3 text-mint" size={28} />
        Selecciona un participante
      </div>
    );
  }

  const predictions = detail.predictions || [];
  const groups = (detail.groups || []).reduce((acc, row) => {
    acc[row.group_code] ||= [];
    acc[row.group_code].push(row);
    return acc;
  }, {});
  const stageBuckets = predictions.reduce((acc, item) => {
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

      {detail.individual && (
        <div className="prediction-section">
          <div className="prediction-section-title">
            <h4>Individuales</h4>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="mini-stat">
              <span>{detail.individual.top_scorer || "-"}</span>
              <small>goleador</small>
            </div>
            <div className="mini-stat">
              <span>{detail.individual.best_player || "-"}</span>
              <small>mejor jugador</small>
            </div>
            <div className="mini-stat">
              <span>{detail.individual.best_goalkeeper || "-"}</span>
              <small>mejor arquero</small>
            </div>
          </div>
        </div>
      )}

      <div className="prediction-section">
        <div className="prediction-section-title">
          <h4>Partidos</h4>
          <span>todos los marcadores del participante</span>
        </div>
        <div className="prediction-stage-stack">
          {Object.entries(stageBuckets).map(([label, items]) => (
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
      </div>
    </div>
  );
}

function MatchesView({ matches, stage, setStage }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return matches.filter((match) => {
      if (!search) return true;
      return `${match.home_team} ${match.away_team} ${match.stageLabel}`.toLowerCase().includes(search);
    });
  }, [matches, query]);

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

      <div className="match-grid">
        {filtered.map((match) => (
          <article key={match.match_id} className="match-card">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-black uppercase text-mint">{match.stageLabel}</span>
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
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="mini-stat">
                <span>{match.prediction_count || 0}</span>
                <small>pronosticos</small>
              </div>
              <div className="mini-stat">
                <span>{match.exact_count || 0}</span>
                <small>exactos</small>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function BracketMatchCard({ match, compact = false }) {
  return (
    <article className={cx("bracket-match", compact && "bracket-match-center")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black text-muted">{match?.match_id || "Pendiente"}</span>
        <CircleDot size={14} className={match?.status === "live" ? "text-red-300" : "text-mint"} />
      </div>
      <p className="mt-2 truncate text-xs font-bold text-muted">{formatColombiaDate(match?.match_date)}</p>
      <div className="mt-3 space-y-1">
        <p className="truncate font-bold text-white">{match?.home_team || "Local"}</p>
        <p className="truncate font-bold text-white">{match?.away_team || "Visitante"}</p>
      </div>
      <div className="mt-3 text-sm font-black text-gold">
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
  const [zoom, setZoom] = useState(0.88);
  const r32 = bracket.r32 || [];
  const r16 = bracket.r16 || [];
  const qf = bracket.qf || [];
  const sf = bracket.sf || [];
  const finalMatch = bracket.final?.[0];
  const thirdMatch = bracket.third?.[0];
  const width = 1420;
  const height = 850;

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
    setZoom((current) => Math.min(1.25, Math.max(0.68, Number((current + delta).toFixed(2)))));
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
  const leaderGoals = Math.max(1, ...((awards.topScorers || []).map((item) => item.goals)));
  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Goleadores</p>
          <h2 className="page-title">Apuestas individuales</h2>
        </div>
        <Goal className="text-gold" size={32} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="panel">
          <h3 className="section-title mb-4">Tabla de goleadores</h3>
          <div className="space-y-3">
            {(awards.topScorers || []).map((player, index) => (
              <div key={player.player_name} className="scorer-row">
                <span className="grid size-8 place-items-center rounded-md bg-white/10 font-black text-white">#{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold text-white">{player.player_name}</p>
                  <div className="mt-2 h-2 rounded-full bg-white/10">
                    <div className="h-2 rounded-full bg-mint" style={{ width: `${(player.goals / leaderGoals) * 100}%` }} />
                  </div>
                </div>
                <strong className="font-display text-3xl text-gold">{player.goals}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="award-grid">
          {(awards.predictions || []).map((item) => (
            <article key={item.participant_id} className="award-card">
              <div className="mb-3 flex items-center justify-between">
                <strong className="truncate text-white">{item.name}</strong>
                <Trophy size={18} className="text-gold" />
              </div>
              <AwardLine label="Goleador" value={item.top_scorer} actual={awards.results?.top_scorer} points={5} />
              <AwardLine label="Balon de Oro" value={item.best_player} actual={awards.results?.best_player} points={5} />
              <AwardLine label="Guante de Oro" value={item.best_goalkeeper} actual={awards.results?.best_goalkeeper} points={6} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function AwardLine({ label, value, actual, points }) {
  const hit = value && actual && value.toLowerCase() === actual.toLowerCase();
  return (
    <div className="award-line">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase text-muted">{label}</p>
        <p className="truncate font-bold text-white">{value || "-"}</p>
      </div>
      <span className={cx("rounded-full px-2 py-1 text-xs font-black", hit ? "bg-mint/15 text-mint" : "bg-white/10 text-muted")}>
        {hit ? `+${points}` : "en juego"}
      </span>
    </div>
  );
}

function AdminView({ password, setPassword, leaderboard, onDone }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [logs, setLogs] = useState([]);
  const [newPassword, setNewPassword] = useState("");
  const [includeTopScorers, setIncludeTopScorers] = useState(false);
  const [adminMatches, setAdminMatches] = useState([]);
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
    locked: false
  });

  function nullableNumber(value) {
    return value === "" || value == null ? null : Number(value);
  }

  function matchGroup(match) {
    const [, groupCode] = String(match.match_id || "").match(/^G-([A-L])-/i) || [];
    return groupCode?.toUpperCase() || "";
  }

  function syncMessage(summary) {
    const games = summary?.games || {};
    const scorers = summary?.topScorers || {};
    const scorersText = includeTopScorers
      ? ` Goleadores: ${scorers.skipped ? scorers.reason : `${scorers.updated || 0} actualizados`}.`
      : "";
    return `Sync listo: ${games.updated || 0} partidos actualizados, ${games.skippedLocked || 0} bloqueados omitidos.${scorersText}`;
  }

  async function loadLogs() {
    if (!password) return;
    const data = await fetch("/api/admin/logs", { headers: { "x-admin-password": password } }).then(async (response) => {
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "No se pudieron leer logs");
      return json;
    });
    setLogs(data.rows || []);
  }

  async function loadAdminMatches() {
    const data = await apiGet("/matches?stage=all");
    setAdminMatches(data.rows || []);
  }

  async function handleUnlock(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await loadLogs();
      await loadAdminMatches();
      setIsAdminUnlocked(true);
      setMessage("Admin desbloqueado.");
    } catch (error) {
      setIsAdminUnlocked(false);
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    setMessage("");
    try {
      const result = await adminPost("/admin/sync", password, { includeTopScorers });
      setMessage(syncMessage(result.summary));
      await loadLogs();
      await loadAdminMatches();
      onDone();
    } catch (error) {
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
      await loadLogs();
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
    setBusy(true);
    setMessage("");
    try {
      await adminPatch(`/admin/matches/${encodeURIComponent(selectedMatchId)}`, password, {
        home_team: matchForm.home_team,
        away_team: matchForm.away_team,
        home_goals: nullableNumber(matchForm.home_goals),
        away_goals: nullableNumber(matchForm.away_goals),
        status: matchForm.status,
        match_date: colombiaDateTimeToIso(matchForm.match_date),
        manual_override: matchForm.manual_override,
        locked: matchForm.locked
      });
      setMessage("Resultado manual guardado y tabla recalculada.");
      await loadAdminMatches();
      await loadLogs();
      onDone();
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
      await loadLogs();
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
        locked: false
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
      locked: selectedMatch.locked ?? false
    });
  }, [selectedMatch]);

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h2 className="page-title">Carga y sincronizacion</h2>
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
              <label className="flex items-center gap-2 text-sm font-bold text-muted">
                <input type="checkbox" checked={includeTopScorers} onChange={(event) => setIncludeTopScorers(event.target.checked)} />
                Incluir goleadores
              </label>
              <div className="flex flex-wrap gap-3">
                <button className="secondary-button" type="button" onClick={handleSync} disabled={busy}>
                  <Activity size={18} /> Sync
                </button>
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
          {message && <p className="rounded-md border border-white/10 bg-white/6 p-3 text-sm font-semibold text-muted">{message}</p>}
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
                <span className="rounded-full bg-gold/10 px-2 py-1 text-sm font-black text-gold">{formatPoints(row.totalPoints)}</span>
              </div>
            ))}
          </div>
        </div>

        {isAdminUnlocked ? (
          <form className="panel space-y-4 lg:col-span-2" onSubmit={handleSaveMatch}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="section-title">Resultado manual</h3>
              {selectedMatch && (
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-muted">
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
                  className="text-input"
                  value={matchForm.home_team}
                  onChange={(event) => setMatchForm((current) => ({ ...current, home_team: event.target.value }))}
                />
              </label>
              <label className="field-label">
                Equipo visitante
                <input
                  className="text-input"
                  value={matchForm.away_team}
                  onChange={(event) => setMatchForm((current) => ({ ...current, away_team: event.target.value }))}
                />
              </label>
              <label className="field-label">
                Goles local
                <input
                  className="text-input"
                  type="number"
                  min="0"
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
                  <option value="live">live</option>
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
            </div>
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

        {isAdminUnlocked && (
          <div className="panel lg:col-span-2">
            <h3 className="section-title mb-4">Logs de sincronizacion</h3>
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="detail-row">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-white">{log.source}</p>
                    <p className="truncate text-xs text-muted">{log.message}</p>
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
        apiGet(`/matches?stage=${stage}`),
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
  }, [stage]);

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
