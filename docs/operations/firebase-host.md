# Host Erudoza on Firebase Spark

Firebase Spark (no credit card) can host the public SPA and `erudoza.com`. It cannot run the .NET 10 API or Cloud Functions. Study, login, and coach tools still run locally against SQLite until a free API host exists.

Do not deploy the Azure App Service / Azure SQL stack. That path costs money.

## What Spark covers

- Firebase Hosting for `apps/web/dist` (10 GB storage, 10 GB/month transfer, custom domain + SSL)
- Landing page and signed-out marketing routes work on the CDN
- `/api` calls stay on the same origin locally; on Firebase they need `VITE_API_BASE_URL` if an API is added later

## Deploy

```bash
npm ci
npm run build:web
npx firebase-tools login --no-localhost
npx firebase-tools projects:create erudoza --display-name Erudoza
npx firebase-tools use erudoza
npx firebase-tools deploy --only hosting
```

If `erudoza` is taken, set the project id in `.firebaserc` and create that project instead.

Live Spark site: https://erudoza.web.app

Console: https://console.firebase.google.com/project/erudoza/overview

This project is `erudoza`. Do not deploy Erudoza into the Filosage Firebase project (`teachapp-d73c3`).

`erudoza.com` can be attached in the Firebase Hosting console when you are ready.

## Custom domain

In Firebase Hosting, add `erudoza.com` and `www.erudoza.com`. Use the A / CNAME records Firebase shows. Do not share a GoDaddy password.
