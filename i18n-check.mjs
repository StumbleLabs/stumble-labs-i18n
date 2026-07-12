#!/usr/bin/env node
/*
 * Validates translation files against en.json.
 * Checks, for every other <lang>.json:
 *   1. same set of keys as en.json (no missing, no unknown)
 *   2. same interpolation placeholders per string ({{name}} tokens)
 *
 * Optional guard: --block=pt-BR,xx marks locales that are maintained upstream
 * (by the website team) and must not be submitted in this repo. If one is
 * present the check fails with a clear message.
 *
 * Works in both repos:
 *   - stumble-labs-i18n: `node i18n-check.mjs locales --block=pt-BR`
 *   - tracker: `node scripts/i18n-check.mjs` (defaults to src/assets/i18n, no block)
 *
 * Exit code 0 = all good, 1 = problems found, 2 = setup error.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REFERENCE = 'en.json';

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith('--'));
const blockArg = args.find((a) => a.startsWith('--block='));

const dir = dirArg || (existsSync('locales') ? 'locales' : join('src', 'assets', 'i18n'));
const blocked = new Set(
  (blockArg ? blockArg.slice('--block='.length) : '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith('.json') ? s : `${s}.json`))
);

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

function placeholders(s) {
  const set = new Set();
  const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(s)) !== null) set.add(m[1]);
  return set;
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

function load(file) {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

if (!existsSync(join(dir, REFERENCE))) {
  console.error(`Could not find ${REFERENCE} in "${dir}".`);
  process.exit(2);
}

const ref = flatten(load(REFERENCE));
const refKeys = new Set(Object.keys(ref));

const present = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== REFERENCE)
  .sort();
const blockedPresent = present.filter((f) => blocked.has(f));
const files = present.filter((f) => !blocked.has(f));

console.log(`Reference: ${REFERENCE} (${refKeys.size} keys)`);
console.log('');

let problems = 0;

for (const f of blockedPresent) {
  problems++;
  console.log(`  fail  ${f}`);
  console.log(`        ${f} is maintained by the website team and is not translated here.`);
  console.log('        Please remove it from this pull request and open an issue instead.');
  console.log('');
}

if (!files.length && !blockedPresent.length) {
  console.log('No translation files yet besides the reference.');
  process.exit(0);
}

for (const file of files) {
  const flat = flatten(load(file));
  const keys = new Set(Object.keys(flat));

  const missing = [...refKeys].filter((k) => !keys.has(k));
  const unknown = [...keys].filter((k) => !refKeys.has(k));
  const badPlaceholders = [];

  for (const k of keys) {
    if (!refKeys.has(k)) continue;
    const expected = placeholders(ref[k]);
    const got = placeholders(flat[k]);
    if (!sameSet(expected, got)) {
      badPlaceholders.push({ key: k, expected: [...expected], got: [...got] });
    }
  }

  const done = refKeys.size - missing.length;
  const pct = Math.round((done / refKeys.size) * 100);
  const clean = !missing.length && !unknown.length && !badPlaceholders.length;

  if (clean) {
    console.log(`  ok    ${file}  (${pct}% complete)`);
    continue;
  }

  problems++;
  console.log(`  fail  ${file}  (${pct}% complete)`);

  if (missing.length) {
    console.log(`        missing ${missing.length} key(s):`);
    for (const k of missing.slice(0, 20)) console.log(`          - ${k}`);
    if (missing.length > 20) console.log(`          ...and ${missing.length - 20} more`);
  }
  if (unknown.length) {
    console.log(`        ${unknown.length} key(s) not in ${REFERENCE}:`);
    for (const k of unknown.slice(0, 20)) console.log(`          + ${k}`);
    if (unknown.length > 20) console.log(`          ...and ${unknown.length - 20} more`);
  }
  for (const p of badPlaceholders.slice(0, 20)) {
    console.log(
      `        placeholder mismatch at "${p.key}": expected {${p.expected.join(', ')}}, got {${p.got.join(', ')}}`
    );
  }
  if (badPlaceholders.length > 20) {
    console.log(`        ...and ${badPlaceholders.length - 20} more placeholder issue(s)`);
  }
  console.log('');
}

console.log('');
if (problems) {
  console.error(`${problems} file(s) need attention.`);
  process.exit(1);
}
console.log('All translation files are in sync with the reference.');
