import { describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError, PublishRejectedError, ReconnectRequiredError } from '../src/providers/errors.ts';
import { createFacebookProvider } from '../src/providers/facebook.ts';
import { escapeLinkedInText, createLinkedInProvider } from '../src/providers/linkedin.ts';
import { createRegistry } from '../src/providers/registry.ts';
import { createXProvider } from '../src/providers/x.ts';
import type { PublishInput } from '../src/providers/types.ts';

const input = (o: Partial<PublishInput['integration']> = {}, content = 'Bonjour'): PublishInput => ({
  accessToken: 'TOK',
  integration: { id: 'i', internalId: 'ACCOUNT1', settings: {}, ...o },
  posts: [{ id: 'p1', content, media: [], settings: {} }],
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

  it('utilise l’auteur configuré (Page)', async () => {
    const f = respond(201, '', { 'x-restli-id': 'urn:li:share:1' });
    await createLinkedInProvider(f).publish(input({ settings: { author_urn: 'urn:li:organization:99' } }));
    expect(JSON.parse((f as any).mock.calls[0][1].body).author).toBe('urn:li:organization:99');
  });

  it('un 201 sans identifiant est une issue inconnue', async () => {
    await expect(createLinkedInProvider(respond(201, '')).publish(input())).rejects.toBeInstanceOf(OutcomeUnknownError);
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
  it('en mode réel, seuls les réseaux implémentés sont disponibles', () => {
    const reg = createRegistry({ dryRun: false });
    expect(reg('facebook')).not.toBeNull();
    expect(reg('x')).not.toBeNull();
    expect(reg('linkedin')).not.toBeNull();
    expect(reg('instagram')).toBeNull();
  });
  it('YouTube et TikTok : jetons rafraîchissables, publication refusée avec un message clair', async () => {
    const reg = createRegistry({ dryRun: false });
    for (const n of ['tiktok', 'youtube']) {
      expect(reg(n)!.refreshToken).toBeTypeOf('function');
      await expect(reg(n)!.publish(input())).rejects.toMatchObject({ name: 'PublishRejectedError', message: expect.stringContaining('pas encore disponible') });
    }
  });
});
