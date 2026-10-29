// ============================================
// MASTER PROJECT SLIDER (Handles Project Navigation)
// ============================================
class MasterProjectSlider {
    constructor() {
        this.projectSlides = document.querySelectorAll('.project-slide');
        this.prevProjectBtn = document.querySelector('.prev-project-btn');
        this.nextProjectBtn = document.querySelector('.next-project-btn');
        this.currentProjectIndex = 0;
        this.totalProjects = this.projectSlides.length;
        this.indicatorsContainer = document.querySelector('.project-indicators');
        this.currentProjectSpan = document.querySelector('.current-project');
        this.totalProjectsSpan = document.querySelector('.total-projects');

        // Guard: bail out if any critical element is missing
        if (!this.prevProjectBtn || !this.nextProjectBtn || !this.indicatorsContainer ||
            !this.currentProjectSpan || !this.totalProjectsSpan || this.totalProjects === 0) {
            console.error('MasterProjectSlider: required elements not found');
            return;
        }

        this.init();
    }

    init() {
        this.totalProjectsSpan.textContent = this.totalProjects;
        this.createIndicators();

        this.prevProjectBtn.addEventListener('click', () => this.prevProject());
        this.nextProjectBtn.addEventListener('click', () => this.nextProject());

        this.updateButtonStates();
        this.addTouchSupport();
        this.updateContainerHeight();

        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' && e.ctrlKey) this.prevProject();
            else if (e.key === 'ArrowRight' && e.ctrlKey) this.nextProject();
        });
    }

    updateContainerHeight() {
        const container = document.querySelector('.projects-container');
        const activeSlide = this.projectSlides[this.currentProjectIndex];
        if (container && activeSlide) {
            container.style.minHeight = activeSlide.offsetHeight + 'px';
        }
    }

    addTouchSupport() {
        let touchStartX = 0;
        let touchEndX = 0;
        let touchStartY = 0;
        let touchFromImageSlider = false;
        const threshold = 60;

        const container = document.querySelector('.projects-container');
        if (!container) return;

        container.addEventListener('touchstart', (e) => {
            touchFromImageSlider = !!e.target.closest('.project-image-slider');
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        container.addEventListener('touchend', (e) => {
            if (touchFromImageSlider) return;
            touchEndX = e.changedTouches[0].screenX;
            const touchEndY = e.changedTouches[0].screenY;
            const distanceX = touchStartX - touchEndX;
            const distanceY = Math.abs(touchStartY - touchEndY);

            if (Math.abs(distanceX) > threshold && Math.abs(distanceX) > distanceY) {
                if (distanceX > 0) this.nextProject();
                else this.prevProject();
            }
        }, { passive: true });
    }

    createIndicators() {
        for (let i = 0; i < this.totalProjects; i++) {
            const indicator = document.createElement('div');
            indicator.classList.add('project-indicator');
            if (i === 0) indicator.classList.add('active');
            indicator.addEventListener('click', () => this.goToProject(i));
            this.indicatorsContainer.appendChild(indicator);
        }
        this.indicators = document.querySelectorAll('.project-indicator');
    }

    goToProject(index) {
        if (index === this.currentProjectIndex) return;
        this.projectSlides[this.currentProjectIndex].classList.remove('active');
        this.indicators[this.currentProjectIndex].classList.remove('active');
        this.currentProjectIndex = index;
        this.projectSlides[this.currentProjectIndex].classList.add('active');
        this.indicators[this.currentProjectIndex].classList.add('active');
        this.currentProjectSpan.textContent = this.currentProjectIndex + 1;
        this.updateButtonStates();
        this.resetImageSlider();
        this.updateContainerHeight();
    }

    nextProject() {
        if (this.currentProjectIndex < this.totalProjects - 1) {
            this.goToProject(this.currentProjectIndex + 1);
        }
    }

    prevProject() {
        if (this.currentProjectIndex > 0) {
            this.goToProject(this.currentProjectIndex - 1);
        }
    }

    updateButtonStates() {
        this.prevProjectBtn.disabled = this.currentProjectIndex === 0;
        this.nextProjectBtn.disabled = this.currentProjectIndex === this.totalProjects - 1;
    }

    resetImageSlider() {
        const currentSlide = this.projectSlides[this.currentProjectIndex];
        const items = currentSlide.querySelectorAll('.slider-images img, .slider-images video');
        const dots = currentSlide.querySelectorAll('.dot');
        items.forEach((item, idx) => idx === 0 ? item.classList.add('active') : item.classList.remove('active'));
        dots.forEach((dot, idx) => idx === 0 ? dot.classList.add('active') : dot.classList.remove('active'));
    }
}

// ============================================
// IMAGE SLIDER (Handles Gallery within Project)
// ============================================
class ImageSlider {
    constructor(sliderElement) {
        this.slider = sliderElement;
        this.prevBtn = sliderElement.querySelector('.prev-btn');
        this.nextBtn = sliderElement.querySelector('.next-btn');
        this.dotsContainer = sliderElement.querySelector('.slider-dots');
        this.currentIndex = 0;

        this.init();
    }

    init() {
        this.createDots();
        this.items = this.slider.querySelectorAll('.slider-images img, .slider-images video');
        if (this.items.length > 0) this.items[0].classList.add('active');

        this.prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this.prevSlide(); });
        this.nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.nextSlide(); });

        this.addTouchSupport();
    }

    createDots() {
        const items = this.slider.querySelectorAll('.slider-images img, .slider-images video');
        items.forEach((_, index) => {
            const dot = document.createElement('span');
            dot.classList.add('dot');
            if (index === 0) dot.classList.add('active');
            dot.addEventListener('click', (e) => { e.stopPropagation(); this.goToSlide(index); });
            this.dotsContainer.appendChild(dot);
        });
        this.dots = this.dotsContainer.querySelectorAll('.dot');
    }

    goToSlide(index) {
        if (index === this.currentIndex) return;

        const currentItem = this.items[this.currentIndex];
        if (currentItem.tagName === 'VIDEO') currentItem.pause();

        this.items[this.currentIndex].classList.remove('active');
        this.dots[this.currentIndex].classList.remove('active');
        this.currentIndex = index;
        this.items[this.currentIndex].classList.add('active');
        this.dots[this.currentIndex].classList.add('active');

        const newItem = this.items[this.currentIndex];
        if (newItem.tagName === 'VIDEO') newItem.play();
    }

    nextSlide() {
        this.goToSlide((this.currentIndex + 1) % this.items.length);
    }

    prevSlide() {
        this.goToSlide((this.currentIndex - 1 + this.items.length) % this.items.length);
    }

    addTouchSupport() {
        let touchStartX = 0;
        let touchEndX = 0;

        this.slider.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        this.slider.addEventListener('touchend', (e) => {
            e.stopPropagation();
            touchEndX = e.changedTouches[0].screenX;
            const threshold = 50;
            if (touchEndX < touchStartX - threshold) this.nextSlide();
            if (touchEndX > touchStartX + threshold) this.prevSlide();
        }, { passive: true });
    }
}

