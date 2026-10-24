import type { FormError } from '@/lib/form-error';
import type { IntegrationItem, MediaItem } from '@/lib/data/types';
import { MAX_MEDIA_PER_POST } from '@/lib/media/rules';
import { networkName } from '@/lib/networks';
import { NETWORK_RULES, validatePost } from '@/lib/posts/logic';
import { localToUtc } from './time';
import { AGENT_LIMITS, type AgentProposal, type AgentProposalStatus } from './types';

/**
 * Publications que le modèle propose, relues avant d'être montrées à l'utilisateur. Le modèle n'écrit jamais dans le calendrier :
 * ce qu'il envoie est une donnée à vérifier, avec les règles de l'application (limites par réseau, médias, premier commentaire, date).
 * Une erreur est renvoyée au modèle, en anglais et sans rien d'autre que ce qu'il a lui-même envoyé, pour qu'il corrige.
 */

export interface ProposeContext {
  /** Canaux que l'agent a le droit d'utiliser (ceux que l'utilisateur a cochés). */
  channels: readonly IntegrationItem[];
  /** Médias de la bibliothèque déjà chargés, par identifiant (voir `mediaIdsOf`). */
  media: ReadonlyMap<string, MediaItem>;
  timeZone: string;
  now: Date;
  newId: () => string;
}

