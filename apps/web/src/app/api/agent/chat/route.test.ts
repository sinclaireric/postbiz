import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentClient } from '@/lib/agent/run';
import { createEventParser } from '@/lib/agent/request';
import type { AgentEvent } from '@/lib/agent/types';
import type { SessionState } from '@/lib/data';
import { DEMO_CONTEXT, demoRepositories } from '@/lib/data/demo';

// La route lit la session, la langue et les dépôts de données dans le contexte de la requête Next : on les remplace par ceux de la démo.
const state = vi.hoisted(() => ({ session: null as unknown, client: null as unknown, images: null as unknown, videos: null as unknown, byToken: null as unknown as (token: string) => Promise<{ session: unknown; repos: unknown }>, cookieReads: 0 }));
vi.mock('@/i18n/server', () => ({
  getT: async () => ((key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key)),
  getLocale: async () => 'fr',
}));
vi.mock('@/lib/data', async () => ({
  getSession: async () => { state.cookieReads++; return state.session; },
  getRepositories: async () => (await import('@/lib/data/demo')).demoRepositories,
  bearerToken: (header: string | null) => /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? null,
  getSessionForToken: (token: string) => state.byToken(token),
}));
vi.mock('@/lib/agent/run', async (original) => ({ ...(await original<typeof import('@/lib/agent/run')>()), sdkAgentClient: () => state.client }));
vi.mock('@/lib/agent/generate', async (original) => ({ ...(await original<typeof import('@/lib/agent/generate')>()), sdkImageProvider: () => state.images, evolinkVideoProvider: () => state.videos }));

const { POST } = await import('./route');

const ready = (over: { id?: string; role?: 'admin' | 'member' | 'viewer'; mode?: 'demo' | 'supabase' } = {}): SessionState => ({
  status: 'ready', ctx: { ...DEMO_CONTEXT, mode: over.mode ?? 'demo', user: { ...DEMO_CONTEXT.user, id: over.id ?? 'u-' + Math.random() }, org: { ...DEMO_CONTEXT.org, role: over.role ?? 'admin' } },
});
const post = (body: unknown, headers: Record<string, string> = {}) => POST(new Request('http://localhost/api/agent/chat', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const events = async (res: Response): Promise<AgentEvent[]> => {
  const parser = createEventParser();
  const text = await res.text();
  return [...parser.push(text), ...parser.flush()];
};
const say = (text: string) => ({ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const use = (id: string, name: string, args: unknown) => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args) });
const usage = { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 } };

beforeEach(() => {
  state.session = ready();
  state.cookieReads = 0;
  state.byToken = async () => ({ session: { status: 'anonymous' }, repos: null });
  delete process.env.OPENAI_API_KEY;
  delete process.env.EVOLINK_API_KEY;
  delete process.env.AGENT_IMAGES_PER_DAY;
  delete process.env.AGENT_VIDEOS_PER_DAY;
});

describe('POST /api/agent/chat : accès et requête', () => {
  it('refuse un visiteur anonyme et un lecteur, en une ligne d’erreur lisible par le navigateur', async () => {
    state.session = { status: 'anonymous' } satisfies SessionState;
    const anon = await post({ message: 'Salut tout le monde' });
    expect(anon.status).toBe(401);
    expect(await events(anon)).toEqual([{ type: 'error', code: 'forbidden' }]);

    state.session = ready({ role: 'viewer' });
    const viewer = await post({ message: 'Salut tout le monde' });
    expect(viewer.status).toBe(403);
    expect(await events(viewer)).toEqual([{ type: 'error', code: 'forbidden' }]);
  });

  it('refuse un corps illisible, démesuré ou incomplet', async () => {
    for (const body of ['pas du json', { message: '' }, { message: 'a'.repeat(2_001) }, 'x'.repeat(30_000)]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await events(res)).toEqual([{ type: 'error', code: 'invalid' }]);
    }
  });

  it('sans clé d’API (hors démo), répond « indisponible » sans appeler le modèle', async () => {
    state.session = ready({ mode: 'supabase' });
    state.client = { stream: vi.fn() } satisfies AgentClient;
    const res = await post({ message: 'Annonce l’atelier', channelIds: ['i2'] });
    expect(res.status).toBe(503);
    expect(await events(res)).toEqual([{ type: 'error', code: 'disabled' }]);
    expect((state.client as AgentClient).stream).not.toHaveBeenCalled();
  });

  it('refuse une conversation qui n’existe pas, et des médias qui n’existent pas', async () => {
    expect((await post({ message: 'Suite', threadId: 'fantome' })).status).toBe(404);
    expect((await post({ message: 'Avec média', mediaIds: ['inconnu'] })).status).toBe(400);
  });

  it('limite le nombre de messages par utilisateur, sans gêner les autres', async () => {
    state.session = ready({ id: 'bavard' });
    const results: number[] = [];
    for (let i = 0; i < 21; i++) results.push((await post({ message: 'Montre le planning', channelIds: ['i1'] })).status);
    expect(results.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(results[20]).toBe(429);
    state.session = ready({ id: 'autre' });
    expect((await post({ message: 'Montre le planning', channelIds: ['i1'] })).status).toBe(200);
  });
});

