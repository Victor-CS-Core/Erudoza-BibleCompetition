# Connecting erudoza.com

Do not share a GoDaddy username or password with the implementation agent.

Host the public SPA on Firebase Spark. See `docs/operations/firebase-host.md`. Do not point the domain at a paid Azure App Service.

## Required records (once Firebase Hosting is live)

In the Firebase Hosting console, add `erudoza.com` and `www.erudoza.com`, then at GoDaddy DNS enter the A and CNAME records Firebase displays.

The SPA `PUBLIC_ORIGIN` / `VITE_PUBLIC_ORIGIN` must be `https://erudoza.com`.

## Safer credential path

1. Add `OPENAI_API_KEY` as an environment secret only if generation jobs will run on a later API host. Study and simulation work without OpenAI.
2. If DNS should be automated later, create GoDaddy API keys at https://developer.godaddy.com and store `GODADDY_API_KEY` / `GODADDY_API_SECRET`. Do not use the account password.
3. Authenticate the Firebase CLI (`npx firebase-tools login --no-localhost`) to deploy Hosting.
4. After the Hosting site exists, attach the domain in Firebase and set `PUBLIC_ORIGIN=https://erudoza.com`.