// ============================================
// NEWS SLIDER (3 cards visible, prev/next/touch)
// ============================================
class NewsSlider {
    constructor() {
        this.track    = document.querySelector('.news-slider-track');
        this.viewport = document.querySelector('.news-slider-viewport');
        this.prevBtn  = document.querySelector('.news-prev-btn');
        this.nextBtn  = document.querySelector('.news-next-btn');
        this.dotsEl   = document.querySelector('.news-dots');

        if (!this.track || !this.viewport || !this.prevBtn || !this.nextBtn || !this.dotsEl) return;

        this.cards      = Array.from(this.track.querySelectorAll('.news-card'));
        this.total      = this.cards.length;
        this.currentIdx = 0;
        this.GAP        = 24;

        requestAnimationFrame(() => {
            this.setCardWidths();
            this.buildDots();
            this.update();
        });

        this.prevBtn.addEventListener('click', () => this.go(this.currentIdx - 1));
        this.nextBtn.addEventListener('click', () => this.go(this.currentIdx + 1));

        let startX = 0;
        this.viewport.addEventListener('touchstart', (e) => {
            startX = e.changedTouches[0].screenX;
        }, { passive: true });
        this.viewport.addEventListener('touchend', (e) => {
            const dx = startX - e.changedTouches[0].screenX;
            if (Math.abs(dx) > 50) {
                if (dx > 0) this.go(this.currentIdx + 1);
                else        this.go(this.currentIdx - 1);
            }
        }, { passive: true });

        window.addEventListener('resize', () => {
            this.currentIdx = 0;
            this.setCardWidths();
            this.buildDots();
            this.update();
        });
    }

    visibleCount() {
        const w = this.viewport.offsetWidth;
        if (w <= 600) return 1;
        if (w <= 900) return 2;
        return 3;
    }

    setCardWidths() {
        const vpW     = this.viewport.offsetWidth;
        const visible = this.visibleCount();
        const totalGap = this.GAP * (visible - 1);
        const cardW   = Math.floor((vpW - totalGap) / visible);

        this.cardW = cardW;
        this.track.style.gap = this.GAP + 'px';

        this.cards.forEach(card => {
            card.style.flex     = '0 0 ' + cardW + 'px';
            card.style.width    = cardW + 'px';
            card.style.minWidth = cardW + 'px';
        });
    }

    maxIdx() { return Math.max(0, this.total - this.visibleCount()); }

