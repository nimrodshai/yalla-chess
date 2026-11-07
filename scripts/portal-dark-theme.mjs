// Writes the portal's dark theme into index.html.
//
// The portal's styles pick their colors by hand, rule by rule, so there is
// no small set of variables to swap. This reads every color in the page's
// own <style> blocks and writes a dark twin of each declaration into the
// block marked id="portal-dark-generated": light neutral backgrounds turn
// to warm near-black, dark text turns to parchment, lines and shadows
// follow, and gold, green, red and already-dark surfaces stay as they are.
//
// Each twin is scoped with :where(:root[data-theme="dark"]), which adds no
// specificity, and the block comes after the page's styles. Every color
// declaration gets a twin, changed or not, so the cascade picks the same
// rule in dark as in light. Hand-tuned exceptions live in the block marked
// id="portal-dark-tuning", which this script leaves alone.
//
// Run after changing the portal's styles:  node scripts/portal-dark-theme.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../index.html', import.meta.url);
const START = '<style id="portal-dark-generated">';
const SCOPE = ':where(:root[data-theme="dark"])';

// Custom properties and rules that keep their light colors in dark: a
// chessboard is the same board at night, black pieces and all.
const KEEP_VARS = new Set(['--board-light', '--board-dark']);
const KEEP_SELECTORS = /\.chess-board-display/;

const html = readFileSync(FILE, 'utf8');

// ------------------------------------------------------------- styles
const blocks = [];
for (const match of html.matchAll(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/g)) {
  const attrs = match[1] || '';
  if (/id="portal-dark-/.test(attrs)) continue;
  blocks.push(match[2]);
}
const source = blocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

// Rules with their at-rule wrappers: [{ wrappers: ['@media ...'], selector, body }].
function parse(css) {
  const rules = [];
  const stack = [];
  let buffer = '';
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    if (char === '{') {
      const head = buffer.trim();
      buffer = '';
      if (head.startsWith('@')) { stack.push(head); continue; }
      const end = css.indexOf('}', i);
      rules.push({ wrappers: stack.filter((entry) => !/^@keyframes|^@font-face/.test(entry)), inKeyframes: stack.some((entry) => /^@keyframes/.test(entry)), selector: head, body: css.slice(i + 1, end) });
      i = end;
    } else if (char === '}') {
      stack.pop();
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return rules;
}
const rules = parse(source).filter((rule) => !rule.inKeyframes);

// Color custom properties, by their first definition.
const vars = {};
for (const rule of rules) {
  for (const [, name, value] of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) {
    if (!(name in vars) && parseColor(value.trim())) vars[name] = value.trim();
  }
}

// ------------------------------------------------------------- colors
function parseColor(text) {
  const value = text.trim().toLowerCase();
  if (value === 'white') return [255, 255, 255, 1];
  if (value === 'black') return [0, 0, 0, 1];
  let match = /^#([0-9a-f]{3,8})$/.exec(value);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    const n = (k) => parseInt(hex.slice(k, k + 2), 16);
    return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
  }
  match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value);
  if (match) {
    const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
  }
  return null;
}

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
}

