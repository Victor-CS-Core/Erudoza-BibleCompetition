# OpenAI generation and Scripture versions

Study games never call OpenAI. They build Missing Words, Verse Builder, Reference Match, What Comes Next, and True/False from stored verse text.

OpenAI is only used when a coach clicks **Generate candidates**. The model receives the already-stored verses for the season scope and must copy evidence text exactly. The validator rejects invented wording. Approve is the only path onto a student's deck, and the first card remains Missing Words.

Set `OPENAI_API_KEY` or `OpenAI__ApiKey` in the API environment. Leave `OpenAI__Enabled=true`. Tests keep the flag false so they stay on the local fallback.

## Public-domain catalog

Coaches can import World English Bible, KJV, ASV, and other public-domain English texts from [bible-api.com](https://bible-api.com/). The import becomes a versioned content pack. The season wizard already selects that pack.

This is the token-saving path: games and generation both read stored Scripture. The model does not write Bible text.

Do not import NIV, ESV, NLT, or other copyrighted translations. Those need a publisher license (for example API.Bible commercial terms). Erudoza will not scrape or bundle them.

## Season version

A season uses one content pack. To change translation, import another pack and point the season scope at it. Wording changes require a new pack version.