describe('POST /api/agent/chat : application mobile (jeton Supabase)', () => {
  it('identifie l’utilisateur par son jeton, sans lire les cookies', async () => {
    const seen: string[] = [];
    state.byToken = async (token) => { seen.push(token); return { session: ready({ id: 'mobile-1' }), repos: demoRepositories }; };
    const res = await post({ message: 'Annonce l’atelier ouvert samedi', channelIds: ['i2'] }, { Authorization: 'Bearer abc.def-ghi' });
    expect(res.status).toBe(200);
    expect((await events(res)).at(-1)!.type).toBe('done');
    expect(seen).toEqual(['abc.def-ghi']);
    expect(state.cookieReads).toBe(0);
  });

  it('refuse un jeton que Supabase ne reconnaît pas, et un lecteur', async () => {
    const bad = await post({ message: 'Salut tout le monde' }, { Authorization: 'Bearer perime' });
    expect(bad.status).toBe(401);
    expect(await events(bad)).toEqual([{ type: 'error', code: 'forbidden' }]);

    state.byToken = async () => ({ session: ready({ role: 'viewer' }), repos: demoRepositories });
    expect((await post({ message: 'Salut tout le monde' }, { Authorization: 'Bearer valide' })).status).toBe(403);
  });

  it('un en-tête qui n’est pas un jeton Bearer retombe sur les cookies', async () => {
    const res = await post({ message: 'Montre le planning', channelIds: ['i1'] }, { Authorization: 'Basic dXNlcjpwYXNz' });
    expect(res.status).toBe(200);
    expect(state.cookieReads).toBe(1);
  });

  it('les conversations du mobile sont celles du web : même dépôt, même historique', async () => {
    state.byToken = async () => ({ session: ready({ id: 'mobile-2' }), repos: demoRepositories });
    const first = (await events(await post({ message: 'Annonce l’atelier ouvert samedi', channelIds: ['i2'] }, { Authorization: 'Bearer t' }))).at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect((await demoRepositories.agent.threads()).some((t) => t.id === first.thread.id)).toBe(true);
  });
});

