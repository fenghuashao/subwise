// Synthetic fixtures only. MiniMax uses an INTERNAL probe contract, not an official response schema.
export const deepseekFixture = { is_available: true, balance_infos: [
  { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
  { currency: 'USD', total_balance: '0.00' }
] };
export const minimaxFixture = { contract: 'subwise.synthetic.windows.v1', windows: [
  { pool: 'coding', window: '5h-demo', label: '模拟 5 小时窗口', limit: 100, remaining: 62, resetAt: '2026-10-29T16:00:00Z' },
  { pool: 'coding', window: 'week-demo', label: '模拟周窗口（非套餐承诺）', limit: 1000, remaining: null, resetAt: null }
] };
const decimal = value => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) throw new Error('schema_error');
  return value;
};
export function normalize(provider, raw, observedAt = '2026-10-29T12:00:00Z') {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('schema_error');
  let items;
  if (provider === 'deepseek') {
    if (typeof raw.is_available !== 'boolean' || !Array.isArray(raw.balance_infos) || !raw.balance_infos.length) throw new Error('schema_error');
    const currencies = new Set();
    items = raw.balance_infos.map(b => {
      if (typeof b.currency !== 'string' || !b.currency.trim() || currencies.has(b.currency) || b.total_balance == null) throw new Error('schema_error');
      currencies.add(b.currency);
      return { kind: 'balance', currency: b.currency, available: decimal(b.total_balance), granted: decimal(b.granted_balance), toppedUp: decimal(b.topped_up_balance) };
    });
  } else if (provider === 'minimax') {
    if (raw.contract !== 'subwise.synthetic.windows.v1' || !Array.isArray(raw.windows) || !raw.windows.length) throw new Error('schema_error');
    const keys = new Set();
    items = raw.windows.map(w => {
      const key = `${w.pool}/${w.window}`;
      if (typeof w.pool !== 'string' || typeof w.window !== 'string' || !w.pool || !w.window || keys.has(key) || typeof w.label !== 'string') throw new Error('schema_error');
      keys.add(key);
      for (const n of [w.limit, w.remaining]) if (n !== null && (!Number.isSafeInteger(n) || n < 0)) throw new Error('schema_error');
      if (w.resetAt !== null && !Number.isFinite(Date.parse(w.resetAt))) throw new Error('schema_error');
      return { kind: 'window', pool: w.pool, window: w.window, label: w.label, limit: w.limit, remaining: w.remaining, resetAt: w.resetAt, unit: 'synthetic_requests', anomaly: w.limit !== null && w.remaining !== null && w.remaining > w.limit };
    });
  } else throw new Error('unsupported');
  return { id: `${provider}:${observedAt}`, provider, observedAt, source: 'mock', schemaVersion: 1, isAvailable: provider === 'deepseek' ? raw.is_available : null, items };
}
export const schema = `CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, provider TEXT NOT NULL, observed_at TEXT NOT NULL, payload TEXT NOT NULL); PRAGMA user_version=1;`;
export async function initialize(db) {
  const version = await db.getAllAsync('PRAGMA user_version');
  if (version[0].user_version > 1) throw new Error('unsupported_database_version');
  await db.execAsync(schema);
}
// Serial queue prevents overlapping native SQLite transactions from UI refreshes.
export function repository(db) {
  let queue = Promise.resolve();
  return {
    save(snapshot) {
      const operation = queue.then(async () => {
        await db.execAsync('BEGIN IMMEDIATE');
        try {
          await db.runAsync('INSERT OR IGNORE INTO snapshots(id,provider,observed_at,payload) VALUES(?,?,?,?)', snapshot.id, snapshot.provider, snapshot.observedAt, JSON.stringify(snapshot));
          await db.execAsync('COMMIT');
        } catch (error) { await db.execAsync('ROLLBACK'); throw error; }
      });
      queue = operation.catch(() => {});
      return operation;
    },
    async latest() {
      await queue;
      const rows = await db.getAllAsync('SELECT payload FROM snapshots s WHERE observed_at=(SELECT MAX(observed_at) FROM snapshots WHERE provider=s.provider) ORDER BY provider');
      return rows.map(r => JSON.parse(r.payload));
    }
  };
}
export async function refreshMock(repo, provider, raw, observedAt) {
  const snapshot = normalize(provider, raw, observedAt);
  await repo.save(snapshot);
  return repo.latest(); // UI only receives data read back from the database.
}
export function cards(snapshots, now = Date.now()) {
  return snapshots.flatMap(s => s.items.map((v, index) => ({
    key: `${s.id}:${index}`, title: s.provider === 'deepseek' ? 'DeepSeek · 模拟 API 余额' : `MiniMax · ${v.label}`,
    value: v.kind === 'balance' ? `${v.currency} ${v.available}` : v.remaining === null ? '剩余额度未知' : `剩余 ${v.remaining} / ${v.limit ?? '未知'}`,
    percent: v.kind === 'window' && v.limit > 0 && v.remaining !== null && !v.anomaly ? v.remaining / v.limit * 100 : null,
    note: `模拟数据 · ${s.observedAt}${s.isAvailable === false ? ' · 余额不足以调用 API' : ''}${v.anomaly ? ' · 异常：余量超过上限' : ''}${v.resetAt && Date.parse(v.resetAt) <= now ? ' · 预计已重置，待刷新' : ''}`
  })));
}
// No credential parameter. Probe cannot access authenticated APIs or a user-supplied URL.
export async function probeHttps(fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher('https://api.deepseek.com/user/balance', { method: 'GET', redirect: 'error', signal: controller.signal });
    if (response.redirected) throw new Error('redirect_rejected');
    return { status: response.status, expected: 401, authenticated: false };
  } finally { clearTimeout(timer); }
}
