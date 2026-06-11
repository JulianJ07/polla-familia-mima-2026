# Polla Familia Mima 2026

Aplicacion web para administrar una quiniela familiar del Mundial 2026.

## Stack

- React + Vite + Tailwind CSS + Framer Motion
- Node.js + Express + Socket.IO
- Supabase Postgres con service role desde el backend
- Seed inicial generado desde Excel para pegar en Supabase SQL Editor

## Uso local

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend: http://127.0.0.1:5173  
API local: http://127.0.0.1:4000/api/health

Configura en `.env`:

```bash
ADMIN_PASSWORD=mima2026
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_KEY=tu-service-role-o-secret-key
ENABLE_CRON=false
```

`.env` esta en `.gitignore` y no debe subirse.

## Supabase

1. Crear el proyecto en Supabase.
2. Abrir SQL Editor.
3. Ejecutar [supabase/schema.sql](supabase/schema.sql).
4. Ejecutar [supabase/seed.sql](supabase/seed.sql).
5. Copiar `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` al `.env` local y a Render.

El backend usa la service role key solo del lado servidor. No se expone ninguna key de Supabase al navegador.

Si la base ya existe, ejecuta tambien las migraciones seguras:

```sql
-- supabase/migrations/20260610_match_result_overrides.sql
alter table match_results add column if not exists manual_override boolean not null default false;
alter table match_results add column if not exists locked boolean not null default false;
alter table match_results add column if not exists source text;
alter table match_results add column if not exists confirmed_at timestamptz;
alter table match_results add column if not exists raw_payload jsonb;
create index if not exists idx_match_results_override_flags on match_results(manual_override, locked);
```

```sql
-- supabase/migrations/20260611_manual_scoring_controls.sql
-- agrega qualified_team, decided_by_penalties, posiciones finales,
-- mejores terceros, premios individuales y aliases de nombres.
```

## Render

Build command:

```bash
npm install --include=dev && npm run build
```

Start command:

```bash
npm start
```

Variables recomendadas:

```bash
ADMIN_PASSWORD=mima2026
NODE_ENV=production
ENABLE_CRON=false
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

La app no usa sincronizacion automatica de resultados. Los resultados, clasificados, posiciones de grupo y premios se cargan desde `/admin`.

## Resultados manuales

Fuente unica de verdad:

- `match_results`
- `predictions`
- `group_predictions`
- `individual_predictions`
- controles manuales guardados desde `/admin`

`ENABLE_CRON` debe quedar en `false`. Las variables `WORLD_CUP_GAMES_URL`, `WORLD_CUP_GROUPS_URL`, `RAPIDAPI_KEY` y `RAPIDAPI_HOST` ya no son necesarias.

Las rutas antiguas de sync quedan desactivadas y responden que la carga es manual.

## Correcciones manuales

Los partidos tienen campos de proteccion y cierre:

- `manual_override`: el admin corrigio el partido manualmente.
- `locked`: el partido queda blindado para cambios accidentales.
- `qualified_team`: equipo clasificado/ganador de la llave en eliminatorias.
- `decided_by_penalties`: marca informativa si la llave se definio por penales.

En fase de grupos los empates cuentan como empate. En eliminatorias, si el marcador queda empatado, el admin debe seleccionar `qualified_team` para que el scoring asigne puntos de ganador/clasificado.

## Mejores terceros

Los 8 mejores terceros se calculan automaticamente cuando las 12 tablas finales de grupo tienen metricas completas:

- puntos en fase de grupos
- diferencia de gol
- goles a favor

Esto sigue el orden principal del reglamento FIFA 2026. Si hay empate justo en el corte del cupo 8 y esos tres criterios no alcanzan, la app muestra un fallback para guardar el desempate manual, porque los siguientes criterios son conducta del equipo y ranking FIFA.

## Seed desde Excel

El script usado para generar el SQL queda disponible:

```bash
npm run seed:sql -- "C:\\ruta\\Polla Mundial 2026 1.xlsx" supabase
```

Archivos generados:

- `supabase/seed.sql`
- `supabase/seed-report.md`
- `supabase/seed-report.json`

## Actualizar horarios y Samuel

Para cargar los 104 horarios reales del Mundial 2026 y las predicciones de Samuel Jimenez desde la transcripcion auditada:

```bash
npm run data:update-schedule-samuel
```

El script usa `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` desde `.env`, actualiza `match_results.match_date`, reemplaza solo los datos del participante `id=2` y recalcula la tabla.

## Correcciones Jorge/Alejandro

Para aplicar las correcciones confirmadas en las capturas de Jorge Marquez y Alejandro Marquez:

```bash
npm run data:fix-marquez
```

El script toma los valores de `supabase/seed.sql`, hace `upsert` solo para esos dos participantes y recalcula la tabla.

## Admin

La ruta `/admin` permite:

- Ver logs de admin.
- Recalcular tabla.
- Corregir resultados manualmente.
- Seleccionar equipo clasificado en eliminatorias.
- Confirmar posiciones finales de grupo.
- Ver los 8 mejores terceros calculados automaticamente.
- Resolver manualmente un empate de mejores terceros si hace falta conducta/ranking FIFA.
- Confirmar premios individuales.
- Ver tabla de posiciones.
- Cambiar password admin.
