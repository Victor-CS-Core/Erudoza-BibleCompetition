# Firebase boundary for Erudoza

Firebase Hosting is retired for this application. Do not run a Firebase Hosting deployment or attach `erudoza.com` to a new Firebase Hosting release.

The Firebase project alias remains `erudoza` because Firebase is reserved for the future storage layer. Storage rules, collections, import jobs, and the production data contract must be designed and reviewed before any Firebase data is uploaded or mutated.

The public SPA and `erudoza.com` are hosted through OpenAI Sites. The .NET API is not part of Firebase Hosting and remains a separate development service until a production API or Firebase-backed replacement is connected.

The supplied NKJV JSON is private local source material. Its metadata prohibits redistribution without permission, so it must not be placed in public Hosting assets or uploaded to Firebase as part of the hosting migration.
