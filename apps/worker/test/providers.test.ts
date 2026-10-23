import { describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError, PublishRejectedError, ReconnectRequiredError } from '../src/providers/errors.ts';
import { createFacebookProvider } from '../src/providers/facebook.ts';
import { DEFAULT_LINKEDIN_API_VERSION, escapeLinkedInText, createLinkedInProvider, linkedInApiVersion } from '../src/providers/linkedin.ts';
import { createRegistry } from '../src/providers/registry.ts';
import { createXProvider } from '../src/providers/x.ts';
import type { CommentInput, PublishInput } from '../src/providers/types.ts';

const input = (o: Partial<PublishInput['integration']> = {}, content = 'Bonjour'): PublishInput => ({
  accessToken: 'TOK',
  integration: { id: 'i', internalId: 'ACCOUNT1', settings: {}, ...o },
  posts: [{ id: 'p1', content, media: [], settings: {} }],
});

const commentInput = (o: Partial<CommentInput['integration']> = {}, text = 'Merci !'): CommentInput => ({
  accessToken: 'TOK', integration: { id: 'i', internalId: 'ACCOUNT1', settings: {}, ...o }, releaseId: 'POST_1', text,
});

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

describe('Facebook', () => {
  it('publie sur le fil de la Page', async () => {
    const f = respond(200, { id: 'PAGE_POST1' });
    const r = await createFacebookProvider(f).publish(input({ internalId: 'PAGE1' }));
    expect(r).toEqual([{ releaseId: 'PAGE_POST1', releaseUrl: 'https://www.facebook.com/PAGE_POST1' }]);
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/PAGE1/feed');
    expect(init.headers.Authorization).toBe('Bearer TOK');
    expect(JSON.parse(init.body)).toEqual({ message: 'Bonjour' });
  });

  it('classe les erreurs : 401 reconnexion, 400 refus, 500 issue inconnue, coupure réseau issue inconnue', async () => {
    await expect(createFacebookProvider(respond(401, {})).publish(input())).rejects.toBeInstanceOf(ReconnectRequiredError);
    await expect(createFacebookProvider(respond(400, { error: { message: 'Contenu dupliqué' } })).publish(input())).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('Contenu dupliqué') });
    await expect(createFacebookProvider(respond(502, '')).publish(input())).rejects.toBeInstanceOf(OutcomeUnknownError);
    const down = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(createFacebookProvider(down).publish(input())).rejects.toBeInstanceOf(OutcomeUnknownError);
  });

  it('un 200 sans identifiant est une issue inconnue, pas un succès', async () => {
    await expect(createFacebookProvider(respond(200, {})).publish(input())).rejects.toBeInstanceOf(OutcomeUnknownError);
  });

  it('une limite de requêtes (429) est un refus, pas une issue inconnue', async () => {
    await expect(createFacebookProvider(respond(429, {})).publish(input())).rejects.toBeInstanceOf(PublishRejectedError);
  });
});

describe('Facebook : premier commentaire', () => {
  it('commente sous la publication', async () => {
    const f = respond(200, { id: 'POST_1_COMMENT9' });
    const r = await createFacebookProvider(f).comment!(commentInput());
    expect(r).toEqual({ commentId: 'POST_1_COMMENT9' });
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/POST_1/comments');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer TOK');
    expect(JSON.parse(init.body)).toEqual({ message: 'Merci !' });
  });

  it('classe les erreurs comme pour une publication, avec les mots d’un commentaire', async () => {
    await expect(createFacebookProvider(respond(401, {})).comment!(commentInput())).rejects.toBeInstanceOf(ReconnectRequiredError);
    await expect(createFacebookProvider(respond(400, { error: { message: 'Permission manquante' } })).comment!(commentInput())).rejects.toMatchObject({
      name: 'PublishRejectedError', message: expect.stringMatching(/refusé le commentaire.*Permission manquante/),
    });
    await expect(createFacebookProvider(respond(503, '')).comment!(commentInput())).rejects.toMatchObject({ name: 'OutcomeUnknownError', message: expect.stringContaining('recommenter') });
    const down = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(createFacebookProvider(down).comment!(commentInput())).rejects.toBeInstanceOf(OutcomeUnknownError);
  });

  it('un 200 sans identifiant est une issue inconnue, pas un succès', async () => {
    await expect(createFacebookProvider(respond(200, {})).comment!(commentInput())).rejects.toBeInstanceOf(OutcomeUnknownError);
  });

  it('les messages d’une publication gardent leurs mots', async () => {
    await expect(createFacebookProvider(respond(400, { error: { message: 'x' } })).publish(input())).rejects.toMatchObject({ message: expect.stringContaining('refusé la publication') });
  });
});

