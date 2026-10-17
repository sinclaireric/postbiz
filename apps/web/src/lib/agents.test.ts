import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NETWORKS } from './networks';
import { AI_AGENTS, THEMES, agentBySlug } from './agents';

const ROOT = path.join(process.cwd(), 'public');
const APP = path.join(process.cwd(), 'src', 'app', '(marketing)');

describe('agents IA', () => {
  it('chaque adresse est unique et bien formée', () => {
    const slugs = AI_AGENTS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s, s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('aucune adresse d’agent ne masque une page existante à la racine', () => {
    // Les agents sont servis à la racine par une route dynamique : un dossier du même nom prendrait la place d'un agent (ou l'inverse).
    const reserved = new Set([
      ...readdirSync(APP, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('[')).map((e) => e.name),
      ...readdirSync(path.join(process.cwd(), 'src', 'app'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name.replace(/^\(.*\)$/, '')),
      'robots.txt', 'sitemap.xml', 'favicon.ico', '_next',
    ]);
    for (const a of AI_AGENTS) expect(reserved.has(a.slug), a.slug).toBe(false);
  });

  it('chaque agent a son icône, sa vidéo et son affiche dans public/', () => {
    for (const a of AI_AGENTS) {
      expect(existsSync(path.join(ROOT, a.icon)), `${a.slug} : icône ${a.icon}`).toBe(true);
      expect(existsSync(path.join(ROOT, 'agents', 'hero', `${a.slug}.webm`)), `${a.slug} : vidéo`).toBe(true);
      expect(existsSync(path.join(ROOT, 'agents', 'hero', `${a.slug}.webp`)), `${a.slug} : affiche`).toBe(true);
    }
  });

  it('chaque palette utilisée existe, chaque présentation est écrite en français et en anglais', () => {
    for (const a of AI_AGENTS) {
      expect(THEMES[a.theme], a.slug).toBeDefined();
      expect(a.what.fr.length, `${a.slug} fr`).toBeGreaterThan(40);
      expect(a.what.en.length, `${a.slug} en`).toBeGreaterThan(40);
      expect(a.what.fr, a.slug).not.toBe(a.what.en);
    }
  });

  it('agentBySlug retrouve un agent, pas un inconnu', () => {
    expect(agentBySlug('claude-code')?.name).toBe('Claude Code');
    expect(agentBySlug('inconnu')).toBeUndefined();
    expect(agentBySlug('blog')).toBeUndefined();
  });
});

describe('pastilles de réseaux des heros', () => {
  it('chaque réseau géré a son logo dans public/socials', () => {
    for (const n of NETWORKS) expect(existsSync(path.join(ROOT, 'socials', `${n.id}.svg`)), n.id).toBe(true);
  });
});
