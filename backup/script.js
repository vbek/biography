




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
            console.error('MasterProjectSlider: required elements not found', {
                prevBtn: this.prevProjectBtn,
                nextBtn: this.nextProjectBtn,
                indicators: this.indicatorsContainer,
                slides: this.totalProjects
            });
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
        this.addTouchSupport(); // Initialize Swipe for text areas
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
        const items = currentSlide.querySelectorAll('.slider-images img, .slider-images video'); // ✅ Include videos
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
        this.images = sliderElement.querySelectorAll('.slider-images img');
        this.prevBtn = sliderElement.querySelector('.prev-btn');
        this.nextBtn = sliderElement.querySelector('.next-btn');
        this.dotsContainer = sliderElement.querySelector('.slider-dots');
        this.currentIndex = 0;
        
        this.init();
    }

    init() {
        this.createDots();
        this.items = this.slider.querySelectorAll('.slider-images img, .slider-images video'); // Change this line
        if (this.items.length > 0) this.items[0].classList.add('active');
        
        this.prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this.prevSlide(); });
        this.nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.nextSlide(); });
        
        this.addTouchSupport();
    }

    // Update the createDots method
    createDots() {
        const items = this.slider.querySelectorAll('.slider-images img, .slider-images video'); // Change this line
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
        
        // Pause video if leaving it
        const currentItem = this.items[this.currentIndex];
        if (currentItem.tagName === 'VIDEO') {
            currentItem.pause();
        }
        
        this.items[this.currentIndex].classList.remove('active');
        this.dots[this.currentIndex].classList.remove('active');
        this.currentIndex = index;
        this.items[this.currentIndex].classList.add('active');
        this.dots[this.currentIndex].classList.add('active');
        
        // Play video if entering it
        const newItem = this.items[this.currentIndex];
        if (newItem.tagName === 'VIDEO') {
            newItem.play();
        }
    }

    // Update nextSlide and prevSlide
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
            e.stopPropagation(); // Block master project swipe
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        this.slider.addEventListener('touchend', (e) => {
            e.stopPropagation(); // Block master project swipe
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
        this.GAP        = 24; // px gap between cards

        // Wait for full layout before measuring
        requestAnimationFrame(() => {
            this.setCardWidths();
            this.buildDots();
            this.update();
        });

        this.prevBtn.addEventListener('click', () => this.go(this.currentIdx - 1));
        this.nextBtn.addEventListener('click', () => this.go(this.currentIdx + 1));

        // Touch swipe
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

        // Recalc on resize
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
            card.style.flex    = '0 0 ' + cardW + 'px';
            card.style.width   = cardW + 'px';
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
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // 0. Wait for dynamic-loader.js to finish injecting cards from data.json
    //    so sliders capture both static AND dynamic cards.
    if (window.dynamicContentReady) {
        try { await window.dynamicContentReady; } catch (e) { /* non-fatal */ }
    }

    // 1. Initialize Master Slider
    new MasterProjectSlider();

    // 2. Initialize all Image Sliders
    document.querySelectorAll('.project-image-slider').forEach(slider => {
        new ImageSlider(slider);
    });

    // 2b. Initialize News Slider
    new NewsSlider();

    // 3. FIXED MOBILE MENU LOGIC
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    const navLinks = document.querySelectorAll('.nav-menu a');

    if (hamburger && navMenu) {
        let menuTouched = false;

        hamburger.addEventListener('touchstart', (e) => {
            e.preventDefault(); // stop ghost click
            menuTouched = true;
            navMenu.classList.toggle('active');
            hamburger.classList.toggle('active');
        }, { passive: false });

        hamburger.addEventListener('click', () => {
            if (menuTouched) { menuTouched = false; return; } // skip ghost click
            navMenu.classList.toggle('active');
            hamburger.classList.toggle('active');
        });

        // Close menu when a link is clicked
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                hamburger.classList.remove('active');
            });
        });
    }

    // 4. ADD THIS: Scroll to Top on Logo Click
    const navLogo = document.querySelector('.nav-logo');
    if (navLogo) {
        navLogo.addEventListener('click', (e) => {
            e.preventDefault();
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }
});
// Comment Button Functionality
const commentButtons = document.querySelectorAll('.comment-btn');
commentButtons.forEach(btn => {
    btn.addEventListener('click', function() {
        alert('Comment functionality - Connect this to your comment system');
    });
});

// Smooth Scroll with Offset for Fixed Navbar
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;
        
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            const navbarHeight = document.querySelector('.navbar').offsetHeight;
            const targetPosition = targetElement.offsetTop - navbarHeight - 20;
            
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    });
});

// Scroll Reveal Animation
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('fade-in');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

document.querySelectorAll('.news-card, .path-card').forEach(el => {
    observer.observe(el);
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
});

// Add active class style
const style = document.createElement('style');
style.textContent = `
    .nav-menu a.active {
        color: var(--primary-color);
    }
    .nav-menu a.active::after {
        width: 100%;
    }
`;
document.head.appendChild(style);

// Download Resume Button
const downloadBtn = document.querySelector('.download-btn');
if (downloadBtn) {
    downloadBtn.addEventListener('click', function(e) {
        console.log('Resume download initiated');
    });
}

document.querySelectorAll('img:not(.slider-images img)').forEach(img => {
    if (img.complete) {
        img.style.opacity = '1'; // already loaded, show immediately
    } else {
        img.style.opacity = '0';
        img.style.transition = 'opacity 0.3s ease';
        img.addEventListener('load', function() {
            this.style.opacity = '1';
        });
        img.addEventListener('error', function() {
            this.style.opacity = '1'; // show even if broken
        });
    }
});

// Add touch feedback for mobile
document.querySelectorAll('.btn, .icon-btn, .image-slider-btn, .master-nav-btn').forEach(element => {
    element.addEventListener('touchstart', function() {
        this.style.transform = 'scale(0.95)';
    });
    
    element.addEventListener('touchend', function() {
        this.style.transform = 'scale(1)';
    });
});

// Note: double-tap zoom prevention removed — it was blocking swipe and button touches

// Console message
console.log('%c👋 Welcome to Bibek Koirala\'s Portfolio!', 'color: #4A90E2; font-size: 16px; font-weight: bold;');
console.log('%cUse Ctrl+Left/Right to navigate between projects!', 'color: #2C3E50; font-size: 12px;');

