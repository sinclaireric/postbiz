'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin/guard';
import { isDemo } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';

/** Active ou désactive la facturation. Le propriétaire est revérifié ici, et par la base (`admin_set_billing_enabled`). */
export async function setBillingEnabledAction(formData: FormData): Promise<void> {
  await requireAdmin();
  if (isDemo) redirect('/admin/facturation?ok=demo');
  const enable = formData.get('enable') === '1';
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_billing_enabled', { p_enabled: enable });
  revalidatePath('/admin/facturation');
  revalidatePath('/tarifs');
  redirect(`/admin/facturation?ok=${error ? 'error' : enable ? 'on' : 'off'}`);
}
