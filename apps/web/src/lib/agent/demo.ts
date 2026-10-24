import type { T } from '@/i18n/types';
import type { IntegrationItem, MediaItem, PostItem } from '@/lib/data/types';
import { MEDIA_RULES } from '@/lib/media/rules';
import { networkName } from '@/lib/networks';
import { NETWORK_RULES } from '@/lib/posts/logic';
import { countLength, sliceAtLimit } from '@/lib/text/length';
import { parseProposeInput } from './proposal';
import { toAgentMedia } from './media';
import type { AgentTurnResult } from './run';
import { utcToLocal } from './time';
import type { AgentEvent } from './types';

/**
 * L'agent du mode démo : aucune IA n'est appelée. Ses réponses sont simulées, déterministes, et construites avec les mots de l'utilisateur
 * (rien n'est inventé) ; les publications qu'il prépare passent par la même validation que celles du vrai agent.
 */

export interface DemoTurnDeps {
  t: T;
  channels: readonly IntegrationItem[];
  library: readonly MediaItem[];
  posts: readonly PostItem[];
  timeZone: string;
  now: Date;
  emit: (event: AgentEvent) => void;
  newId: () => string;
  /** Pause entre deux fragments de texte, pour que la réponse apparaisse au fil de l'eau (0 dans les tests). */
  paceMs?: number;
}

const LIST_INTENT = /\b(pr[ée]vu|programm\w*|planifi\w*|planning|calendrier|venir|scheduled|upcoming|calendar|this week|cette semaine)\b/i;
const WRITE_VERB = /\b(annonce\w*|publie\w*|poste\w*|[ée]cris|r[ée]dige\w*|pr[ée]pare\w*|cr[ée]e\w*|write|post|announce|publish|draft|create|prepare)\b/i;
const ARTICLE = "(?:(?:un|une|le|la|les|des|a|an|the)\\s+|l['’])";
const LEADING = new RegExp(`^(annonce|annoncer|publie|publier|poste|poster|[ée]cris|r[ée]dige|pr[ée]pare|cr[ée]e|write|post|announce|publish|draft|create|prepare)\\s+${ARTICLE}?(?:(?:post|publication|message)\\s+)?(?:(?:sur|pour|[àa] propos de|au sujet de|about|on|for)\\s+)?${ARTICLE}?`, 'i');
const TOMORROW = /\b(demain|tomorrow)\b/i;
const HASHTAG_NETWORKS = new Set<IntegrationItem['networkId']>(['instagram', 'instagram_standalone', 'linkedin', 'linkedin_page', 'tiktok']);

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** Le sujet : le message sans le verbe d'ordre du début (« Annonce l'atelier de samedi » → « L'atelier de samedi »). */
export function demoSubject(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  const stripped = oneLine.replace(LEADING, '').trim();
  return capitalize(stripped || oneLine);
}

/** Jusqu'à trois mots du sujet en #hashtags : aucune idée nouvelle, seulement les mots de l'utilisateur. */
export function demoHashtags(subject: string): string {
  const words = subject.toLocaleLowerCase().match(/[\p{L}\p{N}]{6,}/gu) ?? [];
  return [...new Set(words)].slice(0, 3).map((w) => `#${w}`).join(' ');
}

