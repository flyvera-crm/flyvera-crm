// Test helpers: build a fresh in-memory PostgreSQL (PGlite) with the
// Supabase stand-ins, all migrations and (optionally) the development seed,
// and run queries "as" a specific signed-in user.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const here = dirname(fileURLToPath(import.meta.url));
export const SUPABASE_DIR = join(here, "..");
export const MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations");

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

/** Fresh database: Supabase stand-ins → every migration in order → seed (optional). */
export async function createDb({ seed = true } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(readFileSync(join(here, "supabase-shim.sql"), "utf8"));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (err) {
      err.message = `Migration ${file} failed: ${err.message}`;
      throw err;
    }
  }
  if (seed) {
    try {
      await db.exec(readFileSync(join(SUPABASE_DIR, "seed.sql"), "utf8"));
    } catch (err) {
      err.message = `seed.sql failed: ${err.message}`;
      throw err;
    }
  }
  return db;
}

/**
 * Runs `fn(q)` as a signed-in user (role "authenticated" + JWT sub claim),
 * inside a transaction that is ALWAYS rolled back — tests never affect each other.
 * `q(sql, params)` returns rows.
 */
export async function asUser(db, userId, fn) {
  return runAs(db, "authenticated", userId, fn);
}

/** Same, as a logged-out visitor (role "anon"). */
export async function asAnon(db, fn) {
  return runAs(db, "anon", null, fn);
}

async function runAs(db, role, userId, fn) {
  let result;
  let error;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
    ]);
    const q = makeQ(tx);
    try {
      result = await fn(q);
    } catch (e) {
      error = e;
    }
    await tx.rollback();
  });
  if (error) throw error;
  return result;
}

/**
 * q(sql, params) → rows.
 * q.fails(sql, params, /pattern/) → the statement must fail (with a matching message);
 * a savepoint keeps the surrounding transaction usable afterwards.
 */
function makeQ(tx) {
  const q = async (sql, params) => (await tx.query(sql, params)).rows;
  let n = 0;
  q.fails = async (sql, params, pattern) => {
    const sp = `expect_fail_${++n}`;
    await tx.query(`savepoint ${sp}`);
    try {
      await tx.query(sql, params);
    } catch (e) {
      await tx.query(`rollback to savepoint ${sp}`);
      if (pattern && !pattern.test(e.message)) {
        throw new Error(`Expected error matching ${pattern} but got: ${e.message}\nSQL: ${sql}`);
      }
      return e.message;
    }
    throw new Error(`Expected this statement to be rejected, but it succeeded:\n${sql}`);
  };
  return q;
}

/** Runs `fn(q)` as the database owner (no RLS) in a rolled-back transaction. */
export async function asOwner(db, fn) {
  let result;
  let error;
  await db.transaction(async (tx) => {
    const q = makeQ(tx);
    try {
      result = await fn(q);
    } catch (e) {
      error = e;
    }
    await tx.rollback();
  });
  if (error) throw error;
  return result;
}

/** Expects `promise` to fail; returns the error message (or throws if it succeeded). */
export async function rejects(promise, pattern) {
  try {
    await promise;
  } catch (e) {
    if (pattern && !pattern.test(e.message)) {
      throw new Error(`Expected error matching ${pattern} but got: ${e.message}`);
    }
    return e.message;
  }
  throw new Error(`Expected an error${pattern ? ` matching ${pattern}` : ""}, but the statement succeeded`);
}
