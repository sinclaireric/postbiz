import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChannelPage } from '@/components/channels/channel-page';
import { getT } from '@/i18n/server';
import { NETWORKS, networkById, networkName } from '@/lib/networks';

type Props = { params: Promise<{ network: string }> };

export const dynamicParams = false;
export const generateStaticParams = () => NETWORKS.map((n) => ({ network: n.id }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const network = networkById((await params).network);
  if (!network) return {};
  const t = await getT();
  const name = networkName(network.id);
  return {
    title: t('meta.channel.title', { network: name }),
    description: t('meta.channel.description', { network: name }),
    alternates: { canonical: `/canaux/${network.id}` },
  };
}

export default async function ChannelRoute({ params }: Props) {
  const network = networkById((await params).network);
  if (!network) notFound();
  return <ChannelPage network={network} />;
}
