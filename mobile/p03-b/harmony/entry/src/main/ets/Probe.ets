// Candidate API 12 source. Compilation and every device capability are NOT_RUN.
import { common } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';
import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { http } from '@kit.NetworkKit';
import { notificationManager } from '@kit.NotificationKit';

interface Wallet { currency: string; total_balance: string; }
interface DeepSeekFixture { is_available: boolean; balance_infos: Wallet[]; }
interface WindowFixture { pool: string; window: string; label: string; limit: number; remaining: number | null; }
interface MiniMaxFixture { contract: string; windows: WindowFixture[]; }
export class ProbeRow {
  id: string = '';
  title: string = '';
  value: string = '';
  source: string = 'mock';
}
export class Probe {
  private db: relationalStore.RdbStore | null = null;
  async open(context: common.UIAbilityContext): Promise<void> {
    this.db = await relationalStore.getRdbStore(context, {name:'subwise-p03b.db', securityLevel:relationalStore.SecurityLevel.S1});
    if (this.db.version > 1) throw new Error('unsupported_database_version');
    await this.db.executeSql('CREATE TABLE IF NOT EXISTS probe_rows(id TEXT PRIMARY KEY, title TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL)');
    this.db.version = 1;
  }
  async seed(context: common.UIAbilityContext): Promise<void> {
    if (!this.db) throw new Error('not_ready');
    const bytes = await context.resourceManager.getRawFileContent('fixtures.json');
    const text = new util.TextDecoder().decodeWithStream(bytes);
    const data = JSON.parse(text) as Fixtures;
    const rows: ProbeRow[] = [];
    if (typeof data.deepseek.is_available !== 'boolean' || data.minimax.contract !== 'subwise.synthetic.windows.v1') throw new Error('schema_error');
    data.deepseek.balance_infos.forEach((wallet: Wallet) => {
      if (!wallet.currency || !/^-?\d+(\.\d+)?$/.test(wallet.total_balance)) throw new Error('schema_error');
      const row = new ProbeRow(); row.id = 'deepseek-' + wallet.currency;
      row.title = 'DeepSeek · 模拟 API 余额'; row.value = wallet.currency + ' ' + wallet.total_balance + (data.deepseek.is_available ? '' : ' · 余额不足以调用 API'); rows.push(row);
    });
    data.minimax.windows.forEach((item: WindowFixture) => {
      if (!Number.isSafeInteger(item.limit) || item.limit <= 0 || (item.remaining !== null && (!Number.isSafeInteger(item.remaining) || item.remaining < 0))) throw new Error('schema_error');
      const row = new ProbeRow(); row.id = 'minimax-' + item.pool + '-' + item.window;
      row.title = 'MiniMax · ' + item.label; row.value = item.remaining === null ? '剩余额度未知' : '剩余 ' + item.remaining + ' / ' + item.limit; rows.push(row);
    });
    this.db.beginTransaction();
    try {
      for (const row of rows) await this.db.executeSql('INSERT OR REPLACE INTO probe_rows(id,title,value,source) VALUES(?,?,?,?)', [row.id,row.title,row.value,row.source]);
      this.db.commit();
    } catch (error) {this.db.rollBack(); throw error;}
  }
  async read(): Promise<ProbeRow[]> {
    if (!this.db) throw new Error('not_ready');
    const result = await this.db.querySql('SELECT id,title,value,source FROM probe_rows ORDER BY id');
    const rows: ProbeRow[] = [];
    try {while (result.goToNextRow()) {
      const row = new ProbeRow(); row.id=result.getString(0); row.title=result.getString(1); row.value=result.getString(2); row.source=result.getString(3); rows.push(row);
    }} finally {result.close();}
    return rows;
  }
  async secureProbe(): Promise<string> {
    const encoder = new util.TextEncoder();
    const alias = encoder.encodeInto('subwise.p03b.synthetic');
    const marker = encoder.encodeInto('PUBLIC_SYNTHETIC_NOT_A_KEY');
    const query: asset.AssetMap = { [asset.Tag.ALIAS]: alias };
    // Remove only this test alias; never enumerate user assets.
    try {
      await asset.add({[asset.Tag.ALIAS]:alias,[asset.Tag.SECRET]:marker,[asset.Tag.ACCESSIBILITY]:asset.Accessibility.DEVICE_UNLOCKED,[asset.Tag.SYNC_TYPE]:asset.SyncType.NEVER});
      const found = await asset.query({[asset.Tag.ALIAS]:alias,[asset.Tag.RETURN_TYPE]:asset.ReturnType.ALL});
      if (found.length !== 1) throw new Error('secure_read_failed');
      const secret = found[0][asset.Tag.SECRET] as Uint8Array;
      if (new util.TextDecoder().decodeWithStream(secret) !== 'PUBLIC_SYNTHETIC_NOT_A_KEY') throw new Error('secure_read_failed');
    } finally {await asset.remove(query);}
    const remaining = await asset.query({[asset.Tag.ALIAS]:alias,[asset.Tag.RETURN_TYPE]:asset.ReturnType.ATTRIBUTES});
    if (remaining.length !== 0) throw new Error('secure_delete_failed');
    return '测试标记写读删完成';
  }
  async httpsProbe(): Promise<string> {
    const request = http.createHttp();
    try {
      const response = await request.request('https://api.deepseek.com/user/balance', {method:http.RequestMethod.GET,connectTimeout:8000,readTimeout:8000});
      return '无凭据 HTTPS 状态 ' + response.responseCode + '（预期401）';
    } finally {request.destroy();}
  }
  async notify(context: common.UIAbilityContext): Promise<string> {
    await notificationManager.requestEnableNotification(context);
    await notificationManager.publish({id:303, content:{notificationContentType:notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,normal:{title:'Subwise P03-B',text:'模拟通知；请人工确认送达'}}});
    return '通知 API 返回；送达需人工观察';
  }
}
interface Fixtures { deepseek: DeepSeekFixture; minimax: MiniMaxFixture; }
