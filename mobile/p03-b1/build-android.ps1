param(
  [string]$JdkHome = 'C:\Program Files\Java\jdk-17',
  [int]$ProxyPort = 7897,
  [string]$Architecture = 'x86_64',
  [string]$EvidenceName = 'android-reproduce'
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$androidRoot = Join-Path $taskRoot 'mobile/p03-b/rn/android'
$sdkRoot = Join-Path $taskRoot '.local/p03-b1/sdk'
$evidenceRoot = Join-Path $taskRoot 'docs/mobile/p03-b1/evidence'
if (!(Test-Path (Join-Path $JdkHome 'bin/java.exe'))) { throw 'BLOCKED: JDK missing' }
if (!(Test-Path (Join-Path $androidRoot 'gradlew.bat'))) { throw 'BLOCKED: run Expo Android prebuild first' }
if ($Architecture -notin @('x86_64','arm64-v8a')) { throw 'Use an explicitly supported test architecture' }
if ($EvidenceName -notmatch '^[a-z0-9-]+$') { throw 'Invalid evidence name' }
New-Item -ItemType Directory -Force $evidenceRoot | Out-Null
$previous = @{}
foreach($name in @('JAVA_HOME','GRADLE_USER_HOME','ANDROID_HOME','EXPO_NO_TELEMETRY','NODE_ENV')) { $previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
try {
  $env:JAVA_HOME=$JdkHome
  $env:GRADLE_USER_HOME=Join-Path $taskRoot '.local/p03-b1/gradle'
  $env:ANDROID_HOME=$sdkRoot
  $env:EXPO_NO_TELEMETRY='1'
  $env:NODE_ENV='production'
  ('sdk.dir='+$sdkRoot.Replace('\','/')) | Set-Content (Join-Path $androidRoot 'local.properties')
  $gradleArgs=@('-p',$androidRoot,'assembleRelease',('-PreactNativeArchitectures='+$Architecture),'--no-daemon','--console','plain','--max-workers=4')
  if ($ProxyPort -gt 0) { $gradleArgs += @('-Dhttp.proxyHost=127.0.0.1',('-Dhttp.proxyPort='+$ProxyPort),'-Dhttps.proxyHost=127.0.0.1',('-Dhttps.proxyPort='+$ProxyPort)) }
  $started=(Get-Date).ToUniversalTime().ToString('o')
  & (Join-Path $androidRoot 'gradlew.bat') @gradleArgs 2>&1 | Tee-Object (Join-Path $evidenceRoot ($EvidenceName+'.log'))
  $code=$LASTEXITCODE
  [pscustomobject]@{startedAt=$started;finishedAt=(Get-Date).ToUniversalTime().ToString('o');exitCode=$code;status=if($code -eq 0){'PASS'}else{'FAIL'};architecture=$Architecture;variant='release';signing='Generated Expo test/debug certificate, NOT production distribution';proxyPort=$ProxyPort;scope='Process-local environment, workspace Gradle/SDK'} | ConvertTo-Json | Set-Content (Join-Path $evidenceRoot ($EvidenceName+'.json'))
  if ($code -ne 0) { throw ('Native build failed: '+$code) }
} finally { foreach($name in $previous.Keys){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')} }