export type ProposeResult = { ok: true; proposals: AgentProposal[] } | { ok: false; issues: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const MAX_TEXT = 20_000;

/** Identifiants de médias cités par l'appel du modèle, à charger avant la validation (au plus `MAX_MEDIA_PER_POST` par publication). */
export function mediaIdsOf(input: unknown): string[] {
  const posts = isRecord(input) && Array.isArray(input.posts) ? input.posts.slice(0, AGENT_LIMITS.proposalsPerCall) : [];
  const ids = posts.flatMap((p) => (isRecord(p) && Array.isArray(p.media_ids) ? p.media_ids.slice(0, MAX_MEDIA_PER_POST) : []));
  return [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
}

/** Une erreur de validation en une ligne pour le modèle : la clé de message sans son préfixe, et ses paramètres. */
export function describeError(e: FormError): string {
  const code = e.key.replace(/^app\.validation\./, '');
  return e.params ? `${code} ${JSON.stringify(e.params)}` : code;
}

const optionalString = (v: unknown): string | null | undefined => (v === undefined || v === null ? null : typeof v === 'string' ? v : undefined);

export function parseProposeInput(input: unknown, ctx: ProposeContext): ProposeResult {
  const list = isRecord(input) ? input.posts : undefined;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, issues: ['"posts" must be a non-empty array'] };
  if (list.length > AGENT_LIMITS.proposalsPerCall) return { ok: false, issues: [`too many posts: send at most ${AGENT_LIMITS.proposalsPerCall} in one call`] };

  const issues: string[] = [];
  const proposals: AgentProposal[] = [];

  list.forEach((raw, index) => {
    const at = `post ${index + 1}`;
    if (!isRecord(raw)) {
      issues.push(`${at}: must be an object`);
      return;
    }
    const channel = ctx.channels.find((c) => c.id === raw.channel_id);
    if (!channel) {
      issues.push(`${at}: channel_id is not one of the selected channels`);
      return;
    }
    const label = `${at} (${networkName(channel.networkId)} ${JSON.stringify(channel.name)})`;
    if (channel.status !== 'active') {
      issues.push(`${label}: this channel must be reconnected by the user before it can be used`);
      return;
    }

    const text = typeof raw.text === 'string' ? raw.text.replace(/\r\n/g, '\n').trim() : '';
    if (!text) issues.push(`${label}: "text" is empty`);
    else if (text.length > MAX_TEXT) issues.push(`${label}: "text" is far too long`);

    const comment = optionalString(raw.first_comment);
    if (comment === undefined) issues.push(`${label}: "first_comment" must be a string`);

    let mediaIds: string[] = [];
    if (raw.media_ids !== undefined && raw.media_ids !== null) {
      if (!Array.isArray(raw.media_ids) || raw.media_ids.some((m) => typeof m !== 'string')) issues.push(`${label}: "media_ids" must be an array of ids returned by list_media or attached by the user`);
      else mediaIds = [...new Set(raw.media_ids as string[])];
    }
    if (mediaIds.length > MAX_MEDIA_PER_POST) issues.push(`${label}: too many media`);
    const unknownMedia = mediaIds.filter((id) => !ctx.media.has(id));
    if (unknownMedia.length > 0) issues.push(`${label}: unknown media id ${unknownMedia.join(', ')} (use ids from list_media or the ones the user attached)`);

    let publishAt: string | null = null;
    const when = optionalString(raw.publish_at_local);
    if (when === undefined) issues.push(`${label}: "publish_at_local" must be a string like 2026-10-27T09:00`);
    else if (when && when.trim()) {
      publishAt = localToUtc(when, ctx.timeZone);
      if (!publishAt) issues.push(`${label}: "publish_at_local" must look like 2026-10-27T09:00 (local time, no timezone suffix)`);
    }

    if (!text || issues.some((i) => i.startsWith(label))) return;

    const media = mediaIds.map((id) => ctx.media.get(id)!);
    // Les règles qui comptent à la programmation (date, médias exigés, médias publiables) sont vérifiées ici, pas seulement à l'enregistrement :
    // l'utilisateur ne doit pas recevoir une proposition qu'il ne pourrait pas programmer. Sans date, on vérifie une date lointaine valide.
    const errors = validatePost({
      content: text,
      networkIds: [channel.networkId],
      publishAt: publishAt ?? new Date(ctx.now.getTime() + 24 * 3_600_000).toISOString(),
      mode: 'schedule',
      firstComment: comment ?? '',
      media: media.map((m) => ({ kind: m.kind, width: m.width, height: m.height, name: m.name })),
      now: ctx.now,
    });
    if (errors.length > 0) {
      issues.push(`${label}: ${errors.map(describeError).join('; ')}`);
      return;
    }

    proposals.push({
      id: ctx.newId(), integrationId: channel.id, networkId: channel.networkId, accountName: channel.name,
      text, firstComment: comment?.trim() ? comment.trim() : null, mediaIds, publishAt, status: 'pending',
    });
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, proposals };
}

const STATUSES: readonly AgentProposalStatus[] = ['pending', 'draft', 'scheduled'];
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

/**
 * Relit les publications gardées dans un message (colonne `proposals`). La colonne est modifiable par son propriétaire : on ne se fie pas à sa forme,
 * on garde ce qui est exploitable et on écarte le reste.
 */
export function sanitizeProposals(raw: unknown): AgentProposal[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): AgentProposal[] => {
    if (!isRecord(item)) return [];
    const id = str(item.id, 64);
    const integrationId = str(item.integrationId, 64);
    const accountName = str(item.accountName, 200);
    const text = str(item.text, MAX_TEXT);
    const networkId = typeof item.networkId === 'string' && item.networkId in NETWORK_RULES ? (item.networkId as AgentProposal['networkId']) : null;
    const status = STATUSES.find((s) => s === item.status);
    if (!id || !integrationId || accountName === null || text === null || !networkId || !status) return [];
    const publishAt = typeof item.publishAt === 'string' && !Number.isNaN(Date.parse(item.publishAt)) ? item.publishAt : null;
    const mediaIds = Array.isArray(item.mediaIds) ? item.mediaIds.filter((m): m is string => typeof m === 'string' && m.length <= 64).slice(0, MAX_MEDIA_PER_POST) : [];
    return [{ id, integrationId, networkId, accountName, text, firstComment: str(item.firstComment, MAX_TEXT), mediaIds, publishAt, status }];
  });
}
