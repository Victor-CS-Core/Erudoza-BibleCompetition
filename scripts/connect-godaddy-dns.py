#!/usr/bin/env python3
"""Apply Firebase Hosting DNS for erudoza.com via the GoDaddy API.

Requires GODADDY_API_KEY and GODADDY_API_SECRET (developer keys, never the
account password) and a logged-in Firebase CLI session.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

DOMAIN = "erudoza.com"
FIREBASE_PROJECT = "erudoza"
FIREBASE_SITE = "erudoza"
GODADDY_API = "https://api.godaddy.com"
TTL = 600


def firebase_token() -> str:
    cfg_path = Path.home() / ".config/configstore/firebase-tools.json"
    cfg = json.loads(cfg_path.read_text())
    token = (cfg.get("tokens") or {}).get("access_token")
    if not token:
        raise SystemExit("Firebase CLI is not logged in. Run: npx firebase-tools login --no-localhost")
    return token


def http_json(method: str, url: str, headers: dict[str, str], body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode() or "null"
            return response.status, json.loads(raw)
    except urllib.error.HTTPError as error:
        detail = error.read().decode()
        raise SystemExit(f"{method} {url} failed ({error.code}): {detail[:800]}") from error


def firebase_custom_domains(token: str) -> list[dict]:
    url = (
        "https://firebasehosting.googleapis.com/v1beta1/"
        f"projects/{FIREBASE_PROJECT}/sites/{FIREBASE_SITE}/customDomains"
    )
    _, body = http_json("GET", url, {"Authorization": f"Bearer {token}"})
    return body.get("customDomains") or []


def godaddy_headers() -> dict[str, str]:
    key = os.environ.get("GODADDY_API_KEY", "").strip()
    secret = os.environ.get("GODADDY_API_SECRET", "").strip()
    if not key or not secret:
        raise SystemExit(
            "Set GODADDY_API_KEY and GODADDY_API_SECRET from https://developer.godaddy.com/keys. "
            "Do not use the GoDaddy account password."
        )
    return {
        "Authorization": f"sso-key {key}:{secret}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def godaddy_name(fqdn: str) -> str:
    if fqdn == DOMAIN:
        return "@"
    suffix = f".{DOMAIN}"
    if fqdn.endswith(suffix):
        return fqdn[: -len(suffix)]
    raise SystemExit(f"Unexpected hostname outside {DOMAIN}: {fqdn}")


def collect_puts(domains: list[dict]) -> dict[tuple[str, str], list[dict]]:
    """Group Firebase desired records into GoDaddy PUT payloads keyed by (type, name)."""
    puts: dict[tuple[str, str], list[dict]] = {}

    def add(record_type: str, name: str, data: str) -> None:
        key = (record_type, name)
        payload = {"data": data, "ttl": TTL}
        existing = puts.setdefault(key, [])
        if payload not in existing:
            existing.append(payload)

    for custom in domains:
        updates = custom.get("requiredDnsUpdates") or {}
        for record_set in updates.get("desired") or []:
            for record in record_set.get("records") or []:
                add(record["type"], godaddy_name(record["domainName"]), record["rdata"])
        cert_dns = ((custom.get("cert") or {}).get("verification") or {}).get("dns") or {}
        for record_set in cert_dns.get("desired") or []:
            for record in record_set.get("records") or []:
                add(record["type"], godaddy_name(record["domainName"]), record["rdata"])
    return puts


def main() -> int:
    token = firebase_token()
    domains = firebase_custom_domains(token)
    if not domains:
        raise SystemExit("No Firebase custom domains are attached to site erudoza.")

    puts = collect_puts(domains)
    print("Firebase custom domains:")
    for custom in domains:
        host = custom["name"].split("/")[-1]
        print(
            f"  {host}: host={custom.get('hostState')} "
            f"ownership={custom.get('ownershipState')} "
            f"redirect={custom.get('redirectTarget') or '-'}"
        )

    print("GoDaddy replacements (type name -> data):")
    for (record_type, name), records in sorted(puts.items()):
        values = ", ".join(item["data"] for item in records)
        print(f"  {record_type} {name} -> {values}")

    headers = godaddy_headers()
    for (record_type, name), records in sorted(puts.items()):
        url = f"{GODADDY_API}/v1/domains/{DOMAIN}/records/{record_type}/{name}"
        status, _ = http_json("PUT", url, headers, records)
        print(f"  wrote {record_type} {name} ({status})")

    print("DNS written. Firebase will verify ownership and issue SSL after propagation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
