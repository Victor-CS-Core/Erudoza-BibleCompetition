/** Compilation-only solo-round controls. This module is imported by Node test tooling, never the Worker entry. */
export function soloTestHooks(source: string, options: { clock?: boolean }): string {
  if (!options.clock) return source;
  // Virtual clock for the PbeSoloRound authority, mirroring test-room-hooks:
  // Date.now() inside the authority reads a fixture_clock row that tests
  // advance explicitly with the x-test-solo-now header (monotonic only), so
  // response-window tests no longer sleep in real time. Alarms are recorded
  // virtually; lazy ingress checks (the paths the tests exercise) evaluate
  // them. The authority-replacement snippet is excluded from the rewrite so
  // its real, immediate alarm still fires for settle/recovery tests.
  const replacementMarker = "await this.ctx.storage.setAlarm(Date.now());}return json({status:'replacement-scheduled'});}";
  const parts = source.split(replacementMarker);
  const transform = (chunk: string) => chunk
    .replaceAll('this.ctx.storage.setAlarm(', 'this.testSetAlarm(')
    .replaceAll('Date.now()', 'this.testNow()');
  source = parts.map(transform).join(replacementMarker);
  const constructor = 'constructor(ctx:DurableObjectState,env:Env){super(ctx,env);';
  if (!source.includes(constructor)) throw new Error('Solo clock hook no longer matches the constructor.');
  source = source.replace(constructor, constructor + "ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_clock(id INTEGER PRIMARY KEY,now INTEGER NOT NULL,alarm INTEGER)');ctx.storage.sql.exec('INSERT OR IGNORE INTO fixture_clock(id,now,alarm) VALUES(1,?,NULL)',Date.now());");
  const ingress = '      const match=new URL(request.url).pathname.match(';
  if (!source.includes(ingress)) throw new Error('Solo clock hook no longer matches fetch ingress.');
  source = source.replace(ingress, "      const soloNowHeader=request.headers.get('x-test-solo-now');if(soloNowHeader!==null){const next=Number(soloNowHeader);if(!Number.isSafeInteger(next)||next<this.testNow())throw new HttpError(400,'Test clock must advance monotonically.');this.ctx.storage.sql.exec('UPDATE fixture_clock SET now=? WHERE id=1',next);}\n" + ingress);
  const methods = `
  private testNow():number{const row=this.ctx.storage.sql.exec<{now:number}>('SELECT now FROM fixture_clock WHERE id=1').toArray()[0];return row?row.now:Date.now();}
  private async testSetAlarm(at:number){this.ctx.storage.sql.exec('UPDATE fixture_clock SET alarm=? WHERE id=1',at);}
`;
  if (!source.includes('private readonly epoch=')) throw new Error('Solo clock hook no longer matches the epoch field.');
  return source.replace('private readonly epoch=', methods + '  private readonly epoch=');
}
