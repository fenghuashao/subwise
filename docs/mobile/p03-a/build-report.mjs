import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('./', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');
const architecture = await read('architecture-research.md');
const platform = await read('platform-research.md');
const receipt = JSON.parse(await read('evidence/poc-results.json'));
const baseline = JSON.parse((await read('evidence/baseline.json')).replace(/^\uFEFF/, ''));
const project = new URL('../../../', root);
const preservation = [];
for (const entry of baseline) {
  const bytes = await readFile(new URL(entry.path, project));
  const actual = createHash('sha256').update(bytes).digest('hex').toUpperCase();
  preservation.push({ ...entry, actual, unchanged: actual === entry.sha256 });
}
if (preservation.some(entry => !entry.unchanged)) throw new Error('Baseline changed');
await writeFile(new URL('evidence/preservation.json', root), JSON.stringify(preservation, null, 2) + '\n');
const refs = Object.fromEntries([...platform.matchAll(/^- ([A-Z]\d+) (https:\/\/[^\s（]+)/gm)].map(m => [m[1], m[2]]));
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(value) {
  const saved = [];
  const hold = html => `@@SAVED${saved.push(html) - 1}@@`;
  let text = value.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));
  text = text.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_, label, url) => hold(`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)}</a>`));
  text = text.replace(/\[([A-Z]\d+)\]/g, (all, id) => refs[id] ? hold(`<a class="ref" href="${esc(refs[id])}" target="_blank" rel="noreferrer">${id}</a>`) : all);
  text = text.replace(/https:\/\/[^\s（；）<]+/g, url => hold(`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a>`));
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/@@SAVED(\d+)@@/g, (_, i) => saved[i]);
}
const toc = [];
let headingId = 0;
function render(markdown) {
  const lines = markdown.split(/\r?\n/); let out = ''; let i = 0;
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code = []; i++; while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++; out += `<pre><code>${esc(code.join('\n'))}</code></pre>`; continue;
    }
    if (/^\|/.test(line) && /^\|[\s:|\-]+\|$/.test(lines[i + 1] || '')) {
      const header = cells(line); i += 2; const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      out += `<div class="table-wrap" tabindex="0"><table><thead><tr>${header.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; continue;
    }
    const heading = /^(#{1,3}) (.+)/.exec(line);
    if (heading) {
      const level = heading[1].length === 1 ? 2 : heading[1].length;
      const id = `section-${++headingId}`;
      if (level === 2) toc.push({ id, title: heading[2] });
      out += `<h${level} id="${id}">${inline(heading[2])}</h${level}>`; i++; continue;
    }
    if (/^- /.test(line)) {
      const items = []; while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      out += `<ul>${items.map(s => `<li>${inline(s)}</li>`).join('')}</ul>`; continue;
    }
    const paragraph = []; while (i < lines.length && lines[i].trim() && !/^(#|\||```|- )/.test(lines[i])) paragraph.push(lines[i++]);
    if (!paragraph.length) paragraph.push(lines[i++]);
    out += `<p>${inline(paragraph.join(' '))}</p>`;
  }
  return out;
}
const split = architecture.indexOf('## 3.');
const main = render(architecture.slice(0, split)) + `<section class="platform">${render(platform)}</section>` + render(architecture.slice(split));
const evidence = `<h2 id="execution-evidence">执行凭证（嵌入离线报告）</h2><p>以下结果已嵌入本文件，离线无需打开附件。源码摘录另见 evidence/cc-switch.json；外部官方链接需联网访问。</p><details><summary>PoC 执行明细 · ${receipt.checks.length} 项 PASS</summary><pre>${esc(JSON.stringify(receipt, null, 2))}</pre></details><details><summary>原有 ${preservation.length} 个文件哈希 · 全部保持一致</summary><pre>${esc(JSON.stringify(preservation, null, 2))}</pre></details>`;
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>Subwise P03-A · 平台接入与架构预研</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#182640;background:#f6f8fc;line-height:1.85;font-size:16px}*{box-sizing:border-box}body{margin:0}header{background:#182640;color:white;padding:58px max(30px,calc((100vw - 1260px)/2));border-bottom:6px solid #315dcc}.eyebrow{font-size:13px;letter-spacing:2px;color:#a8bef5}h1{font-size:clamp(30px,4vw,46px);line-height:1.3;margin:16px 0}header p{color:#d9e4fb;max-width:850px}.badges{display:flex;flex-wrap:wrap;gap:10px}.badges span{padding:5px 12px;background:#2b3d5c;border-radius:6px;font-size:13px}.layout{max-width:1440px;margin:0 auto;display:grid;grid-template-columns:240px minmax(0,1fr);gap:38px;padding:32px}nav{position:sticky;top:20px;align-self:start;max-height:90vh;overflow:auto;font-size:13px;border-right:1px solid #dce3ef;padding-right:18px}nav a{display:block;padding:5px 0;color:#56647a;text-decoration:none}nav a:hover{color:#315dcc}main{min-width:0;background:white;border:1px solid #dce3ef;border-radius:12px;padding:26px 36px 50px}h2{font-size:24px;line-height:1.4;margin:40px 0 18px;padding-top:14px;border-top:1px solid #dce3ef;scroll-margin-top:20px}h2:first-child{margin-top:0;border-top:0}h3{font-size:18px;color:#315dcc;margin-top:28px}p{margin:14px 0}a{color:#315dcc;text-underline-offset:3px;overflow-wrap:anywhere}code{background:#edf2fc;border-radius:4px;padding:2px 5px;font-size:.85em;overflow-wrap:anywhere}pre{background:#f1f4fa;border:1px solid #dce3ef;border-radius:8px;padding:18px;overflow:auto;line-height:1.65;font-size:12px}pre code{padding:0;background:none;overflow-wrap:normal}.table-wrap{overflow-x:auto;margin:24px 0;border:1px solid #dce3ef;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:14px;min-width:740px}th{background:#e8eefc;text-align:left;color:#244b9d;font-weight:650}th,td{padding:14px 16px;border-bottom:1px solid #e5eaf2;vertical-align:top}td:first-child{font-weight:600;min-width:135px}tr:last-child td{border-bottom:0}tr:nth-child(even){background:#fafbfe}.ref{font-size:12px;background:#e8eefc;border-radius:4px;padding:1px 5px;text-decoration:none;white-space:nowrap}li{margin-bottom:10px}details{border:1px solid #dce3ef;border-radius:8px;padding:14px;margin:16px 0}summary{cursor:pointer;font-weight:650}footer{padding:30px;text-align:center;color:#64718a;font-size:13px}.gate{background:#fff4df;border-left:4px solid #986017;padding:18px 22px;margin:20px 0}.gate strong{color:#805019}@media(max-width:950px){.layout{display:block;padding:16px}nav{position:static;max-height:none;border:0;display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}nav a{max-width:220px}main{padding:20px}header{padding:34px 24px}}@media print{nav{display:none}.layout{display:block;padding:0}main{border:0;padding:0}header{background:white;color:#182640;padding:20px}header p,.eyebrow{color:#182640}.badges{display:none}table{min-width:0;font-size:10px}th,td{padding:6px}.table-wrap{overflow:visible}details pre{display:block}a{color:#182640}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body><header><div class="eyebrow">SUBWISE / RESEARCH NOTE 03-A / 2026.10.29</div><h1>平台额度接入<br>与技术架构预研</h1><p>七个平台 · 固定版本源码 · 本地优先模型 · 三端路线比较。把可查询的能力、运行时依赖和手机端待验证事项分开呈现。</p><div class="badges"><span>20 项隔离检查 PASS</span><span>官方无凭据请求 401</span><span>真实账户 NOT_RUN</span><span>移动构建 NOT_RUN</span></div></header><div class="layout"><nav aria-label="报告目录">${toc.map(x => `<a href="#${x.id}">${esc(x.title)}</a>`).join('')}<a href="#execution-evidence">执行凭证与文件保留</a></nav><main><div class="gate"><strong>停止在预研阶段。</strong> 本报告包含设计建议与隔离验证，不代表三端 App 或真实账户接入已完成；等待 FA 确认后推进开发。</div>${main}${evidence}</main></div><footer>FX → FA · 无外部脚本、字体或样式依赖 · 可离线阅读 / 打印 · 未提交、未推送</footer></body></html>`;
if (/<script\b|<link\b|<iframe\b/i.test(html)) throw new Error('Unexpected external resource');
await writeFile(new URL('SUBWISE-P03-A-REPORT.html', root), html);
console.log(JSON.stringify({ htmlBytes: Buffer.byteLength(html), preservedFiles: preservation.length, tables: (html.match(/<table>/g) || []).length, sections: toc.length, externalResources: 0 }));
