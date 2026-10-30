import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_LIMITS } from '@/lib/data/types';
import { normalizeWebsite, validateDocument } from './knowledge-sources';

const ORG = '5b1f2c3a-0000-4000-8000-0000000000a1';
const UUID = '3f2b0b9a-0000-4000-8000-000000000000';
const invalidUrl = { ok: false, error: { key: 'app.knowledgePage.errors.invalidUrl' } };

describe('normalizeWebsite : le formulaire « Ajouter un site »', () => {
  it('ajoute https:// à une adresse nue, met le nom de domaine en minuscules et en fait le titre (sans « www. »)', () => {
    expect(normalizeWebsite('www.Maison-Lune.fr/a-propos', 'page', 'on')).toEqual({
      ok: true,
      value: { url: 'https://www.maison-lune.fr/a-propos', title: 'maison-lune.fr', scope: 'page', autoSync: true },
    });
    expect(normalizeWebsite('  http://exemple.fr  ', undefined, undefined)).toMatchObject({ ok: true, value: { url: 'http://exemple.fr/', title: 'exemple.fr' } });
  });

  it('lit tout le site par défaut ; seule la valeur « page » limite à une page', () => {
    expect(normalizeWebsite('exemple.fr', undefined, 'on')).toMatchObject({ value: { scope: 'site' } });
    expect(normalizeWebsite('exemple.fr', 'site', 'on')).toMatchObject({ value: { scope: 'site' } });
    expect(normalizeWebsite('exemple.fr', 'tout', 'on')).toMatchObject({ value: { scope: 'site' } });
    expect(normalizeWebsite('exemple.fr', 'page', 'on')).toMatchObject({ value: { scope: 'page' } });
  });

  it('la relecture hebdomadaire n’est demandée que par une case cochée (« on », « 1 ») ou un booléen vrai', () => {
    const sync = (v: unknown) => (normalizeWebsite('exemple.fr', 'site', v) as { value: { autoSync: boolean } }).value.autoSync;
    expect([sync('on'), sync('1'), sync(true)]).toEqual([true, true, true]);
    expect([sync(null), sync(undefined), sync(''), sync('0'), sync('off'), sync(false)]).toEqual([false, false, false, false, false, false]);
  });

  it.each([
    ['vide', ''],
    ['des blancs', '   '],
    ['rien', undefined],
    ['un autre protocole', 'ftp://exemple.fr'],
    ['un schéma de script', 'javascript:alert(1)'],
    ['un fichier local', 'file:///etc/passwd'],
    ['localhost', 'http://localhost:3000'],
    ['une adresse IP privée', 'http://192.168.1.10/'],
    ['une adresse IP publique (seuls les noms de domaine sont lus)', 'http://93.184.216.34/'],
    ['une adresse IP écrite en entier', 'http://2130706433/'],
    ['une adresse IPv6', 'http://[::1]/'],
    ['un identifiant dans l’adresse', 'https://utilisateur:secret@exemple.fr/'],
    ['un port inhabituel', 'https://exemple.fr:8443/'],
    ['un nom interne', 'http://intranet.local/'],
    ['un nom sans point', 'http://serveur/'],
    ['un texte qui n’est pas une adresse', 'ceci n’est pas un site'],
  ])('refuse %s', (_label, input) => {
    expect(normalizeWebsite(input, 'site', 'on')).toEqual(invalidUrl);
  });

  it('un titre trop long est coupé à 120 signes', () => {
    const host = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.fr`;
    const res = normalizeWebsite(host, 'site', 'on');
    expect(res.ok && res.value.title.length).toBe(120);
  });
});

describe('validateDocument : un fichier déjà déposé dans le stockage', () => {
  const path = `${ORG}/${UUID}-catalogue-2026.pdf`;

  it('accepte un fichier du dossier de l’organisation, de type pris en charge, et nettoie le titre', () => {
    expect(validateDocument({ path, title: '  Catalogue   2026 ', size: 2048 }, ORG)).toEqual({ ok: true, value: { path, title: 'Catalogue 2026', size: 2048 } });
  });

  it('prend le nom du fichier (sans son identifiant ni son extension) quand le titre est vide ou absent', () => {
    expect(validateDocument({ path, title: '   ', size: 10 }, ORG)).toMatchObject({ ok: true, value: { title: 'catalogue-2026' } });
    expect(validateDocument({ path: `${ORG}/${UUID}-prix_2026.csv`, title: undefined, size: 10 }, ORG)).toMatchObject({ ok: true, value: { title: 'prix 2026' } });
  });

  it('coupe le titre à 120 signes', () => {
    const res = validateDocument({ path, title: 'x'.repeat(300), size: 10 }, ORG);
    expect(res.ok && res.value.title).toHaveLength(KNOWLEDGE_LIMITS.title);
  });

  it.each(['pdf', 'docx', 'txt', 'md', 'markdown', 'csv', 'html', 'htm', 'PDF', 'Docx'])('accepte l’extension .%s', (ext) => {
    expect(validateDocument({ path: `${ORG}/${UUID}-doc.${ext}`, title: 'Doc', size: 10 }, ORG).ok).toBe(true);
  });

  it.each([
    ['un fichier d’une autre organisation', `autre-org/${UUID}-doc.pdf`],
    ['un fichier hors de tout dossier', `${UUID}-doc.pdf`],
    ['un sous-dossier', `${ORG}/sous/${UUID}-doc.pdf`],
    ['un chemin qui remonte', `${ORG}/..${UUID}-doc.pdf`],
    ['un chemin trop long', `${ORG}/${'x'.repeat(600)}.pdf`],
    ['un chemin qui se termine par le dossier', `${ORG}/`],
    ['un dossier seul', ORG],
    ['un chemin vide', ''],
  ])('refuse %s (le fichier est introuvable)', (_label, bad) => {
    expect(validateDocument({ path: bad, title: 'Doc', size: 10 }, ORG)).toEqual({ ok: false, error: { key: 'app.knowledgePage.errors.fileMissing' } });
  });

  it('refuse un chemin qui n’est pas du texte', () => {
    expect(validateDocument({ path: 42, title: 'Doc', size: 10 }, ORG)).toMatchObject({ ok: false, error: { key: 'app.knowledgePage.errors.fileMissing' } });
    expect(validateDocument({ path: null, title: 'Doc', size: 10 }, ORG)).toMatchObject({ ok: false });
  });

  it.each(['doc.exe', 'doc.doc', 'doc.xlsx', 'doc.zip', 'doc.pdf.exe', 'doc', 'doc.'])('refuse le type de « %s »', (name) => {
    expect(validateDocument({ path: `${ORG}/${UUID}-${name}`, title: 'Doc', size: 10 }, ORG)).toEqual({ ok: false, error: { key: 'app.knowledgePage.errors.unsupportedType' } });
  });

  it('refuse une taille absente, nulle, négative ou qui n’est pas un nombre ; arrondit une taille fractionnaire', () => {
    for (const size of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '2048', null, undefined, 0.4]) {
      expect(validateDocument({ path, title: 'Doc', size }, ORG)).toEqual({ ok: false, error: { key: 'app.knowledgePage.errors.fileMissing' } });
    }
    expect(validateDocument({ path, title: 'Doc', size: 2048.9 }, ORG)).toMatchObject({ ok: true, value: { size: 2048 } });
  });

  it('refuse plus de 10 Mo et le dit en mégaoctets ; accepte pile 10 Mo', () => {
    expect(validateDocument({ path, title: 'Doc', size: KNOWLEDGE_LIMITS.fileBytes }, ORG).ok).toBe(true);
    expect(validateDocument({ path, title: 'Doc', size: KNOWLEDGE_LIMITS.fileBytes + 1 }, ORG)).toEqual({
      ok: false, error: { key: 'app.knowledgePage.errors.fileTooLarge', params: { max: 10 } },
    });
  });
});
