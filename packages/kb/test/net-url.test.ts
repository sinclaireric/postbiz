import { describe, expect, it } from 'vitest';
import { isCrawlablePage, isPublicHostname, pageKey, parsePublicUrl, sameSite, siteHost } from '../src/net/url.ts';

const reason = (input: string, o?: Parameters<typeof parsePublicUrl>[1]) => {
  const r = parsePublicUrl(input, o);
  return r.ok ? 'ok' : r.reason;
};

describe('parsePublicUrl : une adresse web qu’on accepte de lire', () => {
  it('accepte les adresses ordinaires, sans ancre, avec le port du web', () => {
    for (const ok of ['https://example.com', 'http://example.com/a?b=1', 'https://www.example.co.uk/path/', 'https://sub.example.com:443/x', 'http://example.com:80', 'https://a-b.example.com/', 'https://example.com./']) {
      expect(reason(ok), ok).toBe('ok');
    }
    const r = parsePublicUrl('http://example.com/a?b=1#haut');
    expect(r.ok && r.url.href).toBe('http://example.com/a?b=1');
  });

  it('complète par https:// quand on le demande, et résout une adresse relative', () => {
    const r = parsePublicUrl('example.com/page', { assumeHttps: true });
    expect(r.ok && r.url.href).toBe('https://example.com/page');
    expect(reason('example.com/page')).toBe('invalid'); // sans schéma ni demande de complétion : pas une adresse
    const rel = parsePublicUrl('/contact', { base: 'https://example.com/a/b' });
    expect(rel.ok && rel.url.href).toBe('https://example.com/contact');
    const proto = parsePublicUrl('//cdn.example.com/x', { base: 'https://example.com/' });
    expect(proto.ok && proto.url.href).toBe('https://cdn.example.com/x');
  });

  it('retire le point final du nom de domaine et convertit les noms accentués', () => {
    const dot = parsePublicUrl('https://example.com./x');
    expect(dot.ok && dot.url.hostname).toBe('example.com');
    const idn = parsePublicUrl('https://bücher.example.org/');
    expect(idn.ok && idn.url.hostname).toBe('xn--bcher-kva.example.org');
  });

  it.each(['', '   ', 'http://', 'https://exa mple.com', 'https://example.com/a b', 'https://exa\u0000mple.com', 'https://example.com/\nx', 'http://:80', 'https://[example.com', 'http://1.2.3.4.5/', 'http://example.123/', 'http://256.1.1.1/'])(
    'refuse %j comme invalide', (input) => expect(reason(input)).toBe('invalid'),
  );

  it.each(['javascript:alert(1)', 'ftp://example.com/', 'file:///etc/passwd', 'gopher://example.com/', 'data:text/html,<p>x</p>', 'ws://example.com', 'mailto:a@example.com', 'view-source:https://example.com'])(
    'refuse le schéma de %j', (input) => expect(reason(input)).toBe('scheme'),
  );

  it.each(['https://user:pw@example.com/', 'https://user@example.com/', 'https://:pw@example.com/'])('refuse les identifiants de %j', (input) => expect(reason(input)).toBe('credentials'));

  it.each(['https://example.com:8080/', 'http://example.com:22/', 'https://example.com:25', 'http://example.com:3306', 'http://example.com:0/', 'https://example.com:65535/'])(
    'refuse le port de %j', (input) => expect(reason(input)).toBe('port'),
  );

  it.each([
    'http://127.0.0.1/', 'http://127.0.0.1:80/', 'http://0.0.0.0/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/', 'http://8.8.8.8/', // IPv4
    'http://2130706433/', 'http://0x7f000001/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://017700000001/', 'http://0xa9fea9fe/', // formes déguisées
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[fd00:ec2::254]/', 'http://[2606:4700:4700::1111]/', // IPv6
  ])('refuse l’adresse IP de %j, quelle que soit son écriture', (input) => expect(reason(input)).toBe('address'));

  it.each([
    'http://localhost/', 'http://localhost:80/', 'http://foo.localhost/', 'http://intranet/', 'http://server/', 'http://server.local/', 'http://metadata.google.internal/',
    'http://db.internal/', 'http://a.corp/', 'http://printer.lan/', 'http://x.example/', 'http://x.test/', 'http://x.invalid/', 'http://abcdefg.onion/',
    'http://4.3.2.1.in-addr.arpa/', 'http://router.home.arpa/', 'http://a.b.localdomain/',
  ])('refuse le nom %j', (input) => expect(reason(input)).toBe('host'));

  it('une adresse relative ne peut pas servir à sortir du web', () => {
    expect(reason('javascript:alert(1)', { base: 'https://example.com/' })).toBe('scheme');
    expect(reason('http://127.0.0.1/', { base: 'https://example.com/' })).toBe('address');
    expect(reason('//localhost/x', { base: 'https://example.com/' })).toBe('host');
    expect(reason('https://example.com@127.0.0.1/', { base: 'https://example.com/' })).toBe('credentials');
  });

  it('une adresse trop longue est refusée', () => {
    expect(reason(`https://example.com/${'a'.repeat(2_100)}`)).toBe('invalid');
  });
});

