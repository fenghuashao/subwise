import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalize, deepseekFixture, minimaxFixture, initialize, repository, refreshMock, cards, probeHttps } from '../src/core.mjs';
function adapter(raw) {return {execAsync:async sql => raw.exec(sql), runAsync:async (sql,...args) => raw.prepare(sql).run(...args), getAllAsync:async sql => raw.prepare(sql).all()};}
test('DeepSeek decimal/multi-currency/unknown fields remain distinct', () => {
  const s = normalize('deepseek',deepseekFixture);
  assert.equal(s.source,'mock'); assert.equal(s.items[0].available,'110.00');
  assert.equal(s.items[1].available,'0.00'); assert.equal(s.items[1].granted,null);
  assert.ok(cards([s]).every(c=>c.percent === null));
  assert.equal(normalize('deepseek',{is_available:true,balance_infos:[{currency:'X-CREDIT',total_balance:'-1.00000000000000001'}]}).items[0].available,'-1.00000000000000001');
});
test('malformed and missing balance rejected; unavailable is not zero', () => {
  for(const value of [{},{is_available:false,balance_infos:[]},{is_available:true,balance_infos:[{currency:'USD',total_balance:1}]},{is_available:true,balance_infos:[{currency:'USD'}]}]) assert.throws(()=>normalize('deepseek',value),/schema_error/);
  const unavailable=normalize('deepseek',{is_available:false,balance_infos:[{currency:'USD',total_balance:'-0.01'}]});
  assert.equal(unavailable.isAvailable,false); assert.match(cards([unavailable])[0].note,/余额不足/); assert.equal(unavailable.items[0].available,'-0.01');
});
test('MiniMax synthetic windows independent; unknown and reset never zeroed', () => {
  const s = normalize('minimax',minimaxFixture); const result = cards([s],Date.parse('2026-11-01'));
  assert.equal(result[0].percent,62); assert.equal(result[1].percent,null);
  assert.match(result[1].value,/未知/); assert.match(result[0].note,/预计已重置/);
  assert.equal(s.items[0].remaining,62);
  assert.throws(()=>normalize('minimax',{windows:[]}),/schema_error/);
});
test('duplicate windows and unsafe integers rejected; excess marked anomalous', () => {
  const f = structuredClone(minimaxFixture); f.windows.push(f.windows[0]); assert.throws(()=>normalize('minimax',f));
  const g = structuredClone(minimaxFixture); g.windows[0].remaining=101; const s=normalize('minimax',g); assert.equal(s.items[0].anomaly,true); assert.equal(cards([s])[0].percent,null);
  g.windows[0].remaining=Number.MAX_SAFE_INTEGER+1; assert.throws(()=>normalize('minimax',g));
});
test('actual disk SQLite -> close -> independent process -> UI view model; no memory fallback',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'subwise-p03b-')); const file=join(dir,'probe.db');
  let raw=new DatabaseSync(file);
  try {
    const db=adapter(raw); await initialize(db); const repo=repository(db);
    await Promise.all([refreshMock(repo,'deepseek',deepseekFixture),refreshMock(repo,'minimax',minimaxFixture)]);
    await refreshMock(repo,'deepseek',deepseekFixture); // idempotent repeated fixture
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM snapshots').get().n,2);
    const before=await repo.latest();
    await assert.rejects(()=>refreshMock(repo,'deepseek',{})); assert.deepEqual(await repo.latest(),before);
    raw.close(); raw=null;
    const child=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); console.log(JSON.stringify(db.prepare('SELECT payload FROM snapshots ORDER BY provider').all().map(r=>JSON.parse(r.payload)))); db.close();`,file],{encoding:'utf8'});
    assert.equal(child.status,0,child.stderr); const persisted=JSON.parse(child.stdout);
    assert.equal(cards(persisted).length,4); assert.equal(cards(persisted)[0].value,'CNY 110.00');
    assert.ok(!readFileSync(file).includes(Buffer.from('PUBLIC_SYNTHETIC_NOT_A_KEY')));
  } finally {raw?.close(); rmSync(dir,{recursive:true,force:true});}
});
test('SQLite transaction rolls back failure and queue recovers',async()=>{
  const raw=new DatabaseSync(':memory:'); const db=adapter(raw); await initialize(db); const repo=repository(db);
  await repo.save(normalize('deepseek',deepseekFixture));
  raw.exec("CREATE TRIGGER fail_minimax BEFORE INSERT ON snapshots WHEN NEW.provider='minimax' BEGIN SELECT RAISE(ABORT, 'injected'); END;");
  await assert.rejects(()=>repo.save(normalize('minimax',minimaxFixture)),/injected/);
  assert.equal((await repo.latest()).length,1); raw.exec('DROP TRIGGER fail_minimax');
  await repo.save(normalize('minimax',minimaxFixture)); assert.equal((await repo.latest()).length,2); raw.close();
});
test('newer database schema is not downgraded',async()=>{
  const raw=new DatabaseSync(':memory:'); raw.exec('PRAGMA user_version=2');
  await assert.rejects(()=>initialize(adapter(raw)),/unsupported_database_version/); raw.close();
});
test('HTTPS transport pinned, no credential, redirects fail closed',async()=>{
  const result=await probeHttps(async(url,options)=>{assert.equal(url,'https://api.deepseek.com/user/balance'); assert.equal(options.redirect,'error'); assert.equal(options.headers,undefined); return {status:401,redirected:false};}); assert.equal(result.authenticated,false);
  await assert.rejects(()=>probeHttps(async()=>({status:200,redirected:true})),/redirect_rejected/);
});
