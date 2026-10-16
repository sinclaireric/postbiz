import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { signOut } from '@/app/(auth)/actions';
import { AppShell } from '@/components/app/shell';
import { Onboarding } from '@/components/onboarding/onboarding';
import { getRepositories, getSession, provisionOrganization } from '@/lib/data';
import { ROLE_LABEL } from '@/lib/data/types';
import { networkAvailability } from '@/lib/oauth/availability';
import { networkById } from '@/lib/networks';
import { onboardingTiles, tutorialEmbedUrl } from '@/lib/onboarding';
import { isDemo } from '@/lib/supabase/env';
import { markNotificationsReadAction } from './actions';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  let session = await getSession();
  if (session.status === 'anonymous') redirect('/login');
  if (session.status === 'no-org') {
    // Première connexion : l'organisation est créée sans question, puis on ouvre l'onboarding.
    const ok = await provisionOrganization(session.user);
    redirect(ok ? '/app/calendrier?onboarding=true' : '/login?erreur=organisation');
  }
  if (session.status !== 'ready') redirect('/login');

  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const [conversations, notifications, integrations] = await Promise.all([
    repos.inbox.listConversations(),
    repos.workspace.notifications(),
    repos.workspace.integrations(),
  ]);

  const tiles = onboardingTiles(networkAvailability(process.env, isDemo), { demo: ctx.mode === 'demo', role: ctx.org.role });
  const connected = integrations
    .filter((i) => i.status !== 'disabled')
    .map((i) => ({ id: i.id, name: i.name, networkId: i.networkId, color: networkById(i.networkId)?.color ?? '#999' }));

  return (
    <>
      <AppShell
        orgName={ctx.org.name}
        roleLabel={ROLE_LABEL[ctx.org.role]}
        userName={ctx.user.name}
        userEmail={ctx.user.email}
        unreadMessages={conversations.reduce((n, c) => n + c.unreadCount, 0)}
        notifications={notifications}
        signOutAction={signOut}
        markNotificationsRead={markNotificationsReadAction}
        demo={ctx.mode === 'demo'}
      >
        {children}
      </AppShell>
      <Suspense fallback={null}>
        <Onboarding tiles={tiles} connected={connected} tutorialUrl={tutorialEmbedUrl(process.env.NEXT_PUBLIC_TUTORIAL_VIDEO_URL)} />
      </Suspense>
    </>
  );
}
