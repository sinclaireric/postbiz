import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchError, safeFetch, STRICT_POLICY, type FetchOptions, type FetchPolicy } from '../src/net/fetch.ts';
import { isPublicIp } from '../src/net/ip.ts';
import { parsePublicUrl } from '../src/net/url.ts';

// Un vrai serveur HTTP local (le contrôle d'adresse est levé pour lui seul, par `LOCAL`) et un DNS simulé pour les cas de rebinding.

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let base = '';
let handler: Handler = (_req, res) => res.end('vide');
const seen: http.IncomingHttpHeaders[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.headers);
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

const LOCAL: FetchPolicy = {
  parseUrl: (input, relativeTo) => {
    try {
      const url = new URL(input, relativeTo);
      return url.protocol === 'http:' || url.protocol === 'https:' ? { ok: true, url } : { ok: false, reason: 'scheme' };
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  },
  isAllowedIp: () => true,
};
const opts = (o: Partial<FetchOptions> = {}): FetchOptions => ({ userAgent: 'PostbizBot/1.0 (test)', maxBytes: 1_000_000, timeoutMs: 3_000, policy: LOCAL, ...o });
const serve = (h: Handler) => { handler = h; seen.length = 0; };
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'aucune erreur';
  } catch (e) {
    return e instanceof FetchError ? e.code : `autre : ${(e as Error).message}`;
  }
};

describe('safeFetch : lecture et en-têtes', () => {
  it('rend le corps, le code, le type et le jeu de caractères', async () => {
    serve((_req, res) => { res.setHeader('content-type', 'text/html; charset=ISO-8859-1'); res.end('<p>Bonjour</p>'); });
    const r = await safeFetch(`${base}/page?a=1`, opts());
    expect(r).toMatchObject({ status: 200, contentType: 'text/html', charset: 'iso-8859-1', truncated: false, redirects: 0 });
    expect(r.body.toString()).toBe('<p>Bonjour</p>');
    expect(r.url.href).toBe(`${base}/page?a=1`);
  });

  it('s’identifie, annonce les codages acceptés, n’envoie ni cookie ni autorisation, et ferme la connexion', async () => {
    serve((_req, res) => { res.setHeader('set-cookie', 'session=abc'); res.end('ok'); });
    await safeFetch(`${base}/`, opts({ acceptLanguage: 'de' }));
    const h = seen[0]!;
    expect(h['user-agent']).toBe('PostbizBot/1.0 (test)');
    expect(h['accept-encoding']).toBe('gzip, deflate, br');
    expect(h['accept-language']).toBe('de');
    expect(h.cookie).toBeUndefined();
    expect(h.authorization).toBeUndefined();
    expect(h.connection).toBe('close');
  });

  it('rend aussi les réponses d’erreur, sans lire leur corps', async () => {
    serve((_req, res) => { res.statusCode = 404; res.end('introuvable'); });
    const r = await safeFetch(`${base}/x`, opts());
    expect(r.status).toBe(404);
    expect(r.body.length).toBe(0);
  });

  it('un type de contenu non admis est refusé avant d’en lire le corps', async () => {
    serve((_req, res) => { res.setHeader('content-type', 'image/png'); res.end(Buffer.alloc(1_000)); });
    expect(await code(safeFetch(`${base}/a.png`, opts({ contentTypes: /^(text\/html|application\/xhtml\+xml)$/ })))).toBe('not_html');
    serve((_req, res) => { res.setHeader('content-type', 'application/xhtml+xml'); res.end('<x/>'); });
    expect((await safeFetch(`${base}/`, opts({ contentTypes: /^(text\/html|application\/xhtml\+xml)$/ }))).body.toString()).toBe('<x/>');
  });
});

