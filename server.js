const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4173;
const HOST = '127.0.0.1';
const STATIC_FILES = new Set(['/index.html', '/styles.css', '/app.js']);
const PROVIDERS = {
  minimax: { env: 'MINIMAX_SUBSCRIPTION_KEY', label: 'MiniMax' },
  deepseek: { env: 'DEEPSEEK_API_KEY', label: 'DeepSeek' }
};

class UpstreamError extends Error {
  constructor(message, status = 502, code = 'upstream_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers['content-type'] || '');
    if (!contentType.toLowerCase().startsWith('application/json')) {
      reject(new UpstreamError('请求必须使用 application/json', 415, 'unsupported_media_type'));
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) {
        reject(new UpstreamError('请求内容过大', 413, 'payload_too_large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new UpstreamError('JSON 格式无效', 400, 'invalid_json'));
      }
    });
    request.on('error', reject);
  });
}

async function officialRequest(url, apiKey) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    const message = error.name === 'TimeoutError' ? '官方接口请求超时，请稍后重试' : '无法连接官方接口，请检查网络';
    throw new UpstreamError(message, 502, 'network_error');
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new UpstreamError(`官方接口返回了非 JSON 响应（HTTP ${response.status}）`, 502, 'invalid_upstream_response');
  }
  if (!response.ok) {
    const upstreamMessage = data?.error?.message || data?.base_resp?.status_msg || data?.message || '';
    const suffix = upstreamMessage ? `：${String(upstreamMessage).slice(0, 180)}` : '';
    throw new UpstreamError(`官方接口返回 HTTP ${response.status}${suffix}`, 502, response.status === 401 || response.status === 403 ? 'authentication_failed' : 'upstream_error');
  }
  return data;
}

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoFromEpoch(value) {
  const number = asFiniteNumber(value);
  if (number === null || number <= 0) return null;
  const milliseconds = number < 100000000000 ? number * 1000 : number;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMiniMax(data) {
  if (data?.base_resp && Number(data.base_resp.status_code) !== 0) {
    throw new UpstreamError(`MiniMax：${data.base_resp.status_msg || '查询失败'}`, 502, 'upstream_error');
  }
  const rows = Array.isArray(data?.model_remains) ? data.model_remains : [];
  if (!rows.length) throw new UpstreamError('MiniMax 返回成功，但没有可用的套餐额度数据', 502, 'empty_usage');

  const metrics = [];
  const intervalRows = rows.filter(row => asFiniteNumber(row.current_interval_remaining_percent) !== null);
  const weeklyRows = rows.filter(row => asFiniteNumber(row.current_weekly_remaining_percent) !== null);

  if (intervalRows.length) {
    const remaining = Math.min(...intervalRows.map(row => Math.max(0, Math.min(100, Number(row.current_interval_remaining_percent)))));
    const resetRow = intervalRows.find(row => Number(row.current_interval_remaining_percent) === remaining) || intervalRows[0];
    metrics.push({
      key: 'interval',
      label: '5 小时窗口',
      kind: 'quota',
      unit: '%',
      total: 100,
      used: 100 - remaining,
      remaining,
      resetAt: isoFromEpoch(resetRow.end_time),
      description: intervalRows.length > 1 ? `按 ${intervalRows.length} 个模型中的最低剩余额度计算` : '非视频模型共享额度'
    });
  } else {
    const countRows = rows.filter(row => asFiniteNumber(row.current_interval_total_count) > 0);
    if (countRows.length) {
      const total = countRows.reduce((sum, row) => sum + Number(row.current_interval_total_count), 0);
      const remaining = countRows.reduce((sum, row) => {
        const value = asFiniteNumber(row.current_interval_remaining_count) ?? asFiniteNumber(row.current_interval_usage_count) ?? 0;
        return sum + Math.max(0, value);
      }, 0);
      metrics.push({
        key: 'interval-count',
        label: '当前周期请求额度',
        kind: 'quota',
        unit: '次',
        total,
        used: Math.max(0, total - remaining),
        remaining,
        resetAt: isoFromEpoch(countRows[0].end_time),
        description: '按官方接口返回的计数额度汇总'
      });
    }
  }

  if (weeklyRows.length) {
    const remaining = Math.min(...weeklyRows.map(row => Math.max(0, Math.min(100, Number(row.current_weekly_remaining_percent)))));
    const resetRow = weeklyRows.find(row => Number(row.current_weekly_remaining_percent) === remaining) || weeklyRows[0];
    metrics.push({
      key: 'weekly',
      label: '每周窗口',
      kind: 'quota',
      unit: '%',
      total: 100,
      used: 100 - remaining,
      remaining,
      resetAt: isoFromEpoch(resetRow.weekly_end_time),
      description: weeklyRows.length > 1 ? `按 ${weeklyRows.length} 个模型中的最低剩余额度计算` : '全部模型共享额度，视频仅受此窗口限制'
    });
  }

  if (!metrics.length) throw new UpstreamError('MiniMax 返回的数据中没有可识别的剩余额度字段', 502, 'unsupported_response');
  return {
    provider: 'minimax',
    source: 'official',
    kind: 'quota',
    syncedAt: new Date().toISOString(),
    metrics,
    officialUrl: 'https://platform.minimax.io/docs/m-plan/usage-rules'
  };
}

function normalizeDeepSeek(data) {
  const balances = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  if (!balances.length) throw new UpstreamError('DeepSeek 返回成功，但没有余额数据', 502, 'empty_usage');
  const metrics = balances.map((item, index) => {
    const total = asFiniteNumber(item.total_balance);
    if (total === null) throw new UpstreamError('DeepSeek 余额字段格式无效', 502, 'unsupported_response');
    const currency = item.currency === 'USD' ? 'USD' : 'CNY';
    const granted = asFiniteNumber(item.granted_balance) ?? 0;
    const toppedUp = asFiniteNumber(item.topped_up_balance) ?? 0;
    return {
      key: `balance-${currency.toLowerCase()}-${index}`,
      label: `可用余额 · ${currency}`,
      kind: 'balance',
      unit: currency,
      remaining: total,
      granted,
      toppedUp,
      description: `充值 ${toppedUp.toFixed(2)} + 赠金 ${granted.toFixed(2)}`
    };
  });
  return {
    provider: 'deepseek',
    source: 'official',
    kind: 'balance',
    syncedAt: new Date().toISOString(),
    isAvailable: data.is_available !== false,
    metrics,
    officialUrl: 'https://api-docs.deepseek.com/zh-cn/api/get-user-balance'
  };
}

async function queryProvider(provider, body) {
  const config = PROVIDERS[provider];
  if (!config) throw new UpstreamError('该平台暂未提供官方自动查询适配器', 400, 'unsupported_provider');
  const apiKey = process.env[config.env];
  if (!apiKey) {
    throw new UpstreamError(`未配置 ${config.env}。请在本机终端设置环境变量后重启服务。`, 400, 'not_configured');
  }

  if (provider === 'minimax') {
    const region = body.region === 'global' ? 'global' : 'cn';
    const host = region === 'global' ? 'https://www.minimax.io' : 'https://www.minimax.cn';
    return normalizeMiniMax(await officialRequest(`${host}/v1/token_plan/remains`, apiKey));
  }
  return normalizeDeepSeek(await officialRequest('https://api.deepseek.com/user/balance', apiKey));
}

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  if (!STATIC_FILES.has(requestedPath)) {
    sendJson(response, 404, { error: { code: 'not_found', message: '资源不存在' } });
    return;
  }
  const filePath = path.join(ROOT, requestedPath.slice(1));
  try {
    const content = await fs.readFile(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    response.writeHead(200, {
      'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY'
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    sendJson(response, 404, { error: { code: 'not_found', message: '资源不存在' } });
  }
}

const server = http.createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
  } catch {
    sendJson(response, 400, { error: { code: 'bad_request', message: '请求路径无效' } });
    return;
  }

  if (pathname === '/api/capabilities' && request.method === 'GET') {
    sendJson(response, 200, {
      serverTime: new Date().toISOString(),
      providers: Object.fromEntries(Object.entries(PROVIDERS).map(([key, value]) => [key, { configured: Boolean(process.env[value.env]), env: value.env }]))
    });
    return;
  }

  const usageMatch = pathname.match(/^\/api\/usage\/(minimax|deepseek)$/);
  if (usageMatch && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      const usage = await queryProvider(usageMatch[1], body);
      sendJson(response, 200, { usage });
    } catch (error) {
      const status = error.status || 500;
      sendJson(response, status, { error: { code: error.code || 'internal_error', message: error.message || '查询失败' } });
    }
    return;
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && !pathname.startsWith('/api/')) {
    await serveStatic(request, response, pathname);
    return;
  }
  sendJson(response, 404, { error: { code: 'not_found', message: '接口不存在' } });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Subwise is running at http://${HOST}:${PORT}`);
    const configured = Object.entries(PROVIDERS).filter(([, value]) => process.env[value.env]).map(([key]) => key);
    console.log(`Official usage connectors: ${configured.length ? configured.join(', ') : 'none configured'}`);
  });
}

module.exports = { normalizeMiniMax, normalizeDeepSeek, queryProvider, server };
