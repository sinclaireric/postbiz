import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import type { IntegrationItem, MediaItem } from '@/lib/data/types';
import { AGENT_RULES } from './prompt';
import { agentErrorCode, AgentEmptyError, AgentRefusedError, DEFAULT_AGENT_MODEL, agentConfigured, agentModel, instructionsFor, runAgentTurn, type AgentClient, type AgentResponse, type AgentToolbox, type AgentTurnDeps } from './run';
import { AGENT_LIMITS, type AgentEvent } from './types';

type Params = Parameters<AgentClient['stream']>[0];

const usage = { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 50 } };
const reply = (output: unknown[], over: Partial<AgentResponse> = {}) => ({ status: 'completed', output, usage, ...over }) as unknown as AgentResponse;
const say = (text: string) => ({ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const call = (id: string, name: string, args: unknown) => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'chiffré' };

/** Un client scripté : chaque appel rend la réponse suivante et diffuse son texte comme le ferait le flux. */
function fake(...replies: (AgentResponse | Error)[]) {
  const calls: Params[] = [];
  const client: AgentClient = {
    async stream(params, onText) {
      calls.push(structuredClone(params));
      const next = replies.shift();
      if (!next) throw new Error('réponse non prévue');
      if (next instanceof Error) throw next;
      for (const item of next.output) if (item.type === 'message') for (const part of item.content) if (part.type === 'output_text') onText(part.text);
      return next;
    },
  };
  return { client, calls };
}

const channel = (id: string, networkId: IntegrationItem['networkId'], name: string, status: IntegrationItem['status'] = 'active'): IntegrationItem => ({ id, networkId, name, username: null, pictureUrl: null, status });
const image = (id: string): MediaItem => ({ id, path: id, name: `${id}.jpg`, mimeType: 'image/jpeg', kind: 'image', sizeBytes: 1, width: 1080, height: 1350, durationSeconds: null, alt: '', createdAt: '2026-01-01T00:00:00Z', url: `https://cdn.test/${id}.jpg`, thumbUrl: `https://cdn.test/${id}-t.jpg` });

const library = [image('m1'), image('m2')];
const tools = (over: Partial<AgentToolbox> = {}): AgentToolbox => ({
  listPosts: async () => ({ posts: [] }),
  listMedia: async () => ({ items: library, text: { media: library.map((m) => ({ id: m.id, name: m.name })) } }),
  mediaByIds: async (ids) => library.filter((m) => ids.includes(m.id)),
  ...over,
});

let seq = 0;
const setup = (replies: (AgentResponse | Error)[], over: Partial<AgentTurnDeps> = {}) => {
  const f = fake(...replies);
  const events: AgentEvent[] = [];
  const deps: AgentTurnDeps = {
    client: f.client, model: 'gpt-test', channels: [channel('fb', 'facebook', 'Maison Lune'), channel('x', 'x', 'Maison Lune X'), channel('ig', 'instagram', 'maison.lune')],
    knowledge: [], orgName: 'Maison Lune', language: 'French', timeZone: 'Europe/Paris', now: new Date('2026-10-27T10:00:00Z'), history: [], tools: tools(),
    emit: (e) => events.push(e), newId: () => `p${++seq}`, ...over,
  };
  return { ...f, events, deps };
};

describe('modèle de l’agent', () => {
  it('c’est celui de Postiz par défaut, modifiable par OPENAI_AGENT_MODEL', () => {
    expect(DEFAULT_AGENT_MODEL).toBe('gpt-5.2');
    delete process.env.OPENAI_AGENT_MODEL;
    expect(agentModel()).toBe('gpt-5.2');
    process.env.OPENAI_AGENT_MODEL = ' gpt-5.2-mini ';
    expect(agentModel()).toBe('gpt-5.2-mini');
    delete process.env.OPENAI_AGENT_MODEL;
  });

  it('n’est proposé qu’avec une clé OpenAI côté serveur', () => {
    delete process.env.OPENAI_API_KEY;
    expect(agentConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = '   ';
    expect(agentConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = 'cle-de-test';
    expect(agentConfigured()).toBe(true);
    delete process.env.OPENAI_API_KEY;
  });
});

describe('runAgentTurn : une demande simple', () => {
  it('prépare les publications en un seul appel, sans appel de clôture', async () => {
    const { deps, calls, events } = setup([reply([reasoning, say('Voici deux publications.'), call('c1', 'propose_posts', { posts: [{ channel_id: 'fb', text: 'Atelier ouvert samedi !' }, { channel_id: 'x', text: 'Atelier ouvert samedi.' }] })])]);
    const result = await runAgentTurn(deps, 'Annonce l’atelier de samedi');

    expect(calls).toHaveLength(1);
    expect(result.text).toBe('Voici deux publications.');
    expect(result.proposals.map((p) => [p.networkId, p.status])).toEqual([['facebook', 'pending'], ['x', 'pending']]);
    expect(result.usage).toEqual({ calls: 1, inputTokens: 100, outputTokens: 20, cachedTokens: 50 });
    expect(events.map((e) => e.type)).toEqual(['text', 'tool', 'proposals']);
    expect(events[0]).toEqual({ type: 'text', delta: 'Voici deux publications.' });
  });

  it('construit la requête : modèle, règles, outils, raisonnement, historique, canaux cochés et fuseau', async () => {
    const { deps, calls } = setup([reply([say('Bonjour !')])], {
      history: [{ role: 'user', content: 'Salut' }, { role: 'assistant', content: 'Bonjour' }], knowledge: [{ title: 'Ton', content: 'Tutoiement.' }], safetyId: 'u-hache', cacheKey: 'o-hache',
    });
    await runAgentTurn(deps, 'Que peux-tu faire ?');
    const call = calls[0]!;

    expect(call.model).toBe('gpt-test');
    expect(call.reasoning).toEqual({ effort: 'low' });
    expect(call.store).toBe(false);
    expect(call.safety_identifier).toBe('u-hache');
    expect(call.prompt_cache_key).toBe('o-hache');
    expect(call.max_output_tokens).toBe(16_000);
    expect((call.tools as { name: string; type: string; strict: boolean }[]).map((t) => [t.type, t.name, t.strict])).toEqual([['function', 'propose_posts', false], ['function', 'list_posts', false], ['function', 'list_media', false]]);

    expect(call.instructions).toMatch(/You never publish anything yourself/);
    expect(call.instructions).toContain('Tutoiement.');
    const input = call.input as { role: string; content: string }[];
    expect(input.map((m) => m.role)).toEqual(['user', 'assistant', 'developer', 'user']);
    expect(input.slice(0, 2)).toEqual([{ role: 'user', content: 'Salut' }, { role: 'assistant', content: 'Bonjour' }]);
    expect(input[3]).toEqual({ role: 'user', content: 'Que peux-tu faire ?' });
    // La date et les canaux viennent après l'historique : le début de la requête reste identique d'un message à l'autre.
    expect(input[2]!.content).toContain('Tuesday 2026-10-27 11:00 (timezone Europe/Paris)');
    expect(input[2]!.content).toContain('id: fb | Facebook');
    expect(input[2]!.content).toContain('id: ig | Instagram | account "maison.lune" | at most 2200 characters | needs a picture or a video');
    expect(input[2]!.content).toContain('id: x | X | account "Maison Lune X" | at most 280 characters | text only for now');
  });

  it('sans base de connaissance, les instructions sont les seules règles', () => {
    expect(instructionsFor([])).toBe(AGENT_RULES);
    expect(instructionsFor([{ title: 'Ton', content: 'Tutoiement.' }])).toContain('<knowledge_base>');
  });

  it('répond par du texte quand rien n’est à préparer', async () => {
    const { deps, calls, events } = setup([reply([say('Je prépare des publications pour vos canaux.')])]);
    const result = await runAgentTurn(deps, 'Bonjour');
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ text: 'Je prépare des publications pour vos canaux.', proposals: [], media: [] });
    expect(events.some((e) => e.type === 'proposals')).toBe(false);
  });
});

describe('runAgentTurn : outils de lecture et corrections', () => {
  it('cherche un média, rejoue le raisonnement chiffré et le résultat de l’outil, puis attache le média à Instagram', async () => {
    const { deps, calls, events } = setup([
      reply([reasoning, say('Je cherche une image.'), call('c1', 'list_media', { search: 'atelier' })]),
      reply([call('c2', 'propose_posts', { posts: [{ channel_id: 'ig', text: 'Dans l’atelier.', media_ids: ['m2'] }] })]),
    ]);
    const result = await runAgentTurn(deps, 'Une publication Instagram avec une photo de l’atelier');

    expect(calls).toHaveLength(2);
    const second = calls[1]!.input as { type?: string; role?: string; call_id?: string; output?: string }[];
    // Après les messages : ce que le modèle a produit (raisonnement, texte, appel), puis le résultat de l'appel.
    expect(second.slice(-4).map((i) => i.type ?? i.role)).toEqual(['reasoning', 'message', 'function_call', 'function_call_output']);
    expect(second.at(-1)).toMatchObject({ type: 'function_call_output', call_id: 'c1' });
    expect(second.at(-1)!.output).toContain('m2.jpg');
    expect(result.proposals[0]).toMatchObject({ networkId: 'instagram', mediaIds: ['m2'] });
    expect(result.media).toEqual([{ id: 'm2', kind: 'image', name: 'm2.jpg', alt: '', url: 'https://cdn.test/m2.jpg', thumbUrl: 'https://cdn.test/m2-t.jpg', durationSeconds: null }]);
    expect(events.filter((e) => e.type === 'tool').map((e) => (e as { name: string }).name)).toEqual(['list_media', 'propose_posts']);
  });

  it('renvoie les erreurs de validation au modèle, qui corrige', async () => {
    const { deps, calls } = setup([
      reply([call('c1', 'propose_posts', { posts: [{ channel_id: 'x', text: 'a'.repeat(300) }, { channel_id: 'ig', text: 'Sans image' }] })]),
      reply([call('c2', 'propose_posts', { posts: [{ channel_id: 'x', text: 'Court.' }] })]),
    ]);
    const result = await runAgentTurn(deps, 'Deux publications');

    expect(calls).toHaveLength(2);
    const feedback = (calls[1]!.input as { type?: string; output?: string }[]).at(-1)!;
    expect(feedback.type).toBe('function_call_output');
    expect(feedback.output).toContain('Nothing was prepared');
    expect(feedback.output).toContain('tooLong');
    expect(feedback.output).toContain('needsMedia');
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.text).toBe('Court.');
  });

  it('refuse un canal qui n’a pas été coché, sans rien préparer', async () => {
    const { deps } = setup([reply([say('Désolé.'), call('c1', 'propose_posts', { posts: [{ channel_id: 'li-autre', text: 'Texte' }] })]), reply([say('Je ne peux pas utiliser ce canal.')])]);
    const result = await runAgentTurn(deps, 'Poste sur LinkedIn');
    expect(result.proposals).toEqual([]);
    expect(result.text).toBe('Désolé.\n\nJe ne peux pas utiliser ce canal.');
  });

  it('s’arrête au plafond d’appels quand le modèle n’y arrive pas, sans boucler', async () => {
    const bad = () => reply([call('c', 'propose_posts', { posts: [{ channel_id: 'x', text: 'a'.repeat(300) }] })]);
    const { deps, calls } = setup(Array.from({ length: 10 }, bad));
    await expect(runAgentTurn(deps, 'Publie')).rejects.toBeInstanceOf(AgentEmptyError);
    expect(calls).toHaveLength(AGENT_LIMITS.toolTurns);
  });

  it('répond à un outil inconnu ou à des arguments illisibles par une erreur, sans rien exécuter', async () => {
    const asked: unknown[] = [];
    const { deps, calls } = setup([
      reply([call('c1', 'delete_everything', {}), call('c2', 'list_media', '{pas du json')]),
      reply([say('Je ne sais pas faire cela.')]),
    ], { tools: tools({ listMedia: async (a) => { asked.push(a); return { items: [], text: {} }; } }) });
    const result = await runAgentTurn(deps, 'Supprime tout');
    const outputs = (calls[1]!.input as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output');
    expect(outputs.map((o) => o.output)).toEqual(['Unknown tool delete_everything.', 'The arguments are not a valid JSON object. Call the tool again with valid JSON.']);
    expect(asked).toEqual([]);
    expect(result.text).toBe('Je ne sais pas faire cela.');
  });

  it('transmet les médias joints par l’utilisateur à la validation', async () => {
    let asked: string[] = [];
    const { deps } = setup([reply([call('c1', 'propose_posts', { posts: [{ channel_id: 'ig', text: 'Photo jointe', media_ids: ['m1'] }] })])], {
      attached: [library[0]!],
      tools: tools({ mediaByIds: async (ids) => { asked = ids; return []; } }),
    });
    const result = await runAgentTurn(deps, 'Publie cette photo');
    expect(asked).toEqual([]); // déjà connue : pas de requête de plus
    expect(result.proposals[0]!.mediaIds).toEqual(['m1']);
  });

  it('liste les publications du calendrier sans les modifier', async () => {
    const seen: unknown[] = [];
    const { deps } = setup([reply([call('c1', 'list_posts', { from: '2026-10-27', channel_id: 'fb' })]), reply([say('Rien de prévu.')])], { tools: tools({ listPosts: async (a) => { seen.push(a); return { posts: [] }; } }) });
    const result = await runAgentTurn(deps, 'Qu’est-ce qui est prévu ?');
    expect(seen).toEqual([{ from: '2026-10-27', to: undefined, channelId: 'fb' }]);
    expect(result.text).toBe('Rien de prévu.');
  });
});

describe('runAgentTurn : échecs', () => {
  it('un refus du modèle remonte comme tel, qu’il vienne du message ou du filtre de contenu', async () => {
    const refusal = { type: 'message', id: 'msg_r', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'Je ne peux pas aider.' }] };
    await expect(runAgentTurn(setup([reply([refusal])]).deps, 'x')).rejects.toBeInstanceOf(AgentRefusedError);
    await expect(runAgentTurn(setup([reply([], { status: 'incomplete', incomplete_details: { reason: 'content_filter' } })]).deps, 'x')).rejects.toBeInstanceOf(AgentRefusedError);
  });

  it('une réponse coupée par la limite de jetons n’est jamais exécutée', async () => {
    const { deps } = setup([reply([call('c1', 'propose_posts', { posts: [{ channel_id: 'fb', text: 'Tronqué' }] })], { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })]);
    await expect(runAgentTurn(deps, 'x')).rejects.toThrow(/tronquée/);
  });

  it('une réponse en échec ou vide est une erreur, pas un message vide', async () => {
    await expect(runAgentTurn(setup([reply([], { status: 'failed' })]).deps, 'x')).rejects.toThrow(/en échec/);
    await expect(runAgentTurn(setup([reply([])]).deps, 'x')).rejects.toBeInstanceOf(AgentEmptyError);
  });
});

