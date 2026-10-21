import { describe, expect, it } from 'vitest';
import { plainText, snapToCodePoint, styleState, styleText, toggleStyle, unstyleText, UNDERLINE_MARK } from './style';

const U = UNDERLINE_MARK;
const underlined = (s: string) => [...s].map((c) => c + U).join('');

describe('gras (sans empattement gras Unicode, comme Postiz)', () => {
  it('met les lettres et les chiffres en gras, et laisse le reste', () => {
    expect(styleText('Bonjour 2026 !', { bold: true })).toBe('𝗕𝗼𝗻𝗷𝗼𝘂𝗿 𝟮𝟬𝟮𝟲 !');
  });

  it('met aussi en gras les lettres accentuées : la lettre en gras, l’accent derrière', () => {
    const bold = styleText('é', { bold: true });
    expect([...bold]).toEqual(['𝗲', '́']);
    expect(styleText('Ça va très bien', { bold: true }).normalize('NFC')).toContain('𝗖̧');
    expect(unstyleText(bold)).toBe('é');
    expect(unstyleText(styleText('Ça va très bien, ñ ü', { bold: true }))).toBe('Ça va très bien, ñ ü');
  });

  it('laisse intact ce qui n’a pas de gras : émojis, chinois, arabe, ligatures', () => {
    expect(styleText('😀🔥你好مرحبا', { bold: true })).toBe('😀🔥你好مرحبا');
    expect(styleText('œuf ß', { bold: true })).toBe('œ𝘂𝗳 ß');
  });

  it('se retire à l’identique', () => {
    const text = 'Nouvelle collection d’hiver 2026 — élégance & caractère';
    expect(unstyleText(styleText(text, { bold: true }), { bold: true })).toBe(text);
  });
});

describe('souligné (trait bas combinant, comme Postiz)', () => {
  it('souligne les lettres et les chiffres, pas les espaces ni la ponctuation', () => {
    expect(styleText('Bonjour 26 !', { underline: true })).toBe(`${underlined('Bonjour')} ${underlined('26')} !`);
  });

  it('est idempotent et se retire', () => {
    const once = styleText('Bonjour', { underline: true });
    expect(styleText(once, { underline: true })).toBe(once);
    expect(unstyleText(once, { underline: true })).toBe('Bonjour');
  });

  it('garde l’accent avant le trait bas et le retire proprement', () => {
    const text = 'été';
    const u = styleText(text, { underline: true });
    expect(u).not.toBe(text);
    expect(unstyleText(u, { underline: true })).toBe(text);
  });

  it('ne casse pas les écritures liées ni les émojis', () => {
    expect(styleText('مرحبا 😀', { underline: true })).toBe('مرحبا 😀');
  });
});

describe('gras et souligné ensemble', () => {
  it('se combinent et se retirent séparément', () => {
    const both = styleText('Hello', { bold: true, underline: true });
    expect(both).toBe(underlined('𝗛𝗲𝗹𝗹𝗼'));
    expect(unstyleText(both, { underline: true })).toBe('𝗛𝗲𝗹𝗹𝗼');
    expect(unstyleText(both, { bold: true })).toBe(underlined('Hello'));
    expect(plainText(both)).toBe('Hello');
  });
});

describe('état et bascule', () => {
  it('dit si le style couvre tout le texte, une partie ou rien', () => {
    expect(styleState('Bonjour', 'bold')).toBe('none');
    expect(styleState('𝗕𝗼𝗻𝗷𝗼𝘂𝗿', 'bold')).toBe('all');
    expect(styleState('𝗕𝗼𝗻 jour', 'bold')).toBe('some');
    expect(styleState('😀 !', 'bold')).toBe('none');
    expect(styleState('', 'underline')).toBe('none');
    expect(styleState(underlined('Bon'), 'underline')).toBe('all');
    expect(styleState(`${underlined('Bon')}jour`, 'underline')).toBe('some');
  });

  it('bascule : tout stylé → on retire ; sinon on style tout', () => {
    expect(toggleStyle('Bonjour', 'bold')).toBe('𝗕𝗼𝗻𝗷𝗼𝘂𝗿');
    expect(toggleStyle('𝗕𝗼𝗻𝗷𝗼𝘂𝗿', 'bold')).toBe('Bonjour');
    expect(toggleStyle('𝗕𝗼𝗻 jour', 'bold')).toBe('𝗕𝗼𝗻 𝗷𝗼𝘂𝗿');
    expect(toggleStyle('Bonjour', 'underline')).toBe(underlined('Bonjour'));
    expect(toggleStyle(underlined('Bonjour'), 'underline')).toBe('Bonjour');
  });
});

describe('frappe au clavier avec un style activé', () => {
  it('style chaque caractère tapé, et rien pour un espace ou une ponctuation : c’est ce que fait l’éditeur à chaque touche', () => {
    expect(styleText('j', { bold: true })).toBe('𝗷');
    expect(styleText('j', { underline: true })).toBe(`j${U}`);
    expect(styleText(' ', { bold: true, underline: true })).toBe(' ');
    expect(styleText('!', { bold: true })).toBe('!');
  });
});

describe('curseur', () => {
  it('ne reste jamais au milieu d’une paire de substitution', () => {
    const text = 'a𝗯c'; // 𝗯 occupe deux unités UTF-16 (positions 1 et 2)
    expect(snapToCodePoint(text, 2)).toBe(1);
    expect(snapToCodePoint(text, 1)).toBe(1);
    expect(snapToCodePoint(text, 3)).toBe(3);
    expect(snapToCodePoint(text, 99)).toBe(text.length);
  });
});
