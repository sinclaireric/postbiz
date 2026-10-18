import { describe, expect, it } from 'vitest';
import { accountIdentity, workspaceName } from './workspace-name';

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
