// @vitest-environment node
import { expect,it } from "vitest";
import { createNativeTestApp,TEST_ORG } from "./test-runtime";
import { Store } from "./store";
import type { D1Database } from "@cloudflare/workers-types";
it("rejects simultaneous stale writes without losing the first committed value",async()=>{
  const app=await createNativeTestApp();
  try {
    const store=new Store(app.db as unknown as D1Database);
    await store.insert("test","one",TEST_ORG,{count:0});
    const results=await Promise.allSettled([store.put("test","one",TEST_ORG,{count:1},1),store.put("test","one",TEST_ORG,{count:2},1)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect((await store.get("test","one",TEST_ORG))?.revision).toBe(2);
    expect(await store.get("test","one","other-org")).toBeNull();
  } finally { await app.runtime.dispose(); }
});
