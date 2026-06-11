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
ENABLE_CRON=true
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
WORLD_CUP_GAMES_URL=https://worldcup26.ir/get/games
WORLD_CUP_GROUPS_URL=https://worldcup26.ir/get/groups
RAPIDAPI_KEY=
RAPIDAPI_HOST=v3.football.api-sports.io
```

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
- Recalcular tabla.
- Ver tabla de posiciones.
- Cambiar password admin.
