import { cache } from 'react';
import { isDemo } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { demoAdminMarkRead, demoAdminReply, demoAdminSetStatus, demoAdminThread, demoList, demoSummary } from '@/lib/support/demo';
import { SUPPORT_PAGE_SIZE, SUPPORT_REPLY_MAX, cleanSupportBody, isConversationId, parseAdminThread, parseSummary, parseSupportRow, supportErrorCode, validateSupportBody } from '@/lib/support/logic';
import type { AdminSupportActionResult, AdminSupportRow, AdminSupportSummary, AdminSupportThread, SupportListQuery, SupportStatus } from '@/lib/support/types';
import { totalOf } from './logic';

// Le chat de support vu du propriétaire de la plateforme. Tout passe par les fonctions `admin_support_*`, qui vérifient chacune `is_platform_admin()` :
// aucune table n'est lue directement, aucune clé service_role n'est utilisée. En démonstration : les conversations en mémoire du serveur (lib/support/demo.ts).

function failure(what: string, error: { message: string }): never {
  throw new Error(`${what} : ${error.message}`);
}

export const loadSupportSummary = cache(async (): Promise<AdminSupportSummary> => {
  if (isDemo) return demoSummary();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_support_summary');
  if (error) failure('admin_support_summary', error);
  return parseSummary(data);
});

export async function loadSupportList(q: SupportListQuery): Promise<{ rows: AdminSupportRow[]; total: number }> {
  if (isDemo) return demoList(q.filter, q.search, q.page);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_support_conversations', {
    p_filter: q.filter, p_search: q.search || null, p_limit: SUPPORT_PAGE_SIZE, p_offset: (q.page - 1) * SUPPORT_PAGE_SIZE,
  });
  if (error) failure('admin_support_conversations', error);
  const rows = (data ?? []) as unknown[];
  return { rows: rows.map(parseSupportRow), total: totalOf(rows) };
}

/** Une conversation et ses derniers messages ; `null` si l'identifiant est mal formé ou ne correspond à rien. */
export async function loadSupportConversation(id: string): Promise<AdminSupportThread | null> {
  if (!isConversationId(id)) return null;
  if (isDemo) return demoAdminThread(id);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_support_thread', { p_id: id });
  if (error) failure('admin_support_thread', error);
  return parseAdminThread(data);
}

type ActionError = Extract<AdminSupportActionResult, { ok: false }>['code'];

function actionError(error: { message?: string }): ActionError {
  const message = error.message ?? '';
  if (message.includes('forbidden')) return 'forbidden';
  if (message.includes('not_found')) return 'not_found';
  return supportErrorCode(error);
}

async function fresh(id: string): Promise<AdminSupportActionResult> {
  const thread = await loadSupportConversation(id);
  return thread ? { ok: true, thread } : { ok: false, code: 'not_found' };
}

/** Répond à l'utilisateur. Le texte est nettoyé ici comme dans la base, qui reste l'autorité (droits, taille). Rend le fil à jour. */
export async function replyToConversation(id: string, body: string): Promise<AdminSupportActionResult> {
  if (!isConversationId(id)) return { ok: false, code: 'not_found' };
  const clean = cleanSupportBody(body);
  const invalid = validateSupportBody(clean, SUPPORT_REPLY_MAX);
  if (invalid) return { ok: false, code: invalid };
  if (isDemo) {
    const sent = demoAdminReply(id, clean);
    return sent.ok ? fresh(id) : { ok: false, code: sent.code };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_support_reply', { p_id: id, p_body: clean });
  return error ? { ok: false, code: actionError(error) } : fresh(id);
}

export async function setConversationStatus(id: string, status: SupportStatus): Promise<AdminSupportActionResult> {
  if (!isConversationId(id) || (status !== 'open' && status !== 'resolved')) return { ok: false, code: 'not_found' };
  if (isDemo) return demoAdminSetStatus(id, status) ? fresh(id) : { ok: false, code: 'not_found' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_support_set_status', { p_id: id, p_status: status });
  return error ? { ok: false, code: actionError(error) } : fresh(id);
}

export async function markConversationRead(id: string): Promise<void> {
  if (!isConversationId(id)) return;
  if (isDemo) return demoAdminMarkRead(id);
  const supabase = await createClient();
  await supabase.rpc('admin_support_mark_read', { p_id: id });
}
