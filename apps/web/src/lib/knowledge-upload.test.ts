import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { KNOWLEDGE_LIMITS } from '@/lib/data/types';
import { documentPath, uploadDocument, validateDocumentFile } from './knowledge-upload';

const ORG = '5b1f2c3a-0000-4000-8000-0000000000a1';
const UUID = '3f2b0b9a-0000-4000-8000-000000000000';
/** Un fichier dont on ne fixe que le nom et la taille (inutile d'allouer 10 Mo pour essayer la limite). */
const fileOf = (name: string, size: number) => ({ name, size }) as File;

function fakeStorage(result: { error: { message: string } | null }) {
  const calls: { bucket: string; path: string; file: File; options: Record<string, unknown> }[] = [];
  const supabase = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: File, options: Record<string, unknown>) => (calls.push({ bucket, path, file, options }), result),
      }),
    },
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

describe('validateDocumentFile : ce qu’on vérifie avant l’envoi', () => {
  it('accepte un fichier de type pris en charge et de taille raisonnable', () => {
    for (const name of ['catalogue.pdf', 'conditions.DOCX', 'notes.txt', 'faq.md', 'prix.csv', 'page.html']) expect(validateDocumentFile(fileOf(name, 1000))).toBeNull();
  });

  it('refuse un type inconnu, un fichier vide, un fichier trop gros', () => {
    expect(validateDocumentFile(fileOf('programme.exe', 1000))).toEqual({ key: 'app.knowledgePage.errors.unsupportedType' });
    expect(validateDocumentFile(fileOf('sans-extension', 1000))).toEqual({ key: 'app.knowledgePage.errors.unsupportedType' });
    expect(validateDocumentFile(fileOf('vide.pdf', 0))).toEqual({ key: 'app.knowledgePage.errors.fileMissing' });
    expect(validateDocumentFile(fileOf('gros.pdf', KNOWLEDGE_LIMITS.fileBytes))).toBeNull();
    expect(validateDocumentFile(fileOf('gros.pdf', KNOWLEDGE_LIMITS.fileBytes + 1))).toEqual({ key: 'app.knowledgePage.errors.fileTooLarge', params: { max: 10 } });
  });
});

describe('documentPath : l’emplacement dans le stockage', () => {
  it('« <organisation>/<identifiant>-<nom sûr> » : sans accents, espaces ni caractères spéciaux', () => {
    expect(documentPath(ORG, UUID, 'Catalogue été 2026 (v2).PDF')).toBe(`${ORG}/${UUID}-Catalogue-ete-2026-v2.pdf`);
  });

  it('un nom piégé ne sort jamais du dossier de l’organisation ni ne contient deux points de suite (la base les refuse)', () => {
    for (const name of ['../../etc/passwd.txt', '..\\..\\secret.pdf', 'a..b..c.pdf', '/absolu/chemin.md', 'x/../../y.csv']) {
      const path = documentPath(ORG, UUID, name);
      expect(path.startsWith(`${ORG}/${UUID}-`)).toBe(true);
      expect(path.slice(ORG.length + 1)).not.toContain('/');
      expect(path).not.toContain('..');
    }
  });

  it('garde l’extension, qui décide du type lu par le worker', () => {
    expect(documentPath(ORG, UUID, 'Prix 2026.CSV').endsWith('.csv')).toBe(true);
  });
});

describe('uploadDocument : l’envoi direct vers le stockage privé', () => {
  it('dépose le fichier dans le bucket « knowledge », sous son type, sans écraser, et rend son chemin', async () => {
    const { supabase, calls } = fakeStorage({ error: null });
    const file = fileOf('Conditions de vente.docx', 4096);
    const res = await uploadDocument(supabase, { orgId: ORG, file });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call).toMatchObject({ bucket: 'knowledge', file, options: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: false } });
    expect(call!.path).toMatch(new RegExp(`^${ORG}/[0-9a-f-]{36}-Conditions-de-vente\\.docx$`));
    expect(res).toEqual({ ok: true, path: call!.path });
  });

  it('chaque envoi a un chemin à lui, même pour un même nom de fichier', async () => {
    const { supabase, calls } = fakeStorage({ error: null });
    await uploadDocument(supabase, { orgId: ORG, file: fileOf('doc.txt', 10) });
    await uploadDocument(supabase, { orgId: ORG, file: fileOf('doc.txt', 10) });
    expect(new Set(calls.map((c) => c.path)).size).toBe(2);
  });

  it('un fichier refusé d’avance n’est pas envoyé', async () => {
    const { supabase, calls } = fakeStorage({ error: null });
    expect(await uploadDocument(supabase, { orgId: ORG, file: fileOf('virus.exe', 10) })).toEqual({ ok: false, error: { key: 'app.knowledgePage.errors.unsupportedType' } });
    expect(await uploadDocument(supabase, { orgId: ORG, file: fileOf('gros.pdf', KNOWLEDGE_LIMITS.fileBytes + 1) })).toMatchObject({ ok: false, error: { key: 'app.knowledgePage.errors.fileTooLarge' } });
    expect(calls).toEqual([]);
  });

  it('un échec du stockage donne un message à nous, jamais celui du service', async () => {
    const { supabase } = fakeStorage({ error: { message: 'new row violates row-level security policy for table "objects"' } });
    const res = await uploadDocument(supabase, { orgId: ORG, file: fileOf('doc.txt', 10) });
    expect(res).toEqual({ ok: false, error: { key: 'app.knowledgePage.errors.uploadFailed' } });
    expect(JSON.stringify(res)).not.toContain('row-level');
  });

  it('utilise un identifiant aléatoire pour le chemin', async () => {
    const { supabase, calls } = fakeStorage({ error: null });
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(UUID);
    await uploadDocument(supabase, { orgId: ORG, file: fileOf('doc.txt', 10) });
    uuid.mockRestore();
    expect(calls[0]!.path).toBe(`${ORG}/${UUID}-doc.txt`);
  });
});
