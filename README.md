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

Para la auditoria del 21 de junio, ejecuta tambien:

```sql
-- supabase/migrations/20260621_participants_and_official_results.sql
-- agrega a Patricia Garcia y Luis Alejandro Patino sin borrar datos,
-- carga sus pronosticos diligenciados y corrige los resultados auditados.
```

La migracion es aditiva e idempotente. Antes de desplegar puedes validarla con:

```bash
npm run check
```

Para habilitar la sincronizacion inteligente, ejecuta despues:

```sql
-- supabase/migrations/20260622_api_football_smart_sync.sql
-- agrega cache en vivo, fixture IDs, prioridad, cuota, configuracion y auditoria.
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
API_FOOTBALL_KEY=
API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io
SYNC_SECRET=
```

Activa `ENABLE_CRON=true` solamente despues de ejecutar la migracion, mapear los fixture IDs y confirmar que el plan de API-Football tiene acceso a la temporada 2026.

Despues de aplicar migraciones, sube la rama al repositorio conectado a Render. El `render.yaml` ejecuta el build y el arranque; valida `/api/health`, `/api/meta`, `/api/standings` y finalmente `/grupos`.

## Resultados automaticos y manuales

Fuente unica de verdad:

- `match_results`
- `predictions`
- `group_predictions`
- `individual_predictions`
- controles manuales guardados desde `/admin`

El navegador nunca recibe la clave ni llama a API-Football. Los estados `1H`, `HT`, `2H`, `ET`, `BT` y `P` alimentan solamente la tabla publica provisional. La puntuacion cambia exclusivamente con `FT`, `AET` o `PEN`.

El scheduler agrupa fixture IDs en `/fixtures?ids=...`, usa mutex y registra cada consulta. Las prioridades P0-P3 y los modos `normal`, `saving`, `critical` y `emergency` protegen el limite diario.

El panel `/admin` permite activar la sync, editar equipos populares y favoritos, destacar partidos, cambiar prioridad, asignar fixture IDs, forzar actualizaciones y revisar cuota. Resultados, posiciones finales de grupo y mejores terceros siguen siendo corregibles manualmente.

Una correccion manual establece `manual_override`; `locked` impide tambien cambios en vivo. Los cambios quedan registrados en `match_result_audit`.

### Limitacion comprobada del plan Free

El 21 de junio de 2026 una clave Free valida respondio que `league=1&season=2026` no esta disponible y que el plan solo permite temporadas 2022-2024. La integracion muestra ese error en administracion, pero necesita un plan con acceso a 2026 para sincronizar el Mundial.

Mientras el plan no tenga acceso a 2026, deja `ENABLE_CRON=false`. Las variables antiguas `WORLD_CUP_GAMES_URL`, `WORLD_CUP_GROUPS_URL`, `RAPIDAPI_KEY` y `RAPIDAPI_HOST` ya no son necesarias.

## Correcciones manuales

Los partidos tienen campos de proteccion y cierre:

- `manual_override`: el admin corrigio el partido manualmente.
- `locked`: el partido queda blindado para cambios accidentales.
- `qualified_team`: equipo clasificado/ganador de la llave en eliminatorias.
- `decided_by_penalties`: marca informativa si la llave se definio por penales.

En fase de grupos los empates cuentan como empate. En eliminatorias, si el marcador queda empatado, el admin debe seleccionar `qualified_team` para que el scoring asigne puntos de ganador/clasificado.

## Mejores terceros

La ruta publica `/grupos` muestra las 12 tablas y los 12 terceros de forma provisional. Los 8 clasificados se confirman automaticamente solo cuando las 12 tablas finales tienen metricas completas:

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
- `supabase/seed-data.json`

La migracion auditada se puede regenerar desde el Excel actualizado:

```bash
npm run data:generate-audit-migration -- "C:\ruta\Polla Mundial 2026 1 (2).xlsx"
```

Para aplicarla de forma idempotente con las credenciales de `.env` y recalcular los puntajes:

```bash
npm run data:apply-audit -- "C:\ruta\Polla Mundial 2026 1 (2).xlsx"
```

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
