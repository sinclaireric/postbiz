import { describe, expect, it, vi } from 'vitest';
import { computeMetaSignature, handleMetaWebhook, type NormalizedEvent, type WebhookDb } from '../src/index.ts';

const cfg = { appSecret: 'secret', verifyToken: 'verify-me' };

const dm = (mid: string, accountId = 'PAGE1') => ({
  object: 'page',
  entry: [{ id: accountId, messaging: [{ sender: { id: 'U1' }, recipient: { id: accountId }, timestamp: 1760000000000, message: { mid, text: 'Salut' } }] }],
});

async function post(body: unknown, opts: { sign?: boolean; signature?: string } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = opts.signature ?? (opts.sign === false ? undefined : await computeMetaSignature(raw, cfg.appSecret));
  return new Request('https://x.test/webhook-meta', { method: 'POST', body: raw, headers: sig ? { 'x-hub-signature-256': sig } : {} });
}

function fakeDb(overrides: Partial<WebhookDb> = {}) {
  const ingested: { integrationId: string; e: NormalizedEvent }[] = [];
  const db: WebhookDb = {
    insertRawEvent: vi.fn(async () => 'raw-1'),
    findIntegration: vi.fn(async (_p, id) => (id === 'PAGE1' ? { id: 'int-1' } : null)),
    ingest: vi.fn(async (integrationId, e) => { ingested.push({ integrationId, e }); }),
    markProcessed: vi.fn(async () => {}),
    ...overrides,
  };
  return { db, ingested };
}

describe('webhook Meta — handshake', () => {
  it('répond au challenge', async () => {
    const { db } = fakeDb();
    const res = await handleMetaWebhook(new Request('https://x.test/w?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42'), cfg, db);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('42');
  });
  it('refuse un mauvais jeton', async () => {
    const { db } = fakeDb();
    const res = await handleMetaWebhook(new Request('https://x.test/w?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42'), cfg, db);
    expect(res.status).toBe(403);
  });
});

describe('webhook Meta — réception', () => {
  it('refuse une signature absente ou invalide, sans rien enregistrer', async () => {
    const { db } = fakeDb();
    expect((await handleMetaWebhook(await post(dm('m1'), { sign: false }), cfg, db)).status).toBe(401);
    expect((await handleMetaWebhook(await post(dm('m1'), { signature: 'sha256=00' }), cfg, db)).status).toBe(401);
    expect(db.insertRawEvent).not.toHaveBeenCalled();
  });

  it('refuse un JSON invalide (signé)', async () => {
    const { db } = fakeDb();
    expect((await handleMetaWebhook(await post('pas du json'), cfg, db)).status).toBe(400);
  });

  it('enregistre l’événement brut puis ingère le message vers le bon canal', async () => {
    const { db, ingested } = fakeDb();
    const res = await handleMetaWebhook(await post(dm('m1')), cfg, db);
    expect(res.status).toBe(200);
    expect(db.insertRawEvent).toHaveBeenCalledWith('facebook', expect.objectContaining({ object: 'page' }));
    expect(ingested).toHaveLength(1);
    expect(ingested[0]).toMatchObject({ integrationId: 'int-1', e: { messageExternalId: 'm1', direction: 'in' } });
    expect(db.markProcessed).toHaveBeenCalledWith('raw-1', undefined);
  });

  it('ignore les comptes non connectés à Postbiz', async () => {
    const { db, ingested } = fakeDb();
    const res = await handleMetaWebhook(await post(dm('m1', 'AUTRE')), cfg, db);
    expect(res.status).toBe(200);
    expect(ingested).toHaveLength(0);
  });

  it('répond 500 si l’événement brut ne peut pas être sauvegardé (Meta réessaiera)', async () => {
    const { db } = fakeDb({ insertRawEvent: vi.fn(async () => { throw new Error('db down'); }) });
    expect((await handleMetaWebhook(await post(dm('m1')), cfg, db)).status).toBe(500);
  });

  it('répond 200 même si une ingestion échoue, et consigne l’erreur pour rejeu', async () => {
    const { db } = fakeDb({ ingest: vi.fn(async () => { throw new Error('boom'); }) });
    const res = await handleMetaWebhook(await post(dm('m1')), cfg, db);
    expect(res.status).toBe(200);
    expect(db.markProcessed).toHaveBeenCalledWith('raw-1', expect.stringContaining('m1: boom'));
  });

  it('cherche chaque compte une seule fois par lot', async () => {
    const { db } = fakeDb();
    const body = { object: 'page', entry: [{ id: 'PAGE1', messaging: [
      { sender: { id: 'U1' }, recipient: { id: 'PAGE1' }, timestamp: 1, message: { mid: 'a', text: '1' } },
      { sender: { id: 'U2' }, recipient: { id: 'PAGE1' }, timestamp: 2, message: { mid: 'b', text: '2' } },
    ] }] };
    await handleMetaWebhook(await post(body), cfg, db);
    expect(db.findIntegration).toHaveBeenCalledTimes(1);
    expect(db.ingest).toHaveBeenCalledTimes(2);
  });

  it('refuse les méthodes inattendues', async () => {
    const { db } = fakeDb();
    expect((await handleMetaWebhook(new Request('https://x.test/w', { method: 'PUT' }), cfg, db)).status).toBe(405);
  });
});
