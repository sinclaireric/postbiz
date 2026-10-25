import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '../../../supabase/migrations');

export type Db = PGlite;

/** PGlite n'embarque pas pgvector : le type `vector` des migrations devient `real[]`, la distance `<=>` vient du prélude. */
export function emulatePgvector(sql: string): string {
  return sql.replace(/create extension if not exists vector[^;]*;/gi, '').replace(/extensions\.vector(\(\d+\))?/g, 'real[]');
}

/** Base vierge : prélude Supabase puis toutes les migrations du dépôt, dans l'ordre. */
export async function createDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(readFileSync(join(here, 'prelude.sql'), 'utf8'));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await db.exec(emulatePgvector(readFileSync(join(migrationsDir, f), 'utf8')));
    } catch (e) {
      throw new Error(`Migration ${f} : ${(e as Error).message}`);
    }
  }
  return db;
}

async function withRole<T>(db: Db, role: string, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

/** Exécute `fn` comme un utilisateur connecté (rôle `authenticated`, soumis à la RLS). */
export const asUser = <T>(db: Db, userId: string, fn: () => Promise<T>) => withRole(db, 'authenticated', userId, fn);
/** Exécute `fn` comme un visiteur anonyme. */
export const asAnon = <T>(db: Db, fn: () => Promise<T>) => withRole(db, 'anon', null, fn);
/** Exécute `fn` comme le worker / les Edge Functions (rôle `service_role`). */
export const asService = <T>(db: Db, fn: () => Promise<T>) => withRole(db, 'service_role', null, fn);

export async function q<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function createUser(db: Db, email: string): Promise<string> {
  const rows = await q<{ id: string }>(db, `insert into auth.users (email) values ($1) returning id`, [email]);
  return rows[0]!.id;
}

export interface World {
  alice: string; // admin de l'org A
  carol: string; // membre de l'org A
  dave: string; // lecteur de l'org A
  bob: string; // admin de l'org B
  orgA: string;
  orgB: string;
  intA: string;
  intB: string;
}

/** Deux organisations isolées, chacune avec un canal Instagram. */
export async function seedWorld(db: Db): Promise<World> {
  const alice = await createUser(db, 'alice@a.test');
  const carol = await createUser(db, 'carol@a.test');
  const dave = await createUser(db, 'dave@a.test');
  const bob = await createUser(db, 'bob@b.test');
  const orgA = await asUser(db, alice, async () => (await q<{ id: string }>(db, `select public.create_organization('Org A') as id`))[0]!.id);
  const orgB = await asUser(db, bob, async () => (await q<{ id: string }>(db, `select public.create_organization('Org B') as id`))[0]!.id);
  await q(db, `insert into public.memberships (org_id, user_id, role) values ($1,$2,'member'), ($1,$3,'viewer')`, [orgA, carol, dave]);
  const intA = (await q<{ id: string }>(db,
    `insert into public.integrations (org_id, provider, internal_id, name) values ($1,'instagram','ig-a','Compte A') returning id`, [orgA]))[0]!.id;
  const intB = (await q<{ id: string }>(db,
    `insert into public.integrations (org_id, provider, internal_id, name) values ($1,'instagram','ig-b','Compte B') returning id`, [orgB]))[0]!.id;
  return { alice, carol, dave, bob, orgA, orgB, intA, intB };
}