describe('X : premier commentaire', () => {
  it('répond à sa propre publication', async () => {
    const f = respond(201, { data: { id: '1851' } });
    const r = await createXProvider(f).comment!(commentInput({}, 'Suite du fil'));
    expect(r).toEqual({ commentId: '1851' });
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('https://api.x.com/2/tweets');
    expect(JSON.parse(init.body)).toEqual({ text: 'Suite du fil', reply: { in_reply_to_tweet_id: 'POST_1' } });
  });
  it('refus 403 et réponse sans identifiant', async () => {
    await expect(createXProvider(respond(403, { detail: 'Accès insuffisant' })).comment!(commentInput())).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('Accès insuffisant') });
    await expect(createXProvider(respond(201, { data: {} })).comment!(commentInput())).rejects.toBeInstanceOf(OutcomeUnknownError);
  });
});

describe('X', () => {
  it('publie un post', async () => {
    const f = respond(201, { data: { id: '1850', text: 'Bonjour' } });
    const r = await createXProvider(f).publish(input());
    expect(r).toEqual([{ releaseId: '1850', releaseUrl: 'https://x.com/i/web/status/1850' }]);
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('https://api.x.com/2/tweets');
    expect(JSON.parse(init.body)).toEqual({ text: 'Bonjour' });
  });
  it('refus 403 (accès API insuffisant)', async () => {
    await expect(createXProvider(respond(403, { title: 'Forbidden', detail: 'Accès insuffisant' })).publish(input())).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('Accès insuffisant') });
  });
});

describe('LinkedIn', () => {
  it('échappe les caractères spéciaux du texte', () => {
    expect(escapeLinkedInText('Promo (-10%) #été @marque [lien] *gras* _x_ ~y~ {z} <b> | \\')).toBe(
      'Promo \\(-10%\\) \\#été \\@marque \\[lien\\] \\*gras\\* \\_x\\_ \\~y\\~ \\{z\\} \\<b\\> \\| \\\\'
    );
    expect(escapeLinkedInText('Texte simple, avec accents é.')).toBe('Texte simple, avec accents é.');
  });

  it('publie avec les bons en-têtes et l’auteur', async () => {
    const f = respond(201, '', { 'x-restli-id': 'urn:li:share:123' });
    const r = await createLinkedInProvider(f).publish(input({ internalId: 'abc' }, 'Salut (monde)'));
    expect(r).toEqual([{ releaseId: 'urn:li:share:123', releaseUrl: 'https://www.linkedin.com/feed/update/urn:li:share:123' }]);
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('https://api.linkedin.com/rest/posts');
    expect(init.headers['X-Restli-Protocol-Version']).toBe('2.0.0');
    expect(init.headers['LinkedIn-Version']).toMatch(/^\d{6}$/);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ author: 'urn:li:person:abc', commentary: 'Salut \\(monde\\)', visibility: 'PUBLIC', lifecycleState: 'PUBLISHED' });
  });

  it('ignore une version vide ou invalide dans l’environnement (ligne laissée vide dans le .env)', async () => {
    expect(linkedInApiVersion({})).toBe(DEFAULT_LINKEDIN_API_VERSION);
    expect(linkedInApiVersion({ LINKEDIN_API_VERSION: '' })).toBe(DEFAULT_LINKEDIN_API_VERSION);
    expect(linkedInApiVersion({ LINKEDIN_API_VERSION: '   ' })).toBe(DEFAULT_LINKEDIN_API_VERSION);
    expect(linkedInApiVersion({ LINKEDIN_API_VERSION: '2026' })).toBe(DEFAULT_LINKEDIN_API_VERSION);
    expect(linkedInApiVersion({ LINKEDIN_API_VERSION: ' 202604 ' })).toBe('202604');
    const f = respond(201, '', { 'x-restli-id': 'urn:li:share:1' });
    await createLinkedInProvider(f, { LINKEDIN_API_VERSION: '' }).publish(input());
    expect((f as any).mock.calls[0][1].headers['LinkedIn-Version']).toBe(DEFAULT_LINKEDIN_API_VERSION);
    const g = respond(201, '', { 'x-restli-id': 'urn:li:share:1' });
    await createLinkedInProvider(g, { LINKEDIN_API_VERSION: '202604' }).publish(input());
    expect((g as any).mock.calls[0][1].headers['LinkedIn-Version']).toBe('202604');
  });

  it('une Page LinkedIn rafraîchit son jeton avec les clés de sa propre application, pas celles du profil', async () => {
    const env = { LINKEDIN_CLIENT_ID: 'profil-id', LINKEDIN_CLIENT_SECRET: 'profil-secret', LINKEDIN_PAGE_CLIENT_ID: 'page-id', LINKEDIN_PAGE_CLIENT_SECRET: 'page-secret' };
    const f = respond(200, { access_token: 'AT2', expires_in: 5184000 });
    await createLinkedInProvider(f, env, 'linkedin_page').refreshToken!({ refreshToken: 'RT' } as any);
    expect(Object.fromEntries(new URLSearchParams((f as any).mock.calls[0][1].body))).toMatchObject({ client_id: 'page-id', client_secret: 'page-secret' });
    const g = respond(200, { access_token: 'AT2', expires_in: 5184000 });
    await createLinkedInProvider(g, env).refreshToken!({ refreshToken: 'RT' } as any);
    expect(Object.fromEntries(new URLSearchParams((g as any).mock.calls[0][1].body))).toMatchObject({ client_id: 'profil-id' });
  });

  it('utilise l’auteur configuré (Page)', async () => {
    const f = respond(201, '', { 'x-restli-id': 'urn:li:share:1' });
    await createLinkedInProvider(f).publish(input({ settings: { author_urn: 'urn:li:organization:99' } }));
    expect(JSON.parse((f as any).mock.calls[0][1].body).author).toBe('urn:li:organization:99');
  });

  it('un 201 sans identifiant est une issue inconnue', async () => {
    await expect(createLinkedInProvider(respond(201, '')).publish(input())).rejects.toBeInstanceOf(OutcomeUnknownError);
  });
});

