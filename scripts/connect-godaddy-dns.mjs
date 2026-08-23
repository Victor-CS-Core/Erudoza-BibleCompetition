#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DOMAIN = "erudoza.com";
const GODADDY_API = "https://api.godaddy.com";
const TTL = 600;

// Returned by OpenAI Sites when the apex and www custom domains were attached.
// Keep these values in sync with docs/operations/custom-domain.md if either
// custom domain is detached and re-created.
export const DESIRED_RECORDS = [
  {
    type: "A",
    name: "@",
    values: ["162.159.143.30", "172.66.3.26"],
  },
  {
    type: "TXT",
    name: "_openai-site-verification",
    values: [
      "openai-site-verification=Yf2lnZm49UIO94zqygFMyFdEkC7bQp301uhg9I22OK4",
    ],
  },
  {
    type: "TXT",
    name: "_cf-custom-hostname",
    values: ["5115613d-519c-458a-96be-a33ae7d446b4"],
  },
  {
    type: "CNAME",
    name: "www",
    values: ["custom-domains.chatgpt.site."],
  },
  {
    type: "TXT",
    name: "_openai-site-verification.www",
    values: [
      "openai-site-verification=qL1d-4PCxVfUGM66OsT3QhLNY0VthRc9a-COWDZ3Uuc",
    ],
  },
  {
    type: "TXT",
    name: "_cf-custom-hostname.www",
    values: ["1198484f-1629-41c7-a83d-e0357c675404"],
  },
];

export function replacementPayload(values) {
  return values.map((data) => ({ data, ttl: TTL }));
}

function normalizedValue(value) {
  return String(value).replace(/\.$/, "").toLocaleLowerCase("en-US");
}

export function recordsMatch(current, desired) {
  const currentValues = new Set(current.map((record) => normalizedValue(record.data ?? "")));
  const desiredValues = new Set(desired.map(normalizedValue));
  return (
    currentValues.size === desiredValues.size &&
    [...desiredValues].every((value) => currentValues.has(value))
  );
}

function goDaddyHeaders() {
  const key = process.env.GODADDY_API_KEY?.trim();
  const secret = process.env.GODADDY_API_SECRET?.trim();
  if (!key || !secret) {
    throw new Error(
      "Set GODADDY_API_KEY and GODADDY_API_SECRET from https://developer.godaddy.com/keys. " +
        "Do not use the GoDaddy account password.",
    );
  }
  return {
    Authorization: `sso-key ${key}:${secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function recordUrl(type, name) {
  return `${GODADDY_API}/v1/domains/${DOMAIN}/records/${encodeURIComponent(type)}/${encodeURIComponent(name)}`;
}

async function requestJson(method, url, headers, body) {
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${url} failed (${response.status}): ${raw.slice(0, 800)}`);
  }
  return raw ? JSON.parse(raw) : null;
}

function printDesiredRecords() {
  console.log("OpenAI Sites DNS record sets for erudoza.com:");
  for (const record of DESIRED_RECORDS) {
    console.log(`  ${record.type} ${record.name} -> ${record.values.join(", ")}`);
  }
}

export async function main(args = process.argv.slice(2)) {
  const apply = args.includes("--apply");
  const unknown = args.filter((arg) => arg !== "--apply");
  if (unknown.length) {
    throw new Error(`Unknown argument: ${unknown[0]}`);
  }

  printDesiredRecords();
  if (!apply) {
    console.log("Dry run only. Re-run with --apply after reviewing the record set.");
    return;
  }

  const headers = goDaddyHeaders();
  for (const record of DESIRED_RECORDS) {
    const url = recordUrl(record.type, record.name);
    const current = await requestJson("GET", url, headers);
    if (recordsMatch(current ?? [], record.values)) {
      console.log(`  unchanged ${record.type} ${record.name}`);
      continue;
    }

    await requestJson("PUT", url, headers, replacementPayload(record.values));
    console.log(`  wrote ${record.type} ${record.name}`);
  }

  console.log("DNS written. OpenAI Sites will verify ownership and issue SSL after propagation.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
