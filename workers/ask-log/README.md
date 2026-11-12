# ask-log Worker

Stores each question asked in the "Ask About Me" chat (from `ask/ask.js`), with the visitor's IP and Cloudflare's location guess, in a D1 database.

## One-time setup

```sh
cd workers/ask-log
npx wrangler login
npx wrangler d1 create ask-log          # copy the database_id it prints into wrangler.toml
npx wrangler d1 execute ask-log --remote --file=schema.sql
npx wrangler secret put ADMIN_KEY       # any long random string; this is your viewing password
npx wrangler deploy
```

## Viewing

- Table: `https://bibek-koirala.com.np/api/ask-log?key=YOUR_ADMIN_KEY`
- JSON: add `&format=json`; more rows: `&limit=1000`
- Or run SQL in the Cloudflare dashboard: Storage & Databases → D1 → ask-log → Console, e.g.
  `SELECT country, COUNT(*) FROM questions GROUP BY country ORDER BY 2 DESC;`
- Questions the bot couldn't answer: `SELECT ts, question FROM questions WHERE answer_kind = 'fallback' ORDER BY id DESC;`

Location comes from Cloudflare's IP lookup. It's usually right about the country and only roughly right about the city, and VPN users show up as the VPN's location.

Entries older than `RETENTION_DAYS` (180) are deleted every day.