    go(idx) {
        this.currentIdx = Math.max(0, Math.min(idx, this.maxIdx()));
        this.update();
    }

    update() {
        const offset = this.currentIdx * (this.cardW + this.GAP);
        this.track.style.transform = `translateX(-${offset}px)`;

        this.prevBtn.disabled = this.currentIdx === 0;
        this.nextBtn.disabled = this.currentIdx >= this.maxIdx();

        this.dotsEl.querySelectorAll('.news-dot').forEach((d, i) => {
            d.classList.toggle('active', i === this.currentIdx);
        });
    }

    buildDots() {
        this.dotsEl.innerHTML = '';
        for (let i = 0; i <= this.maxIdx(); i++) {
            const dot = document.createElement('button');
            dot.className = 'news-dot' + (i === 0 ? ' active' : '');
            dot.addEventListener('click', () => this.go(i));
            this.dotsEl.appendChild(dot);
        }
    }
}

// ============================================
// THEME TOGGLE (dark default / light)
// ============================================
function initThemeToggle() {
    const toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;
    const icon = toggle.querySelector('i');

    const apply = (theme) => {
        if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            if (icon) icon.className = 'fas fa-moon';
        } else {
            document.documentElement.removeAttribute('data-theme');
            if (icon) icon.className = 'fas fa-sun';
        }
    };

    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) {}
    apply(saved === 'dark' ? 'dark' : 'light'); // light unless the visitor chose dark

    toggle.addEventListener('click', () => {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const next = isLight ? 'dark' : 'light';
        apply(next);
        try { localStorage.setItem('theme', next); } catch (e) {}
    });
}

// ============================================
// PARTICLE NETWORK BACKGROUND
// ============================================
function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const ctx = canvas.getContext('2d');
    let particles = [];
    let mouse = { x: null, y: null };
    let raf;

    const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', () => { resize(); build(); });

    window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    window.addEventListener('mouseout', () => { mouse.x = null; mouse.y = null; }, { passive: true });

    function build() {
        const count = Math.min(90, Math.floor(window.innerWidth / 16));
        particles = Array.from({ length: count }, () => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.35,
            vy: (Math.random() - 0.5) * 0.35,
            r: Math.random() * 1.6 + 0.6
        }));
    }
    build();

    function colors() {
        const light = document.documentElement.getAttribute('data-theme') === 'light';
        return {
            dot: light ? 'rgba(70, 90, 160, 0.45)' : 'rgba(140, 165, 220, 0.5)',
            lineBase: light ? '70, 90, 160' : '140, 165, 220'
        };
    }

    const LINK_DIST = 130;

    function frame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const c = colors();

        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;

            // gentle attraction to mouse
            if (mouse.x !== null) {
                const dx = mouse.x - p.x, dy = mouse.y - p.y;
                const d = Math.hypot(dx, dy);
                if (d < 200 && d > 0.001) {
                    p.x += (dx / d) * 0.25;
                    p.y += (dy / d) * 0.25;
                }
            }

            if (p.x < 0 || p.x > canvas.width)  p.vx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
            p.x = Math.max(0, Math.min(canvas.width, p.x));
            p.y = Math.max(0, Math.min(canvas.height, p.y));

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = c.dot;
            ctx.fill();
        }

        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const a = particles[i], b = particles[j];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d < LINK_DIST) {
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.strokeStyle = `rgba(${c.lineBase}, ${0.16 * (1 - d / LINK_DIST)})`;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        raf = requestAnimationFrame(frame);
    }
    frame();

    // Pause when tab hidden
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) cancelAnimationFrame(raf);
        else frame();
    });
}

// ============================================
// TYPING EFFECT (hero roles)
// ============================================
function initTyping() {
    const el = document.getElementById('typed-text');
    if (!el) return;

    const phrases = [
        'Computer Vision Researcher',
        'Machine Learning Engineer',
        'Graduate Researcher @ SIUC',
        'IEEE ICMLA 2025 Author',
        'Ex-Lieutenant, Nepali Army'
    ];
    let pi = 0, ci = 0, deleting = false;

    function tick() {
        const phrase = phrases[pi];

        if (!deleting) {
            ci++;
            el.textContent = phrase.slice(0, ci);
            if (ci === phrase.length) {
                deleting = true;
                setTimeout(tick, 2000);
                return;
            }
            setTimeout(tick, 60 + Math.random() * 50);
        } else {
            ci--;
            el.textContent = phrase.slice(0, ci);
            if (ci === 0) {
                deleting = false;
                pi = (pi + 1) % phrases.length;
                setTimeout(tick, 400);
                return;
            }
            setTimeout(tick, 30);
        }
    }
    tick();
}

