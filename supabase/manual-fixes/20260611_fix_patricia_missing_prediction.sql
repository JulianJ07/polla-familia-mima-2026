-- Fix missing Patricia Jimenez knockout/final prediction safely.
-- participant_id = 16. This script does not delete Patricia rows.
-- Source: Polla Mundial 2026 1 (1).xlsx / expected final-phase list.

BEGIN;

-- Diagnostic: rows from the expected final-phase set that are missing right now.
WITH expected(match_id, stage, predicted_home_team, predicted_home_goals, predicted_away_goals, predicted_away_team) AS (
  VALUES
  ('M1', 'r32', 'Ecuador', 2, 0, 'Canadá'),
  ('M9', 'r32', 'Brasil', 4, 1, 'Japón'),
  ('O1', 'r16', 'Ecuador', 0, 2, 'Francia'),
  ('M2', 'r32', 'Francia', 5, 0, 'Irán'),
  ('M10', 'r32', 'Alemania', 4, 1, 'Senegal'),
  ('O2', 'r16', 'Corea', 0, 2, 'Holanda'),
  ('M3', 'r32', 'Corea', 2, 1, 'Bosnia'),
  ('M11', 'r32', 'México', 2, 2, 'Noruega'),
  ('O3', 'r16', 'Colombia', 2, 1, 'España'),
  ('M4', 'r32', 'Holanda', 3, 1, 'Marruecos'),
  ('M12', 'r32', 'Inglaterra', 3, 0, 'Argelia'),
  ('O4', 'r16', 'USA', 2, 0, 'Bélgica'),
  ('M5', 'r32', 'Colombia', 2, 1, 'Croacia'),
  ('M13', 'r32', 'Argentina', 0, 1, 'Uruguay'),
  ('O5', 'r16', 'Brasil', 2, 1, 'Alemania'),
  ('M6', 'r32', 'España', 4, 0, 'Austria'),
  ('M14', 'r32', 'Paraguay', 2, 0, 'Egipto'),
  ('O6', 'r16', 'México', 1, 3, 'Inglaterra'),
  ('M7', 'r32', 'USA', 2, 0, 'Escocia'),
  ('M15', 'r32', 'Suiza', 2, 0, 'Uzbekistán'),
  ('O7', 'r16', 'Uruguay', 1, 2, 'Paraguay'),
  ('M8', 'r32', 'Bélgica', 2, 1, 'Turquía'),
  ('M16', 'r32', 'Portugal', 4, 0, 'Ghana'),
  ('O8', 'r16', 'Suiza', 0, 3, 'Portugal'),
  ('Q1', 'qf', 'Francia', 3, 1, 'Holanda'),
  ('Q2', 'qf', 'Colombia', 2, 0, 'USA'),
  ('Q3', 'qf', 'Brasil', 3, 2, 'Inglaterra'),
  ('Q4', 'qf', 'Paraguay', 0, 3, 'Portugal'),
  ('S1', 'sf', 'Francia', 3, 1, 'Colombia'),
  ('S2', 'sf', 'Brasil', 2, 2, 'Portugal'),
  ('FINAL', 'final', 'Francia', 3, 2, 'Brasil'),
  ('THIRD', 'third', 'Colombia', 1, 2, 'Portugal')
)
SELECT e.*
FROM expected e
LEFT JOIN predictions p
  ON p.participant_id = 16
 AND p.match_id = e.match_id
WHERE p.match_id IS NULL
ORDER BY e.match_id;

-- Idempotent insert: inserts only missing rows and never duplicates.
WITH expected(match_id, stage, predicted_home_team, predicted_home_goals, predicted_away_goals, predicted_away_team) AS (
  VALUES
  ('M1', 'r32', 'Ecuador', 2, 0, 'Canadá'),
  ('M9', 'r32', 'Brasil', 4, 1, 'Japón'),
  ('O1', 'r16', 'Ecuador', 0, 2, 'Francia'),
  ('M2', 'r32', 'Francia', 5, 0, 'Irán'),
  ('M10', 'r32', 'Alemania', 4, 1, 'Senegal'),
  ('O2', 'r16', 'Corea', 0, 2, 'Holanda'),
  ('M3', 'r32', 'Corea', 2, 1, 'Bosnia'),
  ('M11', 'r32', 'México', 2, 2, 'Noruega'),
  ('O3', 'r16', 'Colombia', 2, 1, 'España'),
  ('M4', 'r32', 'Holanda', 3, 1, 'Marruecos'),
  ('M12', 'r32', 'Inglaterra', 3, 0, 'Argelia'),
  ('O4', 'r16', 'USA', 2, 0, 'Bélgica'),
  ('M5', 'r32', 'Colombia', 2, 1, 'Croacia'),
  ('M13', 'r32', 'Argentina', 0, 1, 'Uruguay'),
  ('O5', 'r16', 'Brasil', 2, 1, 'Alemania'),
  ('M6', 'r32', 'España', 4, 0, 'Austria'),
  ('M14', 'r32', 'Paraguay', 2, 0, 'Egipto'),
  ('O6', 'r16', 'México', 1, 3, 'Inglaterra'),
  ('M7', 'r32', 'USA', 2, 0, 'Escocia'),
  ('M15', 'r32', 'Suiza', 2, 0, 'Uzbekistán'),
  ('O7', 'r16', 'Uruguay', 1, 2, 'Paraguay'),
  ('M8', 'r32', 'Bélgica', 2, 1, 'Turquía'),
  ('M16', 'r32', 'Portugal', 4, 0, 'Ghana'),
  ('O8', 'r16', 'Suiza', 0, 3, 'Portugal'),
  ('Q1', 'qf', 'Francia', 3, 1, 'Holanda'),
  ('Q2', 'qf', 'Colombia', 2, 0, 'USA'),
  ('Q3', 'qf', 'Brasil', 3, 2, 'Inglaterra'),
  ('Q4', 'qf', 'Paraguay', 0, 3, 'Portugal'),
  ('S1', 'sf', 'Francia', 3, 1, 'Colombia'),
  ('S2', 'sf', 'Brasil', 2, 2, 'Portugal'),
  ('FINAL', 'final', 'Francia', 3, 2, 'Brasil'),
  ('THIRD', 'third', 'Colombia', 1, 2, 'Portugal')
)
INSERT INTO predictions (
  participant_id,
  match_id,
  predicted_home_goals,
  predicted_away_goals,
  predicted_home_team,
  predicted_away_team,
  stage
)
SELECT
  16,
  e.match_id,
  e.predicted_home_goals,
  e.predicted_away_goals,
  e.predicted_home_team,
  e.predicted_away_team,
  e.stage
FROM expected e
WHERE NOT EXISTS (
  SELECT 1
  FROM predictions p
  WHERE p.participant_id = 16
    AND p.match_id = e.match_id
)
ON CONFLICT (participant_id, match_id) DO NOTHING;

COMMIT;

-- Verification
SELECT participant_id, COUNT(*) AS total
FROM predictions
WHERE participant_id = 16
GROUP BY participant_id;