function format([r, g, b], alpha) {
  const round = (x) => Math.round(x * 1000) / 1000;
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round(alpha)})`;
}

// What a color becomes in the dark theme, by what it paints.
function darken(text, role) {
  const rgba = parseColor(text);
  if (!rgba) return text;
  const alpha = rgba[3];
  const [h, s, l] = toHsl(rgba);
  if (role === 'bg') {
    // Faint white washes lift a dark surface as well as a light one.
    if (alpha < 0.25 && l > 0.9) return text;
    // Light surfaces, neutral or tinted, become warm dark ones; strong
    // mid-tone fills (gold buttons, green and red badges) stay.
    if (l >= 0.75 || (l >= 0.55 && s < 0.35)) return format(fromHsl(h || 38, Math.min(s * 0.45, 0.28), 0.075 + (1 - l) * 0.3), alpha);
    return text;
  }
  if (role === 'fg') {
    if (l >= 0.5) return text;
    if (s < 0.15) return format(fromHsl(h || 40, Math.max(s, 0.18), 0.9 - l * 0.4), alpha);
    return format(fromHsl(h, Math.min(s, 0.7), Math.max(0.66, 0.84 - l * 0.4)), alpha);
  }
  if (role === 'line') {
    if (l < 0.5 && s < 0.6) return format([236, 217, 164], Math.min(1, alpha * 1.1));
    if (l >= 0.75) return format(fromHsl(h || 38, Math.min(s * 0.4, 0.25), 0.16 + (1 - l) * 0.3), alpha);
    return text;
  }
  if (role === 'shadow') {
    if (l < 0.5) return format([0, 0, 0], Math.min(0.6, alpha * 2.2));
    if (l > 0.85) return format(rgba, alpha * 0.25);
    return text;
  }
  return text;
}

const ROLE = (property) => {
  if (property === 'color' || property === 'fill' || property === 'stroke' || property === 'caret-color' || property === '-webkit-text-fill-color' || property === 'text-decoration-color' || property === 'accent-color') return 'fg';
  if (property.startsWith('background')) return 'bg';
  if (property.startsWith('border') || property.startsWith('outline') || property === 'column-rule-color') return 'line';
  if (property === 'box-shadow' || property === 'text-shadow') return 'shadow';
  return null;
};

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b|var\((--[\w-]+)\)/g;

function convert(value, role) {
  let changed = false;
  let touched = false;
  const out = value.replace(COLOR_TOKEN, (token, varName) => {
    if (varName) {
      if (!(varName in vars)) return token;
      touched = true;
      if (KEEP_VARS.has(varName)) return token;
      const next = darken(vars[varName], role);
      if (next !== vars[varName]) changed = true;
      return next === vars[varName] ? token : next;
    }
    touched = true;
    const next = darken(token, role);
    if (next !== token) changed = true;
    return next;
  });
  return { out, touched, changed };
}

// ------------------------------------------------------------- output
function scopeSelector(selector) {
  return selector.split(',').map((part) => {
    const trimmed = part.trim();
    if (/^:root\b/.test(trimmed)) return trimmed.replace(/^:root/, ':root[data-theme="dark"]');
    if (/^html\b/.test(trimmed)) return trimmed.replace(/^html/, 'html[data-theme="dark"]');
    return `${SCOPE} ${trimmed}`;
  }).join(',\n');
}

// Whether a rule paints a fill that stays light in dark: a gold button, a
// green badge. Text on such a fill keeps its dark color, or it would turn
// light on light (initials on the gold avatar).
function keepsLightFill(body) {
  for (const raw of body.split(';')) {
    const index = raw.indexOf(':');
    if (index < 0 || !raw.slice(0, index).trim().toLowerCase().startsWith('background')) continue;
    for (const [token, varName] of raw.slice(index + 1).matchAll(COLOR_TOKEN)) {
      const color = varName ? vars[varName] : token;
      const rgba = color && parseColor(color);
      if (!rgba || rgba[3] < 0.6) continue;
      if (toHsl(rgba)[2] >= 0.5 && darken(color, 'bg') === color) return true;
    }
  }
  return false;
}

let css = '';
let twins = 0;
let changedCount = 0;
for (const rule of rules) {
  const declarations = [];
  const onLightFill = keepsLightFill(rule.body);
  for (const raw of rule.body.split(';')) {
    const index = raw.indexOf(':');
    if (index < 0) continue;
    const property = raw.slice(0, index).trim().toLowerCase();
    if (property.startsWith('--')) continue;
    const role = ROLE(property);
    if (!role) continue;
    const value = raw.slice(index + 1).trim().replace(/\s+/g, ' ');
    const keep = KEEP_SELECTORS.test(rule.selector) || (role === 'fg' && onLightFill);
    const { out, touched, changed } = keep ? { out: value, touched: true, changed: false } : convert(value, role);
    if (!touched) continue;
    declarations.push(`${property}: ${out}`);
    twins += 1;
    if (changed) changedCount += 1;
  }
  if (!declarations.length) continue;
  let block = `${scopeSelector(rule.selector)} { ${declarations.join('; ')}; }`;
  for (const wrapper of [...rule.wrappers].reverse()) block = `${wrapper} { ${block} }`;
  css += `    ${block}\n`;
}

const generated = `${START}\n    /* Generated by scripts/portal-dark-theme.mjs from the styles above; do not edit by hand. */\n${css}  </style>`;
const existing = /<style id="portal-dark-generated">[\s\S]*?<\/style>/;
if (!existing.test(html)) throw new Error('index.html has no <style id="portal-dark-generated"> block to fill.');
writeFileSync(FILE, html.replace(existing, () => generated));
console.log(`portal dark theme: ${twins} color declarations, ${changedCount} changed for dark`);