describe('LinkedIn : premier commentaire', () => {
  it('commente sous la publication, au nom de l’auteur, avec l’adresse encodée', async () => {
    const f = respond(201, { commentUrn: 'urn:li:comment:(urn:li:share:123,456)' });
    const r = await createLinkedInProvider(f).comment!({ ...commentInput({ internalId: 'abc' }, 'Merci (vraiment) #1'), releaseId: 'urn:li:share:123' });
    expect(r).toEqual({ commentId: 'urn:li:comment:(urn:li:share:123,456)' });
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A123/comments');
    expect(init.headers['X-Restli-Protocol-Version']).toBe('2.0.0');
    expect(JSON.parse(init.body)).toEqual({ actor: 'urn:li:person:abc', object: 'urn:li:share:123', message: { text: 'Merci (vraiment) #1' } });
  });

  it('utilise l’auteur configuré (Page) et accepte l’identifiant en en-tête', async () => {
    const f = respond(201, '', { 'x-restli-id': 'urn:li:comment:1' });
    const r = await createLinkedInProvider(f).comment!(commentInput({ settings: { author_urn: 'urn:li:organization:99' } }));
    expect(r.commentId).toBe('urn:li:comment:1');
    expect(JSON.parse((f as any).mock.calls[0][1].body).actor).toBe('urn:li:organization:99');
  });

  it('un 201 sans identifiant est une issue inconnue', async () => {
    await expect(createLinkedInProvider(respond(201, '')).comment!(commentInput())).rejects.toBeInstanceOf(OutcomeUnknownError);
  });
});

describe('registre', () => {
  it('en mode essai, tout réseau est publié sans appel réseau', async () => {
    const f = vi.fn();
    const p = createRegistry({ dryRun: true, fetch: f as any })('tiktok')!;
    const r = await p.publish(input());
    expect(r[0]!.releaseId).toBe('dry-run-p1');
    expect(f).not.toHaveBeenCalled();
  });
  it('en mode essai, le premier commentaire ne contacte aucun réseau non plus', async () => {
    const f = vi.fn();
    const p = createRegistry({ dryRun: true, fetch: f as any })('facebook')!;
    expect(await p.comment!(commentInput())).toEqual({ commentId: 'dry-run-comment-POST_1' });
    expect(f).not.toHaveBeenCalled();
  });
  it('en mode réel, Facebook, X et LinkedIn savent commenter ; YouTube et TikTok pas encore', () => {
    const reg = createRegistry({ dryRun: false });
    for (const n of ['facebook', 'x', 'linkedin', 'linkedin_page']) expect(reg(n)!.comment).toBeTypeOf('function');
    for (const n of ['youtube', 'tiktok']) expect(reg(n)!.comment).toBeUndefined();
  });
  it('en mode réel, seuls les réseaux implémentés sont disponibles', () => {
    const reg = createRegistry({ dryRun: false });
    expect(reg('facebook')).not.toBeNull();
    expect(reg('x')).not.toBeNull();
    expect(reg('linkedin')).not.toBeNull();
    expect(reg('linkedin_page')).not.toBeNull();
    expect(reg('instagram_standalone')).toBeNull(); // simple point d'entrée de connexion : le canal enregistré est « instagram »
  });
  it('YouTube, TikTok et Instagram : jetons rafraîchissables, publication refusée avec un message clair', async () => {
    const reg = createRegistry({ dryRun: false });
    for (const n of ['tiktok', 'youtube', 'instagram']) {
      expect(reg(n)!.refreshToken).toBeTypeOf('function');
      await expect(reg(n)!.publish(input())).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('pas encore disponible') });
    }
  });

  it('Instagram (Instagram Login) : le jeton est prolongé avec les clés de l’application Instagram, le jeton lui-même servant de « refresh token »', async () => {
    const env = { INSTAGRAM_APP_ID: 'ig-id', INSTAGRAM_APP_SECRET: 'ig-secret' };
    const f = respond(200, { access_token: 'IG-NEW', token_type: 'bearer', expires_in: 5184000 });
    const r = await createRegistry({ dryRun: false, fetch: f, env })('instagram')!.refreshToken!({ refreshToken: 'IG-OLD' } as any);
    expect(r).toMatchObject({ accessToken: 'IG-NEW', refreshToken: 'IG-NEW' });
    const url = new URL((f as any).mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://graph.instagram.com/refresh_access_token');
    expect(url.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(url.searchParams.get('access_token')).toBe('IG-OLD');
  });
});
