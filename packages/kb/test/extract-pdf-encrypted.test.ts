import { describe, expect, it, vi } from 'vitest';

// Un PDF protégé par mot de passe : pdf.js lève « PasswordException ». On simule `unpdf` pour vérifier la traduction de l'erreur.
vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn(async () => {
    throw Object.assign(new Error('No password given'), { name: 'PasswordException', code: 1 });
  }),
}));

describe('extractPdf : PDF protégé', () => {
  it('donne l’erreur encrypted', async () => {
    const { extractPdf } = await import('../src/extract/pdf.ts');
    const { ExtractError } = await import('../src/extract/errors.ts');
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\n');
    await expect(extractPdf(pdf)).rejects.toMatchObject({ code: 'encrypted' });
    await expect(extractPdf(pdf)).rejects.toBeInstanceOf(ExtractError);
  });
});
