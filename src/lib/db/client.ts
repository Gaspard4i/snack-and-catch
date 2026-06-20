import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

/** True when no DATABASE_URL is configured (build without connected DB). */
export const isDbMissing = () => !process.env.DATABASE_URL;

/**
 * Cache the postgres client on globalThis so Next.js HMR reloads reuse the
 * same pool. Otherwise each hot reload opens a fresh pool and the old ones
 * linger until their idle_timeout, quickly hitting the Postgres connection
 * cap with "sorry, too many clients already".
 */
const GLOBAL_KEY = Symbol.for("snackAndCatch.db");
type GlobalDb = { db?: DB; client?: postgres.Sql };
const store = globalThis as unknown as Record<symbol, GlobalDb>;
store[GLOBAL_KEY] ??= {};
const holder = store[GLOBAL_KEY];

function createDb(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Configure it in your environment (.env.local or Vercel project settings).",
    );
  }
  /**
   * Managed poolers (Supabase / Neon / RDS …) terminate TLS — `ssl:
   * "require"` makes the postgres-js client opt into encrypted transport
   * without needing a CA bundle. The self-hosted gazai DB runs on the
   * internal Docker network (`@db:5432`, no SSL), so it correctly skips
   * this branch.
   */
  const needsSsl = /supabase|neon|render|amazonaws|sslmode=require/.test(url);
  const client = postgres(url, {
    // Dev had 3 originally, but the species page fan-outs nine
    // queries in Promise.all → pool starvation → 30s timeouts. Bump
    // to 10 so a single page load fits in one pool round-trip.
    max: process.env.NODE_ENV === "production" ? 10 : 10,
    idle_timeout: 20,
    max_lifetime: 60 * 10,
    ssl: needsSsl ? "require" : undefined,
  });
  holder.client = client;
  return drizzle(client, { schema });
}

/**
 * Proxy that defers `DATABASE_URL` validation to the first DB access.
 * Lets Next.js import route modules at build time without the env var.
 */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop, receiver) {
    if (!holder.db) holder.db = createDb();
    const value = Reflect.get(holder.db, prop, receiver);
    return typeof value === "function" ? value.bind(holder.db) : value;
  },
});

/**
 * Runs the query and, if the DB is unavailable (e.g. during a Vercel build
 * when DATABASE_URL has not been provisioned yet), returns the provided
 * fallback. In normal runtime with a configured DB, errors still propagate.
 */
export async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

  if (isDbMissing()) {
    // Build sans DATABASE_URL : on throw pour que Next skip le prerender de cette
    // route plutot que de cacher [] dans le Data Cache (qui resterait servi
    // jusqu'a la prochaine revalidation, soit 6h).
    if (isBuildPhase) {
      throw new Error("[db] DATABASE_URL missing at build time — skipping prerender");
    }
    return fallback;
  }
  try {
    return await fn();
  } catch (err) {
    // Pendant le build, throw aussi pour invalider le prerender et eviter de
    // mettre en cache un fallback vide. unstable_cache ne stockera pas une
    // exception, donc le runtime retentera la query live et marchera.
    if (isBuildPhase) {
      throw err;
    }
    /**
     * Runtime : degrader gracieusement plutot que throw. Un throw ici remonte
     * dans le Server Component render et Next affiche la generique "A server
     * error occurred" — inutile pour les users quand la cause est un probleme
     * DB transient (conteneur qui redemarre, pool sature). Retourner le
     * fallback garde la route renderable ; les composants downstream gerent
     * deja les arrays vides / null. L'erreur est logguee pour visibilite.
     */
    console.warn(
      "[db] query failed, falling back:",
      err instanceof Error ? err.message : err,
    );
    return fallback;
  }
}

export { schema };
