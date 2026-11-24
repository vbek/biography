-- Run once on a database created before lat/lon were added (fresh installs get them from schema.sql):
--   npx wrangler d1 execute ask-log --remote --file=migrations/001-lat-lon.sql
ALTER TABLE questions ADD COLUMN lat REAL;
ALTER TABLE questions ADD COLUMN lon REAL;
ALTER TABLE visits ADD COLUMN lat REAL;
ALTER TABLE visits ADD COLUMN lon REAL;
