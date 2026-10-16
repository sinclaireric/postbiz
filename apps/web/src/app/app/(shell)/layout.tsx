import { redirect } from 'next/navigation';
import { signOut } from '@/app/(auth)/actions';
import { Sidebar } from '@/components/app/sidebar';
import { getRepositories, getSession } from '@/lib/data';
import { ROLE_LABEL } from '@/lib/data/types';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.status === 'anonymous') redirect('/login');
  if (session.status === 'no-org') redirect('/app/onboarding');

  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const unread = (await repos.inbox.listConversations()).reduce((n, c) => n + c.unreadCount, 0);

  return (
    <div className="flex min-h-dvh flex-col bg-paper lg:flex-row">
      <Sidebar
        orgName={ctx.org.name}
        role={ROLE_LABEL[ctx.org.role]}
        userName={ctx.user.name}
        userEmail={ctx.user.email}
        unread={unread}
        signOutAction={signOut}
      />
      <div className="flex min-w-0 flex-1 flex-col lg:h-dvh lg:overflow-hidden">
        {ctx.mode === 'demo' && (
          <p className="border-b border-warn/25 bg-warn-soft px-4 py-2 text-center text-sm font-medium text-warn">
            Mode démo : données d’exemple, rien n’est envoyé aux réseaux. Configurez Supabase pour utiliser vos vraies données.
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
