// Research-only. Never reads environment variables, keys, browser data or CLI login files.
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFile } from 'node:fs/promises';

const official = 'https://api.deepseek.com/user/balance';
const decimal = /^-?\d+(?:\.\d+)?$/;
function money(value, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || !decimal.test(value)) throw new Error('schema');
  return value; // Preserve decimal strings, including negative balances; no binary float rounding.
}
export function normalize(body) {
  if (typeof body?.is_available !== 'boolean' || !Array.isArray(body.balance_infos) || !body.balance_infos.length) throw new Error('schema');
  const currencies = new Set();
  return {
    source: 'official_contract_fixture', isAvailable: body.is_available,
    balances: body.balance_infos.map(row => {
      if (!['CNY', 'USD'].includes(row.currency) || currencies.has(row.currency)) throw new Error('schema');
      currencies.add(row.currency);
      return { currency: row.currency, available: money(row.total_balance),
        granted: money(row.granted_balance, true), toppedUp: money(row.topped_up_balance, true) };
    })
  };
}

async function query(url, timeoutMs = 1000) {
  // Transport test uses a fixed synthetic marker ONLY on loopback, never on the Internet.
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: 'Bearer P03_SYNTHETIC_NOT_A_KEY' },
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) { return { state: error.name === 'TimeoutError' ? 'timeout' : 'network_error' }; }
  if (!response.ok) {
    await response.body?.cancel();
    return { state: response.status === 401 ? 'reauth_required' : response.status === 403 ? 'permission_denied' : response.status === 429 ? 'rate_limited' : 'server_error', retryAfter: response.headers.get('retry-after') };
  }
  try { return { state: 'ready', snapshot: normalize(await response.json()) }; }
  catch { return { state: 'schema_error' }; }
}

const fixture = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }] };
const checks = [];
function check(name, fn) { fn(); checks.push({ name, status: 'PASS' }); }
check('official example retains decimal strings', () => assert.equal(normalize(fixture).balances[0].available, '110.00'));
check('two currencies remain independent including zero', () => assert.equal(normalize({ ...fixture, balance_infos: [...fixture.balance_infos, { currency: 'USD', total_balance: '0.00' }] }).balances.length, 2));
check('unavailable is not invalid authentication', () => assert.equal(normalize({ ...fixture, is_available: false }).isAvailable, false));
check('optional missing components stay unknown', () => assert.equal(normalize({ ...fixture, balance_infos: [{ currency: 'CNY', total_balance: '-0.01' }] }).balances[0].granted, null));
for (const [name, body] of [
  ['missing wallet', { is_available: true }], ['empty wallets', { is_available: true, balance_infos: [] }],
  ['missing availability', { balance_infos: fixture.balance_infos }],
  ['invalid decimal', { ...fixture, balance_infos: [{ currency: 'CNY', total_balance: 'NaN' }] }],
  ['unknown currency', { ...fixture, balance_infos: [{ currency: 'EUR', total_balance: '1.00' }] }],
  ['missing amount', { ...fixture, balance_infos: [{ currency: 'CNY' }] }],
  ['duplicate currency', { ...fixture, balance_infos: [...fixture.balance_infos, ...fixture.balance_infos] }]
]) check(name + ' rejected', () => assert.throws(() => normalize(body)));

let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  assert.equal(req.headers.authorization, 'Bearer P03_SYNTHETIC_NOT_A_KEY');
  if (req.url === '/timeout') return; // Closed with closeAllConnections in cleanup.
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/ok' }); return res.end(); }
  const status = /^\/\d+$/.test(req.url) ? Number(req.url.slice(1)) : 200;
  res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 429 ? { 'Retry-After': '60' } : {}) });
  res.end(req.url === '/malformed' ? '<html>not json</html>' : JSON.stringify(fixture));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const ok = await query(base + '/ok');
  check('loopback HTTP contract success', () => assert.equal(ok.state, 'ready'));
  for (const [path, state] of [['/401', 'reauth_required'], ['/403', 'permission_denied'], ['/429', 'rate_limited'], ['/500', 'server_error'], ['/malformed', 'schema_error'], ['/redirect', 'network_error'], ['/timeout', 'timeout']]) {
    const before = requests;
    const result = await query(base + path, path === '/timeout' ? 80 : 1000);
    check('loopback ' + path, () => { assert.equal(result.state, state); assert.equal(requests, before + 1); });
    if (path === '/429') check('Retry-After retained', () => assert.equal(result.retryAfter, '60'));
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

let publicProbe = { status: 'NOT_RUN' };
if (process.argv.includes('--probe-public')) {
  // One bounded GET without Authorization. Only status/type are retained; body discarded.
  try {
    const response = await fetch(official, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
    publicProbe = { status: 'OBSERVED', authenticated: false, httpStatus: response.status, contentType: response.headers.get('content-type') };
    await response.body?.cancel();
  } catch (error) { publicProbe = { status: 'FAILED', kind: error.name === 'TimeoutError' ? 'timeout' : 'network_error' }; }
}
const receipt = { task: 'Subwise P03-A', generatedAt: new Date().toISOString(), runtime: process.version,
  fixtureSource: 'https://api-docs.deepseek.com/api/get-user-balance/', checks, loopbackRequests: requests, publicProbe,
  authenticatedLiveBalance: 'NOT_RUN', mobileBuilds: { ios: 'NOT_RUN', android: 'NOT_RUN', harmonyos: 'NOT_RUN' },
  limitations: ['Fixtures and loopback prove contract handling only.', 'No real credentials read or used.', 'No model inference invoked.', 'No account balance, mobile network or device credential store verified.'] };
await writeFile(new URL('../evidence/poc-results.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ checks: checks.length, passed: checks.every(c => c.status === 'PASS'), publicProbe, authenticatedLiveBalance: 'NOT_RUN' }));
