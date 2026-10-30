import { describe, expect, it } from 'vitest';
import { accountIdentity, cleanWorkspaceName, workspaceName, workspaceNameError } from './workspace-name';

describe('nom de l’espace de travail', () => {
  it('prend l’entreprise saisie à l’inscription', () => {
    expect(workspaceName({ email: 'lea@exemple.fr', company: 'Atelier Nova' })).toBe('Atelier Nova');
    expect(workspaceName({ email: 'lea@exemple.fr', name: 'Léa Martin', company: 'Atelier Nova' })).toBe('Atelier Nova');
  });
  it('sans entreprise (Google), part du nom puis de l’e-mail', () => {
    expect(workspaceName({ email: 'lea@exemple.fr', name: 'Léa Martin' })).toBe('Espace de Léa Martin');
    expect(workspaceName({ email: 'lea@exemple.fr' })).toBe('Espace de lea');
    expect(workspaceName({ email: '' })).toBeNull();
  });
  it('lit les métadonnées sans se fier à leur type, et borne la longueur', () => {
    expect(accountIdentity({ email: 'a@b.co', user_metadata: { company: '  Atelier   Nova ', full_name: 'Léa' } })).toEqual({ email: 'a@b.co', name: 'Léa', company: 'Atelier Nova' });
    expect(accountIdentity({ email: 'a@b.co', user_metadata: { company: { x: 1 }, name: 42 } })).toEqual({ email: 'a@b.co', name: undefined, company: undefined });
    expect(accountIdentity({ email: 'a@b.co', user_metadata: { company: 'é'.repeat(300) } }).company).toHaveLength(120);
    expect(accountIdentity({ email: null })).toEqual({ email: '', name: undefined, company: undefined });
  });
});

describe('nom saisi pour un nouvel espace', () => {
  it('retire les espaces superflus et les caractères de contrôle', () => {
    expect(cleanWorkspaceName('  Atelier   des \n Lilas \t')).toBe('Atelier des Lilas');
    expect(cleanWorkspaceName('A\u0000B\u007fC')).toBe('A B C');
    expect(cleanWorkspaceName(undefined)).toBe('');
    expect(cleanWorkspaceName(null)).toBe('');
    expect(cleanWorkspaceName(42)).toBe('42');
  });
  it('limite à 120 caractères, sans couper un caractère en deux', () => {
    expect([...cleanWorkspaceName('é'.repeat(300))]).toHaveLength(120);
    const emoji = cleanWorkspaceName('🌿'.repeat(200));
    expect([...emoji]).toHaveLength(120);
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
  it('exige 2 à 120 caractères, comme le renommage', () => {
    expect(workspaceNameError('')).toEqual({ key: 'app.settings.errNameLength' });
    expect(workspaceNameError('a')).toEqual({ key: 'app.settings.errNameLength' });
    expect(workspaceNameError('ab')).toBeNull();
    expect(workspaceNameError('x'.repeat(120))).toBeNull();
    expect(workspaceNameError('x'.repeat(121))).toEqual({ key: 'app.settings.errNameLength' });
  });
});
