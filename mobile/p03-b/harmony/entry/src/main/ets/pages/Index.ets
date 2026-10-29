import { common } from '@kit.AbilityKit';
import { notificationManager } from '@kit.NotificationKit';
import { Probe, ProbeRow } from '../Probe';
@Entry
@Component
struct Index {
  @State tab: string = '总览';
  @State message: string = 'P03-B 模拟探针 · 非正式产品 UI';
  @State rows: ProbeRow[] = [];
  @State busy: boolean = false;
  private probe: Probe = new Probe();
  aboutToAppear(): void { this.run(async () => {await this.probe.open(this.context()); this.rows=await this.probe.read(); return '已读取本地数据库';}); }
  private context(): common.UIAbilityContext {return this.getUIContext().getHostContext() as common.UIAbilityContext;}
  private async run(action: () => Promise<string>): Promise<void> {
    this.busy=true;
    try {this.message=await action();} catch {this.message='验证失败 / 权限拒绝；保留旧记录';} finally {this.busy=false;}
  }
  build() {
    Column({space:16}) {
      Text('Subwise · ' + this.tab).fontSize(26).fontColor('#182640')
      Text(this.message).fontSize(15).fontColor('#986017')
      Scroll() {
        Column({space:16}) {
          if (this.tab === '总览' || this.tab === '用量') {
            ForEach(this.rows, (row: ProbeRow) => {
              Column({space:12}) {Text(row.title).fontSize(16); Text(row.value).fontSize(24); Text('模拟数据 · 2026-10-29 固定 fixture').fontSize(15)}.padding(18).backgroundColor(Color.White).borderRadius(16).width('100%')
            }, (row: ProbeRow) => row.id)
            Button('写入模拟数据并重新读取').enabled(!this.busy).onClick(() => this.run(async () => {await this.probe.seed(this.context()); this.rows=await this.probe.read(); return '模拟适配器 → RDB → UI';}))
            Button('离线重新读取').enabled(!this.busy).onClick(() => this.run(async () => {this.rows=await this.probe.read(); return '已读取 SQLite';}))
          } else if (this.tab === '我的') {
            Button('安全存储测试标记写读删').enabled(!this.busy).onClick(() => this.run(() => this.probe.secureProbe()))
            Button('无凭据 HTTPS 探针').enabled(!this.busy).onClick(() => this.run(() => this.probe.httpsProbe()))
            Button('请求权限并发布测试通知').enabled(!this.busy).onClick(() => this.run(() => this.probe.notify(this.context())))
            Button('清除测试通知').enabled(!this.busy).onClick(() => this.run(async () => {await notificationManager.cancel(303); return '已清除测试通知';}))
          } else { Text('本轮仅验证导航；订阅业务留待后续阶段') }
        }.width('100%')
      }.layoutWeight(1)
      Row() {ForEach(['总览','订阅','用量','我的'], (name: string) => {Button(name).layoutWeight(1).height(48).onClick(() => {this.tab=name;})})}.width('100%')
    }.padding(20).width('100%').height('100%').backgroundColor('#F6F8FC')
  }
}
