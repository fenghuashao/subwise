import {createWriteStream,readFileSync,mkdirSync,renameSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
const [url,destination,algorithm,expected]=process.argv.slice(2);
if(!url?.startsWith('https://') || !destination)throw new Error('HTTPS URL and destination required');
mkdirSync(dirname(destination),{recursive:true});
for(let attempt=1;attempt<=3;attempt++) {
  try {
    const r=await fetch(url,{signal:AbortSignal.timeout(600000)});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(r.body),createWriteStream(destination+'.partial'));
    const bytes=readFileSync(destination+'.partial');
    const sha256=createHash('sha256').update(bytes).digest('hex');
    if(expected && createHash(algorithm).update(bytes).digest('hex')!==expected.trim())throw new Error('Checksum mismatch; do not extract');
    renameSync(destination+'.partial',destination);
    console.log(JSON.stringify({url,finalUrl:r.url,destination,sha256,officialChecksumVerified:!!expected,attempt}));
    break;
  } catch(error) {console.log(JSON.stringify({attempt,error:error.cause?.code??error.message}));if(attempt===3)throw error;}
}
