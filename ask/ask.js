/* ============================================================
   Ask About Me: a small floating Q&A widget for this site.

   It answers only from ask/knowledge.json (built from the site by
   scripts/build-ask-index.mjs) plus a live read of data.json. Answers
   are sentences copied from that content, never generated text, and
   when nothing on the site matches, the bot says so. Questions never
   leave the browser.

   Include with: <script src="ask/ask.js" defer></script>
   (the stylesheet and data are found relative to this file)
   ============================================================ */
(function () {
    'use strict';

    // ---------------------------------------------------------------
    // Text processing
    // ---------------------------------------------------------------
    var STOP = new Set((
        'a an the is are was were be been being am do does did done doing have has had having ' +
        'i me my mine myself you your yours yourself he him his she her hers they them their theirs it its ' +
        'we us our this that these those of in on at to for from by with about as into onto over under than ' +
        'then so and or but if not no yes can could would should will shall may might must ' +
        'what which who whom whose when where why how tell know please give show say said there here ' +
        'any some much many more most also just very really ever currently current now ' +
        'bibek koirala bibeks im ive id ill youre hes shes whats wheres whos hows thats dont doesnt ' +
        'get got like want wanted need let lets one thing things kind sort something anything stuff ' +
        'hi hello hey thanks thank ok okay take took taken use used using'
    ).split(/\s+/));

    function fold(s) {
        return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/[’‘`]/g, "'");
    }

    function stem(w) {
        if (w.length <= 3) return w;
        if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
        if (/ied$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
        if (/sses$/.test(w)) return w.slice(0, -2);
        if (/ations?$/.test(w) && w.length > 7) return w.replace(/ations?$/, '');
        if (/tions?$/.test(w) && w.length > 6) return w.replace(/ions?$/, '');
        if (/ings?$/.test(w) && w.length > 5) return w.replace(/ings?$/, '');
        if (/ed$/.test(w) && w.length > 4) return w.slice(0, -2);
        if (/(ch|sh|x|z)es$/.test(w)) return w.slice(0, -2);
        if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
        return w;
    }

    // [{raw, stem}] for every word in the string
    function words(s) {
        var out = [];
        var m, re = /[a-z0-9]+(?:\+\+|#)?/g;
        var t = fold(s).replace(/'s\b/g, '').replace(/'/g, '');
        while ((m = re.exec(t))) {
            if (m[0].length < 2 && !/^\d$/.test(m[0])) continue;
            out.push({ raw: m[0], stem: stem(m[0]) });
        }
        return out;
    }

    function edit1(a, b) {
        // true when a and b differ by at most one edit (insert, delete, substitute or swap)
        if (a === b) return true;
        var la = a.length, lb = b.length;
        if (Math.abs(la - lb) > 1) return false;
        var i = 0;
        while (i < la && i < lb && a[i] === b[i]) i++;
        if (la === lb) {
            if (a.slice(i + 1) === b.slice(i + 1)) return true;
            return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
        }
        return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
    }

    // ---------------------------------------------------------------
    // Topics: map how people ask to the part of the site that answers
    // ---------------------------------------------------------------
    var TOPICS = {
        education:    { words: 'study studied studying studies school college university uni degree education educational master masters graduate graduating graduation gpa grade grades coursework course courses class classes major academic academics', sections: ['education'] },
        experience:   { words: 'work worked working job jobs career employment employed employer company companies experience experiences role roles position positions intern internship officer government govt professional assistantship', sections: ['experience'], list: true },
        publications: { words: 'paper papers publication publications publish published journal journals conference conferences article articles author authored citation citations proceedings', sections: ['publications'], list: true },
        projects:     { words: 'project projects portfolio build built made make making create created develop developed', sections: ['projects'], list: true },
        research:     { words: 'research researching researcher', ids: ['project-instance-level-bacteria*'], sections: ['projects', 'experience', 'publications'], weak: true },
        skills:       { words: 'skill skills skilled tech technology technologies stack language languages programming framework frameworks library libraries expertise proficient experienced familiar knowledge know', sections: ['skills'], list: true },
        contact:      { words: 'contact email mail reach hire hiring connect message touch phone call linkedin twitter instagram social socials github', sections: ['contact'] },
        news:         { words: 'news latest recent recently update updates announcement announcements happening', sections: ['news'], list: true },
        tools:        { words: 'tool tools app apps utility utilities', sections: ['tools'], list: true },
        games:        { words: 'game games gaming play playing', sections: ['games'], list: true },
        location:     { words: 'live living located location based city country hometown reside town', ids: ['resume-location', 'exp-nepal-govt-officer'] },
        resume:       { words: 'resume cv', ids: ['resume-download'] },
        awards:       { words: 'award awards honor honors prize prizes recognition recognized spotlight featured achievement achievements', sections: ['news'] },
        about:        { words: 'yourself introduce introduction background bio biography summary overview', sections: ['about'] },
        availability: { words: 'available availability collaborate collaboration collaborating opportunity opportunities freelance open', ids: ['availability', 'contact'] }
    };
    // Extra words a question word can match in the site's text.
    var ALSO = {
        course: 'coursework', class: 'coursework', subject: 'coursework',
        graduate: 'expected degree', graduat: 'expected degree', finish: 'expected degree',
        accuracy: 'map miou precision recall accuracy', accurate: 'map miou precision recall accuracy',
        fast: 'faster ms latency inference', speed: 'faster ms latency inference', quick: 'faster ms latency',
        funded: 'nifa usda grant funded', fund: 'nifa usda grant funded', funding: 'nifa usda grant funded', grant: 'nifa usda grant',
        dissertation: 'thesis', cv: 'resume', ai: 'ai artificial intelligence', ml: 'ml machine learning',
        live: 'based', located: 'based', location: 'based', hometown: 'based'
    };
    var TRIGGER = {}; // stem -> topic name
    Object.keys(TOPICS).forEach(function (name) {
        TOPICS[name].words.split(' ').forEach(function (w) { TRIGGER[stem(w)] = TRIGGER[stem(w)] || name; });
    });

    var LIST_LABEL = {
        experience: 'roles', publications: 'entries under Publications', projects: 'projects', skills: 'skill areas',
        news: 'latest updates', tools: 'free tools', games: 'games'
    };
    var SECTION_LABEL = {
        about: 'About', stats: 'About', education: 'Education', experience: 'Experience', publications: 'Publications',
        projects: 'Projects', news: 'News', contact: 'Contact', tools: 'Tools', games: 'Games', skills: 'Skills'
    };
    var FOLLOW_UPS = {
        about: ["What's your research about?", 'What have you published?', 'How can I contact you?'],
        stats: ['What projects have you built?', 'What have you published?', 'Where have you worked?'],
        education: ['What was your thesis about?', 'What courses did you take?', 'Where have you worked?'],
        experience: ['What did you do as a research assistant?', 'What did you do in Nepal?', 'What are your skills?'],
        publications: ['Tell me about the ICMLA paper', 'What is the EMNLP paper about?', 'What was your thesis about?'],
        projects: ['What is SeekBot?', 'What tools have you built?', 'What games have you made?'],
        news: ['Any awards?', 'What have you published?', "What's your research about?"],
        tools: ['What is LocalLabel?', 'What is Texlume?', 'What games have you made?'],
        games: ['How does AR Survival work?', 'Can I play Ludo with friends?', 'What tools have you built?'],
        skills: ['Do you know PyTorch?', 'What projects have you built?', 'Where have you worked?'],
        contact: ['Can I download your résumé?', 'Are you open to collaboration?', "What's your research about?"]
    };
    var STARTERS = ["What's your research about?", 'Where did you study?', 'What have you published?', 'What tools have you built?', 'How can I contact you?'];

    // ---------------------------------------------------------------
    // Engine
    // ---------------------------------------------------------------
    // Keep in step with dataChunk() in scripts/build-ask-index.mjs.
    function dataChunk(item, section) {
        return {
            id: 'data-' + item.id, section: section, src: 'data.json', title: item.title || '', kind: item.tag || '',
            date: item.date || '', url: section === 'news' ? '#news' : '#research', text: item.description || '',
            links: item.link ? [{ href: item.link, label: item.linkLabel || 'View' }] : []
        };
    }

    function Engine(kb) {
        var self = this;
        this.owner = kb.owner || {};
        this.chunks = kb.chunks.filter(function (c) { return c.text; });
        this.byId = {};
        var df = {}, total = 0;
        this.chunks.forEach(function (c) {
            self.byId[c.id] = c;
            var tf = {};
            var toks = words(c.title).concat(words(c.title), words(c.text), words((c.tags || []).join(' ')), words(c.kind));
            toks.forEach(function (t) { tf[t.stem] = (tf[t.stem] || 0) + 1; });
            c._tf = tf;
            c._len = toks.length;
            total += toks.length;
            Object.keys(tf).forEach(function (k) { df[k] = (df[k] || 0) + 1; });
        });
        this.df = df;
        this.N = this.chunks.length;
        this.avgLen = total / Math.max(1, this.N);
        this.vocab = Object.keys(df);
        this.maxIdf = Math.log(1 + (this.N + 0.5) / 0.5);
    }

    Engine.prototype.idf = function (s) {
        var n = this.df[s] || 0;
        return n ? Math.log(1 + (this.N - n + 0.5) / (n + 0.5)) : this.maxIdf;
    };

    // Unknown words get their closest site word when it is one typo away.
    Engine.prototype.correct = function (s) {
        if (this.df[s] || TRIGGER[s] || s.length < 5 || /\d/.test(s)) return s;
        var best = null, bestDf = 0;
        for (var i = 0; i < this.vocab.length; i++) {
            var v = this.vocab[i];
            if (edit1(s, v) && this.df[v] > bestDf) { best = v; bestDf = this.df[v]; }
        }
        if (!best) for (var t in TRIGGER) if (edit1(s, t)) return t;
        return best || s;
    };

    Engine.prototype.parse = function (q) {
        var self = this;
        var all = words(q);
        var topics = [];
        var terms = []; // content words: {raw, stem, alt, topic, pos}
        all.forEach(function (w, i) {
            var s = self.correct(w.stem);
            var topic = TRIGGER[s];
            if (topic && topics.indexOf(topic) < 0) topics.push(topic);
            if (!STOP.has(w.raw) && !STOP.has(s)) {
                var alt = (ALSO[w.raw] || ALSO[s] || '').split(' ').filter(Boolean).map(stem)
                    .filter(function (x) { return x !== s; });
                terms.push({ raw: w.raw, stem: s, alt: alt, topic: topic || null, pos: i });
            }
        });
        var f = fold(q);
        if (/\bwhere\b.*\b(from|live|based|located|stay)\b/.test(f) && topics.indexOf('location') < 0) topics.push('location');
        if (/\bwho (are|is) (you|he|bibek)\b|\babout (you|yourself|him|bibek)\b|\bintroduce\b|\bbackground\b|\bbio\b/.test(f) && topics.indexOf('about') < 0) topics.push('about');
        return {
            text: f, terms: terms, topics: topics,
            howMany: /\bhow many\b|\bnumber of\b|\bcount\b/.test(f),
            listy: /\b(list|all|which|what|any|show|how many|tell me about (your|the))\b/.test(f) || terms.length <= 2,
            define: /\b(what|who) (is|are|was|were)\b|\btell me about\b|\bdescribe\b|\bexplain\b/.test(f)
        };
    };

    Engine.prototype.score = function (c, p) {
        var self = this, s = 0, k1 = 1.2, b = 0.75;
        function bm(stemmed) {
            var f = c._tf[stemmed] || 0;
            return f ? self.idf(stemmed) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * c._len / self.avgLen)) : 0;
        }
        p.terms.forEach(function (t) {
            var best = bm(t.stem);
            t.alt.forEach(function (a) { best = Math.max(best, bm(a) * 0.8); });
            s += t.topic ? best * 0.5 : best;           // topic words are generic; names and facts count fully
        });
        p.topics.forEach(function (name) {
            var T = TOPICS[name];
            if (!T) return;
            var at = idIndex(T, c.id);
            if (at === 0) s += 3.5; else if (at > 0) s += 2.5;
            if (T.sections && T.sections.indexOf(c.section) >= 0) s += T.weak ? 0.6 : 2.2;
        });
        if (p.topics.indexOf('about') >= 0 && c.id === 'about') s += 4;
        if (c.src === 'resume') s *= 0.75;              // the site itself wins ties with the résumé
        if (c.weight) s *= c.weight;
        return s;
    };

    function idIndex(T, id) {
        if (!T.ids) return -1;
        for (var i = 0; i < T.ids.length; i++) {
            var x = T.ids[i];
            if (x === id || (x.slice(-1) === '*' && id.indexOf(x.slice(0, -1)) === 0)) return i;
        }
        return -1;
    }

    // Share of the question's meaning that chunk c covers (0..1).
    Engine.prototype.coverage = function (c, p) {
        var self = this, have = 0, want = 0, missing = [];
        p.terms.forEach(function (t) {
            var T = t.topic && TOPICS[t.topic];
            var w = T ? 1 : self.idf(t.stem);
            want += w;
            var hit = c._tf[t.stem] || t.alt.some(function (a) { return c._tf[a]; }) ||
                (T && ((T.sections && T.sections.indexOf(c.section) >= 0) || idIndex(T, c.id) >= 0));
            if (hit) have += w; else missing.push(t);
        });
        return { ratio: want ? have / want : 1, missing: phrases(p.terms, missing) };
    };

    // Unmatched words, with their neighbours, so "phone number" reads as a phrase.
    function phrases(terms, missing) {
        var runs = [], run = [];
        terms.forEach(function (t, i) {
            if (i && t.pos !== terms[i - 1].pos + 1) { runs.push(run); run = []; }
            run.push(t);
        });
        runs.push(run);
        return runs.filter(function (r) { return r.some(function (t) { return missing.indexOf(t) >= 0; }); })
            .map(function (r) { return r.map(function (t) { return t.raw; }).join(' '); });
    }

    Engine.prototype.ask = function (q) {
        var p = this.parse(q);
        var f = p.text.trim();
        if (!f) return null;
        var small = smallTalk(f, p, this.owner);
        if (small) return small;

        // Broad "what are your X?" questions get a short list of that section.
        var specific = p.terms.filter(function (t) { return !t.topic; });
        var listTopic = p.topics.filter(function (n) { return TOPICS[n] && TOPICS[n].list; })[0];
        if (listTopic && !specific.length && (p.listy || p.howMany)) return this.list(listTopic, p);

        if (!p.terms.length && !p.topics.length) {
            // Every word was generic ("what do you do?"): answer with the intro.
            return this.answerFrom([this.byId.about], p, true);
        }

        var self = this;
        var ranked = this.chunks.map(function (c) { return { c: c, s: self.score(c, p) }; })
            .filter(function (r) { return r.s > 0; })
            .sort(function (a, b) { return b.s - a.s; });
        if (!ranked.length) return this.fallback(p, phrases(p.terms, p.terms));

        // Among the close leaders, prefer the one that covers the whole question.
        var top = null, topFit = 0, firstCov = this.coverage(ranked[0].c, p);
        for (var j = 0; j < Math.min(6, ranked.length); j++) {
            if (ranked[j].s < ranked[0].s * 0.6) break;
            var ratio = this.coverage(ranked[j].c, p).ratio;
            var fit = ranked[j].s * (0.5 + ratio);
            if (ratio >= 0.6 && fit > topFit) { top = ranked[j]; topFit = fit; }
        }
        if (!top || top.s < 1.2) return this.fallback(p, firstCov.missing);

        var picks = [top.c];
        for (var i = 0; i < ranked.length && picks.length < 2; i++) {
            var r = ranked[i];
            if (r === top) continue;
            if (r.s < top.s * 0.8) break;
            if (r.c.src === 'resume' || picks.some(function (x) { return similar(x, r.c); })) continue;
            if (this.coverage(r.c, p).ratio >= 0.8) picks.push(r.c);
        }
        return this.answerFrom(picks, p, !specific.length);
    };

    // A short lead-in when the question was about a whole topic this chunk belongs to.
    Engine.prototype.leadFor = function (c, p) {
        for (var i = 0; i < p.topics.length; i++) {
            var T = TOPICS[p.topics[i]];
            if (LEADS[p.topics[i]] && (idIndex(T, c.id) >= 0 || (T.sections || []).indexOf(c.section) >= 0)) return LEADS[p.topics[i]];
        }
        return '';
    };

    Engine.prototype.answerFrom = function (picks, p, broad) {
        var self = this;
        var c = picks[0];
        var body = this.snippet(c, p);
        return {
            kind: 'answer',
            lead: broad ? this.leadFor(c, p) : '',
            title: showTitle(c, body) ? c.title : '',
            meta: [c.kind, c.date].filter(Boolean).join(' · '),
            text: body,
            links: (c.links || []).slice(0, 3),
            source: { label: c.src === 'resume' ? 'Résumé' : SECTION_LABEL[c.section] || 'This site', href: c.url },
            related: picks.slice(1).map(function (r) { return { title: r.title, ask: 'Tell me about ' + r.title }; }),
            followUps: FOLLOW_UPS[c.section] || FOLLOW_UPS.about,
            email: self.owner.email
        };
    };

    // The one or two sentences of a chunk that best answer the question.
    Engine.prototype.snippet = function (c, p) {
        var self = this;
        var sents = sentences(c.text);
        if (c.text.length <= 280 || sents.length <= 1) return clip(sents.map(firstPerson).join(' '), 420);
        // a résumé line that only repeats the title ("Project – github.com/…") adds nothing
        if (fold(sents[0]).indexOf(fold(c.title)) === 0 && sents[0].length < c.title.length + 60) sents = sents.slice(1);
        var stems = {};
        p.terms.forEach(function (t) {
            stems[t.stem] = t.topic ? 0.5 : 1;
            t.alt.forEach(function (a) { stems[a] = stems[a] || 0.8; });
        });
        var scored = sents.map(function (s, i) {
            var seen = {}, sc = 0;
            words(s).forEach(function (w) {
                if (stems[w.stem] && !seen[w.stem]) { seen[w.stem] = 1; sc += stems[w.stem] * self.idf(w.stem); }
            });
            return { i: i, s: s, sc: sc };
        });
        // "What is X?" about an item by name: its opening sentences describe it best.
        var named = p.terms.some(function (t) {
            return !t.topic && words(c.title).some(function (w) { return w.stem === t.stem; });
        });
        if (p.define && named) scored.forEach(function (x) { x.sc = x.i === 0 ? 1 : 0; });
        var best = scored.slice().sort(function (a, b) { return b.sc - a.sc || a.i - b.i; });
        var chosen = best[0].sc > 0 ? [best[0]] : [scored[0]];
        var second = best[0].sc > 0 ? best[1] : scored[1];
        if (second && (best[0].sc === 0 || second.sc > 0) && chosen[0].s.length + second.s.length < 340) chosen.push(second);
        chosen.sort(function (a, b) { return a.i - b.i; });
        // a thin pick reads better with the sentences that follow it
        var len = chosen.reduce(function (n, x) { return n + x.s.length; }, 0);
        for (var k = chosen[chosen.length - 1].i + 1; k < scored.length && len < 200 && len + scored[k].s.length < 420; k++) {
            chosen.push(scored[k]);
            len += scored[k].s.length;
        }
        return clip(chosen.map(function (x) { return firstPerson(x.s); }).join(' '), 420);
    };

    Engine.prototype.list = function (topic, p) {
        var items = this.chunks.filter(function (c) {
            if (c.section !== TOPICS[topic].sections[0] || c.src === 'resume') return false;
            if (/-overview$|^archive-|^pub-in-preparation$/.test(c.id)) return false;
            return true;
        });
        if (topic === 'skills') items = this.chunks.filter(function (c) { return c.section === 'skills'; });
        if (topic === 'news') {
            // data.json items are the newest and are shown first on the page too
            items.sort(function (a, b) { return (b.src === 'data.json') - (a.src === 'data.json'); });
        }
        if (!items.length) return this.fallback(p, []);
        var n = items.length;
        var shown = items.slice(0, topic === 'news' ? 5 : 8);
        var self = this;
        var note = this.byId['pub-in-preparation'];
        return {
            kind: 'list',
            lead: p.howMany
                ? 'There are ' + n + ' ' + LIST_LABEL[topic] + ' on my site:'
                : (LIST_LEADS[topic] || 'Here’s what’s on the site:'),
            items: shown.map(function (c) {
                var detail = topic === 'skills'
                    ? clip(c.text.replace(/^[^:]+:\s*/, ''), 110)
                    : [c.kind, c.date].filter(Boolean).join(' · ');
                var link = (c.links || [])[0];
                return {
                    title: topic === 'skills' ? c.title.replace(/^Skills:\s*/, '') : c.title,
                    detail: detail,
                    ask: topic === 'skills' ? '' : 'Tell me about ' + c.title,
                    href: link ? link.href : ''
                };
            }),
            more: n > shown.length ? (n - shown.length) + ' more on the site.' : '',
            note: topic === 'publications' && note ? note.text : '',
            source: { label: SECTION_LABEL[TOPICS[topic].sections[0]], href: shown[0].url },
            followUps: FOLLOW_UPS[TOPICS[topic].sections[0]],
            email: self.owner.email
        };
    };

    Engine.prototype.fallback = function (p, missing) {
        var miss = missing.filter(function (w) { return w.length > 2; }).slice(0, 2);
        return {
            kind: 'fallback',
            text: (miss.length
                ? 'I couldn’t find anything about “' + miss.join('” or “') + '” on my site, and I’d rather not guess.'
                : 'That isn’t covered on my site, and I’d rather not guess.'),
            email: this.owner.email,
            followUps: STARTERS.slice(0, 3)
        };
    };

    var LEADS = {
        education: 'Here’s my education:',
        research: 'Here’s the short version of my research:',
        contact: 'Happy to hear from you!'
    };
    var LIST_LEADS = {
        experience: 'Here’s where I’ve worked:',
        publications: 'Here’s what I’ve published:',
        projects: 'Here are some of my projects:',
        skills: 'Here are my main skill areas:',
        news: 'Here’s what’s new:',
        tools: 'I’ve built these free tools. They all run in your browser:',
        games: 'Here are the games I’ve made. They’re free to play in your browser:'
    };

    function smallTalk(f) {
        var bare = f.replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
        var short = bare.split(' ').length <= 4;
        if (/^(hi|hello|hey|hiya|yo|namaste|greetings|good (morning|afternoon|evening))\b/.test(bare) && short) {
            return { kind: 'say', text: 'Hi there! Ask me anything about my research, publications, projects, tools or how to reach me.', followUps: STARTERS.slice(0, 4) };
        }
        if (/^(thanks|thank you|thx|ty|cheers|great|awesome|cool|nice|perfect)\b/.test(bare) && short) {
            return { kind: 'say', text: 'You’re welcome! Anything else you’d like to know?', followUps: STARTERS.slice(1, 4) };
        }
        if (/^(bye|goodbye|see you|see ya|later)\b/.test(bare) && short) {
            return { kind: 'say', text: 'Thanks for stopping by!', followUps: [] };
        }
        if (/\b(are you|is this) (a |an )?(bot|ai|robot|real|human|chatgpt|gpt|llm|person)\b|\bhow do you work\b|\bwhat are you\b/.test(bare)) {
            return {
                kind: 'say',
                text: 'I’m a small assistant for this website. I answer in Bibek’s words using only what’s written on the site and résumé, so if something isn’t there, I’ll say so instead of guessing. Your questions stay in your browser.',
                followUps: STARTERS.slice(0, 3)
            };
        }
        return null;
    }

    function similar(a, b) {
        var A = new Set(words(a.title).map(function (w) { return w.stem; }));
        var B = words(b.title).map(function (w) { return w.stem; });
        var inter = B.filter(function (s) { return A.has(s); }).length;
        var union = new Set(B.concat(Array.from(A))).size || 1;
        return inter / union >= 0.5 || (a.section === b.section && a.title === b.title);
    }

    function showTitle(c, body) {
        return ['projects', 'publications', 'news', 'tools', 'games', 'experience', 'education'].indexOf(c.section) >= 0 &&
            fold(body).replace(/^i /, '').indexOf(fold(c.title)) !== 0 && c.title !== 'Education';
    }

    // Sentence split that leaves "E. coli", "M.S." and "pp." alone.
    function sentences(text) {
        var out = [], start = 0, m, re = /[.!?][”")]?\s+/g;
        while ((m = re.exec(text))) {
            var before = text.slice(start, m.index + 1);
            var next = text.charAt(m.index + m[0].length);
            var lastWord = (before.match(/(\S+)$/) || ['', ''])[1];
            if (!/[A-Z0-9“"(]/.test(next)) continue;
            if (/^(?:[A-Za-z]|[A-Z]\.[A-Z]|pp|p|vs|al|approx|Univ|No|Dr|St|Mr|Ms|e\.g|i\.e)\.$/.test(lastWord)) continue;
            out.push(text.slice(start, m.index + m[0].length).trim());
            start = m.index + m[0].length;
        }
        if (start < text.length) out.push(text.slice(start).trim());
        return out.filter(Boolean);
    }

    // Résumé and news lines start with a verb ("Built a pipeline…"); say who did it.
    var PAST_IRREGULAR = /^(Built|Led|Had|Made|Won|Gave|Wrote|Taught|Ran|Brought|Held|Spent|Took|Began|Became|Taken)\b/;
    var PRESENT_3RD = /^(Also )?(Builds|Brings|Leads|Works|Develops|Designs|Creates|Makes|Runs)\b/;
    var PASSIVE = /^(Featured|Selected|Awarded|Invited|Recognized|Honored|Nominated|Funded)\b/;
    var NOT_VERBS = /^(Accepted|Defended|Expected|Published|Updated|Released)\s+(?:on\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d)|^(United|Embedded|Advanced|Need|Speed|Seed|Red|Bed|Feed|Detailed|Limited|Based)\b/;
    var ROLE_START = /^[A-Z][a-z]+(?: [a-z]+){0,6} (?:engineer|researcher|developer|scientist|student)\b/;
    function firstPerson(s) {
        var m;
        if (/^Open to\b/.test(s)) return 'I’m open' + s.slice(4);
        if (ROLE_START.test(s)) return 'I’m a ' + lowerFirst(s);
        if (PASSIVE.test(s)) return 'I was ' + lowerFirst(s);
        if ((m = s.match(PRESENT_3RD))) return 'I ' + (m[1] ? 'also ' : '') + m[2].toLowerCase().replace(/s$/, '') + s.slice(m[0].length);
        if (/^Also [a-z]+ed\b|^Also (built|led|made)\b/.test(s)) return 'I also' + s.slice(4);
        if (!NOT_VERBS.test(s) && (PAST_IRREGULAR.test(s) || /^[A-Z][a-z]+(?:-[a-z]+)?ed\b/.test(s))) return 'I ' + lowerFirst(s);
        return s;
    }
    function lowerFirst(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
    function clip(s, n) {
        if (s.length <= n) return s;
        var cut = s.slice(0, n);
        return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '…';
    }

    var api = { Engine: Engine, dataChunk: dataChunk, words: words, sentences: sentences, firstPerson: firstPerson };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document === 'undefined') return;

    // ---------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------
    var script = document.currentScript;
    var BASE = new URL('.', script ? script.src : location.href);   // .../ask/
    var ROOT = new URL('..', BASE);                                  // site root
    var STORE = 'askAboutMe.v1';

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('ask.css' + (script ? new URL(script.src).search : ''), BASE).href; // same ?v= as ask.js
    document.head.appendChild(link);

    var engine = null, loading = null;
    function load() {
        if (loading) return loading;
        loading = fetch(new URL('knowledge.json', BASE), { cache: 'no-cache' })
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(function (kb) {
                // data.json is edited from the dashboard, so read it live to stay current.
                return fetch(new URL('data.json', ROOT), { cache: 'no-cache' })
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .catch(function () { return null; })
                    .then(function (data) {
                        if (data) {
                            kb.chunks = kb.chunks.filter(function (c) { return c.src !== 'data.json'; })
                                .concat((data.news || []).map(function (i) { return dataChunk(i, 'news'); }),
                                    (data.research || []).map(function (i) { return dataChunk(i, 'projects'); }));
                        }
                        engine = new Engine(kb);
                        return engine;
                    });
            });
        loading.catch(function () { loading = null; });
        return loading;
    }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function svg(path, size) {
        var ns = 'http://www.w3.org/2000/svg';
        var s = document.createElementNS(ns, 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('width', size || 20);
        s.setAttribute('height', size || 20);
        s.setAttribute('aria-hidden', 'true');
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor');
        s.setAttribute('stroke-width', '2');
        s.setAttribute('stroke-linecap', 'round');
        s.setAttribute('stroke-linejoin', 'round');
        path.split('|').forEach(function (d) {
            var p = document.createElementNS(ns, 'path');
            p.setAttribute('d', d);
            s.appendChild(p);
        });
        return s;
    }
    var ICON_CHAT = 'M21 12a8.5 8.5 0 0 1-12.3 7.6L3 21l1.4-5.7A8.5 8.5 0 1 1 21 12z|M8.5 10.5h7|M8.5 14h4.5';
    var ICON_SEND = 'M5 12h13|M13 6l6 6-6 6';
    var ICON_CLOSE = 'M6 6l12 12|M18 6L6 18';
    var ICON_LINK = 'M14 4h6v6|M20 4l-9 9|M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5';

    function resolve(href) {
        if (!href) return null;
        if (/^mailto:/i.test(href)) return { href: href, external: false };
        if (href.charAt(0) === '#') {
            if (document.getElementById(href.slice(1))) return { href: href, anchor: true };
            return { href: new URL('index.html' + href, ROOT).href, external: false };
        }
        var u;
        try { u = new URL(href, ROOT); } catch (e) { return null; }
        if (!/^https?:$/.test(u.protocol)) return null;
        return { href: u.href, external: u.origin !== location.origin };
    }

    // --- build the widget ---
    var root = el('div', 'ask-root');
    var fab = el('button', 'ask-fab');
    fab.type = 'button';
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-controls', 'ask-panel');
    fab.appendChild(svg(ICON_CHAT, 22));
    fab.appendChild(el('span', 'ask-fab-label', 'Ask about me'));

    var panel = el('section', 'ask-panel');
    panel.id = 'ask-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Ask About Me');
    panel.hidden = true;

    var head = el('header', 'ask-head');
    var avatar = el('img', 'ask-avatar');
    avatar.src = new URL('images/face.webp', ROOT).href;
    avatar.alt = '';
    avatar.width = 36; avatar.height = 36;
    avatar.onerror = function () { avatar.onerror = null; avatar.src = new URL('images/profile.webp', ROOT).href; };
    var titles = el('div', 'ask-titles');
    titles.appendChild(el('h2', 'ask-title', 'Ask About Me'));
    titles.appendChild(el('p', 'ask-sub', 'Answers from this site only'));
    var close = el('button', 'ask-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close chat');
    close.appendChild(svg(ICON_CLOSE, 18));
    head.appendChild(avatar); head.appendChild(titles); head.appendChild(close);

    var log = el('div', 'ask-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('tabindex', '0');
    log.setAttribute('aria-label', 'Conversation');

    var suggest = el('div', 'ask-suggest');
    var form = el('form', 'ask-form');
    var input = el('input', 'ask-input');
    input.type = 'text';
    input.maxLength = 300;
    input.autocomplete = 'off';
    input.placeholder = 'Ask about my work, research, skills…';
    input.setAttribute('aria-label', 'Your question');
    input.setAttribute('enterkeyhint', 'send');
    var send = el('button', 'ask-send');
    send.type = 'submit';
    send.setAttribute('aria-label', 'Send');
    send.appendChild(svg(ICON_SEND, 18));
    form.appendChild(input); form.appendChild(send);
    var foot = el('p', 'ask-foot', 'Replies quote this website. Your questions never leave your browser.');

    panel.appendChild(head); panel.appendChild(log); panel.appendChild(suggest); panel.appendChild(form); panel.appendChild(foot);
    root.appendChild(panel); root.appendChild(fab);

    function mount() { document.body.appendChild(root); restore(); }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

    // --- conversation state (kept for this tab so it survives page changes) ---
    var turns = [];
    function save() {
        try { sessionStorage.setItem(STORE, JSON.stringify({ open: !panel.hidden, history: turns.slice(-30) })); } catch (e) { /* storage off */ }
    }
    function restore() {
        var st = null;
        try { st = JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch (e) { /* storage off */ }
        if (st && st.history && st.history.length) {
            turns = st.history;
            turns.forEach(function (m) { render(m, false); });
            var last = turns[turns.length - 1];
            chips((last.a && last.a.followUps) || STARTERS);
        }
        if (st && st.open) open(false);
    }

    function greet() {
        if (log.childElementCount) return;
        render({ a: { kind: 'say', text: 'Hi! I’m Bibek’s site assistant. Ask me about my research, publications, projects or how to get in touch, and I’ll answer from what’s on this site.' } }, false);
        chips(STARTERS);
    }

    function open(focus) {
        panel.hidden = false;
        root.classList.add('is-open');
        fab.setAttribute('aria-expanded', 'true');
        greet();
        load().catch(function () { /* shown when asking */ });
        if (focus !== false && !matchMedia('(pointer: coarse)').matches) input.focus();
        scrollEnd(false);
        save();
    }
    function shut() {
        panel.hidden = true;
        root.classList.remove('is-open');
        fab.setAttribute('aria-expanded', 'false');
        save();
        fab.focus();
    }

    fab.addEventListener('click', function () { if (panel.hidden) open(); else shut(); });
    fab.addEventListener('pointerenter', function () { load().catch(function () {}); }, { once: true });
    close.addEventListener('click', shut);
    panel.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); shut(); }
    });
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        submit(input.value);
    });

    var busy = false;
    function submit(q) {
        q = String(q || '').trim().slice(0, 300);
        if (!q || busy) return;
        input.value = '';
        busy = true;
        var msg = { q: q };
        render(msg, true);
        chips([]);
        var typing = el('div', 'ask-msg ask-bot ask-typing');
        typing.setAttribute('aria-label', 'Typing');
        typing.appendChild(el('span')); typing.appendChild(el('span')); typing.appendChild(el('span'));
        log.appendChild(typing);
        scrollEnd(true);
        var started = Date.now();
        load().then(function (eng) {
            return eng.ask(q) || { kind: 'say', text: 'Ask me anything about my work.' };
        }, function () {
            return { kind: 'say', text: 'Sorry, I couldn’t load the site’s content just now. Please check your connection and try again.' };
        }).then(function (a) {
            var wait = Math.max(0, 380 + Math.min(500, (a.text || '').length * 2) - (Date.now() - started));
            setTimeout(function () {
                typing.remove();
                msg.a = a;
                turns.push(msg);
                render({ a: a }, true);
                chips(a.followUps || []);
                busy = false;
                save();
            }, wait);
        });
    }

    function chips(list) {
        suggest.textContent = '';
        var asked = new Set(turns.map(function (m) { return fold(m.q); }));
        list.filter(function (q) { return !asked.has(fold(q)); }).slice(0, 3).forEach(function (q) {
            var b = el('button', 'ask-chip', q);
            b.type = 'button';
            b.addEventListener('click', function () { submit(q); });
            suggest.appendChild(b);
        });
        suggest.hidden = !suggest.childElementCount;
    }

    function scrollEnd(smooth) {
        requestAnimationFrame(function () {
            var last = log.lastElementChild;
            // Long answers: show their start rather than their end.
            if (last && last.classList.contains('ask-bot') && last.offsetHeight > log.clientHeight * 0.8) {
                log.scrollTo({ top: last.offsetTop - 8, behavior: smooth ? 'smooth' : 'auto' });
            } else {
                log.scrollTo({ top: log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
            }
        });
    }

    function anchor(target, label, cls) {
        var r = resolve(target);
        if (!r) return null;
        var a = el('a', cls, label);
        a.href = r.href;
        if (r.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        if (r.anchor) {
            a.addEventListener('click', function (e) {
                var t = document.getElementById(r.href.slice(1));
                if (!t) return;
                e.preventDefault();
                if (matchMedia('(max-width: 560px)').matches) shut();
                t.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
        return a;
    }

    function render(m, animate) {
        if (m.q) {
            var u = el('div', 'ask-msg ask-user', m.q);
            if (animate) u.classList.add('ask-in');
            log.appendChild(u);
        }
        if (m.a) {
            var a = m.a;
            var b = el('div', 'ask-msg ask-bot' + (a.kind === 'fallback' ? ' ask-miss' : ''));
            if (animate) b.classList.add('ask-in');
            if (a.lead) b.appendChild(el('p', 'ask-lead', a.lead));
            if (a.title) {
                var t = el('p', 'ask-item-title', a.title);
                if (a.meta) t.appendChild(el('span', 'ask-meta', a.meta));
                b.appendChild(t);
            }
            if (a.text) b.appendChild(el('p', 'ask-text', a.text));
            if (a.kind === 'list') {
                var ul = el('ul', 'ask-list');
                a.items.forEach(function (it) {
                    var li = el('li');
                    if (it.ask) {
                        var q = el('button', 'ask-list-q', it.title);
                        q.type = 'button';
                        q.title = 'Ask about this';
                        q.addEventListener('click', function () { submit(it.ask); });
                        li.appendChild(q);
                    } else {
                        li.appendChild(el('span', 'ask-list-t', it.title));
                    }
                    if (it.detail) li.appendChild(el('span', 'ask-meta', it.detail));
                    ul.appendChild(li);
                });
                b.appendChild(ul);
                if (a.more) b.appendChild(el('p', 'ask-note', a.more));
                if (a.note) b.appendChild(el('p', 'ask-note', a.note));
            }
            if (a.kind === 'fallback' && a.email) {
                var p = el('p', 'ask-text');
                p.appendChild(document.createTextNode('You can ask me directly at '));
                var mail = anchor('mailto:' + a.email, a.email, 'ask-inline');
                if (mail) p.appendChild(mail);
                p.appendChild(document.createTextNode('.'));
                b.appendChild(p);
            }
            if (a.related && a.related.length) {
                var rel = el('p', 'ask-note');
                rel.appendChild(document.createTextNode('Related: '));
                a.related.forEach(function (r, i) {
                    if (i) rel.appendChild(document.createTextNode(', '));
                    var rb = el('button', 'ask-inline-btn', r.title);
                    rb.type = 'button';
                    rb.addEventListener('click', function () { submit(r.ask); });
                    rel.appendChild(rb);
                });
                b.appendChild(rel);
            }
            var row = el('div', 'ask-links');
            (a.links || []).forEach(function (l) {
                var x = anchor(l.href, l.label, 'ask-link');
                if (x) { x.appendChild(svg(ICON_LINK, 12)); row.appendChild(x); }
            });
            if (a.source && a.source.href) {
                var s = anchor(a.source.href, 'Source: ' + a.source.label, 'ask-link ask-source');
                if (s) row.appendChild(s);
            }
            if (row.childElementCount) b.appendChild(row);
            log.appendChild(b);
        }
        scrollEnd(animate);
    }
})();
