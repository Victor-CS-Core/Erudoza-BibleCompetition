import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  DESIRED_RECORDS,
  recordsMatch,
  replacementPayload,
} from "./connect-godaddy-dns.mjs";

test("Sites records cover the apex, www, and validation", () => {
  const byKey = new Map(
    DESIRED_RECORDS.map((record) => [`${record.type} ${record.name}`, record.values]),
  );

  assert.deepEqual(byKey.get("A @"), ["162.159.143.30", "172.66.3.26"]);
  assert.deepEqual(byKey.get("CNAME www"), ["custom-domains.chatgpt.site."]);
  assert.ok(byKey.has("TXT _openai-site-verification"));
  assert.ok(byKey.has("TXT _cf-custom-hostname"));
  assert.ok(byKey.has("TXT _openai-site-verification.www"));
  assert.ok(byKey.has("TXT _cf-custom-hostname.www"));
});

test("replacement payload is scoped and uses the expected TTL", () => {
  assert.deepEqual(replacementPayload(["one", "two"]), [
    { data: "one", ttl: 600 },
    { data: "two", ttl: 600 },
  ]);
});

test("record matching ignores order and CNAME trailing dots", () => {
  assert.equal(
    recordsMatch(
      [
        { data: "172.66.3.26", ttl: 3600 },
        { data: "162.159.143.30", ttl: 600 },
      ],
      ["162.159.143.30", "172.66.3.26"],
    ),
    true,
  );
  assert.equal(
    recordsMatch(
      [{ data: "custom-domains.chatgpt.site", ttl: 600 }],
      ["custom-domains.chatgpt.site."],
    ),
    true,
  );
});

test("CLI defaults to a read-only dry run", () => {
  const output = execFileSync(process.execPath, ["scripts/connect-godaddy-dns.mjs"], {
    encoding: "utf8",
  });
  assert.match(output, /Dry run only/);
});
