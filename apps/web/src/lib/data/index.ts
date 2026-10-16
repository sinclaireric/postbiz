import { cache } from 'react';
import { isDemo } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { DEMO_CONTEXT, demoOrgName, demoRepositories } from './demo';
import { createSupabaseRepositories } from './supabase';
import type { AppContext, OrgRole, Repositories } from './types';

export type SessionState =
  | { status: 'anonymous' }
  | { status: 'no-org'; user: { id: string; email: string } }
  | { status: 'ready'; ctx: AppContext };

/** Qui est connecté, et dans quelle organisation ? Mis en cache pour la durée d'une requête. */
export const getSession = cache(async (): Promise<SessionState> => {
  if (isDemo) return { status: 'ready', ctx: { ...DEMO_CONTEXT, org: { ...DEMO_CONTEXT.org, name: demoOrgName() } } };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { status: 'anonymous' };

  const { data: m } = await supabase
    .from('memberships')
    .select('role, organizations(id, name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const org = Array.isArray(m?.organizations) ? m?.organizations[0] : m?.organizations;
  if (!m || !org) return { status: 'no-org', user: { id: user.id, email: user.email ?? '' } };

  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  return {
    status: 'ready',
    ctx: {
      mode: 'supabase',
      user: { id: user.id, email: user.email ?? '', name: profile?.display_name ?? user.email ?? 'Vous' },
      org: { id: org.id, name: org.name, role: m.role as OrgRole },
    },
  };
});

export async function getRepositories(ctx: AppContext): Promise<Repositories> {
  if (ctx.mode === 'demo') return demoRepositories;
  return createSupabaseRepositories(await createClient(), ctx);
}