/** Le texte d'une publication pour un réseau : celui de l'utilisateur, mis à la forme du réseau, sous sa limite. */
export function demoText(networkId: IntegrationItem['networkId'], subject: string): string {
  const tags = HASHTAG_NETWORKS.has(networkId) ? demoHashtags(subject) : '';
  const body = tags ? `${subject}\n\n${tags}` : subject;
  const max = NETWORK_RULES[networkId].maxLength;
  if (countLength(networkId, body) <= max) return body;
  // « … » pèse 2 sur X : on coupe un peu avant la limite, puis on retire un signe à la fois jusqu'à ce que le tout tienne.
  const chars = [...sliceAtLimit(networkId, body, max - 2)[0].trimEnd()];
  while (chars.length > 0 && countLength(networkId, `${chars.join('')}…`) > max) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

function tomorrowAtNine(now: Date, timeZone: string): string {
  const local = utcToLocal(new Date(now.getTime() + 24 * 3_600_000), timeZone).slice(0, 10);
  return `${local}T09:00`;
}

async function say(deps: DemoTurnDeps, text: string): Promise<void> {
  for (const chunk of text.match(/\S+\s*/g) ?? [text]) {
    deps.emit({ type: 'text', delta: chunk });
    await sleep(deps.paceMs ?? 12);
  }
}

export async function runDemoTurn(deps: DemoTurnDeps, userContent: string, attached: readonly MediaItem[] = []): Promise<AgentTurnResult> {
  const { t, channels, now, timeZone } = deps;
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  const done = async (text: string, extra: Partial<Pick<AgentTurnResult, 'proposals' | 'media'>> = {}): Promise<AgentTurnResult> => {
    await say(deps, text);
    const result: AgentTurnResult = { text, proposals: extra.proposals ?? [], media: extra.media ?? [], usage };
    if (result.proposals.length > 0) deps.emit({ type: 'proposals', proposals: result.proposals, media: result.media });
    return result;
  };

  // Consulter le calendrier : la liste des publications des 30 prochains jours, telle que l'agent la lirait.
  if (LIST_INTENT.test(userContent) && !WRITE_VERB.test(userContent)) {
    deps.emit({ type: 'tool', name: 'list_posts' });
    const today = utcToLocal(now, timeZone).slice(0, 10);
    const end = utcToLocal(new Date(now.getTime() + 30 * 86_400_000), timeZone).slice(0, 10);
    const upcoming = deps.posts
      .filter((p) => p.publishAt && (!channels.length || channels.some((c) => c.id === p.integrationId)))
      .map((p) => ({ p, local: utcToLocal(p.publishAt!, timeZone) }))
      .filter(({ local }) => local.slice(0, 10) >= today && local.slice(0, 10) <= end)
      .sort((a, b) => a.local.localeCompare(b.local))
      .slice(0, 10);
    if (upcoming.length === 0) return done(t('app.agent.demo.noPosts'));
    const lines = upcoming.map(({ p, local }) => `- ${local.replace('T', ' ')} · ${networkName(p.networkId)} · ${p.content.replace(/\s+/g, ' ').slice(0, 70)}`);
    return done(`${t('app.agent.demo.upcoming')}\n${lines.join('\n')}`);
  }

  if (userContent.trim().length < 6 && attached.length === 0) return done(t('app.agent.demo.help'));
  if (channels.length === 0) return done(t('app.agent.demo.noChannel'));

  deps.emit({ type: 'tool', name: 'propose_posts' });
  const subject = demoSubject(userContent);
  const usable = channels.filter((c) => c.status === 'active');
  const needMedia = (c: IntegrationItem) => NETWORK_RULES[c.networkId].requiresMedia;
  const mediaFor = (c: IntegrationItem): MediaItem | undefined => {
    if (!needMedia(c) || !MEDIA_RULES[c.networkId].publishable) return undefined;
    return attached[0] ?? deps.library.find((m) => m.kind === 'image') ?? deps.library.find((m) => MEDIA_RULES[c.networkId].videos);
  };
  const skipped: IntegrationItem[] = [];
  const posts: Record<string, unknown>[] = [];
  const publishAt = TOMORROW.test(userContent) ? tomorrowAtNine(now, timeZone) : undefined;
  for (const c of usable) {
    if (needMedia(c) && !MEDIA_RULES[c.networkId].publishable) { skipped.push(c); continue; }
    const m = mediaFor(c);
    if (needMedia(c) && !m) { skipped.push(c); continue; }
    posts.push({ channel_id: c.id, text: demoText(c.networkId, subject), ...(m ? { media_ids: [m.id] } : {}), ...(publishAt ? { publish_at_local: publishAt } : {}) });
  }

  const known = new Map([...attached, ...deps.library].map((m) => [m.id, m]));
  const parsed = posts.length > 0 ? parseProposeInput({ posts }, { channels, media: known, timeZone, now, newId: deps.newId }) : null;
  const proposals = parsed?.ok ? parsed.proposals : [];
  const media = [...new Set(proposals.flatMap((p) => p.mediaIds))].flatMap((id) => (known.has(id) ? [toAgentMedia(known.get(id)!)] : []));
  const notes = skipped.length > 0 ? ` ${t('app.agent.demo.skipped', { networks: skipped.map((c) => networkName(c.networkId)).join(', ') })}` : '';
  if (proposals.length === 0) return done(skipped.length > 0 ? t('app.agent.demo.skipped', { networks: skipped.map((c) => networkName(c.networkId)).join(', ') }) : t('app.agent.demo.noChannel'));
  return done(`${t('app.agent.demo.intro')}${notes}`, { proposals, media });
}
