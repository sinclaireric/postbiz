import { describe, expect, it } from 'vitest';
import { ALIAS_DOMAINS, aliasRedirects, configuredAliases, normalizeHost } from './alias-domains';

const hostsOf = (siteUrl: string | undefined, aliases?: readonly string[]) => aliasRedirects(siteUrl, aliases).map((r) => r.has[0]!.value);

describe('normalizeHost', () => {
  it('nettoie la casse, le schéma, le chemin et le point final', () => {
    expect(normalizeHost('  HTTPS://WWW.GetPostbiz.com/prix?x=1 ')).toBe('www.getpostbiz.com');
    expect(normalizeHost('post-iz.com.')).toBe('post-iz.com');
  });
  it('refuse ce qui n’est pas un nom de domaine', () => {
    for (const bad of ['', 'localhost', 'a b.com', '-x.com', 'x-.com', 'x..com', 'exemple', '192.168.0.1', 'exemple.c']) expect(normalizeHost(bad), bad).toBeNull();
  });
});

describe('configuredAliases', () => {
  it('utilise la liste par défaut si la variable est absente', () => {
    expect(configuredAliases(undefined)).toEqual([...ALIAS_DOMAINS]);
  });
  it('la remplace si elle est définie, déduplique et ignore les valeurs invalides', () => {
    expect(configuredAliases('Exemple.com, exemple.com, pas un domaine, autre.fr')).toEqual(['exemple.com', 'autre.fr']);
  });
  it('une variable vide désactive toutes les redirections', () => {
    expect(configuredAliases('')).toEqual([]);
  });
});

describe('aliasRedirects', () => {
  it('ne redirige rien sans domaine principal ou avec une adresse locale', () => {
    expect(aliasRedirects(undefined)).toEqual([]);
    expect(aliasRedirects('')).toEqual([]);
    expect(aliasRedirects('pas une url')).toEqual([]);
    for (const local of ['http://localhost:3100', 'http://127.0.0.1:3100', 'http://app.localhost', 'http://[::1]:3100']) expect(aliasRedirects(local), local).toEqual([]);
  });

  it('redirige chaque domaine secondaire et son www vers le domaine principal, en permanent, chemin conservé', () => {
    const redirects = aliasRedirects('https://postbiz.app', ['getpostbiz.com', 'post-iz.com']);
    expect(hostsOf('https://postbiz.app', ['getpostbiz.com', 'post-iz.com'])).toEqual(['getpostbiz.com', 'post-iz.com', 'www.getpostbiz.com', 'www.post-iz.com']);
    for (const r of redirects) {
      expect(r.source).toBe('/:path*');
      expect(r.destination).toBe('https://postbiz.app/:path*');
      expect(r.permanent).toBe(true);
    }
  });

  it('couvre les quatre domaines demandés par défaut', () => {
    expect(hostsOf('https://postbiz.app')).toEqual([
      'getpostbiz.com', 'post-iz.com', 'postizz.com', 'trypostiz.com',
      'www.getpostbiz.com', 'www.post-iz.com', 'www.postizz.com', 'www.trypostiz.com',
    ]);
  });

  it('ne se redirige jamais vers lui-même (domaine principal listé comme secondaire)', () => {
    expect(hostsOf('https://getpostbiz.com', ['getpostbiz.com', 'post-iz.com'])).toEqual(['post-iz.com', 'www.getpostbiz.com', 'www.post-iz.com']);
    expect(hostsOf('https://www.getpostbiz.com', ['getpostbiz.com'])).toEqual(['getpostbiz.com']);
  });

  it('garde le port et le schéma du domaine principal, sans chemin ni barre finale', () => {
    expect(aliasRedirects('https://postbiz.app/', ['x-y.com'])[0]!.destination).toBe('https://postbiz.app/:path*');
    expect(aliasRedirects('https://staging.postbiz.app:8443/accueil', ['x-y.com'])[0]!.destination).toBe('https://staging.postbiz.app:8443/:path*');
  });

  it('ignore les noms invalides de la liste', () => {
    expect(hostsOf('https://postbiz.app', ['n’importe quoi', 'bon.com'])).toEqual(['bon.com', 'www.bon.com']);
  });
});
