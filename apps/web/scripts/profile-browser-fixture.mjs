// Synthetic unlock records only for the isolated profile browser suite.
// Never imported by the Worker or a production bootstrap.
export async function seedProfileBrowserUnlocks(db,org){
 const user=await db.prepare("SELECT id FROM Users WHERE org_id=? AND user_name='admin@erudoza.local'").bind(org).first();
 for(const key of ['solo:exact-recall','solo:chapter-strong','team:first-fellowship']){
  const id=`${org}:${user.id}:mastery-v1:${key}`;
  const data={id,userId:user.id,key,ruleVersion:'mastery-v1',earnedAtUtc:'2026-09-13T00:00:00Z',seasonId:'profile-browser-fixture',evidence:{fixture:'isolated-browser-profile'}};
  await db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('mastery-honor',?,?,?,?)").bind(id,org,user.id,JSON.stringify(data)).run();
 }
}