describe('safeFetch : redirections', () => {
  it('les suit, y compris vers une adresse relative, et dit combien il y en a eu', async () => {
    serve((req, res) => {
      if (req.url === '/a') { res.statusCode = 301; res.setHeader('location', '/b'); return res.end(); }
      if (req.url === '/b') { res.statusCode = 302; res.setHeader('location', `${base}/c?x=1#frag`); return res.end(); }
      res.end('arrivé');
    });
    const r = await safeFetch(`${base}/a`, opts());
    expect(r.body.toString()).toBe('arrivé');
    expect(r.redirects).toBe(2);
    expect(r.url.pathname + r.url.search).toBe('/c?x=1');
  });

  it('ne renvoie aucun cookie d’une étape à l’autre', async () => {
    serve((req, res) => {
      if (req.url === '/a') { res.statusCode = 302; res.setHeader('set-cookie', 'a=1'); res.setHeader('location', '/b'); return res.end(); }
      res.end('ok');
    });
    await safeFetch(`${base}/a`, opts());
    expect(seen).toHaveLength(2);
    expect(seen[1]!.cookie).toBeUndefined();
  });

  it('refuse une boucle, et plus de cinq redirections', async () => {
    serve((req, res) => { res.statusCode = 302; res.setHeader('location', req.url === '/a' ? '/b' : '/a'); res.end(); });
    expect(await code(safeFetch(`${base}/a`, opts()))).toBe('redirect_loop');
    serve((req, res) => { res.statusCode = 302; res.setHeader('location', `/p${Number(req.url!.slice(2)) + 1}`); res.end(); });
    expect(await code(safeFetch(`${base}/p0`, opts()))).toBe('redirect_loop');
    // 5 redirections passent, la sixième non.
    serve((req, res) => {
      const n = Number(req.url!.slice(2));
      if (n >= 5) return res.end('fin');
      res.statusCode = 302;
      res.setHeader('location', `/p${n + 1}`);
      res.end();
    });
    expect((await safeFetch(`${base}/p0`, opts())).redirects).toBe(5);
  });

  it('chaque redirection est revalidée : vers le réseau local, les métadonnées d’un cloud ou un schéma étranger', async () => {
    // Départ permis, mais les adresses suivantes passent par la validation stricte.
    const policy: FetchPolicy = { ...LOCAL, parseUrl: (input, relativeTo) => (relativeTo ? parsePublicUrl(input, { base: relativeTo }) : LOCAL.parseUrl(input)) };
    for (const target of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/admin', 'http://localhost/', 'http://[::1]/', 'http://2130706433/', 'http://metadata.google.internal/']) {
      serve((_req, res) => { res.statusCode = 302; res.setHeader('location', target); res.end(); });
      expect(await code(safeFetch(`${base}/`, opts({ policy }))), target).toBe('blocked_address');
    }
    // Un port autre que 80 et 443 est refusé lui aussi, même sur une adresse locale.
    serve((_req, res) => { res.statusCode = 302; res.setHeader('location', 'http://127.0.0.1:8080/admin'); res.end(); });
    expect(await code(safeFetch(`${base}/`, opts({ policy })))).toBe('invalid_url');
    for (const target of ['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/', 'http://user:pw@example.com/']) {
      serve((_req, res) => { res.statusCode = 302; res.setHeader('location', target); res.end(); });
      expect(await code(safeFetch(`${base}/`, opts({ policy })))).toBe('invalid_url');
    }
  });
});

describe('safeFetch : adresses refusées (politique stricte)', () => {
  const strict = (addresses: { address: string; family: number }[] | Error): FetchPolicy => ({
    parseUrl: STRICT_POLICY.parseUrl,
    isAllowedIp: isPublicIp,
    lookup: async () => { if (addresses instanceof Error) throw addresses; return addresses; },
  });
  const fetchWith = (addresses: { address: string; family: number }[] | Error) => safeFetch('https://site.example.com/', opts({ policy: strict(addresses) }));

  it('refuse un nom qui désigne une adresse non publique', async () => {
    for (const address of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '168.63.129.16']) {
      expect(await code(fetchWith([{ address, family: 4 }])), address).toBe('blocked_address');
    }
    for (const address of ['::1', 'fe80::1', 'fd00:ec2::254', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::1']) {
      expect(await code(fetchWith([{ address, family: 6 }])), address).toBe('blocked_address');
    }
  });

  it('une seule adresse privée parmi les réponses suffit à refuser (rebinding à réponses multiples)', async () => {
    expect(await code(fetchWith([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]))).toBe('blocked_address');
    expect(await code(fetchWith([{ address: '10.0.0.1', family: 4 }, { address: '93.184.216.34', family: 4 }]))).toBe('blocked_address');
  });

  it('un nom introuvable donne dns_failed', async () => {
    expect(await code(fetchWith([]))).toBe('dns_failed');
    expect(await code(fetchWith(Object.assign(new Error('x'), { code: 'ENOTFOUND' })))).toBe('dns_failed');
  });

  it('le DNS du système est contrôlé lui aussi, à la connexion : « localhost » mène à une adresse refusée et rien n’atteint le serveur', async () => {
    serve((_req, res) => res.end('ne doit jamais être lu'));
    const policy: FetchPolicy = { parseUrl: LOCAL.parseUrl, isAllowedIp: isPublicIp }; // pas de `lookup` : le vrai `dns.lookup`
    const url = new URL(base);
    url.hostname = 'localhost';
    expect(await code(safeFetch(url, opts({ policy })))).toBe('blocked_address');
    expect(seen).toHaveLength(0);
  });

  it('refuse les adresses que la validation d’adresse écarte, sans résoudre le moindre nom', async () => {
    let resolved = false;
    const policy: FetchPolicy = { ...STRICT_POLICY, lookup: async () => { resolved = true; return [{ address: '93.184.216.34', family: 4 }]; } };
    for (const url of ['http://127.0.0.1/', 'http://localhost/', 'https://example.com:8443/', 'ftp://example.com/', 'https://user:pw@example.com/', 'http://[::1]/', 'http://2130706433/', 'not a url']) {
      expect(await code(safeFetch(url, opts({ policy }))), url).toMatch(/^(blocked_address|invalid_url)$/);
    }
    expect(resolved).toBe(false);
  });
});