describe('isPublicHostname', () => {
  it('reconnaît les noms de domaine publics', () => {
    for (const h of ['example.com', 'www.example.co.uk', 'a-b.c-d.fr', 'xn--bcher-kva.example.org', 'my_site.example.com', 'EXAMPLE.COM', 'example.com.']) expect(isPublicHostname(h), h).toBe(true);
    for (const h of ['', 'a.b', 'localhost', 'example', '-a.example.com', 'a-.example.com', 'a..b.com', 'exa mple.com', 'example.com/x', 'example.c0m1.99', 'x.local']) expect(isPublicHostname(h), h).toBe(false);
  });
});

describe('pageKey : reconnaître deux adresses de la même page', () => {
  const key = (s: string) => pageKey(new URL(s));

  it('ignore l’ancre, le suivi publicitaire, la casse du domaine et le « / » final', () => {
    expect(key('https://Example.COM/a/?utm_source=x&utm_medium=y#top')).toBe('https://example.com/a');
    expect(key('https://example.com/a?fbclid=1&gclid=2&b=2&a=1')).toBe('https://example.com/a?a=1&b=2');
    expect(key('https://example.com')).toBe('https://example.com/');
    expect(key('https://example.com/')).toBe('https://example.com/');
    expect(key('https://example.com//a//b/')).toBe('https://example.com/a/b');
  });

  it('ramène « index.html » à son dossier et garde les paramètres qui comptent', () => {
    expect(key('https://example.com/index.html')).toBe('https://example.com/');
    expect(key('https://example.com/blog/index.php')).toBe('https://example.com/blog');
    expect(key('https://example.com/produit?id=12')).toBe('https://example.com/produit?id=12');
    expect(key('https://example.com/a')).not.toBe(key('https://example.com/b'));
    expect(key('http://example.com/a')).not.toBe(key('https://example.com/a'));
  });

  it('siteHost et sameSite : www n’est pas un autre site', () => {
    expect(siteHost('WWW.Example.com')).toBe('example.com');
    expect(sameSite(new URL('https://www.example.com/a'), new URL('http://example.com/b'))).toBe(true);
    expect(sameSite(new URL('https://blog.example.com/'), new URL('https://example.com/'))).toBe(false);
    expect(sameSite(new URL('https://example.com.evil.net/'), new URL('https://example.com/'))).toBe(false);
  });
});

describe('isCrawlablePage : quelles pages lire', () => {
  const ok = (s: string) => isCrawlablePage(new URL(s));

  it('lit les pages ordinaires', () => {
    for (const u of ['https://example.com/', 'https://example.com/a-propos', 'https://example.com/livraison.html', 'https://example.com/produit?id=12', 'https://example.com/fr/contact/', 'https://example.com/blog/mon-article', 'https://example.com/page.php']) {
      expect(ok(u), u).toBe(true);
    }
  });

  it('ignore les fichiers, l’administration, les comptes, les flux, les listes et les recherches', () => {
    for (const u of [
      'https://example.com/photo.jpg', 'https://example.com/catalogue.pdf', 'https://example.com/a.zip', 'https://example.com/style.css', 'https://example.com/app.js', 'https://example.com/data.json', 'https://example.com/sitemap.xml',
      'https://example.com/wp-admin/', 'https://example.com/wp-login.php', 'https://example.com/wp-json/wp/v2/posts', 'https://example.com/wp-content/uploads/x', 'https://example.com/feed', 'https://example.com/blog/feed/',
      'https://example.com/cart', 'https://example.com/panier', 'https://example.com/checkout', 'https://example.com/login', 'https://example.com/mon-compte/commandes', 'https://example.com/account',
      'https://example.com/tag/chene', 'https://example.com/author/sam', 'https://example.com/blog/page/2/', 'https://example.com/?s=chaise', 'https://example.com/recherche?q=table', 'https://example.com/boutique?orderby=price',
      'https://example.com/produit?add-to-cart=12', 'https://example.com/a?replytocom=5',
    ]) {
      expect(ok(u), u).toBe(false);
    }
  });

  it('ignore une adresse démesurée', () => {
    expect(ok(`https://example.com/${'a'.repeat(1_100)}`)).toBe(false);
  });
});
