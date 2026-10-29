import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { cards, initialize, repository, refreshMock, deepseekFixture, minimaxFixture, probeHttps } from './core.mjs';

Notifications.setNotificationHandler({handleNotification: async () => ({shouldShowBanner:true, shouldShowList:true, shouldPlaySound:false, shouldSetBadge:false})});
type Repo = ReturnType<typeof repository>;
type Card = {key:string; title:string; value:string; percent:number | null; note:string};
const tabs = ['总览', '订阅', '用量', '我的'];
export default function App() {
  const [tab, setTab] = useState('总览');
  const [repo, setRepo] = useState<Repo | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('正在打开 SQLite');
  const [busy, setBusy] = useState(false);
  const [notificationId, setNotificationId] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    (async () => {
      const db = await SQLite.openDatabaseAsync('subwise-p03b.db');
      await initialize(db);
      const storage = repository(db);
      const saved = await storage.latest();
      if (!disposed) {setRepo(storage); setRows(saved); setStatus('SQLite 已打开 · 已读取本地记录');}
    })().catch(() => setStatus('SQLite 打开失败；未切换到内存假存储'));
    return () => { disposed = true; };
  }, []);
  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {setStatus(await action());} catch {setStatus('验证失败 · 已保留最后成功记录');} finally {setBusy(false);}
  }
  const button = (label: string, action: () => Promise<string>, disabled = false) => <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={() => run(action)} style={[styles.button, (busy || disabled) && {opacity:0.45}]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Subwise · {tab}</Text>
      <Text style={styles.note}>P03-B 技术探针 · 全部为模拟数据 · 非正式产品 UI</Text>
      <Text accessibilityLiveRegion="polite" testID="probe-status" style={styles.status}>{status}</Text>
      {(tab === '总览' || tab === '用量') && <>
        {rows.length === 0 && <Text style={styles.note}>本地暂无快照；点击写入模拟数据开始验证。</Text>}
        {cards(rows).map((card: Card) => <View key={card.key} style={styles.card}>
          <Text style={styles.heading}>{card.title}</Text><Text style={styles.value}>{card.value}</Text>
          {card.percent !== null && <View accessibilityLabel={`剩余 ${card.percent}%`} style={styles.track}><View style={[styles.fill, {width:`${card.percent}%` as `${number}%`}]} /></View>}
          <Text style={styles.note}>{card.note}</Text>
        </View>)}
        {button('写入模拟数据并从 SQLite 读取', async () => {
          if (!repo) throw new Error('not_ready');
          await refreshMock(repo, 'deepseek', deepseekFixture);
          setRows(await refreshMock(repo, 'minimax', minimaxFixture));
          return '模拟适配器 → SQLite → UI 完成；非平台同步';
        }, !repo)}
        {button('重新读取本地 SQLite（无需联网）', async () => {if (!repo) throw new Error(); setRows(await repo.latest()); return '已重新读取本地快照';}, !repo)}
        {button('模拟响应损坏（应保留快照）', async () => {if (!repo) throw new Error(); await refreshMock(repo, 'deepseek', {}); return '不应到达';}, !repo)}
      </>}
      {tab === '订阅' && <Text style={styles.note}>本轮仅验证导航；订阅增改归档属于后续阶段，未实现。</Text>}
      {tab === '我的' && <>
        {button('安全存储：测试标记写 / 读 / 删', async () => {
          if (Platform.OS === 'web') return 'NOT_RUN · Web 不代表系统安全存储';
          const key = 'subwise.p03b.synthetic'; const marker = 'PUBLIC_SYNTHETIC_NOT_A_KEY';
          try {
            await SecureStore.setItemAsync(key, marker, {keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
            if (await SecureStore.getItemAsync(key) !== marker) throw new Error();
          } finally {await SecureStore.deleteItemAsync(key);}
          if (await SecureStore.getItemAsync(key) !== null) throw new Error();
          return '安全存储写 / 读 / 删通过（仅测试标记）';
        })}
        {button('HTTPS 无凭据探针（预期 401）', async () => {const r = await probeHttps(); return `HTTPS HTTP ${r.status} · ${r.status === 401 ? '符合预期' : '与预期不同'} · 未认证`;})}
        {button('请求通知权限并安排 5 秒测试', async () => {
          if (Platform.OS === 'web') return 'NOT_RUN · Web 不代表原生通知';
          if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('p03b', {name:'P03-B 测试', importance:Notifications.AndroidImportance.DEFAULT});
          const permission = await Notifications.requestPermissionsAsync();
          if (!permission.granted) return '通知未获授权；本地数据仍可用';
          if (notificationId) await Notifications.cancelScheduledNotificationAsync(notificationId);
          const id = await Notifications.scheduleNotificationAsync({content:{title:'Subwise P03-B',body:'模拟本地通知；请人工确认实际送达'},trigger:{type:Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,seconds:5,channelId:'p03b'}});
          setNotificationId(id); return '调度 API 返回成功；实际送达仍需观察';
        })}
        {button('取消本轮测试通知', async () => {if (notificationId) {await Notifications.cancelScheduledNotificationAsync(notificationId); await Notifications.dismissNotificationAsync(notificationId); setNotificationId(null);} return '已清理本轮通知请求';})}
      </>}
    </ScrollView>
    <View style={styles.tabs}>{tabs.map(name => <Pressable key={name} accessibilityRole="tab" accessibilityState={{selected:tab === name}} onPress={() => setTab(name)} style={styles.tab}><Text style={{color:tab === name ? '#315DCC':'#182640'}}>{name}</Text></Pressable>)}</View>
  </View>;
}
const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#F6F8FC',paddingTop:48,paddingBottom:24},content:{padding:20,gap:16},title:{fontSize:26,fontWeight:'700',color:'#182640'},
  note:{fontSize:15,color:'#58657B',lineHeight:23},status:{fontSize:15,color:'#986017',lineHeight:23},card:{padding:18,backgroundColor:'#FFFFFF',borderRadius:16,gap:12,borderWidth:1,borderColor:'#DCE3EF'},
  heading:{fontSize:16,color:'#182640'},value:{fontSize:24,color:'#182640',fontVariant:['tabular-nums']},button:{minHeight:48,justifyContent:'center',padding:14,borderRadius:12,backgroundColor:'#315DCC'},buttonText:{color:'white',fontSize:16},
  track:{height:8,borderRadius:4,backgroundColor:'#E8EEFC'},fill:{height:8,borderRadius:4,backgroundColor:'#315DCC'},tabs:{flexDirection:'row',borderTopWidth:1,borderColor:'#DCE3EF'},tab:{flex:1,minHeight:48,alignItems:'center',justifyContent:'center'}
});
