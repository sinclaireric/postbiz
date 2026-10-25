import { describe, expect, it } from 'vitest';
import { streamChat } from './client';
import { encodeEvent } from './request';
import type { AgentChatRequest, AgentEvent } from './types';

const req: AgentChatRequest = { threadId: null, message: 'Bonjour', channelIds: [], mediaIds: [], timeZone: 'UTC' };
const thread = { id: 't1', title: 'Bonjour', updatedAt: '2026-10-27T10:00:00Z' };
const msg = (role: 'user' | 'assistant', text: string) => ({ id: role, role, text, proposals: [], mediaIds: [], jobIds: [], createdAt: '2026-10-27T10:00:00Z' });

/** Une réponse HTTP dont le corps arrive par morceaux, comme la route d'API le fait. */
const response = (chunks: string[], init: ResponseInit = {}) => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
  return new Response(body, init);
};
const fetcher = (res: Response | Error) => (async () => { if (res instanceof Error) throw res; return res; }) as unknown as typeof fetch;

async function collect(res: Response | Error, signal?: AbortSignal) {
  const events: AgentEvent[] = [];
  await streamChat(req, (e) => events.push(e), signal, fetcher(res));
  return events;
}

describe('streamChat', () => {
  const done: AgentEvent = { type: 'done', thread, user: msg('user', 'Bonjour'), assistant: msg('assistant', 'Salut') };

  it('rend les événements dans l’ordre, même coupés au milieu d’une ligne', async () => {
    const wire = [encodeEvent({ type: 'text', delta: 'Sa' }), encodeEvent({ type: 'text', delta: 'lut' }), encodeEvent(done)].join('');
    const events = await collect(response([wire.slice(0, 20), wire.slice(20, 70), wire.slice(70)]));
    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'done']);
  });

  it('transmet une erreur de la route telle quelle, sans en ajouter une seconde', async () => {
    const events = await collect(response([encodeEvent({ type: 'error', code: 'rate_limited' })], { status: 429 }));
    expect(events).toEqual([{ type: 'error', code: 'rate_limited' }]);
  });

  it('une réponse qui s’arrête sans événement final devient une erreur', async () => {
    expect(await collect(response([encodeEvent({ type: 'text', delta: 'Sa' })]))).toEqual([{ type: 'text', delta: 'Sa' }, { type: 'error', code: 'failed' }]);
    expect(await collect(response(['<html>502 Bad Gateway</html>'], { status: 502 }))).toEqual([{ type: 'error', code: 'failed' }]);
  });

  it('une connexion impossible devient une erreur', async () => {
    expect(await collect(new TypeError('Failed to fetch'))).toEqual([{ type: 'error', code: 'failed' }]);
  });

  it('une interruption voulue (« Arrêter ») ne signale aucune erreur', async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await collect(new DOMException('aborted', 'AbortError'), abort.signal)).toEqual([]);
  });
});
