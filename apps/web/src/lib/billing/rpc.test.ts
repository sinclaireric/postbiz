import { describe, expect, it } from 'vitest';
import { isMissingFunction } from './rpc.ts';

describe('fonction SQL absente', () => {
  it('reconnaît PostgREST (PGRST202), Postgres (42883) et leurs messages', () => {
    expect(isMissingFunction({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(isMissingFunction({ code: '42883', message: 'x' })).toBe(true);
    expect(isMissingFunction({ message: 'Could not find the function public.ai_text_reserve(p_org, p_feature) in the schema cache' })).toBe(true);
    expect(isMissingFunction({ message: 'function public.ai_media_reserve(uuid, text, integer) does not exist' })).toBe(true);
  });

  it('ne confond pas avec une vraie erreur (droits, réseau, contrainte)', () => {
    expect(isMissingFunction(null)).toBe(false);
    expect(isMissingFunction(undefined)).toBe(false);
    expect(isMissingFunction({ code: '42501', message: 'permission denied for function ai_text_reserve' })).toBe(false);
    expect(isMissingFunction({ code: '23514', message: 'channel_limit' })).toBe(false);
    expect(isMissingFunction({ message: 'fetch failed' })).toBe(false);
    expect(isMissingFunction({ code: null, message: null })).toBe(false);
  });
});
