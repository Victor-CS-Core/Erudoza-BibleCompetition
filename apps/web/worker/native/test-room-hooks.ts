/** Compilation-only room controls. This module is imported by Node test tooling, never the Worker entry. */
export function roomTestHooks(source:string,options:{clock?:boolean;replace?:boolean;diagnostics?:boolean}):string {
 if(options.diagnostics){
  // Settle creation/anomaly outbox work inside the metered request in this test bundle.
  source=source.replaceAll('this.ctx.waitUntil(this.projectSafely());','await this.projectSafely();');
  source=source.replace('console.error("Practice command failed",error instanceof Error?error.name:"UnknownError")','console.error("Practice command failed",error instanceof Error?error.stack:String(error))');
  source=source.replace('super(ctx,meteredObjectEnv(env));',"super(ctx,meteredObjectEnv(env));ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_storage_measure(name TEXT PRIMARY KEY,value INTEGER NOT NULL)');");
  source=source.replaceAll('await target.fetch(new Request(', 'await this.testReportFetch(target,new Request(');
  source=source.replace(' private epoch=',`private async testReportFetch(target:DurableObjectStub,request:Request){const value=await request.clone().text(),path=new URL(request.url).pathname;for(const [name,size] of [[path+'-wire-bytes',new TextEncoder().encode(value).length],[path+'-nodes',JSON.parse(value).nodes?.length??0]] as const)this.ctx.storage.sql.exec('INSERT INTO fixture_storage_measure(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=max(value,excluded.value)',name,size);return target.fetch(request as never);}\n private epoch=`);
 }
 if(options.replace){
  const ingress='const now=Date.now();let r=await this.load();';
  if(!source.includes(ingress))throw new Error('Room replacement hook no longer matches.');
  source=source.replace(ingress,ingress+"if(request.headers.has('x-test-room-snapshot'))return json(r);if(request.headers.has('x-test-strip-attempt-ids')&&r){for(const s of r.submissions)delete s.attemptId;await this.save(r);return json(r);}if(request.headers.has('x-test-authority-replaced')&&r){r.epoch='fixture-replaced';await this.save(r);await this.ctx.storage.setAlarm(Date.now());return json({status:'replacement-scheduled',snapshotUtf8Bytes:new TextEncoder().encode(JSON.stringify(r)).length,questions:r.questions.length,reserves:r.reserves.length,roster:r.members.length});}"+(options.diagnostics?"if(request.headers.has('x-test-room-storage'))return json({revision:r?.revision,alarmAt:await this.ctx.storage.getAlarm(),uploaded:this.ctx.storage.sql.exec('SELECT count(*) AS rows FROM room_uploaded').one(),outboxRevision:JSON.parse(this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM outbox WHERE id=1').toArray()[0]?.data??'null')?.revision??null,components:this.ctx.storage.sql.exec('SELECT count(*) AS rows,max(length(CAST(data AS BLOB))) AS maxBytes,sum(length(CAST(data AS BLOB))) AS totalBytes FROM room_components').one(),state:this.ctx.storage.sql.exec('SELECT length(CAST(data AS BLOB)) AS bytes FROM state WHERE id=1').toArray()[0],outbox:this.ctx.storage.sql.exec('SELECT length(CAST(data AS BLOB)) AS bytes FROM outbox WHERE id=1').toArray()[0]??null,wire:this.ctx.storage.sql.exec('SELECT name,value FROM fixture_storage_measure ORDER BY name').toArray()});if(request.headers.has('x-test-remove-room-component')){const root=JSON.parse(this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM state WHERE id=1').one().data);this.ctx.storage.sql.exec('DELETE FROM room_components WHERE hash=?',root.questions[0].hash);return json({removed:root.questions[0].hash});}":""));
 }
 if(!options.clock)return source;
 const body='const ingress=Date.now();const sensitive=';
 if(!source.includes(body))throw new Error('Room clock hook no longer matches complete bounded body ingress.');
  source=source.replace(body,"if(request.headers.has('x-test-room-now')){const next=Number(request.headers.get('x-test-room-now'));if(!Number.isSafeInteger(next)||next<this.testNow()&&this.ctx.storage.sql.exec('SELECT 1 FROM state WHERE id=1').toArray().length)throw new HttpError(400,'Test clock must advance monotonically.');this.ctx.storage.sql.exec('UPDATE fixture_clock SET now=? WHERE id=1',next);}const ingress=Date.now();if(request.headers.has('x-test-room-alarm')){checkOrigin(request,this.env);await authenticate(request,this.env,match[1]);const due=await this.testGetAlarm();if(due===null||due>ingress)throw new HttpError(409,'Test alarm is not due.');await this.alarm();return json(await this.load());}const sensitive=");
 source=source.replaceAll('Date.now()','this.testNow()').replaceAll('this.ctx.storage.setAlarm(','this.testSetAlarm(').replaceAll('this.ctx.storage.getAlarm()','this.testGetAlarm()').replaceAll('this.ctx.storage.deleteAlarm()','this.testDeleteAlarm()');
 const constructor='super(ctx,meteredObjectEnv(env));';
 if(!source.includes(constructor))throw new Error('Room clock hook no longer matches constructor.');
 source=source.replace(constructor,constructor+"ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_clock(id INTEGER PRIMARY KEY,now INTEGER NOT NULL,alarm INTEGER)');ctx.storage.sql.exec('INSERT OR IGNORE INTO fixture_clock(id,now,alarm) VALUES(1,?,NULL)',Date.now());");
 const methods=`
 private testNow():number{return this.ctx.storage.sql.exec<{now:number}>('SELECT now FROM fixture_clock WHERE id=1').one().now;}
 private async testSetAlarm(at:number){this.ctx.storage.sql.exec('UPDATE fixture_clock SET alarm=? WHERE id=1',at);}
 private async testGetAlarm():Promise<number|null>{return this.ctx.storage.sql.exec<{alarm:number|null}>('SELECT alarm FROM fixture_clock WHERE id=1').one().alarm;}
 private async testDeleteAlarm(){this.ctx.storage.sql.exec('UPDATE fixture_clock SET alarm=NULL WHERE id=1');}
 `;
 return source.replace(' private epoch=',methods+' private epoch=');
}
