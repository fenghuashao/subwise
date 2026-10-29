// Execute on the Mac mini M4: node mobile/p03-b1/mac-verify.mjs
// Uses existing Xcode/Node/CocoaPods; never installs global tools or accepts licenses.
import {spawnSync} from 'node:child_process';
import {mkdirSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,basename} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const app=resolve(root,'mobile/p03-b/rn');
const out=resolve(root,'docs/mobile/p03-b1/evidence/mac');
mkdirSync(out,{recursive:true});
const results=[];
function run(name,command,args,cwd=app){
  const r=spawnSync(command,args,{cwd,encoding:'utf8',env:{...process.env,EXPO_NO_TELEMETRY:'1',CI:'1',NODE_ENV:'production'},maxBuffer:32*1024*1024});
  writeFileSync(resolve(out,name+'.log'),(r.stdout??'')+(r.stderr??''));
  results.push({name,command,args,exitCode:r.status,status:r.status===0?'PASS':'FAIL',at:new Date().toISOString()});
  writeFileSync(resolve(out,'commands.json'),JSON.stringify(results,null,2));
  if(r.status!==0)throw new Error(`${name} failed; see ${out}/${name}.log`);
  return r.stdout;
}
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('BLOCKED: run natively on macOS arm64, not Windows or Rosetta. No iOS result was generated.');
run('xcode-version','xcodebuild',['-version']);
run('xcode-path','xcode-select',['-p']);
run('xcode-first-launch-status','xcodebuild',['-checkFirstLaunchStatus']);
run('node-version','node',['--version']);
run('pod-version','pod',['--version']);
run('npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);
// Existing ios directory is never deleted. Use a fresh transfer if it contains unrelated work.
run('ios-prebuild','npx',['--no-install','expo','prebuild','--platform','ios','--no-install']);
run('pods','pod',['install'],resolve(app,'ios'));
const workspaces=readdirSync(resolve(app,'ios')).filter(n=>n.endsWith('.xcworkspace'));
if(workspaces.length!==1)throw new Error('BLOCKED: expected exactly one generated workspace');
const workspace=resolve(app,'ios',workspaces[0]);
const listing=JSON.parse(run('schemes','xcodebuild',['-list','-json','-workspace',workspace]));
const schemes=listing.workspace.schemes.filter(s=>!s.startsWith('Pods-'));
const inferredScheme=basename(workspace,'.xcworkspace');
const scheme=process.env.SUBWISE_SCHEME??(schemes.includes(inferredScheme)?inferredScheme:schemes.length===1?schemes[0]:null);
if(!scheme||!schemes.includes(scheme))throw new Error('BLOCKED: select SUBWISE_SCHEME from schemes.log');
const runtimes=JSON.parse(run('runtimes','xcrun',['simctl','list','runtimes','--json'])).runtimes.filter(r=>r.isAvailable&&r.identifier.includes('.iOS-'));
runtimes.sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
const types=JSON.parse(run('device-types','xcrun',['simctl','list','devicetypes','--json'])).devicetypes.filter(d=>d.name.startsWith('iPhone'));
const type=types.find(d=>d.name==='iPhone 16')??types.at(-1);
if(!runtimes.length||!type)throw new Error('BLOCKED: install a compatible iOS Simulator runtime in Xcode, then rerun');
const udid=run('create-simulator','xcrun',['simctl','create','Subwise-P03B1',type.identifier,runtimes[0].identifier]).trim();
writeFileSync(resolve(out,'simulator.json'),JSON.stringify({udid,device:type,runtime:runtimes[0]},null,2));
run('boot','xcrun',['simctl','boot',udid]);
run('bootstatus','xcrun',['simctl','bootstatus',udid,'-b']);
const derived=resolve(root,'.local/p03-b1/ios-derived');
run('ios-build','xcodebuild',['-workspace',workspace,'-scheme',scheme,'-configuration','Release','-sdk','iphonesimulator','-destination',`id=${udid}`,'-derivedDataPath',derived,'build']);
const products=resolve(derived,'Build/Products/Release-iphonesimulator');
const apps=readdirSync(products).filter(f=>f.endsWith('.app'));
if(apps.length!==1)throw new Error('BLOCKED: expected one .app product');
const product=resolve(products,apps[0]);
run('signature','codesign',['--verify','--deep','--strict','--verbose=2',product]);
run('install','xcrun',['simctl','install',udid,product]);
run('launch','xcrun',['simctl','launch',udid,'dev.subwise.p03b']);
run('show-simulator','open',['-a','Simulator','--args','-CurrentDeviceUDID',udid]);
const receipt={build:'PASS',install:'PASS',launchCommand:'PASS',nativeUiObserved:'NOT_RUN',sqlite:'NOT_RUN',secureStore:'NOT_RUN',https:'NOT_RUN',notifications:'NOT_RUN',relaunchPersistence:'NOT_RUN',physicalIPhone:'NOT_RUN',udid,product,scheme,at:new Date().toISOString()};
writeFileSync(resolve(out,'acceptance.json'),JSON.stringify(receipt,null,2));
console.log('Build/install commands passed. Native capability gate still NOT_RUN. Follow MAC-TASK.md; preserve screenshots and observations.');
