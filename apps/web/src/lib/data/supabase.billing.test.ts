import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DEMO_CONTEXT } from './demo';
import { createSupabaseRepositories } from './supabase';

// Les réservations de quota, essayées avec un faux client : réponses de la base, et comportement quand la migration de facturation n'est pas appliquée.
// Les règles elles-mêmes (mois, plans, verrous) sont dans les fonctions SQL, testées dans packages/db.

type Reply = { data?: unknown; error?: { message: string; code?: string } | null };
const MISSING = { message: 'Could not find the function public.ai_media_reserve(p_daily_limit, p_kind, p_org) in the schema cache', code: 'PGRST202' };

function repos(rpc: (name: string, args: Record<string, unknown>) => Reply) {
  const calls: string[] = [];
  const supabase = { rpc: async (name: string, args: Record<string, unknown>) => (calls.push(name), { data: null, error: null, ...rpc(name, args) }) } as unknown as SupabaseClient;
  return { generation: createSupabaseRepositories(supabase, DEMO_CONTEXT).generation, calls };
}

describe('quota d’images et de vidéos', () => {
  it('traduit la réponse de la base : ok → vrai, quota du mois → « monthly », plafond du jour ou accès refusé → faux', async () => {
    for (const [data, expected] of [['ok', true], ['monthly', 'monthly'], ['daily', false], ['denied', false]] as const) {
      expect(await repos(() => ({ data })).generation.reserve('image', 30), String(data)).toBe(expected);
    }
  });

  it('une vraie erreur (droits, réseau) refuse, sans retomber sur l’ancienne fonction', async () => {
    const r = repos(() => ({ error: { message: 'permission denied', code: '42501' } }));
    expect(await r.generation.reserve('video', 5)).toBe(false);
    expect(r.calls).toEqual(['ai_media_reserve']);
  });

  it('migration pas appliquée : retombe sur le plafond journalier d’avant (ai_generation_reserve)', async () => {
    const ok = repos((name) => (name === 'ai_media_reserve' ? { error: MISSING } : { data: true }));
    expect(await ok.generation.reserve('image', 30)).toBe(true);
    expect(ok.calls).toEqual(['ai_media_reserve', 'ai_generation_reserve']);
    const full = repos((name) => (name === 'ai_media_reserve' ? { error: MISSING } : { data: false }));
    expect(await full.generation.reserve('image', 30)).toBe(false);
  });
});

describe('quota d’IA texte', () => {
  it('traduit la réponse de la base : vrai → permis, faux → quota atteint', async () => {
    expect(await repos(() => ({ data: true })).generation.reserveText('agent')).toBe(true);
    expect(await repos(() => ({ data: false })).generation.reserveText('agent')).toBe(false);
  });

  it('migration pas appliquée : il n’y a pas de quota, l’IA texte reste permise', async () => {
    expect(await repos(() => ({ error: { ...MISSING, message: 'Could not find the function public.ai_text_reserve' } })).generation.reserveText('assistant')).toBe(true);
  });

  it('une vraie erreur refuse', async () => {
    expect(await repos(() => ({ error: { message: 'fetch failed' } })).generation.reserveText('suggestion')).toBe(false);
    expect(await repos(() => ({ error: { message: 'permission denied', code: '42501' } })).generation.reserveText('suggestion')).toBe(false);
  });
});
