import process from 'node:process';
import {readFile,unlink} from 'node:fs/promises';
export default async function teardown(){
 const path=process.env.ERUDOZA_NATIVE_PID_FILE;if(!path)return;
 try{const pid=Number(await readFile(path,'utf8'));if(Number.isSafeInteger(pid)&&pid>0)process.kill(pid,'SIGTERM');}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
 await unlink(path).catch(()=>{});
}
