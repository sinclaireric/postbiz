import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';
import { isDemo, supabaseAnonKey, supabaseUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { accountIdentity, workspaceName, type AccountIdentity } from '@/lib/workspace-name';
import { DEMO_CONTEXT, demoOrgName, demoRepositories } from './demo';
import { createSupabaseRepositories } from './supabase';
import type { AppContext, OrgRole, Repositories } from './types';

export type SessionState =
  | { status: 'anonymous' }
  | { status: 'no-org'; user: { id: string } & AccountIdentity }
  | { status: 'ready'; ctx: AppContext };

/** Qui est connecté, et dans quelle organisation ? D'après la session du client Supabase donné (cookies du navigateur, ou jeton du mobile). */
async function sessionOf(supabase: SupabaseClient, token?: string): Promise<SessionState> {
  const { data } = await supabase.auth.getUser(token);
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
}

/** Qui est connecté, et dans quelle organisation ? Mis en cache pour la durée d'une requête. */
export const getSession = cache(async (): Promise<SessionState> => {
  if (isDemo) return { status: 'ready', ctx: { ...DEMO_CONTEXT, org: { ...DEMO_CONTEXT.org, name: demoOrgName() } } };
  return sessionOf(await createClient());
});

/** Le jeton d'un en-tête `Authorization: Bearer …`, ou null. */
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+([\w.~+/-]+=*)$/i.exec(header?.trim() ?? '');
  return m ? m[1]! : null;
}

/**
 * Session d'un client qui n'a pas de cookie (l'application mobile) : son jeton Supabase, vérifié auprès de Supabase Auth, puis des dépôts de données qui
 * agissent avec ce jeton. La RLS de la base reste la seule autorité, exactement comme avec les cookies. Sans projet Supabase (démo), le jeton ne sert à rien.
 */
export async function getSessionForToken(token: string): Promise<{ session: SessionState; repos: Repositories | null }> {
  if (isDemo) return { session: await getSession(), repos: null };
  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await sessionOf(supabase, token);
  return { session, repos: session.status === 'ready' ? createSupabaseRepositories(supabase, session.ctx) : null };
}

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
