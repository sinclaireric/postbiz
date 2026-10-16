import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/index.ts';

const key = Buffer.alloc(32, 7).toString('base64');
const otherKey = Buffer.alloc(32, 9).toString('base64');

describe('chiffrement des jetons', () => {
  it('chiffre puis déchiffre', async () => {
    const enc = await encryptSecret('EAAB-jeton-secret', key);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain('EAAB');
    expect(await decryptSecret(enc, key)).toBe('EAAB-jeton-secret');
  });

  it('produit un résultat différent à chaque appel (IV aléatoire)', async () => {
    expect(await encryptSecret('x', key)).not.toBe(await encryptSecret('x', key));
  });

  it('refuse une mauvaise clé', async () => {
    const enc = await encryptSecret('secret', key);
    await expect(decryptSecret(enc, otherKey)).rejects.toThrow();
  });

  it('détecte une altération', async () => {
    const enc = await encryptSecret('secret', key);
    const [v, iv, ct] = enc.split('.');
    const tampered = `${v}.${iv}.${ct!.slice(0, -4)}AAAA`;
    await expect(decryptSecret(tampered, key)).rejects.toThrow();
  });

  it('refuse une clé de mauvaise taille et un format inconnu', async () => {
    await expect(encryptSecret('x', Buffer.alloc(16).toString('base64'))).rejects.toThrow(/32 octets/);
    await expect(decryptSecret('v9.aaa.bbb', key)).rejects.toThrow(/inconnu/);
  });
});