describe('safeFetch : taille, décompression et durée', () => {
  it('coupe un corps trop grand (truncate) ou refuse (error)', async () => {
    serve((_req, res) => res.end(Buffer.alloc(10_000, 97)));
    const cut = await safeFetch(`${base}/`, opts({ maxBytes: 1_000 }));
    expect(cut.truncated).toBe(true);
    expect(cut.body.length).toBe(1_000);
    expect(await code(safeFetch(`${base}/`, opts({ maxBytes: 1_000, onOverflow: 'error' })))).toBe('too_large');
    const fits = await safeFetch(`${base}/`, opts({ maxBytes: 10_000, onOverflow: 'error' }));
    expect(fits.truncated).toBe(false);
    expect(fits.body.length).toBe(10_000);
  });

  it('décompresse gzip, deflate et brotli', async () => {
    const text = 'Livraison offerte dès 60 euros. '.repeat(50);
    for (const [name, pack] of [['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]] as const) {
      serve((_req, res) => { res.setHeader('content-encoding', name); res.end(pack(Buffer.from(text))); });
      expect((await safeFetch(`${base}/`, opts())).body.toString(), name).toBe(text);
    }
  });

  it('ne se laisse pas écraser par une bombe de décompression', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(40_000_000)); // quelques dizaines de Ko compressés, 40 Mo décompressés
    expect(bomb.length).toBeLessThan(200_000);
    serve((_req, res) => { res.setHeader('content-encoding', 'gzip'); res.end(bomb); });
    const t0 = Date.now();
    const r = await safeFetch(`${base}/`, opts({ maxBytes: 100_000 }));
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBe(100_000);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(await code(safeFetch(`${base}/`, opts({ maxBytes: 100_000, onOverflow: 'error' })))).toBe('too_large');
    const br = zlib.brotliCompressSync(Buffer.alloc(50_000_000));
    serve((_req, res) => { res.setHeader('content-encoding', 'br'); res.end(br); });
    expect((await safeFetch(`${base}/`, opts({ maxBytes: 100_000 }))).body.length).toBe(100_000);
  }, 30_000);

  it('garde ce qui a été décodé quand le flux compressé est coupé net', async () => {
    const whole = zlib.gzipSync(Buffer.from('abcdefghij'.repeat(5_000)));
    serve((_req, res) => { res.setHeader('content-encoding', 'gzip'); res.write(whole.subarray(0, Math.floor(whole.length / 2))); res.end(); });
    const r = await safeFetch(`${base}/`, opts());
    expect(r.body.length).toBeGreaterThan(0);
  });

  it('refuse un codage inconnu', async () => {
    serve((_req, res) => { res.setHeader('content-encoding', 'zstd'); res.end('x'); });
    expect(await code(safeFetch(`${base}/`, opts()))).toBe('unreachable');
  });

  it('abandonne un serveur qui ne répond pas, ou qui n’envoie jamais la fin du corps', async () => {
    serve(() => { /* aucune réponse */ });
    expect(await code(safeFetch(`${base}/`, opts({ timeoutMs: 200 })))).toBe('timeout');
    serve((_req, res) => { res.write('début'); /* jamais de fin */ });
    const t0 = Date.now();
    expect(await code(safeFetch(`${base}/`, opts({ timeoutMs: 300 })))).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(1_500);
  });

  it('s’arrête quand on l’y invite', async () => {
    serve(() => { /* aucune réponse */ });
    const controller = new AbortController();
    const pending = code(safeFetch(`${base}/`, opts({ signal: controller.signal, timeoutMs: 5_000 })));
    setTimeout(() => controller.abort(), 50);
    expect(await pending).toBe('aborted');
    expect(await code(safeFetch(`${base}/`, opts({ signal: AbortSignal.abort() })))).toBe('aborted');
  });

  it('un port fermé donne unreachable', async () => {
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    expect(await code(safeFetch(`http://127.0.0.1:${port}/`, opts()))).toBe('unreachable');
  });
});
