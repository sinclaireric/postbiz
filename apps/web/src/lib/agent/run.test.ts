import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import type { IntegrationItem, MediaItem } from '@/lib/data/types';
import { agentRules } from './prompt';
import { agentErrorCode, AgentEmptyError, AgentRefusedError, DEFAULT_AGENT_MODEL, agentConfigured, agentModel, instructionsFor, runAgentTurn, type AgentClient, type AgentResponse, type AgentToolbox, type AgentTurnDeps } from './run';
import type { GenerationTools } from './generation';
import { AGENT_LIMITS, type AgentEvent, type AgentVideoJob } from './types';

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
    expect(instructionsFor([])).toBe(agentRules());
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

describe('runAgentTurn : génération d’images et de vidéos', () => {
  const generated = (id: string): MediaItem => ({ ...image(id), name: `ai-image-${id}.jpg`, width: 1024, height: 1024 });
  const job = (id = 'job1'): AgentVideoJob => ({ id, status: 'pending', orientation: 'vertical', prompt: 'Un rabot', mediaId: null, error: null, createdAt: '2026-10-27T10:00:00Z' });

  /** Des outils de génération scriptés : chaque appel est consigné, chaque image porte un identifiant en séquence. */
  function generation(over: Partial<GenerationTools> = {}) {
    const log: { image: unknown[]; video: unknown[]; status: string[] } = { image: [], video: [], status: [] };
    let n = 0;
    const gen: GenerationTools = {
      generateImage: async (args) => (log.image.push(args), { ok: true, item: generated(`g${++n}`) }),
      startVideo: async (args) => (log.video.push(args), { ok: true, job: job() }),
      videoStatus: async (id) => (log.status.push(id), { ok: true, job: { ...job(id), status: 'completed', mediaId: 'v1' }, item: { ...image('v1'), kind: 'video', url: 'https://cdn.test/v1.mp4' } }),
      ...over,
    };
    return { gen, log };
  }
  const withGeneration = (g: GenerationTools, features = { image: true, video: true }) => ({ tools: tools({ generation: g }), features });
  const outputs = (call: Params) => (call.input as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output').map((i) => JSON.parse(i.output!) as Record<string, unknown>);
  const toolNames = (call: Params) => (call.tools as { name: string }[]).map((t) => t.name);

  it('propose les outils de génération (et leurs règles) seulement quand le serveur les offre', async () => {
    const { gen } = generation();
    const off = setup([reply([say('Bonjour')])], { tools: tools({ generation: gen }), features: { image: false, video: false } });
    await runAgentTurn(off.deps, 'Salut');
    expect(toolNames(off.calls[0]!)).toEqual(['propose_posts', 'list_posts', 'list_media']);
    expect(off.calls[0]!.instructions).not.toContain('generate_image');

    const none = setup([reply([say('Bonjour')])], { features: { image: true, video: true } });
    await runAgentTurn(none.deps, 'Salut');
    expect(toolNames(none.calls[0]!)).toEqual(['propose_posts', 'list_posts', 'list_media']); // pas d'outils de génération dans la boîte à outils

    const images = setup([reply([say('Bonjour')])], withGeneration(gen, { image: true, video: false }));
    await runAgentTurn(images.deps, 'Salut');
    expect(toolNames(images.calls[0]!)).toEqual(['propose_posts', 'list_posts', 'list_media', 'generate_image']);
    expect(images.calls[0]!.instructions).toContain('generate_image');
    expect(images.calls[0]!.instructions).not.toContain('generate_video');

    const both = setup([reply([say('Bonjour')])], withGeneration(gen));
    await runAgentTurn(both.deps, 'Salut');
    expect(toolNames(both.calls[0]!)).toEqual(['propose_posts', 'list_posts', 'list_media', 'generate_image', 'generate_video', 'video_status']);
    expect(both.calls[0]!.instructions).toContain('generate_video');
  });

  it('génère une image, puis la joint à la publication préparée dans le même message', async () => {
    const { gen, log } = generation();
    const { deps, events, calls } = setup([
      reply([say('Je crée l’image.'), call('c1', 'generate_image', { prompt: 'Un atelier de menuiserie', size: 'landscape', alt: 'Un atelier' })]),
      reply([call('c2', 'propose_posts', { posts: [{ channel_id: 'fb', text: 'Atelier ouvert samedi !', media_ids: ['g1'] }] })]),
    ], withGeneration(gen));
    const result = await runAgentTurn(deps, 'Annonce l’atelier avec une image');

    expect(log.image).toEqual([{ prompt: 'Un atelier de menuiserie', size: 'landscape', alt: 'Un atelier' }]);
    expect(calls).toHaveLength(2);
    expect(outputs(calls[1]!)[0]).toMatchObject({ media_id: 'g1', width: 1024, height: 1024 });
    expect(result.images.map((m) => m.id)).toEqual(['g1']);
    expect(result.proposals[0]!.mediaIds).toEqual(['g1']);
    expect(result.media.map((m) => m.id)).toEqual(['g1']);
    expect(events.map((e) => e.type)).toEqual(['text', 'tool', 'media', 'tool', 'proposals']);
    expect(events.find((e) => e.type === 'media')).toMatchObject({ media: [{ id: 'g1', kind: 'image' }] });
  });

  it('une taille inconnue devient carrée ; l’outil ne reçoit que les champs attendus', async () => {
    const { gen, log } = generation();
    const { deps } = setup([reply([call('c1', 'generate_image', { prompt: 'Un phare', size: 'enorme', evil: 'x' })]), reply([say('Voilà.')])], withGeneration(gen));
    await runAgentTurn(deps, 'Une image d’un phare');
    expect(log.image).toEqual([{ prompt: 'Un phare', size: 'square', alt: undefined }]);
  });

  it('plusieurs images demandées en même temps sont générées en parallèle', async () => {
    let running = 0;
    let peak = 0;
    const { gen } = generation({
      generateImage: async () => { peak = Math.max(peak, ++running); await new Promise((r) => setTimeout(r, 10)); running--; return { ok: true, item: generated(`g${peak}-${Math.random()}`) }; },
    });
    const { deps } = setup([reply([call('a', 'generate_image', { prompt: 'Un' }), call('b', 'generate_image', { prompt: 'Deux' }), call('c', 'generate_image', { prompt: 'Trois' })]), reply([say('Voici.')])], withGeneration(gen));
    const result = await runAgentTurn(deps, 'Trois images');
    expect(peak).toBe(3);
    expect(result.images).toHaveLength(3);
  });

  it(`au plus ${AGENT_LIMITS.imagesPerMessage} images par demande : les suivantes ne partent pas, le modèle est prévenu`, async () => {
    const { gen, log } = generation();
    const four = Array.from({ length: 4 }, (_, i) => call(`c${i}`, 'generate_image', { prompt: `Image ${i}` }));
    const { deps, calls } = setup([reply(four), reply([say('Trois images sont prêtes.')])], withGeneration(gen));
    const result = await runAgentTurn(deps, 'Quatre images');
    expect(log.image).toHaveLength(AGENT_LIMITS.imagesPerMessage);
    expect(result.images).toHaveLength(AGENT_LIMITS.imagesPerMessage);
    expect(JSON.stringify(calls[1]!.input)).toContain(`Only ${AGENT_LIMITS.imagesPerMessage} pictures can be generated per request`);
  });

  it('un échec de génération est rendu au modèle, qui l’explique ; rien n’est joint', async () => {
    const { gen } = generation({ generateImage: async () => ({ ok: false, error: 'The image provider refused this description (content policy).' }) });
    const { deps, calls } = setup([reply([call('c1', 'generate_image', { prompt: 'Interdit' })]), reply([say('Cette image n’est pas possible.')])], withGeneration(gen));
    const result = await runAgentTurn(deps, 'Une image');
    expect(outputs(calls[1]!)[0]).toEqual({ error: 'The image provider refused this description (content policy).' });
    expect(result.text).toBe('Cette image n’est pas possible.');
    expect(result.images).toEqual([]);
  });

  it('une génération qui lève une exception ne casse pas la conversation', async () => {
    const { gen } = generation({ generateImage: async () => { throw new Error('boum'); } });
    const { deps, calls } = setup([reply([call('c1', 'generate_image', { prompt: 'Un phare' })]), reply([say('Désolé.')])], withGeneration(gen));
    const result = await runAgentTurn(deps, 'Une image');
    expect(outputs(calls[1]!)[0]).toMatchObject({ error: expect.stringMatching(/could not be generated/) });
    expect(result.text).toBe('Désolé.');
  });

  it('sans description, l’outil n’est pas appelé', async () => {
    const { gen, log } = generation();
    const { deps, calls } = setup([reply([call('c1', 'generate_image', { prompt: '  ' })]), reply([say('Que voulez-vous voir ?')])], withGeneration(gen));
    await runAgentTurn(deps, 'Une image');
    expect(log.image).toEqual([]);
    expect(JSON.stringify(calls[1]!.input)).toContain('description of the picture is missing');
  });

  it('lance une vidéo : la tâche est annoncée au navigateur, le modèle sait qu’elle prend des minutes', async () => {
    const { gen, log } = generation();
    const { deps, events, calls } = setup([
      reply([call('c1', 'generate_video', { prompt: 'Un rabot sur du chêne', orientation: 'horizontal', reference_media_ids: ['m1', 4, 'm2'] })]),
      reply([say('Votre vidéo est en préparation, quelques minutes.')]),
    ], withGeneration(gen));
    const result = await runAgentTurn(deps, 'Une vidéo de l’atelier');

    expect(log.video).toEqual([{ prompt: 'Un rabot sur du chêne', orientation: 'horizontal', referenceIds: ['m1', 'm2'] }]);
    expect(result.jobs.map((j) => j.id)).toEqual(['job1']);
    expect(events.filter((e) => e.type === 'job')).toEqual([{ type: 'job', job: job() }]);
    expect(outputs(calls[1]!)[0]).toMatchObject({ job_id: 'job1', status: 'pending', note: expect.stringContaining('several minutes') });
    expect(result.text).toBe('Votre vidéo est en préparation, quelques minutes.');
  });

  it('une orientation inconnue devient verticale ; une seule vidéo par demande', async () => {
    const { gen, log } = generation();
    const { deps, calls } = setup([reply([call('a', 'generate_video', { prompt: 'Un' }), call('b', 'generate_video', { prompt: 'Deux' })]), reply([say('Une vidéo est lancée.')])], withGeneration(gen));
    const result = await runAgentTurn(deps, 'Deux vidéos');
    expect(log.video).toEqual([{ prompt: 'Un', orientation: 'vertical', referenceIds: [] }]);
    expect(result.jobs).toHaveLength(1);
    expect(JSON.stringify(calls[1]!.input)).toContain('Only 1 video can be started per request');
  });

  it('une vidéo refusée (plafond, fournisseur) est expliquée par le modèle', async () => {
    const { gen } = generation({ startVideo: async () => ({ ok: false, error: 'This organization reached its limit of 5 generated videos per day.' }) });
    const { deps, calls } = setup([reply([call('c1', 'generate_video', { prompt: 'Un rabot' })]), reply([say('Limite atteinte.')])], withGeneration(gen));
    const result = await runAgentTurn(deps, 'Une vidéo');
    expect(outputs(calls[1]!)[0]).toMatchObject({ error: expect.stringContaining('limit of 5') });
    expect(result.jobs).toEqual([]);
  });

  it('la vidéo n’est pas proposée quand le serveur ne l’offre pas : l’appel reçoit une réponse claire', async () => {
    const { gen, log } = generation();
    const { deps, calls } = setup([reply([call('c1', 'generate_video', { prompt: 'Un rabot' })]), reply([say('Pas de vidéo ici.')])], withGeneration(gen, { image: true, video: false }));
    await runAgentTurn(deps, 'Une vidéo');
    expect(log.video).toEqual([]);
    expect(JSON.stringify(calls[1]!.input)).toContain('Video generation is not available');
  });

  it('video_status : une vidéo prête devient un média utilisable dans les publications du même message', async () => {
    const { gen, log } = generation();
    const { deps, events } = setup([
      reply([call('c1', 'video_status', { job_id: 'job1' })]),
      reply([call('c2', 'propose_posts', { posts: [{ channel_id: 'ig', text: 'Coulisses !', media_ids: ['v1'] }] })]),
    ], withGeneration(gen));
    const result = await runAgentTurn(deps, 'Ma vidéo est prête ? Prépare le post');
    expect(log.status).toEqual(['job1']);
    expect(result.proposals[0]!.mediaIds).toEqual(['v1']);
    expect(events.filter((e) => e.type === 'job' || e.type === 'media').map((e) => e.type)).toEqual(['job', 'media']);
  });

  it('video_status : encore en cours, ou en échec', async () => {
    const pending = generation({ videoStatus: async (id) => ({ ok: true, job: job(id), item: null }) });
    const a = setup([reply([call('c1', 'video_status', { job_id: 'job1' })]), reply([say('Pas encore prête.')])], withGeneration(pending.gen));
    await runAgentTurn(a.deps, 'Prête ?');
    expect(outputs(a.calls[1]!)[0]).toMatchObject({ status: 'pending', note: expect.stringContaining('do not call video_status again') });

    const failed = generation({ videoStatus: async (id) => ({ ok: true, job: { ...job(id), status: 'failed', error: 'Rejected' }, item: null }) });
    const b = setup([reply([call('c1', 'video_status', { job_id: 'job1' })]), reply([say('Elle a échoué.')])], withGeneration(failed.gen));
    await runAgentTurn(b.deps, 'Prête ?');
    expect(outputs(b.calls[1]!)[0]).toMatchObject({ status: 'failed', error: 'Rejected' });

    const missing = generation({ videoStatus: async () => ({ ok: false, error: 'Video job not found.' }) });
    const c = setup([reply([call('c1', 'video_status', { job_id: 'autre' })]), reply([say('Introuvable.')])], withGeneration(missing.gen));
    await runAgentTurn(c.deps, 'Prête ?');
    expect(outputs(c.calls[1]!)[0]).toEqual({ error: 'Video job not found.' });
  });

  it('une réponse faite seulement d’images générées n’est pas « vide »', async () => {
    const { gen } = generation();
    const { deps } = setup([reply([call('c1', 'generate_image', { prompt: 'Un phare' })]), reply([])], withGeneration(gen));
    const result = await runAgentTurn(deps, 'Un phare');
    expect(result.text).toBe('');
    expect(result.images).toHaveLength(1);
  });
});