// ============================================
// ANIMATED STAT COUNTERS
// ============================================
function initCounters() {
    const nums = document.querySelectorAll('.stat-number[data-count]');
    if (!nums.length) return;

    const animate = (el) => {
        const target = parseInt(el.dataset.count, 10) || 0;
        const suffix = el.dataset.suffix || '+';
        const dur = 1400;
        const start = performance.now();

        function step(now) {
            const t = Math.min(1, (now - start) / dur);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = Math.round(eased * target) + (t === 1 ? suffix : '');
            if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    };

    const obs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                animate(e.target);
                obs.unobserve(e.target);
            }
        });
    }, { threshold: 0.6 });

    nums.forEach(n => obs.observe(n));
}

// ============================================
// SCROLL PROGRESS BAR
// ============================================
function initScrollProgress() {
    const bar = document.querySelector('.scroll-progress');
    if (!bar) return;
    const update = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
}

// ============================================
// SCROLL REVEAL
// ============================================
function initReveal() {
    const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                obs.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

    // Legacy fade-in for cards (incl. dynamically loaded news cards)
    const fadeObs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('fade-in');
                fadeObs.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -100px 0px' });

    document.querySelectorAll('.news-card, .path-card').forEach(el => fadeObs.observe(el));
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // 0. Wait for dynamic-loader.js to finish injecting cards from data.json
    //    so sliders capture both static AND dynamic cards.
    if (window.dynamicContentReady) {
        try { await window.dynamicContentReady; } catch (e) { /* non-fatal */ }
    }

    // 1. Sliders
    new MasterProjectSlider();
    document.querySelectorAll('.project-image-slider').forEach(slider => {
        new ImageSlider(slider);
    });
    new NewsSlider();

    // 2. Dynamic UI features
    initThemeToggle();
    initParticles();
    initTyping();
    initCounters();
    initScrollProgress();
    initReveal();

    // 3. Mobile menu
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    const navLinks = document.querySelectorAll('.nav-menu a');

    if (hamburger && navMenu) {
        let menuTouched = false;

        hamburger.addEventListener('touchstart', (e) => {
            e.preventDefault();
            menuTouched = true;
            navMenu.classList.toggle('active');
            hamburger.classList.toggle('active');
        }, { passive: false });

        hamburger.addEventListener('click', () => {
            if (menuTouched) { menuTouched = false; return; }
            navMenu.classList.toggle('active');
            hamburger.classList.toggle('active');
        });

        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                hamburger.classList.remove('active');
            });
        });
    }

    // 4. Scroll to top on logo click
    const navLogo = document.querySelector('.nav-logo');
    if (navLogo) {
        navLogo.addEventListener('click', (e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});

// Smooth Scroll with Offset for Fixed Navbar
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;

        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            const navbarHeight = document.querySelector('.navbar').offsetHeight;
            const targetPosition = targetElement.offsetTop - navbarHeight - 20;
            window.scrollTo({ top: targetPosition, behavior: 'smooth' });
        }
    });
});

// Active Navigation Link on Scroll
window.addEventListener('scroll', () => {
    let current = '';
    const sections = document.querySelectorAll('section[id]');
    const navbarHeight = document.querySelector('.navbar').offsetHeight;

    sections.forEach(section => {
        const sectionTop = section.offsetTop - navbarHeight - 100;
        const sectionHeight = section.clientHeight;
        if (pageYOffset >= sectionTop && pageYOffset < sectionTop + sectionHeight) {
            current = section.getAttribute('id');
        }
    });

    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${current}`) {
            link.classList.add('active');
        }
    });
}, { passive: true });

// Active nav link style
const style = document.createElement('style');
style.textContent = `
    .nav-menu a.active { color: var(--accent); }
    .nav-menu a.active::after { width: 100%; }
`;
document.head.appendChild(style);

// Image fade-in on load (skip slider images — they manage their own visibility)
document.querySelectorAll('img:not(.slider-images img)').forEach(img => {
    if (img.complete) {
        img.style.opacity = '1';
    } else {
        img.style.opacity = '0';
        img.style.transition = 'opacity 0.3s ease';
        img.addEventListener('load', function () { this.style.opacity = '1'; });
        img.addEventListener('error', function () { this.style.opacity = '1'; });
    }
});

// Touch feedback for buttons
document.querySelectorAll('.btn, .icon-btn, .image-slider-btn, .master-nav-btn').forEach(element => {
    element.addEventListener('touchstart', function () { this.style.transform = 'scale(0.95)'; });
    element.addEventListener('touchend', function () { this.style.transform = 'scale(1)'; });
});

// Console message
console.log('%c👋 Welcome to Bibek Koirala\'s Portfolio v2!', 'color: #22d3ee; font-size: 16px; font-weight: bold;');
console.log('%cUse Ctrl+Left/Right to navigate between projects. Try the theme toggle!', 'color: #818cf8; font-size: 12px;');
