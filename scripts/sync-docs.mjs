#!/usr/bin/env node
/**
 * Pulls README.md files from the Embedbits GitHub repositories and writes them
 * into docs/ as Docusaurus pages.
 *
 *   npm run sync-docs
 *
 * The generated pages are committed, so the site builds offline. Re-run the
 * script whenever a README changes. Do not edit generated pages by hand --
 * change the README in the source repository instead.
 */
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ORG = 'Embedbits';
const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');

// dir = folder under docs/, file = page name, position = sidebar order.
const PAGES = [
  // Platform
  {repo: 'EmBi_Platform', dir: 'platform', file: 'embi-platform', title: 'EmBi_Platform', position: 1},
  {repo: 'EmBi-ArtifactsHandler', dir: 'platform', file: 'artifacts-handler', title: 'Artifacts Handler', position: 2},

  // BSP
  {repo: 'Bsp', dir: 'bsp', file: 'overview', title: 'BSP Overview', label: 'Overview', position: 1},
  {repo: 'Bsp-Linker', dir: 'bsp', file: 'linker', title: 'Linker', position: 2},
  {repo: 'Bsp-Startup', dir: 'bsp', file: 'startup', title: 'Startup', position: 3},
  {repo: 'Bsp-Docs', dir: 'bsp', file: 'docs-module', title: 'Docs Module', position: 4},

  // RAL
  {repo: 'Bsp-Ral', dir: 'bsp/ral', file: 'overview', title: 'RAL Overview', label: 'Overview', position: 1},
  {repo: 'Bsp-Ral-CMSIS', dir: 'bsp/ral', file: 'cmsis', title: 'RAL CMSIS', label: 'CMSIS', position: 2},
  {repo: 'Bsp-Ral-CMSIS_ST', dir: 'bsp/ral', file: 'cmsis-st', title: 'RAL CMSIS ST', label: 'CMSIS ST', position: 3},
  {repo: 'Bsp-Ral-RAL_ST', dir: 'bsp/ral', file: 'ral-st', title: 'RAL ST', label: 'RAL ST', position: 4},

  // MCAL
  {repo: 'Bsp-Mcal', dir: 'bsp/mcal', file: 'overview', title: 'MCAL Overview', label: 'Overview', position: 1},
  ...[
    ['Core', 'Core'], ['Rcc', 'RCC'], ['Gpio', 'GPIO'], ['Exti', 'EXTI'], ['Nvic', 'NVIC'],
    ['Tim', 'TIM'], ['Usart', 'USART'], ['I2c', 'I2C'], ['Adc', 'ADC'], ['Crc', 'CRC'],
    ['Rng', 'RNG'], ['Iwdg', 'IWDG'], ['Dma', 'DMA'], ['Gpdma', 'GPDMA'],
  ].map(([name, label], i) => ({
    repo: `Bsp-Mcal-${name}`, dir: 'bsp/mcal/modules', file: name.toLowerCase(),
    title: `${label} MCAL Module`, label, position: i + 1,
  })),

  // Artifacts
  {repo: 'Artifacts', dir: 'artifacts', file: 'overview', title: 'Artifacts Overview', label: 'Overview', position: 1},
  ...[
    ['gcc', 'gcc'], ['gcc_arm_none_eabi', 'gcc-arm-none-eabi'], ['ninja', 'Ninja'], ['doxygen', 'Doxygen'],
    ['graphviz', 'Graphviz'], ['python', 'Python'], ['ruby', 'Ruby'], ['unity', 'Unity'],
    ['cmock', 'CMock'], ['renode', 'Renode'], ['probe_rs', 'probe-rs'], ['u8g2', 'u8g2'],
  ].map(([name, label], i) => ({
    repo: `Artifact-${name}`, dir: 'artifacts/tools', file: name.replace(/_/g, '-'),
    title: `${label} Artifact`, label, position: i + 1,
  })),
];

/** Drops `## <heading>` sections whose heading matches `test`. */
function dropSections(md, test) {
  const lines = md.split('\n');
  const out = [];
  let skipping = false;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = !inFence && /^##\s+(.*)$/.exec(line);
    if (heading) skipping = test(heading[1]);
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

function rewriteLinks(md, repo) {
  const blob = `https://github.com/${ORG}/${repo}/blob/HEAD/`;
  const raw = `https://raw.githubusercontent.com/${ORG}/${repo}/HEAD/`;
  const isRelative = (u) => !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(u);
  const clean = (u) => u.replace(/^\.\//, '');
  return md
    .replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (m, a, u, b) => (isRelative(u) ? a + raw + clean(u) + b : m))
    .replace(/(\[[^\]]*\]\()([^)\s]+)(\))/g, (m, a, u, b) => (isRelative(u) ? a + blob + clean(u) + b : m));
}

function transform(md, repo) {
  let body = md.replace(/\r\n/g, '\n').replace(/^﻿/, '').trim();
  body = body.replace(/^# .*\n+/, ''); // title comes from front matter
  body = dropSections(body, (h) => /table of contents|useful links/i.test(h));
  body = rewriteLinks(body, repo);
  body = body.replace(/\n(\s*---\s*\n){2,}/g, '\n---\n').replace(/\n{3,}/g, '\n\n');
  return body.trim() + '\n';
}

async function fetchReadme(repo) {
  const res = await fetch(`https://raw.githubusercontent.com/${ORG}/${repo}/HEAD/README.md`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${repo}: HTTP ${res.status}`);
  return res.text();
}

const missing = [];
await Promise.all(
  PAGES.map(async (p) => {
    const readme = await fetchReadme(p.repo);
    if (readme === null) return missing.push(p.repo);
    const front = [
      '---',
      `title: ${JSON.stringify(p.title)}`,
      `sidebar_label: ${JSON.stringify(p.label ?? p.title)}`,
      `sidebar_position: ${p.position}`,
      `custom_edit_url: https://github.com/${ORG}/${p.repo}/edit/HEAD/README.md`,
      '---',
      '',
      `{/* Generated by scripts/sync-docs.mjs from ${ORG}/${p.repo}. Do not edit here. */}`,
      '',
    ].join('\n');
    const dir = path.join(DOCS, p.dir);
    await mkdir(dir, {recursive: true});
    // .md files are parsed as CommonMark (see markdown.format in docusaurus.config.ts),
    // so the MDX comment is replaced by a plain HTML comment.
    await writeFile(path.join(dir, `${p.file}.md`), front.replace(/\{\/\*(.*)\*\/\}/, '<!--$1-->') + transform(readme, p.repo));
  }),
);

console.log(`Synced ${PAGES.length - missing.length} pages.`);
if (missing.length) console.log(`No README found for: ${missing.join(', ')}`);
