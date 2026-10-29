import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('./', import.meta.url);
const html = await readFile(new URL('SUBWISE-P03-A-REPORT.html', root), 'utf8');
const checks = [];
function check(name, run) { run(); checks.push({ name, status: 'PASS' }); }
check('document UTF-8 and Chinese language', () => { assert.match(html, /<html lang="zh-CN">/); assert.match(html, /charset="utf-8"/); });
check('no external runtime resources', () => assert.doesNotMatch(html, /<script\b|<link\b|<iframe\b|<img\b|@import|url\s*\(/i));
check('all seven platforms included', () => ['OpenAI', 'Claude', 'MiniMax', 'Kimi', '智谱', 'DeepSeek', 'Gemini'].forEach(name => assert.ok(html.includes(name))));
check('evidence labels preserved', () => ['DOC_SUPPORTED','SOURCE_SUPPORTED','VERIFIED','NOT_RUN','UNSUPPORTED'].forEach(name => assert.ok(html.includes(name))));
check('source revision pinned', () => assert.ok(html.includes('ddcb111765be66ed9e7e43e240497fd2c9576688')));
check('no unresolved renderer placeholders', () => assert.doesNotMatch(html, /@@SAVED\d+@@/));
check('all internal navigation targets exist exactly once', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]), match[1]);
});
check('tables have consistent column counts', () => {
  const tables = [...html.matchAll(/<table>([\s\S]*?)<\/table>/g)]; assert.equal(tables.length, 6);
  for (const [,table] of tables) {
    const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => (m[1].match(/<(?:th|td)>/g) || []).length);
    assert.ok(rows.length > 1); assert.ok(rows.every(count => count === rows[0]));
  }
});
check('HTML structural containers balanced', () => {
  for (const tag of ['html','head','body','header','main','nav','section','div','table','thead','tbody','tr','th','td','pre','code','details','summary','ul','li','p']) {
    assert.equal((html.match(new RegExp(`<${tag}(?:\\s[^>]*|)>`, 'g')) || []).length, (html.match(new RegExp(`</${tag}>`, 'g')) || []).length, tag);
  }
});
const preserved = JSON.parse(await readFile(new URL('evidence/preservation.json', root), 'utf8'));
check('all baseline files preserved', () => { assert.equal(preserved.length,7); assert.ok(preserved.every(file => file.unchanged)); });
const receipt = { task:'P03-A', generatedAt:new Date().toISOString(), checks, browserVisual:'NOT_RUN',
  browserReason:'Browser URL security policy rejected file://; no workaround attempted.',
  realAccountQueries:'NOT_RUN', mobileBuilds:'NOT_RUN', commitPush:'NOT_RUN' };
await writeFile(new URL('evidence/report-validation.json', root), JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({ passed:checks.length, total:checks.length, browserVisual:'NOT_RUN' }));