describe('agentErrorCode', () => {
  const headers = new Headers();
  it('range les erreurs du SDK et de la boucle', () => {
    expect(agentErrorCode(new AgentRefusedError())).toBe('refused');
    expect(agentErrorCode(new AgentEmptyError())).toBe('empty');
    expect(agentErrorCode(new OpenAI.RateLimitError(429, { code: 'rate_limit_exceeded' }, 'Rate limit', headers))).toBe('rate_limited');
    expect(agentErrorCode(new OpenAI.AuthenticationError(401, { code: 'invalid_api_key' }, 'Bad key', headers))).toBe('disabled');
    expect(agentErrorCode(new OpenAI.PermissionDeniedError(403, undefined, 'Forbidden', headers))).toBe('disabled');
    expect(agentErrorCode(new OpenAI.APIError(500, { message: 'Overloaded' }, 'Overloaded', headers))).toBe('failed');
    expect(agentErrorCode(new Error('boom'))).toBe('failed');
  });

  it('un compte sans crédit n’est pas une rafale de demandes : l’agent est indisponible', () => {
    expect(agentErrorCode(new OpenAI.RateLimitError(429, { code: 'insufficient_quota' }, 'Quota', headers))).toBe('disabled');
  });

  it('une interruption voulue n’est pas journalisée comme une panne', () => {
    expect(agentErrorCode(new OpenAI.APIUserAbortError())).toBe('failed');
  });
});
