import {spawnSync} from 'node:child_process';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const cwd=resolve(root,'mobile/p03-b/rn');
const evidence=resolve(root,'docs/mobile/p03-b/evidence');
mkdirSync(evidence,{recursive:true});
const groups={
  basic:[['typecheck','npm run check'],['tests','npm test'],['dependencies','npm ls --depth=0 --json'],['expo-compatibility','npx expo install --check']],
  bundle:[['native-js-bundle','npx expo export --platform android --platform ios --output-dir dist-native'],['web-bundle','npx expo export --platform web --output-dir dist-web']],
  prebuild:[['android-prebuild','npx expo prebuild --platform android --no-install']],
  android:[['android-assemble','android\\gradlew.bat -p android assembleDebug --no-daemon --console plain']]
};
const group=process.argv[2] ?? 'basic';
if(!groups[group]) throw new Error('unknown group');
for(const [name,command] of groups[group]) {
  const startedAt=new Date().toISOString();
  const result=spawnSync('cmd.exe',['/d','/s','/c',command],{cwd,env:{...process.env,CI:'1',EXPO_NO_TELEMETRY:'1',ANDROID_HOME:'C:\\Users\\fengh\\AppData\\Local\\Android\\Sdk'},encoding:'utf8',timeout:group==='android'?240000:240000,maxBuffer:16*1024*1024});
  const log=(result.stdout??'')+(result.stderr??'');
  writeFileSync(resolve(evidence,name+'.log'),log);
  const summary={name,command,startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,error:result.error?.code??null,status:result.status===0?'PASS':'FAIL',log:name+'.log'};
  writeFileSync(resolve(evidence,name+'.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));
  if(result.status!==0) console.log(log.slice(-5000));
}
