# Snack & Catch

Companion web app for the [Cobblemon](https://cobblemon.com) Minecraft mod.
Plan your seasonings, cook the right Poké Snack, then find where the
Pokémon you want actually spawns.

> Cook the right snack. Catch the right Cobblemon.

**Live:** https://snack-and-catch.vercel.app

## Features

- **Cobbledex** — searchable index of every Cobblemon species with
  types, biomes, spawn conditions and sprites.
- **Snack maker** — interactive Campfire Pot with a real-time 3D snack
  preview that reacts to the seasonings (berries) you drop in.
- **Bait maker** — same workflow tuned for Poké Bait, including the
  faithful in-game tinting (multi-layer dye blending from the mod's
  `PokeBaitItemColorProvider`).
- **Aprijuice maker** — pick apricorn combinations and get the resulting
  ride-stat profile.
- **Spawn lookup** — biome- and context-aware spawn data so you know
  whether a Pokémon shows up grounded, surface, submerged, in the air or
  underground.
- **i18n** — English, French, Spanish, German, Portuguese, Japanese and
  Chinese (Simplified) via `next-intl`.
- **Themes** — light, dark, and four flavoured palettes (Pokécenter,
  Grass, Fire, Water).

## Tech stack

- **Next.js 16** (App Router, Cache Components / PPR) + **React 19**
- **Tailwind CSS 4**
- **PostgreSQL** — Docker locally and in production (self-hosted on the gazai VPS)
- **Drizzle ORM** + **Zod** for typed data access and validation
- **Three.js** / `@react-three/fiber` for the 3D snack preview
- **Vitest** for unit + integration tests
- Deployed on the **gazai VPS** (Docker Compose, image built and pushed by GitHub Actions)

## Data sources

All gameplay data is derived from upstream open content:

- [Cobblemon source repository](https://gitlab.com/cable-mc/cobblemon) — MPL 2.0
- [Official Cobblemon wiki](https://wiki.cobblemon.com) — CC BY 4.0

Species, spawns, berries, seasonings and apricorn data are extracted
locally during ingestion. No upstream assets are redistributed; sprites
and textures are fetched on demand from the official mod repository.

## Getting started

Requirements: Node 20+, pnpm, Docker.

```sh
pnpm install
cp .env.example .env.local           # adjust DATABASE_URL if needed
docker compose up -d                 # Postgres on :5433
pnpm db:migrate                      # apply Drizzle schema
pnpm ingest                          # pull Cobblemon data into the DB (~30s)
pnpm dev                             # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Run the production build |
| `pnpm test` | Vitest run |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm db:generate` | Generate a new Drizzle migration from the schema |
| `pnpm db:migrate` | Apply migrations against `.env.local` |
| `pnpm db:push` | Push schema directly (dev only) |
| `pnpm ingest` | Full Cobblemon data pipeline (species, spawns, berries) |
| `pnpm ingest:wiki` | Wiki-only enrichment pass |
| `pnpm ingest:textures` | Pull mod textures on demand |

Production variants suffixed with `:prod` use `.env.production`.

## Project layout

```
src/
  app/                   App Router routes (pokedex, snack, bait, juice, …)
  components/            UI components (CampfirePot, Snack3D, Landing, …)
  lib/
    db/                  Drizzle client, schema, queries
    parsers/             Zod schemas for Cobblemon JSON
    sources/             Upstream fetchers (GitLab, wiki)
    recommend/           Snack / juice recommendation engine
ingest/                  Data ingestion pipeline
drizzle/                 SQL migrations
public/textures/         Cached sprites and item textures
tests/                   Vitest specs and fixtures
```

## Deployment

The app is self-hosted on the gazai VPS with Docker Compose. Pushing to
`master` triggers GitHub Actions, which builds the image, pushes it to
GHCR, and runs `deploy.sh` on the VPS to pull and restart the web service.

The production Postgres (`snack-db`) is not exposed outside the VPS, so DB
tasks run inside the container over SSH — e.g.
`pnpm ingest:berry-drops:prod`. See `.env.production` for details.

`metadataBase` reads from `NEXT_PUBLIC_SITE_URL` so OpenGraph and
Twitter cards always resolve to the right host on previews.

## License

[MIT](./LICENSE) for the application code.

Cobblemon assets and game data remain under their original licenses
(MPL 2.0 and CC BY 4.0). This project is not affiliated with Cobblemon
or The Pokémon Company.
