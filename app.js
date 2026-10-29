(() => {
  'use strict';

  const STORAGE_KEY = 'subwise.subscriptions.v1';
  const SETTINGS_KEY = 'subwise.settings.v1';
  const VALID_STATUSES = ['active', 'paused', 'cancelled'];
  const VALID_CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly', 'once'];
  const VIEW_NAMES = {
    overview: '总览',
    subscriptions: '我的订阅',
    usage: '额度用量',
    calendar: '续费日历',
    analytics: '支出分析',
    settings: '设置与数据'
  };
  const STATUS_NAMES = { active: '使用中', paused: '已暂停', cancelled: '已取消' };
  const CYCLE_NAMES = { weekly: '每周', monthly: '每月', quarterly: '每季度', yearly: '每年', once: '一次性' };
  const CHART_COLORS = ['#c9f56a', '#a897f8', '#74a9f7', '#f3af67', '#8ed8a5', '#f08383', '#75d5d1'];
  const USAGE_CAPABILITIES = {
    minimax: { platform: 'MiniMax', direct: true, mode: '官方 API', capability: 'M Plan 5 小时窗口与每周窗口剩余额度', url: 'https://platform.minimax.cn/docs/token-plan/faq' },
    deepseek: { platform: 'DeepSeek', direct: true, mode: '官方 API', capability: '账户可用余额、充值余额与赠金；不含 token 用量', url: 'https://api-docs.deepseek.com/zh-cn/api/get-user-balance' },
    openai: { platform: 'OpenAI', direct: false, mode: '控制台 / 手动', capability: '消费级订阅额度无公开查询 API；API 用量不等同订阅额度', url: 'https://platform.openai.com/usage' },
    anthropic: { platform: 'Anthropic', direct: false, mode: '控制台 / 手动', capability: '控制台可查用量与速率限制；不等同 Claude 订阅剩余额度', url: 'https://platform.claude.com/docs/en/api/rate-limits' },
    google: { platform: 'Google AI', direct: false, mode: '控制台 / 手动', capability: '项目配额依赖 Google Cloud 权限与具体模型', url: 'https://ai.google.dev/gemini-api/docs/rate-limits' }
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = (name, className = '') => `<svg${className ? ` class="${className}"` : ''}><use href="#i-${name}"/></svg>`;
  const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const pad = value => String(value).padStart(2, '0');
  const toDateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const parseDate = value => new Date(`${value}T00:00:00`);
  const startOfToday = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const addDays = (date, amount) => {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return result;
  };
  const addMonths = (date, amount) => {
    const result = new Date(date);
    const originalDay = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + amount);
    result.setDate(Math.min(originalDay, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
    return result;
  };
  const dateAfter = days => toDateKey(addDays(startOfToday(), days));
  const daysUntil = value => Math.round((parseDate(value) - startOfToday()) / 86400000);
  const formatMoney = (value, decimals) => {
    const number = Number(value) || 0;
    const useDecimals = decimals ?? !Number.isInteger(number);
    return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: useDecimals ? 2 : 0, maximumFractionDigits: 2 })}`;
  };
  const formatDate = (value, withYear = false) => {
    if (!value) return '未设置';
    const date = parseDate(value);
    return new Intl.DateTimeFormat('zh-CN', { ...(withYear ? { year: 'numeric' } : {}), month: 'short', day: 'numeric' }).format(date);
  };
  const monthlyCost = subscription => {
    if (subscription.status !== 'active') return 0;
    const amount = Number(subscription.amount) || 0;
    return ({ weekly: amount * 52 / 12, monthly: amount, quarterly: amount / 3, yearly: amount / 12, once: 0 })[subscription.cycle] || 0;
  };

  function normalizeUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const metrics = Array.isArray(usage.metrics) ? usage.metrics.slice(0, 12).map((metric, index) => {
      const total = metric.total === null || metric.total === undefined ? null : Number(metric.total);
      const used = metric.used === null || metric.used === undefined ? null : Number(metric.used);
      const remaining = Number(metric.remaining);
      if (!Number.isFinite(remaining)) return null;
      return {
        key: String(metric.key || `metric-${index}`).slice(0, 50),
        label: String(metric.label || '额度').slice(0, 60),
        kind: metric.kind === 'balance' ? 'balance' : 'quota',
        unit: String(metric.unit || 'tokens').slice(0, 16),
        total: Number.isFinite(total) ? total : null,
        used: Number.isFinite(used) ? used : null,
        remaining,
        granted: Number.isFinite(Number(metric.granted)) ? Number(metric.granted) : null,
        toppedUp: Number.isFinite(Number(metric.toppedUp)) ? Number(metric.toppedUp) : null,
        resetAt: metric.resetAt ? String(metric.resetAt).slice(0, 40) : null,
        description: String(metric.description || '').slice(0, 180)
      };
    }).filter(Boolean) : [];
    return {
      source: ['official', 'manual', 'demo', 'empty'].includes(usage.source) ? usage.source : 'manual',
      kind: usage.kind === 'balance' ? 'balance' : 'quota',
      syncedAt: usage.syncedAt ? String(usage.syncedAt).slice(0, 40) : null,
      isAvailable: usage.isAvailable !== false,
      metrics,
      error: String(usage.error || '').slice(0, 240)
    };
  }

  function createDemoUsage(provider) {
    const now = new Date();
    if (provider === 'minimax') return normalizeUsage({
      source: 'demo', kind: 'quota', syncedAt: now.toISOString(), metrics: [
        { key: 'interval', label: '5 小时窗口', kind: 'quota', unit: '%', total: 100, used: 32, remaining: 68, resetAt: new Date(now.getTime() + 3 * 3600000).toISOString(), description: '演示快照，非实时官方数据' },
        { key: 'weekly', label: '每周窗口', kind: 'quota', unit: '%', total: 100, used: 61, remaining: 39, resetAt: new Date(now.getTime() + 4 * 86400000).toISOString(), description: '演示快照，非实时官方数据' }
      ]
    });
    if (provider === 'deepseek') return normalizeUsage({
      source: 'demo', kind: 'balance', syncedAt: now.toISOString(), metrics: [
        { key: 'balance-cny', label: '可用余额 · CNY', kind: 'balance', unit: 'CNY', remaining: 86.5, granted: 10, toppedUp: 76.5, description: '演示余额，非实时官方数据' }
      ]
    });
    return null;
  }

  function createDemoSubscriptions() {
    return [
      { id: 'demo-minimax', platform: 'MiniMax', plan: 'M Plan 订阅', amount: 199, cycle: 'monthly', renewal: dateAfter(9), status: 'active', payment: '微信支付', autoRenew: true, notes: '主力模型平台。金额为演示数据，请按实际订单修改。', usageRegion: 'cn', usage: createDemoUsage('minimax') },
      { id: 'demo-openai', platform: 'OpenAI', plan: 'ChatGPT Plus', amount: 145, cycle: 'monthly', renewal: dateAfter(18), status: 'active', payment: 'Visa ···· 4242', autoRenew: true, notes: '个人账号。金额为演示数据。' },
      { id: 'demo-anthropic', platform: 'Anthropic', plan: 'Claude Pro', amount: 145, cycle: 'monthly', renewal: dateAfter(4), status: 'active', payment: 'Visa ···· 4242', autoRenew: true, notes: '写作与代码辅助。金额为演示数据。' },
      { id: 'demo-deepseek', platform: 'DeepSeek', plan: 'API 预付费账户', amount: 100, cycle: 'quarterly', renewal: dateAfter(27), status: 'active', payment: '支付宝', autoRenew: false, notes: '备用模型平台。金额为演示数据。', usage: createDemoUsage('deepseek') },
      { id: 'demo-google', platform: 'Google AI', plan: 'AI Studio 资源包', amount: 300, cycle: 'yearly', renewal: dateAfter(62), status: 'paused', payment: 'Mastercard ···· 8888', autoRenew: false, notes: '已暂停。金额为演示数据。' }
    ];
  }

  function normalizeSubscription(item, index = 0) {
    if (!item || typeof item !== 'object') throw new Error('订阅记录格式无效');
    const platform = String(item.platform || '').trim();
    const plan = String(item.plan || '').trim();
    const amount = Number(item.amount);
    const renewal = String(item.renewal || '');
    if (!platform || !plan || !Number.isFinite(amount) || amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(renewal) || Number.isNaN(parseDate(renewal).getTime())) {
      throw new Error(`第 ${index + 1} 条订阅缺少有效字段`);
    }
    return {
      id: String(item.id || `sub-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`),
      platform: platform.slice(0, 40),
      plan: plan.slice(0, 60),
      amount,
      cycle: VALID_CYCLES.includes(item.cycle) ? item.cycle : 'monthly',
      renewal,
      status: VALID_STATUSES.includes(item.status) ? item.status : 'active',
      payment: String(item.payment || '').slice(0, 40),
      autoRenew: item.autoRenew !== false,
      notes: String(item.notes || '').slice(0, 240),
      usageRegion: item.usageRegion === 'global' ? 'global' : 'cn',
      usage: normalizeUsage(item.usage)
    };
  }

  function loadSubscriptions() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return createDemoSubscriptions();
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) throw new Error('invalid data');
      return parsed.map((item, index) => {
        const normalized = normalizeSubscription(item, index);
        if (!normalized.usage && item.id === 'demo-minimax') normalized.usage = createDemoUsage('minimax');
        if (!normalized.usage && item.id === 'demo-deepseek') normalized.usage = createDemoUsage('deepseek');
        return normalized;
      });
    } catch (error) {
      console.warn('无法读取本地订阅数据，已载入示例数据。', error);
      return createDemoSubscriptions();
    }
  }

  function loadSettings() {
    try {
      return { reminderDays: 7, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return { reminderDays: 7 };
    }
  }

  let subscriptions = loadSubscriptions();
  let settings = loadSettings();
  let currentView = 'overview';
  let currentStatus = 'all';
  let currentSearch = '';
  let currentSort = 'renewal';
  let calendarDate = new Date(startOfToday().getFullYear(), startOfToday().getMonth(), 1);
  let selectedId = null;
  let confirmCallback = null;
  let connectorState = { available: false, providers: {} };
  const syncingIds = new Set();

  function saveSubscriptions() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(subscriptions));
    } catch {
      showToast('浏览器存储不可用，请导出备份保存数据', 'info');
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      showToast('提醒设置暂时无法保存', 'info');
    }
  }

  function providerMeta(platform) {
    const key = platform.toLowerCase();
    if (key.includes('minimax')) return { initials: 'M', bg: '#5b4bbb', color: '#f1edff' };
    if (key.includes('openai')) return { initials: 'O', bg: '#30352f', color: '#f3f5ef' };
    if (key.includes('anthropic') || key.includes('claude')) return { initials: 'A', bg: '#765445', color: '#ffe4d2' };
    if (key.includes('deepseek')) return { initials: 'D', bg: '#355eaa', color: '#e9f2ff' };
    if (key.includes('google') || key.includes('gemini')) return { initials: 'G', bg: '#3b665c', color: '#e4fff6' };
    if (key.includes('阿里') || key.includes('百炼')) return { initials: '云', bg: '#81552d', color: '#fff0d9' };
    if (key.includes('智谱')) return { initials: 'Z', bg: '#385ca0', color: '#edf4ff' };
    return { initials: (platform.trim()[0] || 'S').toUpperCase(), bg: '#3c4337', color: '#e8f2df' };
  }

  function platformKey(platform) {
    const key = String(platform).toLowerCase();
    if (key.includes('minimax')) return 'minimax';
    if (key.includes('deepseek')) return 'deepseek';
    if (key.includes('openai') || key.includes('chatgpt')) return 'openai';
    if (key.includes('anthropic') || key.includes('claude')) return 'anthropic';
    if (key.includes('google') || key.includes('gemini')) return 'google';
    return null;
  }

  function providerLogo(subscription, large = false) {
    const meta = providerMeta(subscription.platform);
    return `<div class="provider-logo${large ? ' large' : ''}" style="--logo-bg:${meta.bg};--logo-color:${meta.color}">${escapeHTML(meta.initials)}</div>`;
  }

  function renewalMeta(subscription) {
    if (subscription.status === 'cancelled') return { primary: '不再续费', secondary: STATUS_NAMES.cancelled, urgent: false };
    if (subscription.cycle === 'once') return { primary: formatDate(subscription.renewal, true), secondary: '一次性服务', urgent: false };
    const days = daysUntil(subscription.renewal);
    let secondary = `还剩 ${days} 天`;
    if (days < 0) secondary = `已过 ${Math.abs(days)} 天`;
    if (days === 0) secondary = '今天续费';
    if (days === 1) secondary = '明天续费';
    if (subscription.status === 'paused') secondary = '订阅已暂停';
    return { primary: formatDate(subscription.renewal, true), secondary, urgent: days >= 0 && days <= Number(settings.reminderDays) && subscription.status === 'active' };
  }

  function activeSubscriptions() {
    return subscriptions.filter(item => item.status === 'active');
  }

  function upcomingSubscriptions(days = 30) {
    return activeSubscriptions()
      .filter(item => item.cycle !== 'once' && daysUntil(item.renewal) >= 0 && daysUntil(item.renewal) <= days)
      .sort((a, b) => parseDate(a.renewal) - parseDate(b.renewal));
  }

  function renderStats() {
    const active = activeSubscriptions();
    const monthly = active.reduce((sum, item) => sum + monthlyCost(item), 0);
    const upcoming = upcomingSubscriptions(30);
    const upcomingTotal = upcoming.reduce((sum, item) => sum + Number(item.amount), 0);
    const nearest = upcoming[0];
    const stats = [
      { label: '每月支出', value: formatMoney(monthly), foot: '按不同计费周期折算', icon: 'wallet', accent: true },
      { label: '年度预计支出', value: formatMoney(monthly * 12), foot: '基于当前有效订阅估算', icon: 'chart' },
      { label: '有效订阅', value: String(active.length), suffix: '个', foot: `共记录 ${subscriptions.length} 个平台服务`, icon: 'card' },
      { label: '30 天内待续费', value: formatMoney(upcomingTotal), foot: nearest ? `${upcoming.length} 笔 · 最近 ${formatDate(nearest.renewal)}` : '近期没有待续费项目', icon: 'calendar' }
    ];
    $('#statsGrid').innerHTML = stats.map(stat => `
      <article class="stat-card${stat.accent ? ' accent' : ''}">
        <div class="stat-top"><span>${stat.label}</span><div class="stat-icon">${icon(stat.icon)}</div></div>
        <strong class="stat-value">${stat.value}${stat.suffix ? `<small>${stat.suffix}</small>` : ''}</strong>
        <span class="stat-foot">${stat.foot}</span>
      </article>`).join('');
  }

  function subscriptionListItem(subscription) {
    return `<article class="subscription-item" data-id="${escapeHTML(subscription.id)}" tabindex="0" role="button" aria-label="查看 ${escapeHTML(subscription.platform)} 订阅详情">
      ${providerLogo(subscription)}
      <div class="subscription-info"><strong>${escapeHTML(subscription.platform)}</strong><span>${escapeHTML(subscription.plan)} · ${CYCLE_NAMES[subscription.cycle]}</span></div>
      <div class="subscription-cost"><strong>${formatMoney(subscription.amount)}</strong><span>/ ${CYCLE_NAMES[subscription.cycle].replace('每', '')}</span></div>
      ${icon('chevron', 'item-arrow')}
    </article>`;
  }

  function renewalListItem(subscription) {
    const date = parseDate(subscription.renewal);
    const days = daysUntil(subscription.renewal);
    const timing = days === 0 ? '今天续费' : days === 1 ? '明天续费' : `${days} 天后续费`;
    return `<div class="renewal-item">
      <div class="renewal-date"><strong>${date.getDate()}</strong><span>${date.getMonth() + 1} 月</span></div>
      <div class="renewal-info"><strong>${escapeHTML(subscription.platform)}</strong><span>${timing} · ${escapeHTML(subscription.plan)}</span></div>
      <span class="renewal-price">${formatMoney(subscription.amount)}</span>
    </div>`;
  }

  function renderOverview() {
    renderStats();
    const sorted = [...subscriptions].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return parseDate(a.renewal) - parseDate(b.renewal);
    });
    $('#overviewSubscriptions').innerHTML = sorted.slice(0, 5).map(subscriptionListItem).join('') || '<div class="empty-mini">还没有订阅，点击右上角添加第一个平台。</div>';
    $('#overviewSubscriptionMeta').textContent = `${activeSubscriptions().length} 个使用中 · ${subscriptions.length} 条记录`;
    const upcoming = upcomingSubscriptions(30);
    $('#upcomingRenewals').innerHTML = upcoming.slice(0, 4).map(renewalListItem).join('') || '<div class="empty-mini">未来 30 天没有续费。<br>可以放心专注工作。</div>';
    const platformCosts = getPlatformCosts();
    const total = platformCosts.reduce((sum, item) => sum + item.cost, 0);
    if (platformCosts.length && total > 0) {
      const top = platformCosts[0];
      $('#insightText').textContent = `${top.platform} 是你当前月均支出最高的平台，约占总订阅费用的 ${Math.round(top.cost / total * 100)}%。`;
    } else {
      $('#insightText').textContent = '添加有效订阅后，这里会展示你的费用构成与支出重点。';
    }
    const reminderCount = upcomingSubscriptions(Number(settings.reminderDays)).length;
    $('#notificationDot').hidden = reminderCount === 0;
  }

  function tableRow(subscription) {
    const renewal = renewalMeta(subscription);
    return `<div class="subscription-table table-row" data-id="${escapeHTML(subscription.id)}">
      <div class="table-provider" data-open-detail="${escapeHTML(subscription.id)}" role="button" tabindex="0">
        ${providerLogo(subscription, true)}
        <div class="subscription-info"><strong>${escapeHTML(subscription.platform)}</strong><span>${escapeHTML(subscription.plan)}</span></div>
      </div>
      <div class="table-cost"><strong>${formatMoney(subscription.amount)}</strong><span>${CYCLE_NAMES[subscription.cycle]}计费</span></div>
      <div class="table-renewal"><strong>${renewal.primary}</strong><span class="${renewal.urgent ? 'urgent' : ''}">${renewal.secondary}</span></div>
      <div><span class="status-badge status-${subscription.status}">${STATUS_NAMES[subscription.status]}</span></div>
      <button class="icon-btn row-menu" data-open-detail="${escapeHTML(subscription.id)}" aria-label="管理 ${escapeHTML(subscription.platform)}">${icon('more')}</button>
    </div>`;
  }

  function renderAllSubscriptions() {
    let list = subscriptions.filter(item => {
      const matchesStatus = currentStatus === 'all' || item.status === currentStatus;
      const keyword = currentSearch.trim().toLowerCase();
      const matchesSearch = !keyword || `${item.platform} ${item.plan}`.toLowerCase().includes(keyword);
      return matchesStatus && matchesSearch;
    });
    list.sort((a, b) => {
      if (currentSort === 'cost') return monthlyCost(b) - monthlyCost(a) || Number(b.amount) - Number(a.amount);
      if (currentSort === 'name') return a.platform.localeCompare(b.platform, 'zh-CN');
      return parseDate(a.renewal) - parseDate(b.renewal);
    });
    $('#allSubscriptions').innerHTML = list.map(tableRow).join('');
    $('.table-head').hidden = list.length === 0;
    $('#emptyState').hidden = list.length !== 0;
    $('#navCount').textContent = subscriptions.length;
  }

  function formatUsageNumber(value) {
    const number = Number(value) || 0;
    return number.toLocaleString('zh-CN', { maximumFractionDigits: number < 100 ? 2 : 0 });
  }

  function formatUsageTime(value) {
    if (!value) return '未记录同步时间';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function usageSourceMeta(usage) {
    if (!usage) return { source: 'empty', label: '未记录' };
    return {
      official: { source: 'official', label: '官方数据' },
      manual: { source: 'manual', label: '手动记录' },
      demo: { source: 'demo', label: '演示快照' },
      empty: { source: 'empty', label: '未记录' }
    }[usage.source] || { source: 'manual', label: '手动记录' };
  }

  function usageMetricHtml(metric) {
    if (metric.kind === 'balance') {
      const symbol = metric.unit === 'USD' ? '$' : '¥';
      return `<div class="usage-metric"><div class="usage-metric-head"><span>${escapeHTML(metric.label)}</span><strong class="balance-value">${symbol}${formatUsageNumber(metric.remaining)}</strong></div><div class="balance-breakdown">${escapeHTML(metric.description || '官方账户余额')}</div></div>`;
    }
    const total = Number(metric.total);
    const used = Number(metric.used);
    const usedPercent = total > 0 && Number.isFinite(used) ? Math.max(0, Math.min(100, used / total * 100)) : Math.max(0, Math.min(100, 100 - Number(metric.remaining)));
    const level = usedPercent >= 90 ? 'danger' : usedPercent >= 75 ? 'warning' : '';
    const remainingText = `${formatUsageNumber(metric.remaining)}${metric.unit === '%' ? '%' : ` ${metric.unit}`}`;
    const usedText = Number.isFinite(used) && total > 0 ? `已用 ${formatUsageNumber(used)} / ${formatUsageNumber(total)} ${metric.unit}` : `已用 ${formatUsageNumber(usedPercent)}%`;
    return `<div class="usage-metric"><div class="usage-metric-head"><span>${escapeHTML(metric.label)}</span><strong>${remainingText} <small>剩余</small></strong></div><div class="usage-progress ${level}"><i style="width:${usedPercent.toFixed(1)}%"></i></div><div class="usage-metric-meta"><span>${usedText}</span><span>${metric.resetAt ? `${formatUsageTime(metric.resetAt)} 重置` : escapeHTML(metric.description || '')}</span></div></div>`;
  }

  function usageCard(subscription) {
    const usage = subscription.usage;
    const source = usageSourceMeta(usage);
    const provider = platformKey(subscription.platform);
    const capability = USAGE_CAPABILITIES[provider];
    const syncing = syncingIds.has(subscription.id);
    const metrics = usage?.metrics || [];
    return `<article class="usage-card${syncing ? ' syncing' : ''}" data-usage-card="${escapeHTML(subscription.id)}">
      <div class="usage-card-header">${providerLogo(subscription, true)}<div class="subscription-info"><strong>${escapeHTML(subscription.platform)}</strong><span>${escapeHTML(subscription.plan)}</span></div><span class="usage-source source-${source.source}">${syncing ? '同步中' : source.label}</span></div>
      ${metrics.length ? `<div class="usage-metrics">${metrics.map(usageMetricHtml).join('')}</div>` : `<div class="usage-empty"><div>${icon('gauge')}<span>还没有用量数据<br>同步官方数据或录入手动快照</span></div></div>`}
      ${usage?.error ? `<div class="usage-error">${icon('info')}<span>${escapeHTML(usage.error)}</span></div>` : ''}
      <div class="usage-card-footer"><span class="usage-synced-at">${usage?.syncedAt ? `更新于 ${formatUsageTime(usage.syncedAt)}` : '等待第一次记录'}</span><div class="usage-card-actions">
        ${provider === 'minimax' ? `<select class="select-control usage-region" data-usage-region="${escapeHTML(subscription.id)}" aria-label="MiniMax 站点"><option value="cn"${subscription.usageRegion !== 'global' ? ' selected' : ''}>国内站</option><option value="global"${subscription.usageRegion === 'global' ? ' selected' : ''}>国际站</option></select>` : ''}
        <button class="btn btn-secondary" data-manual-usage="${escapeHTML(subscription.id)}">${icon('edit')}手动录入</button>
        ${capability?.direct ? `<button class="btn btn-primary${syncing ? ' loading' : ''}" data-sync-usage="${escapeHTML(subscription.id)}"${syncing ? ' disabled' : ''}>${icon('refresh')}${syncing ? '查询中' : '官方同步'}</button>` : `<a class="btn btn-secondary" href="${capability?.url || '#'}" target="_blank" rel="noopener noreferrer">${icon('external')}控制台</a>`}
      </div></div>
    </article>`;
  }

  function renderUsage() {
    const sorted = [...subscriptions].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return a.platform.localeCompare(b.platform, 'zh-CN');
    });
    const recorded = subscriptions.filter(item => item.usage?.metrics?.length).length;
    const official = subscriptions.filter(item => item.usage?.source === 'official').length;
    const alerts = subscriptions.reduce((sum, item) => sum + (item.usage?.metrics || []).filter(metric => {
      if (metric.kind !== 'quota') return false;
      const usedPercent = metric.total > 0 && metric.used !== null ? metric.used / metric.total * 100 : 100 - metric.remaining;
      return usedPercent >= 80;
    }).length, 0);
    $('#usageSummary').innerHTML = [
      { icon: 'gauge', value: `${recorded} / ${subscriptions.length}`, label: '已记录用量的订阅' },
      { icon: 'link', value: `${official}`, label: '使用官方接口数据' },
      { icon: 'bell', value: `${alerts}`, label: '用量超过 80% 的额度窗口' }
    ].map(item => `<div class="usage-summary-card"><div class="small-icon">${icon(item.icon)}</div><div><strong>${item.value}</strong><span>${item.label}</span></div></div>`).join('');
    $('#usageGrid').innerHTML = sorted.map(usageCard).join('') || '<div class="empty-mini">先添加订阅，再记录平台额度。</div>';
    $('#usageNavDot').hidden = alerts === 0;
    $('#connectorTable').innerHTML = Object.entries(USAGE_CAPABILITIES).map(([key, capability]) => {
      const subscription = { platform: capability.platform };
      const configured = connectorState.providers[key]?.configured;
      const mode = capability.direct && configured ? '已配置 · 可查询' : capability.mode;
      return `<div class="connector-row"><div class="connector-platform">${providerLogo(subscription)}<span>${capability.platform}</span></div><span class="connector-capability">${capability.capability}</span><span class="connector-mode${capability.direct ? ' direct' : ''}">${mode}</span><a href="${capability.url}" target="_blank" rel="noopener noreferrer" aria-label="查看 ${capability.platform} 官方说明">${icon('external')}</a></div>`;
    }).join('');
    updateConnectorUI();
  }

  function updateConnectorUI() {
    $('#connectorStatus').textContent = connectorState.available ? '本地安全代理已连接' : '当前为手动模式';
    ['minimax', 'deepseek'].forEach(provider => {
      const element = $(`#${provider}ConfigStatus`);
      if (!element) return;
      const configured = Boolean(connectorState.providers[provider]?.configured);
      element.textContent = configured ? '已配置' : '未配置';
      element.classList.toggle('configured', configured);
    });
  }

  function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    $('#calendarMonth').textContent = `${year} 年 ${month + 1} 月`;
    const firstOfMonth = new Date(year, month, 1);
    const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - mondayOffset);
    const todayKey = toDateKey(startOfToday());
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const date = addDays(gridStart, index);
      const key = toDateKey(date);
      const events = activeSubscriptions().filter(item => item.renewal === key && item.cycle !== 'once');
      cells.push(`<div class="calendar-day${date.getMonth() !== month ? ' other-month' : ''}${key === todayKey ? ' is-today' : ''}">
        <span class="day-number">${date.getDate()}</span>
        ${events.slice(0, 2).map(item => `<button class="calendar-event" data-open-detail="${escapeHTML(item.id)}" title="${escapeHTML(item.platform)} · ${formatMoney(item.amount)}">${escapeHTML(item.platform)} ${formatMoney(item.amount)}</button>`).join('')}
        ${events.length > 2 ? `<span class="calendar-event">+${events.length - 2} 项</span>` : ''}
      </div>`);
    }
    $('#calendarGrid').innerHTML = cells.join('');
    const monthItems = activeSubscriptions().filter(item => {
      const date = parseDate(item.renewal);
      return item.cycle !== 'once' && date.getFullYear() === year && date.getMonth() === month;
    }).sort((a, b) => parseDate(a.renewal) - parseDate(b.renewal));
    $('#monthRenewals').innerHTML = monthItems.map(renewalListItem).join('') || '<div class="empty-mini">本月没有续费项目。</div>';
    $('#monthRenewalCount').textContent = `${monthItems.length} 笔计划`;
    $('#monthRenewalTotal').textContent = formatMoney(monthItems.reduce((sum, item) => sum + Number(item.amount), 0));
  }

  function getPlatformCosts() {
    const groups = {};
    activeSubscriptions().forEach(item => {
      groups[item.platform] = (groups[item.platform] || 0) + monthlyCost(item);
    });
    return Object.entries(groups).map(([platform, cost]) => ({ platform, cost })).sort((a, b) => b.cost - a.cost);
  }

  function forecastNextYear() {
    const start = new Date(startOfToday().getFullYear(), startOfToday().getMonth(), 1);
    const months = Array.from({ length: 12 }, (_, index) => ({ date: addMonths(start, index), total: 0 }));
    activeSubscriptions().filter(item => item.cycle !== 'once').forEach(item => {
      let chargeDate = parseDate(item.renewal);
      const end = addMonths(start, 12);
      let guard = 0;
      while (chargeDate < end && guard < 400) {
        if (chargeDate >= start) {
          const bucket = (chargeDate.getFullYear() - start.getFullYear()) * 12 + chargeDate.getMonth() - start.getMonth();
          if (bucket >= 0 && bucket < 12) months[bucket].total += Number(item.amount);
        }
        if (item.cycle === 'weekly') chargeDate = addDays(chargeDate, 7);
        if (item.cycle === 'monthly') chargeDate = addMonths(chargeDate, 1);
        if (item.cycle === 'quarterly') chargeDate = addMonths(chargeDate, 3);
        if (item.cycle === 'yearly') chargeDate = addMonths(chargeDate, 12);
        guard += 1;
      }
    });
    return months;
  }

  function renderAnalytics() {
    const groups = getPlatformCosts();
    const total = groups.reduce((sum, item) => sum + item.cost, 0);
    let cursor = 0;
    const segments = groups.map((item, index) => {
      const start = cursor;
      cursor += total ? item.cost / total * 100 : 0;
      return `${CHART_COLORS[index % CHART_COLORS.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    });
    $('#donutChart').style.background = segments.length ? `conic-gradient(${segments.join(',')})` : '#2b3028';
    $('#donutTotal').textContent = formatMoney(total);
    $('#chartLegend').innerHTML = groups.map((item, index) => `<div class="legend-item"><i class="legend-color" style="background:${CHART_COLORS[index % CHART_COLORS.length]}"></i><span>${escapeHTML(item.platform)}</span><strong>${total ? Math.round(item.cost / total * 100) : 0}%</strong></div>`).join('') || '<div class="empty-mini">暂无支出数据</div>';

    const forecast = forecastNextYear();
    const max = Math.max(...forecast.map(item => item.total), 1);
    $('#barChart').innerHTML = forecast.map((item, index) => `<div class="bar-group" title="${item.date.getFullYear()} 年 ${item.date.getMonth() + 1} 月：${formatMoney(item.total)}"><span class="bar-value">${formatMoney(item.total)}</span><div class="bar${index === 0 ? ' current' : ''}" style="height:${Math.max(item.total / max * 145, item.total ? 5 : 2)}px"></div><span class="bar-label">${item.date.getMonth() + 1}月</span></div>`).join('');
    $('#yearProjectionBadge').textContent = `未来 12 个月 ${formatMoney(forecast.reduce((sum, item) => sum + item.total, 0))}`;

    const highest = groups[0]?.cost || 1;
    $('#platformRanking').innerHTML = groups.map((item, index) => {
      const subscription = subscriptions.find(sub => sub.platform === item.platform);
      return `<div class="ranking-row"><span class="ranking-index">${pad(index + 1)}</span><div class="ranking-provider">${providerLogo(subscription)}<span>${escapeHTML(item.platform)}</span></div><div class="ranking-track"><div class="ranking-fill" style="width:${item.cost / highest * 100}%;background:${CHART_COLORS[index % CHART_COLORS.length]}"></div></div><div class="ranking-cost"><strong>${formatMoney(item.cost)}</strong><span>每月折算</span></div></div>`;
    }).join('') || '<div class="empty-mini">添加有效订阅后即可查看平台支出排行。</div>';
  }

  function renderSettings() {
    $('#reminderDays').value = String(settings.reminderDays);
  }

  function renderAll() {
    renderOverview();
    renderAllSubscriptions();
    renderUsage();
    renderCalendar();
    renderAnalytics();
    renderSettings();
  }

  function setView(view) {
    if (!VIEW_NAMES[view]) return;
    currentView = view;
    $$('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
    $$('.nav-item[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('#breadcrumbCurrent').textContent = VIEW_NAMES[view];
    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'usage') renderUsage();
    if (view === 'calendar') renderCalendar();
    if (view === 'analytics') renderAnalytics();
  }

  function openSidebar() {
    $('#sidebar').classList.add('open');
    $('#sidebarScrim').classList.add('open');
  }

  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sidebarScrim').classList.remove('open');
  }

  function openSubscriptionModal(id = null) {
    const form = $('#subscriptionForm');
    form.reset();
    $('#subscriptionId').value = id || '';
    if (id) {
      const item = subscriptions.find(subscription => subscription.id === id);
      if (!item) return;
      $('#modalEyebrow').textContent = 'EDIT SUBSCRIPTION';
      $('#modalTitle').textContent = '编辑订阅';
      $('#saveSubscriptionBtn').textContent = '保存修改';
      $('#platformInput').value = item.platform;
      $('#planInput').value = item.plan;
      $('#amountInput').value = item.amount;
      $('#cycleInput').value = item.cycle;
      $('#renewalInput').value = item.renewal;
      $('#statusInput').value = item.status;
      $('#paymentInput').value = item.payment;
      $('#notesInput').value = item.notes;
      $('#autoRenewInput').checked = item.autoRenew;
    } else {
      $('#modalEyebrow').textContent = 'NEW SUBSCRIPTION';
      $('#modalTitle').textContent = '添加订阅';
      $('#saveSubscriptionBtn').textContent = '保存订阅';
      $('#platformInput').value = 'MiniMax';
      $('#cycleInput').value = 'monthly';
      $('#renewalInput').value = dateAfter(30);
      $('#statusInput').value = 'active';
      $('#autoRenewInput').checked = true;
    }
    $('#subscriptionModal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#platformInput').focus(), 50);
  }

  function closeSubscriptionModal() {
    $('#subscriptionModal').hidden = true;
    restoreBodyScroll();
  }

  function openDetail(id) {
    const item = subscriptions.find(subscription => subscription.id === id);
    if (!item) return;
    selectedId = id;
    const renewal = renewalMeta(item);
    $('#detailProvider').innerHTML = `${providerLogo(item, true)}<div><h2 id="detailTitle">${escapeHTML(item.platform)}</h2><p>${escapeHTML(item.plan)}</p></div>`;
    $('#detailContent').innerHTML = `
      <div class="detail-hero"><div><span>当前套餐费用</span><strong>${formatMoney(item.amount)} <small>/ ${CYCLE_NAMES[item.cycle]}</small></strong></div><span class="status-badge status-${item.status}">${STATUS_NAMES[item.status]}</span></div>
      <div class="detail-grid">
        <div class="detail-field"><span>下次续费</span><strong>${renewal.primary}</strong></div>
        <div class="detail-field"><span>时间状态</span><strong>${renewal.secondary}</strong></div>
        <div class="detail-field"><span>月均折算</span><strong>${item.status === 'active' ? formatMoney(monthlyCost(item)) : '不计入支出'}</strong></div>
        <div class="detail-field"><span>自动续费</span><strong>${item.autoRenew ? '已开启' : '已关闭'}</strong></div>
        <div class="detail-field"><span>计费周期</span><strong>${CYCLE_NAMES[item.cycle]}</strong></div>
        <div class="detail-field"><span>支付方式</span><strong>${escapeHTML(item.payment || '未记录')}</strong></div>
      </div>
      ${item.notes ? `<div class="detail-notes"><span>备注</span><p>${escapeHTML(item.notes)}</p></div>` : ''}
      <button class="detail-usage-link" data-view-usage="${escapeHTML(item.id)}"><span>${icon('gauge')}查看该订阅的额度用量</span>${icon('arrow')}</button>
      ${item.platform.toLowerCase().includes('minimax') ? '<a class="detail-link" href="https://platform.minimaxi.com/" target="_blank" rel="noopener noreferrer">打开 MiniMax 开放平台' + icon('external') + '</a>' : ''}`;
    $('#detailModal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeDetail() {
    $('#detailModal').hidden = true;
    selectedId = null;
    restoreBodyScroll();
  }

  function restoreBodyScroll() {
    if ($('#subscriptionModal').hidden && $('#detailModal').hidden && $('#manualUsageModal').hidden && $('#confirmModal').hidden) document.body.style.overflow = '';
  }

  function showConfirm(title, text, actionLabel, callback) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmAction').textContent = actionLabel;
    confirmCallback = callback;
    $('#confirmModal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeConfirm() {
    $('#confirmModal').hidden = true;
    confirmCallback = null;
    restoreBodyScroll();
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = icon(type === 'success' ? 'check' : 'info');
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);
    $('#toastRegion').appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  async function loadConnectorCapabilities() {
    try {
      const response = await fetch('/api/capabilities', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('capabilities unavailable');
      const data = await response.json();
      connectorState = { available: true, providers: data.providers || {} };
    } catch {
      connectorState = { available: false, providers: {} };
    }
    renderUsage();
  }

  async function syncOfficialUsage(id, quiet = false) {
    const item = subscriptions.find(subscription => subscription.id === id);
    if (!item) return false;
    const provider = platformKey(item.platform);
    if (!USAGE_CAPABILITIES[provider]?.direct) {
      showToast('该平台没有已接入的官方额度查询接口', 'info');
      return false;
    }
    syncingIds.add(id);
    if (item.usage) item.usage.error = '';
    renderUsage();
    try {
      const response = await fetch(`/api/usage/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ region: item.usageRegion || 'cn' }),
        signal: AbortSignal.timeout(20000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `查询失败（HTTP ${response.status}）`);
      const usage = normalizeUsage(data.usage);
      if (!usage?.metrics?.length) throw new Error('官方接口没有返回可展示的用量数据');
      usage.source = 'official';
      usage.error = '';
      item.usage = usage;
      saveSubscriptions();
      if (!quiet) showToast(`${item.platform} 官方用量已更新`);
      return true;
    } catch (error) {
      const message = error.name === 'TimeoutError' ? '查询超时，请检查网络后重试' : error.message;
      item.usage = { ...(item.usage || normalizeUsage({ source: 'empty', metrics: [] })), error: String(message).slice(0, 240) };
      if (!quiet) showToast(`${item.platform} 同步失败：${message}`, 'info');
      return false;
    } finally {
      syncingIds.delete(id);
      renderUsage();
      renderOverview();
    }
  }

  function openManualUsageModal(id) {
    const item = subscriptions.find(subscription => subscription.id === id);
    if (!item) return;
    selectedId = id;
    const metric = item.usage?.metrics?.find(entry => entry.kind === 'quota');
    $('#manualUsageForm').reset();
    $('#manualUsageId').value = id;
    $('#manualUsageProvider').innerHTML = `${providerLogo(item)}<div><strong>${escapeHTML(item.platform)}</strong><span>${escapeHTML(item.plan)}</span></div>`;
    $('#manualUsageLabel').value = metric?.label || `${item.platform} 周期额度`;
    $('#manualUsageTotal').value = metric?.total ?? 100000;
    $('#manualUsageUsed').value = metric?.used ?? 0;
    $('#manualUsageUnit').value = ['tokens', '次', '条', 'credits', '%'].includes(metric?.unit) ? metric.unit : 'tokens';
    if (metric?.resetAt) {
      const reset = new Date(metric.resetAt);
      $('#manualUsageReset').value = Number.isNaN(reset.getTime()) ? '' : toDateKey(reset);
    }
    $('#manualUsageModal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#manualUsageLabel').focus(), 50);
  }

  function closeManualUsageModal() {
    $('#manualUsageModal').hidden = true;
    selectedId = null;
    restoreBodyScroll();
  }

  function exportData() {
    const payload = { app: 'Subwise', version: 1, exportedAt: new Date().toISOString(), subscriptions, settings };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `subwise-backup-${toDateKey(startOfToday())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('备份文件已导出');
  }

  async function importData(file) {
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('备份文件不能超过 2 MB');
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : parsed.subscriptions;
      if (!Array.isArray(list)) throw new Error('文件中没有订阅数据');
      const normalized = list.map(normalizeSubscription);
      subscriptions = normalized;
      if (!Array.isArray(parsed) && parsed.settings && [3, 7, 14, 30].includes(Number(parsed.settings.reminderDays))) {
        settings.reminderDays = Number(parsed.settings.reminderDays);
        saveSettings();
      }
      saveSubscriptions();
      renderAll();
      showToast(`已恢复 ${normalized.length} 条订阅记录`);
    } catch (error) {
      showToast(`导入失败：${error.message}`, 'info');
    } finally {
      $('#importFile').value = '';
    }
  }

  function bindEvents() {
    $$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    $$('[data-go]').forEach(button => button.addEventListener('click', () => setView(button.dataset.go)));
    $$('[data-add]').forEach(button => button.addEventListener('click', () => openSubscriptionModal()));
    $('#addSubscriptionBtn').addEventListener('click', () => openSubscriptionModal());
    $('#menuBtn').addEventListener('click', openSidebar);
    $('#sidebarScrim').addEventListener('click', closeSidebar);
    $('#notificationBtn').addEventListener('click', () => {
      const count = upcomingSubscriptions(Number(settings.reminderDays)).length;
      setView('calendar');
      showToast(count ? `有 ${count} 笔订阅将在 ${settings.reminderDays} 天内续费` : `${settings.reminderDays} 天内没有续费项目`, 'info');
    });

    $('#overviewSubscriptions').addEventListener('click', event => {
      const item = event.target.closest('[data-id]');
      if (item) openDetail(item.dataset.id);
    });
    $('#overviewSubscriptions').addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        const item = event.target.closest('[data-id]');
        if (item) { event.preventDefault(); openDetail(item.dataset.id); }
      }
    });
    document.addEventListener('click', event => {
      const trigger = event.target.closest('[data-open-detail]');
      if (trigger) openDetail(trigger.dataset.openDetail);
      const usageTrigger = event.target.closest('[data-view-usage]');
      if (usageTrigger) {
        const id = usageTrigger.dataset.viewUsage;
        closeDetail();
        setView('usage');
        setTimeout(() => document.querySelector(`[data-usage-card="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      }
    });

    $('#searchInput').addEventListener('input', event => { currentSearch = event.target.value; renderAllSubscriptions(); });
    $('#sortSelect').addEventListener('change', event => { currentSort = event.target.value; renderAllSubscriptions(); });
    $('#statusFilters').addEventListener('click', event => {
      const button = event.target.closest('[data-status]');
      if (!button) return;
      currentStatus = button.dataset.status;
      $$('#statusFilters button').forEach(item => item.classList.toggle('active', item === button));
      renderAllSubscriptions();
    });
    $('#clearFilters').addEventListener('click', () => {
      currentSearch = '';
      currentStatus = 'all';
      $('#searchInput').value = '';
      $$('#statusFilters button').forEach(button => button.classList.toggle('active', button.dataset.status === 'all'));
      renderAllSubscriptions();
    });

    $('#usageGrid').addEventListener('click', event => {
      const syncButton = event.target.closest('[data-sync-usage]');
      if (syncButton) syncOfficialUsage(syncButton.dataset.syncUsage);
      const manualButton = event.target.closest('[data-manual-usage]');
      if (manualButton) openManualUsageModal(manualButton.dataset.manualUsage);
    });
    $('#usageGrid').addEventListener('change', event => {
      const select = event.target.closest('[data-usage-region]');
      if (!select) return;
      const item = subscriptions.find(subscription => subscription.id === select.dataset.usageRegion);
      if (item) {
        item.usageRegion = select.value === 'global' ? 'global' : 'cn';
        saveSubscriptions();
        showToast(`MiniMax 已切换为${item.usageRegion === 'global' ? '国际站' : '国内站'}`);
      }
    });
    $('#syncAllUsageBtn').addEventListener('click', async () => {
      const items = subscriptions.filter(item => USAGE_CAPABILITIES[platformKey(item.platform)]?.direct);
      if (!items.length) { showToast('没有支持官方同步的订阅', 'info'); return; }
      const button = $('#syncAllUsageBtn');
      button.disabled = true;
      button.classList.add('loading');
      let succeeded = 0;
      for (const item of items) {
        if (await syncOfficialUsage(item.id, true)) succeeded += 1;
      }
      button.disabled = false;
      button.classList.remove('loading');
      showToast(`同步完成：${succeeded} 成功，${items.length - succeeded} 失败`, succeeded === items.length ? 'success' : 'info');
    });

    $('#prevMonth').addEventListener('click', () => { calendarDate = addMonths(calendarDate, -1); renderCalendar(); });
    $('#nextMonth').addEventListener('click', () => { calendarDate = addMonths(calendarDate, 1); renderCalendar(); });

    $$('[data-close-modal]').forEach(button => button.addEventListener('click', closeSubscriptionModal));
    $$('[data-close-detail]').forEach(button => button.addEventListener('click', closeDetail));
    $$('[data-close-manual]').forEach(button => button.addEventListener('click', closeManualUsageModal));
    $('#subscriptionModal').addEventListener('click', event => { if (event.target === $('#subscriptionModal')) closeSubscriptionModal(); });
    $('#detailModal').addEventListener('click', event => { if (event.target === $('#detailModal')) closeDetail(); });
    $('#manualUsageModal').addEventListener('click', event => { if (event.target === $('#manualUsageModal')) closeManualUsageModal(); });
    $('#confirmModal').addEventListener('click', event => { if (event.target === $('#confirmModal')) closeConfirm(); });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('#confirmModal').hidden) closeConfirm();
      else if (!$('#manualUsageModal').hidden) closeManualUsageModal();
      else if (!$('#subscriptionModal').hidden) closeSubscriptionModal();
      else if (!$('#detailModal').hidden) closeDetail();
      else closeSidebar();
    });

    $('#subscriptionForm').addEventListener('submit', event => {
      event.preventDefault();
      const id = $('#subscriptionId').value;
      const existing = id ? subscriptions.find(item => item.id === id) : null;
      const data = normalizeSubscription({
        id: id || `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        platform: $('#platformInput').value,
        plan: $('#planInput').value,
        amount: $('#amountInput').value,
        cycle: $('#cycleInput').value,
        renewal: $('#renewalInput').value,
        status: $('#statusInput').value,
        payment: $('#paymentInput').value,
        notes: $('#notesInput').value,
        autoRenew: $('#autoRenewInput').checked,
        usageRegion: existing?.usageRegion,
        usage: existing?.usage
      });
      if (id) {
        const index = subscriptions.findIndex(item => item.id === id);
        if (index !== -1) subscriptions[index] = data;
      } else {
        subscriptions.unshift(data);
      }
      saveSubscriptions();
      renderAll();
      closeSubscriptionModal();
      showToast(id ? '订阅修改已保存' : `已添加 ${data.platform} 订阅`);
    });

    $('#manualUsageForm').addEventListener('submit', event => {
      event.preventDefault();
      const id = $('#manualUsageId').value;
      const item = subscriptions.find(subscription => subscription.id === id);
      if (!item) return;
      const total = Number($('#manualUsageTotal').value);
      const used = Number($('#manualUsageUsed').value);
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used) || used < 0 || used > total) {
        showToast('已用量必须在 0 和总额度之间', 'info');
        return;
      }
      const resetValue = $('#manualUsageReset').value;
      const resetDate = resetValue ? parseDate(resetValue) : null;
      item.usage = normalizeUsage({
        source: 'manual',
        kind: 'quota',
        syncedAt: new Date().toISOString(),
        metrics: [{
          key: 'manual-snapshot',
          label: $('#manualUsageLabel').value,
          kind: 'quota',
          unit: $('#manualUsageUnit').value,
          total,
          used,
          remaining: Math.max(0, total - used),
          resetAt: resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate.toISOString() : null,
          description: '用户手动记录'
        }],
        error: ''
      });
      saveSubscriptions();
      renderAll();
      closeManualUsageModal();
      showToast('手动用量快照已保存');
    });

    $('#editSubscriptionBtn').addEventListener('click', () => {
      const id = selectedId;
      closeDetail();
      openSubscriptionModal(id);
    });
    $('#deleteSubscriptionBtn').addEventListener('click', () => {
      const item = subscriptions.find(subscription => subscription.id === selectedId);
      if (!item) return;
      const id = item.id;
      showConfirm('删除这条订阅？', `${item.platform} · ${item.plan} 将从本机记录中移除，此操作无法撤销。`, '确认删除', () => {
        subscriptions = subscriptions.filter(subscription => subscription.id !== id);
        saveSubscriptions();
        renderAll();
        closeConfirm();
        closeDetail();
        showToast('订阅已删除');
      });
    });
    $('#confirmCancel').addEventListener('click', closeConfirm);
    $('#confirmAction').addEventListener('click', () => { if (confirmCallback) confirmCallback(); });

    $('#reminderDays').addEventListener('change', event => {
      settings.reminderDays = Number(event.target.value);
      saveSettings();
      renderOverview();
      showToast(`已设置为提前 ${settings.reminderDays} 天提醒`);
    });
    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', event => { if (event.target.files[0]) importData(event.target.files[0]); });
    $('#resetBtn').addEventListener('click', () => {
      showConfirm('恢复示例数据？', '当前所有订阅修改都会被示例数据替换。建议先导出 JSON 备份。', '确认重置', () => {
        subscriptions = createDemoSubscriptions();
        saveSubscriptions();
        renderAll();
        closeConfirm();
        showToast('已恢复示例数据');
      });
    });
  }

  function initialize() {
    $('#todayLabel').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
    bindEvents();
    renderAll();
    const hashView = location.hash.replace('#', '');
    if (VIEW_NAMES[hashView]) setView(hashView);
    loadConnectorCapabilities();
  }

  initialize();
})();