describe('POST /api/agent/chat : mode démo', () => {
  it('diffuse la réponse simulée, puis l’échange enregistré dans une nouvelle conversation', async () => {
    const res = await post({ message: 'Annonce l’atelier ouvert samedi', channelIds: ['i2'], timeZone: 'Europe/Paris' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');
    const list = await events(res);
    expect(list.map((e) => e.type)).toEqual(expect.arrayContaining(['text', 'tool', 'proposals', 'done']));
    expect(list.at(-1)!.type).toBe('done');
    const done = list.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.thread.title).toBe('Annonce l’atelier ouvert samedi');
    expect(done.user).toMatchObject({ role: 'user', text: 'Annonce l’atelier ouvert samedi' });
    expect(done.assistant.proposals).toMatchObject([{ integrationId: 'i2', networkId: 'facebook', status: 'pending', text: 'Atelier ouvert samedi' }]);
    expect((await demoRepositories.agent.thread(done.thread.id))!.messages).toHaveLength(2);
  });

  it('continue la conversation demandée', async () => {
    const first = (await events(await post({ message: 'Annonce l’atelier ouvert samedi', channelIds: ['i2'] }))).at(-1) as Extract<AgentEvent, { type: 'done' }>;
    const second = (await events(await post({ message: 'Montre le planning', channelIds: ['i2'], threadId: first.thread.id }))).at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(second.thread.id).toBe(first.thread.id);
    expect((await demoRepositories.agent.thread(first.thread.id))!.messages).toHaveLength(4);
  });

  it('n’utilise que les canaux demandés, jamais ceux d’une autre organisation', async () => {
    const done = (await events(await post({ message: 'Annonce l’atelier ouvert samedi', channelIds: ['i2', 'canal-d-une-autre-org'] }))).at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.assistant.proposals.map((p) => p.integrationId)).toEqual(['i2']);
  });
});

describe('POST /api/agent/chat : vrai agent (client simulé)', () => {
  const run = (replies: unknown[]) => {
    const calls: unknown[] = [];
    state.client = {
      async stream(params, onText) {
        calls.push(structuredClone(params));
        const next = replies.shift() as { output: { type: string; content?: { type: string; text?: string }[] }[] };
        for (const item of next.output) if (item.type === 'message') for (const part of item.content!) if (part.type === 'output_text') onText(part.text!);
        return next as never;
      },
    } satisfies AgentClient;
    return calls;
  };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key-not-used';
    state.session = ready({ mode: 'supabase' });
  });

  it('transmet le texte au fil de l’eau, enregistre l’échange et ne propose que des publications valides', async () => {
    run([{ status: 'completed', usage, output: [say('Voici une publication.'), use('t1', 'propose_posts', { posts: [{ channel_id: 'i2', text: 'Atelier ouvert samedi !' }] })] }]);
    const list = await events(await post({ message: 'Annonce l’atelier de samedi', channelIds: ['i2'], timeZone: 'Europe/Paris' }));
    expect(list.map((e) => e.type)).toEqual(['text', 'tool', 'proposals', 'done']);
    const done = list.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.assistant.text).toBe('Voici une publication.');
    expect(done.assistant.proposals[0]).toMatchObject({ integrationId: 'i2', text: 'Atelier ouvert samedi !', status: 'pending' });
  });

  it('envoie à l’agent l’historique de la conversation, les canaux cochés et le fuseau du navigateur', async () => {
    const first = (await events((run([{ status: 'completed', usage, output: [say('Bonjour !')] }]), await post({ message: 'Salut', channelIds: ['i2'] })))).at(-1) as Extract<AgentEvent, { type: 'done' }>;
    const calls = run([{ status: 'completed', usage, output: [say('Oui.')] }]);
    await events(await post({ message: 'Et pour demain ?', channelIds: ['i1'], threadId: first.thread.id, timeZone: 'Asia/Tokyo' }));
    const call = calls[0] as { input: { role: string; content: string }[]; model: string; store: boolean; safety_identifier: string; prompt_cache_key: string };
    expect(call.model).toBe('gpt-5.2');
    expect(call.store).toBe(false);
    // L'identité n'est jamais transmise : seulement une empreinte de l'utilisateur et de l'organisation.
    expect(call.safety_identifier).toMatch(/^[0-9a-f]{32}$/);
    expect(call.prompt_cache_key).toMatch(/^[0-9a-f]{32}$/);
    expect(call.safety_identifier).not.toBe(call.prompt_cache_key);
    expect(call.input.map((m) => m.role)).toEqual(['user', 'assistant', 'developer', 'user']);
    expect([call.input[0], call.input[1], call.input[3]]).toEqual([{ role: 'user', content: 'Salut' }, { role: 'assistant', content: 'Bonjour !' }, { role: 'user', content: 'Et pour demain ?' }]);
    const session = call.input[2]!.content;
    expect(session).toContain('timezone Asia/Tokyo');
    expect(session).toContain('id: i1 | Instagram');
    expect(session).not.toContain('id: i2');
  });

  it('une erreur du fournisseur arrive comme une ligne d’erreur, sans rien enregistrer ni divulguer', async () => {
    state.client = { stream: async () => { throw new Error('upstream exploded sk-ant-secret'); } } satisfies AgentClient;
    const before = (await demoRepositories.agent.threads()).length;
    const text = await (await post({ message: 'Annonce l’atelier de samedi', channelIds: ['i2'] })).text();
    expect(JSON.parse(text.trim())).toEqual({ type: 'error', code: 'failed' });
    expect(text).not.toMatch(/sk-ant|exploded/);
    expect((await demoRepositories.agent.threads()).length).toBe(before);
  });
});

