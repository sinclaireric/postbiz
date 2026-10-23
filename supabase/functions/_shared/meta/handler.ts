// Logique de l'Edge Function `webhook-meta`, isolée de Deno et de Supabase pour pouvoir être testée.
import { verifyMetaChallenge, verifyMetaSignature } from './signature.ts';
import { normalizeMetaWebhook, type MetaProvider, type NormalizedEvent } from './webhook.ts';

export interface WebhookDb {
  /** Conserve l'événement brut (idempotence, rejeu). Doit lever en cas d'échec : Meta réessaiera. */
  insertRawEvent(provider: MetaProvider, payload: unknown): Promise<string>;
  findIntegration(provider: MetaProvider, internalId: string): Promise<{ id: string } | null>;
  ingest(integrationId: string, e: NormalizedEvent): Promise<void>;
  markProcessed(rawEventId: string, error?: string): Promise<void>;
}

export interface WebhookConfig {
  appSecret: string;
  /**
   * Clé secrète de l'application Instagram (connexion « Instagram Login », sans Page) : Meta signe ces événements avec elle, pas avec la clé
   * de l'application Meta. Facultative : sans elle, seuls les événements signés avec `appSecret` sont acceptés.
   */
  instagramAppSecret?: string;
  verifyToken: string;
}

const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

export async function handleMetaWebhook(req: Request, cfg: WebhookConfig, db: WebhookDb): Promise<Response> {
  if (req.method === 'GET') {
    const challenge = verifyMetaChallenge(new URL(req.url).searchParams, cfg.verifyToken);
    return challenge === null ? text('forbidden', 403) : text(challenge, 200);
  }
  if (req.method !== 'POST') return text('method not allowed', 405);

  const raw = await req.text();
  const signature = req.headers.get('x-hub-signature-256');
  const signed = (await verifyMetaSignature(raw, signature, cfg.appSecret)) || (!!cfg.instagramAppSecret && (await verifyMetaSignature(raw, signature, cfg.instagramAppSecret)));
  if (!signed) return text('invalid signature', 401);

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return text('invalid json', 400);
  }

  const provider: MetaProvider = body?.object === 'instagram' ? 'instagram' : 'facebook';
  let rawId: string;
  try {
    rawId = await db.insertRawEvent(provider, body);
  } catch {
    return text('storage error', 500); // Meta réessaiera
  }

  // À partir d'ici l'événement est sauvegardé : on répond toujours 200 pour éviter les rafales de relances.
  const errors: string[] = [];
  const known = new Map<string, { id: string } | null>();
  for (const e of normalizeMetaWebhook(body)) {
    try {
      const key = `${e.provider}:${e.accountId}`;
      if (!known.has(key)) known.set(key, await db.findIntegration(e.provider, e.accountId));
      const integration = known.get(key);
      if (!integration) continue; // compte non connecté à Postbiz
      await db.ingest(integration.id, e);
    } catch (err) {
      errors.push(`${e.messageExternalId}: ${(err as Error).message}`);
    }
  }
  await db.markProcessed(rawId, errors.length ? errors.join('; ').slice(0, 1000) : undefined).catch(() => {});
  return text('ok', 200);
}
