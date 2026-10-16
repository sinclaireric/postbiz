'use server';

import { redirect } from 'next/navigation';
import { isDemo } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';

export interface OnboardingState { error?: string }

export async function createOrganizationAction(_: OnboardingState, formData: FormData): Promise<OnboardingState> {
  if (isDemo) redirect('/app/inbox');
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Donnez un nom d’au moins 2 caractères à votre organisation.' };
  if (name.length > 120) return { error: 'Ce nom est trop long.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('create_organization', { p_name: name });
  if (error) return { error: 'Impossible de créer l’organisation. Réessayez dans un instant.' };
  redirect('/app/inbox');
}
