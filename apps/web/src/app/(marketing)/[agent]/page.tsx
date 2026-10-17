import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AgentPage } from '@/components/agents/agent-page';
import { getT } from '@/i18n/server';
import { AI_AGENTS, agentBySlug } from '@/lib/agents';

type Props = { params: Promise<{ agent: string }> };

/** Seules les adresses des agents connus existent à la racine : toute autre adresse est une 404, comme avant. */
export const dynamicParams = false;
export const generateStaticParams = () => AI_AGENTS.map((a) => ({ agent: a.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const agent = agentBySlug((await params).agent);
  if (!agent) return {};
  const t = await getT();
  return {
    title: t('meta.agent.title', { name: agent.name }),
    description: t('meta.agent.description', { name: agent.name }),
    alternates: { canonical: `/${agent.slug}` },
  };
}

export default async function AgentRoute({ params }: Props) {
  const agent = agentBySlug((await params).agent);
  if (!agent) notFound();
  return <AgentPage agent={agent} />;
}
