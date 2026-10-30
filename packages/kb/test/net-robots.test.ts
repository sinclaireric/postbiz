import { describe, expect, it } from 'vitest';
import { ALLOW_ALL, DISALLOW_ALL, parseRobots } from '../src/net/robots.ts';

const rules = (text: string, agent = 'PostbizBot/1.0 (+https://postbiz.example)') => parseRobots(text, agent);

describe('parseRobots : les exemples de la spécification (RFC 9309, Google)', () => {
  const check = (disallow: string, blocked: string[], allowed: string[]) => {
    const r = rules(`User-agent: *\nDisallow: ${disallow}`);
    for (const p of blocked) expect(r.allows(p), `${p} bloqué par ${disallow}`).toBe(false);
    for (const p of allowed) expect(r.allows(p), `${p} permis malgré ${disallow}`).toBe(true);
  };

  it('/fish et /fish* : préfixe, sensible à la casse', () => {
    const blocked = ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fishheads/yummy.html', '/fish.php?id=anything'];
    const allowed = ['/Fish.asp', '/catfish', '/?id=fish', '/desert/fish'];
    check('/fish', blocked, allowed);
    check('/fish*', blocked, allowed);
  });

  it('/fish/ : le dossier seulement', () => {
    check('/fish/', ['/fish/', '/fish/?id=anything', '/fish/salmon.htm'], ['/fish', '/fish.html', '/Fish/Salmon.asp']);
  });

  it('/*.php : tout ce qui contient .php', () => {
    check('/*.php', ['/index.php', '/filename.php', '/folder/filename.php', '/folder/filename.php?parameters', '/folder/any.php.file.html', '/filename.php/'], ['/', '/windows.PHP']);
  });

  it('/*.php$ : se termine par .php', () => {
    check('/*.php$', ['/filename.php', '/folder/filename.php'], ['/filename.php?parameters', '/filename.php/', '/filename.php5', '/windows.PHP']);
  });

  it('/ interdit tout, « Disallow: » vide ne restreint rien', () => {
    expect(rules('User-agent: *\nDisallow: /').allows('/page')).toBe(false);
    expect(rules('User-agent: *\nDisallow:').allows('/page')).toBe(true);
  });
});

describe('parseRobots : priorités', () => {
  it('le motif le plus long l’emporte, et Allow l’emporte à égalité', () => {
    const r = rules('User-agent: *\nDisallow: /\nAllow: /public\nDisallow: /public/secret');
    expect(r.allows('/accueil')).toBe(false);
    expect(r.allows('/public/page')).toBe(true);
    expect(r.allows('/public/secret/x')).toBe(false);
    const tie = rules('User-agent: *\nDisallow: /dossier\nAllow: /dossier');
    expect(tie.allows('/dossier/x')).toBe(true);
  });

  it('un groupe qui nomme notre robot remplace le groupe *', () => {
    const text = 'User-agent: *\nDisallow: /\n\nUser-agent: PostbizBot\nDisallow: /prive\n\nUser-agent: Googlebot\nDisallow: /google';
    const r = rules(text);
    expect(r.allows('/page')).toBe(true);
    expect(r.allows('/prive/x')).toBe(false);
    expect(r.allows('/google')).toBe(true);
    expect(rules(text, 'AutreBot/2').allows('/page')).toBe(false);
  });

  it('plusieurs User-agent de suite partagent leurs règles ; un User-agent après des règles ouvre un autre groupe', () => {
    const text = 'User-agent: Autre\nUser-agent: postbizbot\nDisallow: /a\nUser-agent: Troisieme\nDisallow: /b';
    const r = rules(text);
    expect(r.allows('/a')).toBe(false);
    expect(r.allows('/b')).toBe(true);
  });

  it('ignore les commentaires, la casse des champs, les lignes invalides et les fins de ligne Windows', () => {
    const r = rules('# robots\r\nUSER-AGENT: *   # tous\r\ndisallow: /admin # privé\r\nbidule sans deux-points\r\nAllow : /admin/aide\r\n');
    expect(r.allows('/admin/x')).toBe(false);
    expect(r.allows('/admin/aide')).toBe(true);
    expect(r.allows('/accueil')).toBe(true);
  });

  it('sans règle pour nous : tout est permis', () => {
    expect(rules('User-agent: Googlebot\nDisallow: /').allows('/x')).toBe(true);
    expect(rules('').allows('/x')).toBe(true);
  });

  it('un chemin sans barre initiale est ramené à la racine', () => {
    expect(rules('User-agent: *\nDisallow: /a').allows('a/b')).toBe(false);
  });
});

describe('parseRobots : délai et plans de site', () => {
  it('lit Crawl-delay du groupe retenu, et les Sitemap (hors groupes)', () => {
    const r = rules('Sitemap: https://exemple.fr/sitemap.xml\nUser-agent: *\nCrawl-delay: 2\nUser-agent: PostbizBot\nCrawl-delay: 7.5\nSitemap: https://exemple.fr/autre.xml');
    expect(r.crawlDelay).toBe(7.5);
    expect(r.sitemaps).toEqual(['https://exemple.fr/sitemap.xml', 'https://exemple.fr/autre.xml']);
    expect(rules('User-agent: *\nCrawl-delay: 3').crawlDelay).toBe(3);
    expect(rules('User-agent: *\nCrawl-delay: abc').crawlDelay).toBeNull();
    expect(rules('User-agent: *\nDisallow: /x').crawlDelay).toBeNull();
  });

  it('constantes ALLOW_ALL et DISALLOW_ALL', () => {
    expect(ALLOW_ALL.allows('/x')).toBe(true);
    expect(DISALLOW_ALL.allows('/')).toBe(false);
  });
});
