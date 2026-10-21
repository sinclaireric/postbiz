import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { runAssist, type AiClient } from './claude';
import type { AiRequest } from './types';

type Msg = Awaited<ReturnType<AiClient['create']>>;
const message = (content: unknown[], stop_reason = 'end_turn') => ({ content, stop_reason }) as unknown as Msg;
const json = (value: unknown) => message([{ type: 'text', text: JSON.stringify(value) }]);

function fake(...replies: (Msg | Error)[]) {
  const calls: Parameters<AiClient['create']>[0][] = [];
  const client: AiClient = {
    async create(params) {
      calls.push(params);
      const next = replies.shift();
      if (!next) throw new Error('réponse non prévue');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, calls };
}

const base = { orgName: 'Maison Lune', language: 'French', entries: [{ title: 'Ton', content: 'Tutoiement.' }], now: new Date('2026-10-21T10:00:00Z') };
const write: AiRequest = { mode: 'write', topic: 'Soldes', tone: 'friendly', length: 'short', networkIds: ['x'], useKnowledge: true };

describe('assistant : rédiger et améliorer', () => {
  it('envoie la demande telle que prévue et rend les propositions utilisables', async () => {
    const { client, calls } = fake(json({ proposals: [{ text: 'Soldes dès demain !' }, { text: 'x'.repeat(400) }] }));
    const result = await runAssist(write, { ...base, client });
    expect(result).toEqual({ ok: true, mode: 'write', proposals: [{ text: 'Soldes dès demain !' }] });

    const call = calls[0]!;
    expect(call.model).toBe('claude-opus-5-5');
    expect(call.fallbacks).toBe('default');
    expect(call.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(call.output_config?.format).toMatchObject({ type: 'json_schema' });
    expect(call.tools).toBeUndefined();
    // Règles puis base de connaissance, mise en cache.
    expect(call.system).toHaveLength(2);
    expect((call.system as { cache_control?: unknown }[])[1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.stringify(call.messages)).toContain('Soldes');
  });

  it('n’envoie pas la base de connaissance quand elle n’est pas demandée', async () => {
    const { client, calls } = fake(json({ proposals: [{ text: 'Bonjour' }] }));
    await runAssist({ ...write, useKnowledge: false }, { ...base, client });
    expect(calls[0]!.system).toHaveLength(1);
  });

  it('améliorer : une version pour la correction, plusieurs pour la reformulation', async () => {
    const { client } = fake(json({ proposals: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }] }));
    const result = await runAssist({ mode: 'improve', action: 'rewrite', text: 'Texte', tone: 'direct', networkIds: [], useKnowledge: false }, { ...base, client });
    expect(result.ok && result.mode === 'improve' && result.proposals).toHaveLength(3);
  });

  it('une réponse sans proposition utilisable devient « empty »', async () => {
    const { client } = fake(json({ proposals: [] }));
    expect(await runAssist(write, { ...base, client })).toEqual({ ok: false, error: 'empty' });
  });

  it('un refus du modèle est signalé comme tel', async () => {
    const { client } = fake(message([], 'refusal'));
    expect(await runAssist(write, { ...base, client })).toEqual({ ok: false, error: 'refused' });
  });

  it('traduit les erreurs de l’API en codes affichables', async () => {
    const rate = Object.create(Anthropic.RateLimitError.prototype) as Error;
    const auth = Object.create(Anthropic.AuthenticationError.prototype) as Error;
    expect(await runAssist(write, { ...base, client: fake(rate).client })).toEqual({ ok: false, error: 'rate_limited' });
    expect(await runAssist(write, { ...base, client: fake(auth).client })).toEqual({ ok: false, error: 'disabled' });
    expect(await runAssist(write, { ...base, client: fake(new Error('réseau')).client })).toEqual({ ok: false, error: 'failed' });
  });
});

describe('assistant : idées d’après l’actualité et la base de connaissance', () => {
  const ideas: AiRequest = { mode: 'ideas', theme: 'vélo', news: true, knowledge: true, tone: 'professional', networkIds: ['linkedin'] };
  const search = (hits: { url: string; title: string }[], stop = 'end_turn', text = 'Notes de recherche') =>
    message([{ type: 'web_search_tool_result', content: hits.map((h) => ({ type: 'web_search_result', ...h })) }, { type: 'text', text }], stop);
  const article = { url: 'https://lemonde.example/a1', title: 'Le Monde' };

  it('reprend la recherche après une pause, puis rédige à partir de sources réellement trouvées', async () => {
    const { client, calls } = fake(
      search([article], 'pause_turn', ''),
      search([], 'end_turn', 'Notes : article du Monde'),
      json({ ideas: [
        { title: 'Réagir', angle: 'Sujet chaud', text: 'Notre avis', origin: 'news', source_url: article.url },
        { title: 'Inventé', angle: 'Faux', text: 'Texte', origin: 'news', source_url: 'https://invente.example/x' },
        { title: 'Notre offre', angle: 'Toujours utile', text: 'Livraison offerte', origin: 'knowledge', source_url: '' },
      ] }),
    );
    const result = await runAssist(ideas, { ...base, client });

    expect(calls).toHaveLength(3);
    expect(calls[0]!.tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }]);
    // La recherche d'actualité connaît elle aussi la base de connaissance (règles + fiches).
    expect(calls[0]!.system).toHaveLength(2);
    expect(calls[0]!.output_config?.format).toBeUndefined();
    // La reprise renvoie le tour interrompu de l'assistant.
    expect(calls[1]!.messages.at(-1)!.role).toBe('assistant');
    // La rédaction ne dispose plus de l'outil de recherche.
    expect(calls[2]!.tools).toBeUndefined();
    expect(JSON.stringify(calls[2]!.messages)).toContain(article.url);

    expect(result).toMatchObject({ ok: true, mode: 'ideas' });
    if (!result.ok || result.mode !== 'ideas') throw new Error('idées attendues');
    expect(result.ideas.map((i) => i.title)).toEqual(['Réagir', 'Notre offre']);
    expect(result.ideas[0]!.source).toEqual({ title: 'Le Monde', url: article.url });
  });

  it('sans thème ni base de connaissance, la demande est refusée avant tout appel', async () => {
    const { client, calls } = fake();
    expect(await runAssist({ ...ideas, theme: '', knowledge: false }, { ...base, entries: [], client })).toEqual({ ok: false, error: 'invalid' });
    expect(await runAssist({ ...ideas, theme: '', knowledge: true }, { ...base, entries: [], client })).toEqual({ ok: false, error: 'invalid' });
    expect(calls).toHaveLength(0);
  });

  it('actualité seule et recherche sans résultat : « empty », sans rédaction inutile', async () => {
    const { client, calls } = fake(search([], 'end_turn', 'Rien de pertinent'));
    expect(await runAssist({ ...ideas, knowledge: false }, { ...base, client })).toEqual({ ok: false, error: 'empty' });
    expect(calls).toHaveLength(1);
  });

  it('base de connaissance seule : un seul appel, sans recherche web', async () => {
    const { client, calls } = fake(json({ ideas: [{ title: 'Offre', angle: 'Utile', text: 'Livraison offerte', origin: 'knowledge', source_url: '' }] }));
    const result = await runAssist({ ...ideas, news: false }, { ...base, client });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tools).toBeUndefined();
    expect(result).toMatchObject({ ok: true, mode: 'ideas' });
  });
});
