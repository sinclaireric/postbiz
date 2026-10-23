import { cache } from 'react';
import { isDemo } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { demoOrganizations, demoOverview, demoUserDetail, demoUsers } from './demo';
import { PAGE_SIZE, isUserId, parseOrgRow, parseOverview, parseUserDetail, parseUserRow, totalOf } from './logic';
import type { AdminOrgRow, AdminOverview, AdminPage, AdminUserDetail, AdminUserRow, ListQuery } from './types';

export type AdminAccess = { status: 'anonymous' } | { status: 'forbidden' } | { status: 'admin'; email: string };

/**
 * Qui visite l'espace propriétaire ? La base décide (`is_platform_admin`) : le site n'a aucune liste d'administrateurs à tenir à jour,
 * et chaque fonction `admin_*` refuse de toute façon un autre utilisateur. En mode démo (sans Supabase), l'accès est ouvert.
 */
export const getAdminAccess = cache(async (): Promise<AdminAccess> => {
  if (isDemo) return { status: 'admin', email: 'proprietaire@postbiz.demo' };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { status: 'anonymous' };
  const { data: isAdmin } = await supabase.rpc('is_platform_admin');
  return isAdmin === true ? { status: 'admin', email: data.user.email ?? '' } : { status: 'forbidden' };
});

function failure(what: string, error: { message: string }): never {
  throw new Error(`${what} : ${error.message}`);
}

export const loadOverview = cache(async (): Promise<AdminOverview> => {
  if (isDemo) return demoOverview();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_overview');
  if (error) failure('admin_overview', error);
  return parseOverview(data);
});

const args = (q: ListQuery) => ({ p_search: q.search || null, p_phase: q.phase, p_limit: PAGE_SIZE, p_offset: (q.page - 1) * PAGE_SIZE });

export async function loadUsers(q: ListQuery): Promise<AdminPage<AdminUserRow>> {
  if (isDemo) return demoUsers(q);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_users', args(q));
  if (error) failure('admin_users', error);
  const rows = (data ?? []) as unknown[];
  return { rows: rows.map(parseUserRow), total: totalOf(rows) };
}

export async function loadOrganizations(q: ListQuery): Promise<AdminPage<AdminOrgRow>> {
  if (isDemo) return demoOrganizations(q);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_organizations', args(q));
  if (error) failure('admin_organizations', error);
  const rows = (data ?? []) as unknown[];
  return { rows: rows.map(parseOrgRow), total: totalOf(rows) };
}

/** Fiche d'un utilisateur ; `null` si l'identifiant est mal formé ou ne correspond à personne. */
export async function loadUserDetail(id: string): Promise<AdminUserDetail | null> {
  if (!isUserId(id)) return null;
  if (isDemo) return demoUserDetail(id);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_user_detail', { p_user: id });
  if (error) failure('admin_user_detail', error);
  return parseUserDetail(data);
}
