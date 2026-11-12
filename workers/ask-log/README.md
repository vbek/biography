# ask-log Worker

Stores, in a D1 database, with the visitor's IP and Cloudflare's location guess:
- each question asked in the "Ask About Me" chat (sent by `ask/ask.js`)
- each visit to a tool or game: opened, whether they interacted, seconds in view (sent by `/track.js`)

## Setup / after changing schema.sql

```sh
cd workers/ask-log
npx wrangler login
npx wrangler d1 execute ask-log --remote --file=schema.sql   # safe to re-run
npx wrangler secret put ADMIN_KEY                            # first time only
npx wrangler deploy
```

## Viewing

- Questions: `https://bibek-koirala.com.np/api/ask-log?key=ADMIN_KEY`
- Tool & game visits: `...&view=visits`
- Per-app summary (opens, used, unique IPs, avg time): `...&view=apps`
- `&format=json` for raw data, `&limit=1000` for more rows
- Or run SQL in the Cloudflare dashboard: Storage & Databases → D1 → ask-log → Console.

Location comes from Cloudflare's IP lookup: usually right about the country, rough about the city, and VPN users show up as the VPN.
Entries older than `RETENTION_DAYS` (180) are deleted daily.
