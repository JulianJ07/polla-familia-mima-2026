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
SYNC_SECRET=un-secreto-largo-para-cron
TOP_SCORERS_SYNC_HOURS=12
```

`.env` esta en `.gitignore` y no debe subirse.

## Supabase

1. Crear el proyecto en Supabase.
2. Abrir SQL Editor.
3. Ejecutar [supabase/schema.sql](supabase/schema.sql).
4. Ejecutar [supabase/seed.sql](supabase/seed.sql).
5. Copiar `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` al `.env` local y a Render.

El backend usa la service role key solo del lado servidor. No se expone ninguna key de Supabase al navegador.

Si la base ya existe, ejecuta tambien la migracion segura:

```sql
-- supabase/migrations/20260610_match_result_overrides.sql
alter table match_results add column if not exists manual_override boolean not null default false;
alter table match_results add column if not exists locked boolean not null default false;
alter table match_results add column if not exists source text;
alter table match_results add column if not exists confirmed_at timestamptz;
alter table match_results add column if not exists raw_payload jsonb;
create index if not exists idx_match_results_override_flags on match_results(manual_override, locked);
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
SYNC_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
WORLD_CUP_GAMES_URL=https://worldcup26.ir/get/games
WORLD_CUP_GROUPS_URL=https://worldcup26.ir/get/groups
RAPIDAPI_KEY=
RAPIDAPI_HOST=v3.football.api-sports.io
TOP_SCORERS_SYNC_HOURS=12
```

En produccion se recomienda `ENABLE_CRON=false` porque Render Free puede dormir el servicio. Usa un cron externo para despertar la app y ejecutar la sincronizacion.

## Cron externo

Endpoint protegido:

```bash
POST https://TU_APP.onrender.com/api/cron/sync
```

Header recomendado:

```bash
x-sync-secret: TU_SYNC_SECRET
```

Ejemplo con `curl`:

```bash
curl -X POST "https://TU_APP.onrender.com/api/cron/sync" \
  -H "x-sync-secret: TU_SYNC_SECRET"
```

Tambien acepta query param para servicios que no permiten headers:

```bash
https://TU_APP.onrender.com/api/cron/sync?secret=TU_SYNC_SECRET
```

En cron-job.org crea un monitor tipo HTTP POST cada 5 o 10 minutos hacia `/api/cron/sync`. En GitHub Actions, puedes programar un workflow con `schedule` y ejecutar el `curl` anterior usando `SYNC_SECRET` como secret del repo.

La sincronizacion automatica actualiza partidos y recalcula puntajes. No actualiza goleadores por defecto para evitar gastar requests de API-Football/RapidAPI.

## API-Football / RapidAPI

Los goleadores se sincronizan solo si se manda `includeTopScorers=true` desde el admin y existe `RAPIDAPI_KEY`.

`TOP_SCORERS_SYNC_HOURS=12` limita internamente la consulta para no gastar requests en cada sync. Si se intenta antes de tiempo, queda registrado como `skipped` en logs.

## Correcciones manuales

Los partidos tienen campos de proteccion:

- `manual_override`: el admin corrigio el partido manualmente.
- `locked`: el partido queda blindado contra sync automatica.

Si cualquiera de esos campos esta en `true`, la sincronizacion automatica no sobrescribe equipos, goles, estado ni fecha del partido. El panel `/admin` permite corregir marcador, estado y bloqueo.

## Seed desde Excel

El script usado para generar el SQL queda disponible:

```bash
npm run seed:sql -- "C:\\ruta\\Polla Mundial 2026 1.xlsx" supabase
```

Archivos generados:

- `supabase/seed.sql`
- `supabase/seed-report.md`
- `supabase/seed-report.json`

## Admin

La ruta `/admin` permite:

- Ver logs de sincronizacion.
- Ejecutar sync manual.
- Ejecutar sync de goleadores solo cuando se pida.
- Recalcular tabla.
- Corregir resultados manualmente y bloquearlos.
- Ver tabla de posiciones.
- Cambiar password admin.
