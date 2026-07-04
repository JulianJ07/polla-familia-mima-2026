import { assertNoError, nowIso } from "../db/supabase.js";

const OPTIONAL_SCHEMA_ERROR = /schema cache|does not exist|could not find|relation .* does not exist/i;

export const BRACKET_ADVANCEMENT = {
  M3: { winner: { matchId: "O1", slot: "home" } },
  M4: { winner: { matchId: "O1", slot: "away" } },
  M1: { winner: { matchId: "O2", slot: "home" } },
  M10: { winner: { matchId: "O2", slot: "away" } },
  M9: { winner: { matchId: "O3", slot: "home" } },
  M2: { winner: { matchId: "O3", slot: "away" } },
  M11: { winner: { matchId: "O4", slot: "home" } },
  M12: { winner: { matchId: "O4", slot: "away" } },
  M6: { winner: { matchId: "O5", slot: "home" } },
  M5: { winner: { matchId: "O5", slot: "away" } },
  M8: { winner: { matchId: "O6", slot: "home" } },
  M7: { winner: { matchId: "O6", slot: "away" } },
  M15: { winner: { matchId: "O7", slot: "home" } },
  M16: { winner: { matchId: "O7", slot: "away" } },
  M14: { winner: { matchId: "O8", slot: "home" } },
  M13: { winner: { matchId: "O8", slot: "away" } },
  O1: { winner: { matchId: "Q1", slot: "home" } },
  O2: { winner: { matchId: "Q1", slot: "away" } },
  O3: { winner: { matchId: "Q2", slot: "home" } },
  O4: { winner: { matchId: "Q2", slot: "away" } },
  O5: { winner: { matchId: "Q3", slot: "home" } },
  O6: { winner: { matchId: "Q3", slot: "away" } },
  O7: { winner: { matchId: "Q4", slot: "home" } },
  O8: { winner: { matchId: "Q4", slot: "away" } },
  Q1: { winner: { matchId: "S1", slot: "home" } },
  Q2: { winner: { matchId: "S1", slot: "away" } },
  Q3: { winner: { matchId: "S2", slot: "home" } },
  Q4: { winner: { matchId: "S2", slot: "away" } },
  S1: {
    winner: { matchId: "FINAL", slot: "home" },
    loser: { matchId: "THIRD", slot: "home" }
  },
  S2: {
    winner: { matchId: "FINAL", slot: "away" },
    loser: { matchId: "THIRD", slot: "away" }
  }
};

function normalizedTeam(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sameTeam(a, b) {
  return Boolean(a && b && normalizedTeam(a) === normalizedTeam(b));
}

function slotField(slot) {
  return slot === "home" ? "home_team" : "away_team";
}

function loserForMatch(match) {
  if (sameTeam(match.qualified_team, match.home_team)) return match.away_team;
  if (sameTeam(match.qualified_team, match.away_team)) return match.home_team;
  return null;
}

export function getBracketAdvancement(match) {
  const link = BRACKET_ADVANCEMENT[match?.match_id];
  if (!link || match?.status !== "finished" || !match?.qualified_team) return [];
  const updates = [];

  if (link.winner) {
    updates.push({
      fromMatchId: match.match_id,
      matchId: link.winner.matchId,
      field: slotField(link.winner.slot),
      team: match.qualified_team,
      result: "winner"
    });
  }

  const loser = loserForMatch(match);
  if (link.loser && loser) {
    updates.push({
      fromMatchId: match.match_id,
      matchId: link.loser.matchId,
      field: slotField(link.loser.slot),
      team: loser,
      result: "loser"
    });
  }

  return updates;
}

async function insertAudit(client, row) {
  const { error } = await client.from("match_result_audit").insert(row);
  if (error && OPTIONAL_SCHEMA_ERROR.test(error.message || "")) return;
  assertNoError(error, "Auditar avance de llave");
}

export async function applyBracketAdvancement(client, match, {
  actor = "scheduler",
  source = "bracket-advance",
  reason = "Clasificado propagado automaticamente en la llave.",
  at = nowIso()
} = {}) {
  const updates = getBracketAdvancement(match);
  const changed = [];

  for (const update of updates) {
    const { data: target, error: readError } = await client
      .from("match_results")
      .select("*")
      .eq("match_id", update.matchId)
      .maybeSingle();
    assertNoError(readError, `Leer partido destino ${update.matchId}`);
    if (!target || sameTeam(target[update.field], update.team)) continue;

    const patch = { [update.field]: update.team, last_updated: at };
    const { data: row, error: updateError } = await client
      .from("match_results")
      .update(patch)
      .eq("match_id", update.matchId)
      .select("*")
      .single();
    assertNoError(updateError, `Propagar llave a ${update.matchId}`);

    await insertAudit(client, {
      match_id: update.matchId,
      actor,
      source,
      reason,
      previous_value: {
        [update.field]: target[update.field],
        from_match_id: update.fromMatchId,
        result: update.result
      },
      new_value: {
        [update.field]: update.team,
        from_match_id: update.fromMatchId,
        result: update.result
      },
      created_at: at
    });

    changed.push(row);
  }

  return changed;
}
