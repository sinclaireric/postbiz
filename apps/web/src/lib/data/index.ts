import { cache } from 'react';
import { isDemo } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { accountIdentity, workspaceName, type AccountIdentity } from '@/lib/workspace-name';
import { DEMO_CONTEXT, demoOrgName, demoRepositories } from './demo';
import { createSupabaseRepositories } from './supabase';
import type { AppContext, OrgRole, Repositories } from './types';

export type SessionState =
  | { status: 'anonymous' }
  | { status: 'no-org'; user: { id: string } & AccountIdentity }
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
  if (!m || !org) return { status: 'no-org', user: { id: user.id, ...accountIdentity(user) } };

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

/**
 * Première connexion : crée l'organisation de l'utilisateur sans lui poser de question (comme Postiz), nommée d'après
 * l'entreprise saisie à l'inscription, puis l'envoie vers l'onboarding. Idempotent côté base (ensure_organization).
 */
export async function provisionOrganization(identity: AccountIdentity): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('ensure_organization', { p_name: workspaceName(identity) });
  return !error;
}

/** Le compte connecté est-il suspendu par le propriétaire de la plateforme ? (Suspendu, il ne voit plus aucune organisation.) */
export async function isAccountSuspended(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('is_suspended');
  return data === true;
}
