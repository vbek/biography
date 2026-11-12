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