describe('POST /api/agent/chat : génération d’images et de vidéos', () => {
  const stream = (replies: unknown[]) => {
    const calls: { tools: { name: string }[]; instructions: string; input: unknown[] }[] = [];
    state.client = {
      async stream(params, onText) {
        calls.push(structuredClone(params) as never);
        const next = replies.shift() as { output: { type: string; content?: { type: string; text?: string }[] }[] };
        for (const item of next.output) if (item.type === 'message') for (const part of item.content!) if (part.type === 'output_text') onText(part.text!);
        return next as never;
      },
    } satisfies AgentClient;
    return calls;
  };
  const jpeg = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', width: 1024, height: 1024 };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key-not-used';
    state.session = ready({ mode: 'supabase' });
    state.images = { generate: vi.fn(async () => jpeg) };
    state.videos = { start: vi.fn(async () => 'task-route'), check: vi.fn(async () => ({ state: 'pending' })) };
  });

  it('propose la génération d’images avec la clé de l’agent, et celle des vidéos seulement avec une clé Evolink', async () => {
    let calls = stream([{ status: 'completed', usage, output: [say('Bonjour !')] }]);
    await events(await post({ message: 'Salut', channelIds: ['i2'] }));
    expect(calls[0]!.tools.map((t) => t.name)).toEqual(['propose_posts', 'list_posts', 'list_media', 'generate_image']);

    process.env.EVOLINK_API_KEY = 'cle-evolink';
    calls = stream([{ status: 'completed', usage, output: [say('Bonjour !')] }]);
    await events(await post({ message: 'Salut', channelIds: ['i2'] }));
    expect(calls[0]!.tools.map((t) => t.name)).toEqual(['propose_posts', 'list_posts', 'list_media', 'generate_image', 'generate_video', 'video_status']);
  });

  it('un plafond journalier à 0 retire l’outil correspondant', async () => {
    process.env.EVOLINK_API_KEY = 'cle-evolink';
    process.env.AGENT_IMAGES_PER_DAY = '0';
    process.env.AGENT_VIDEOS_PER_DAY = '0';
    const calls = stream([{ status: 'completed', usage, output: [say('Bonjour !')] }]);
    await events(await post({ message: 'Salut', channelIds: ['i2'] }));
    expect(calls[0]!.tools.map((t) => t.name)).toEqual(['propose_posts', 'list_posts', 'list_media']);
    expect(calls[0]!.instructions).not.toContain('generate_image');
  });

  it('génère une image, la range dans la médiathèque, la joint à la publication et garde le tout dans la conversation', async () => {
    stream([
      { status: 'completed', usage, output: [say('Je crée l’image.'), use('g1', 'generate_image', { prompt: 'Un atelier de menuiserie au lever du jour', size: 'landscape', alt: 'Un atelier' })] },
      { status: 'completed', usage, output: [use('p1', 'propose_posts', { posts: [{ channel_id: 'i1', text: 'Notre atelier au lever du jour', media_ids: ['__GENERATED__'] }] })] },
    ]);
    // L'identifiant de l'image n'existe qu'une fois générée : le modèle simulé le lit dans le résultat de l'outil.
    const original = state.client as AgentClient;
    state.client = {
      async stream(params, onText, signal) {
        const outputs = (params.input as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output');
        if (outputs.length > 0) {
          const id = (JSON.parse(outputs[0]!.output!) as { media_id: string }).media_id;
          return { status: 'completed', usage, output: [use('p1', 'propose_posts', { posts: [{ channel_id: 'i1', text: 'Notre atelier au lever du jour', media_ids: [id] }] })] } as never;
        }
        return original.stream(params, onText, signal);
      },
    } satisfies AgentClient;

    const list = await events(await post({ message: 'Un post Instagram avec une image de notre atelier', channelIds: ['i1'], timeZone: 'Europe/Paris' }));
    expect(list.map((e) => e.type)).toEqual(['text', 'tool', 'media', 'tool', 'proposals', 'done']);
    const media = list.find((e) => e.type === 'media') as Extract<AgentEvent, { type: 'media' }>;
    expect(media.media[0]).toMatchObject({ kind: 'image', name: 'ai-image-un-atelier-de-menuiserie-au-lever-du.jpg', alt: 'Un atelier' });
    const done = list.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.assistant.mediaIds).toEqual([media.media[0]!.id]);
    expect(done.assistant.proposals[0]!.mediaIds).toEqual([media.media[0]!.id]);
    expect(done.assistant.jobIds).toEqual([]);
    expect((state.images as { generate: ReturnType<typeof vi.fn> }).generate).toHaveBeenCalledWith('Un atelier de menuiserie au lever du jour', 'landscape', expect.anything());
    expect((await demoRepositories.media.byIds([media.media[0]!.id]))[0]).toMatchObject({ width: 1024, height: 1024, kind: 'image', mimeType: 'image/jpeg' });
    const saved = (await demoRepositories.agent.thread(done.thread.id))!.messages[1]!;
    expect(saved.mediaIds).toEqual([media.media[0]!.id]);
  });

  it('lance une vidéo : la tâche est annoncée, gardée avec le message, et la route d’interrogation la retrouve', async () => {
    process.env.EVOLINK_API_KEY = 'cle-evolink';
    stream([
      { status: 'completed', usage, output: [use('v1', 'generate_video', { prompt: 'Un rabot sur du chêne', orientation: 'vertical' })] },
      { status: 'completed', usage, output: [say('La vidéo est lancée, elle prend quelques minutes.')] },
    ]);
    const list = await events(await post({ message: 'Une vidéo de l’atelier', channelIds: ['i1'] }));
    expect(list.map((e) => e.type)).toEqual(['tool', 'job', 'text', 'done']);
    const job = (list.find((e) => e.type === 'job') as Extract<AgentEvent, { type: 'job' }>).job;
    expect(job).toMatchObject({ status: 'pending', orientation: 'vertical', prompt: 'Un rabot sur du chêne' });
    const done = list.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.assistant.jobIds).toEqual([job.id]);
    expect((await demoRepositories.generation.jobs([job.id]))[0]).toMatchObject({ providerTaskId: 'task-route' });
    expect((state.videos as { start: ReturnType<typeof vi.fn> }).start).toHaveBeenCalledWith({ prompt: 'Un rabot sur du chêne', orientation: 'vertical', imageUrls: [] }, expect.anything());
  });

  it('un plafond journalier atteint est rapporté au modèle, qui le dit à l’utilisateur', async () => {
    process.env.AGENT_IMAGES_PER_DAY = '1';
    // Le journal des générations de la démo est partagé par tout le fichier : on repart d'un jour vierge.
    (globalThis as unknown as { __postbizDemo: { generations: unknown[] } }).__postbizDemo.generations = [];
    const calls = stream([
      { status: 'completed', usage, output: [use('a', 'generate_image', { prompt: 'Un phare' }), use('b', 'generate_image', { prompt: 'Un autre phare' })] },
      { status: 'completed', usage, output: [say('Une seule image aujourd’hui.')] },
    ]);
    const list = await events(await post({ message: 'Deux images de phares', channelIds: ['i1'] }));
    const done = list.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.assistant.mediaIds).toHaveLength(1);
    expect(JSON.stringify(calls[1]!.input)).toContain('limit of 1 generated pictures per day');
  });
});
