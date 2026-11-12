CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,            -- UTC, 'YYYY-MM-DD HH:MM:SS'
    question TEXT NOT NULL,
    answer_kind TEXT,            -- what the bot did: answer, list, say, fallback (= no answer found)
    answer_title TEXT,           -- title of the item it answered with, if any
    page TEXT,                   -- page the chat was opened on
    session TEXT,                -- random id per browser tab, groups one visitor's questions
    ip TEXT,
    country TEXT,
    region TEXT,
    city TEXT,
    timezone TEXT,
    asn INTEGER,
    as_org TEXT,                 -- network owner, e.g. the ISP or a university
    user_agent TEXT,
    referrer TEXT
);
CREATE INDEX IF NOT EXISTS questions_ip_ts ON questions (ip, ts);
CREATE INDEX IF NOT EXISTS questions_ts ON questions (ts);

CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit TEXT NOT NULL,         -- random id per page load
    ts TEXT NOT NULL,            -- opened, UTC
    last_ts TEXT,                -- last update (when they left or switched tabs)
    app TEXT NOT NULL,           -- e.g. tools/pdf-editor, games/ludo
    page TEXT,
    interacted INTEGER NOT NULL DEFAULT 0, -- 1 once they clicked, typed, dropped a file...
    seconds INTEGER NOT NULL DEFAULT 0,    -- time the tab was in view
    ip TEXT,
    country TEXT,
    region TEXT,
    city TEXT,
    timezone TEXT,
    asn INTEGER,
    as_org TEXT,
    user_agent TEXT,
    referrer TEXT
);
CREATE INDEX IF NOT EXISTS visits_visit ON visits (visit);
CREATE INDEX IF NOT EXISTS visits_ip_ts ON visits (ip, ts);
CREATE INDEX IF NOT EXISTS visits_app_ts ON visits (app, ts);
