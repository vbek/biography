

// Mobile Menu Toggle
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

hamburger.addEventListener('click', () => {
    navMenu.classList.toggle('active');
    hamburger.classList.toggle('active');
});

document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', () => {
        navMenu.classList.remove('active');
        hamburger.classList.remove('active');
    });
});

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
        
        this.init();
    }
    
    init() {
        this.totalProjectsSpan.textContent = this.totalProjects;
        this.createIndicators();
        
        this.prevProjectBtn.addEventListener('click', () => this.prevProject());
        this.nextProjectBtn.addEventListener('click', () => this.nextProject());
        
        this.updateButtonStates();
        this.addTouchSupport(); // Initialize Swipe for text areas
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' && e.ctrlKey) this.prevProject();
            else if (e.key === 'ArrowRight' && e.ctrlKey) this.nextProject();
        });
    }

    addTouchSupport() {
        let touchStartX = 0;
        let touchEndX = 0;
        const threshold = 60; 

        // Target only the text area to change projects
        const textAreas = document.querySelectorAll('.project-content');

        textAreas.forEach(area => {
            area.addEventListener('touchstart', (e) => {
                touchStartX = e.changedTouches[0].screenX;
            }, { passive: true });

            area.addEventListener('touchend', (e) => {
                touchEndX = e.changedTouches[0].screenX;
                const distance = touchStartX - touchEndX;

                if (Math.abs(distance) > threshold) {
                    if (distance > 0) this.nextProject();
                    else this.prevProject();
                }
            }, { passive: true });
        });
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
        const images = currentSlide.querySelectorAll('.slider-images img');
        const dots = currentSlide.querySelectorAll('.dot');
        images.forEach((img, idx) => idx === 0 ? img.classList.add('active') : img.classList.remove('active'));
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
        if (this.images.length > 0) this.images[0].classList.add('active');
        
        this.prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this.prevSlide(); });
        this.nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.nextSlide(); });
        
        this.addTouchSupport();
    }

    createDots() {
        this.images.forEach((_, index) => {
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
        this.images[this.currentIndex].classList.remove('active');
        this.dots[this.currentIndex].classList.remove('active');
        this.currentIndex = index;
        this.images[this.currentIndex].classList.add('active');
        this.dots[this.currentIndex].classList.add('active');
    }

    nextSlide() {
        this.goToSlide((this.currentIndex + 1) % this.images.length);
    }

    prevSlide() {
        this.goToSlide((this.currentIndex - 1 + this.images.length) % this.images.length);
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
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Master Slider
    new MasterProjectSlider();

    // 2. Initialize all Image Sliders
    document.querySelectorAll('.project-image-slider').forEach(slider => {
        new ImageSlider(slider);
    });

    // 3. CLEANED UP MOBILE MENU LOGIC
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    const navLinks = document.querySelectorAll('.nav-menu a');

    if (hamburger && navMenu) {
        // Toggle function
        const toggleMenu = () => {
            navMenu.classList.toggle('active');
            hamburger.classList.toggle('active');
        };

        // Single click listener (works on mobile and desktop)
        hamburger.addEventListener('click', toggleMenu);

        // Close menu when a link is clicked
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                hamburger.classList.remove('active');
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

// Add loading animation for images (excluding slider images)
document.querySelectorAll('img:not(.slider-images img)').forEach(img => {
    img.addEventListener('load', function() {
        this.style.opacity = '1';
    });
    
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.3s ease';
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

// Prevent double-tap zoom on buttons (iOS)
let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);

// Console message
console.log('%c👋 Welcome to Bibek Koirala\'s Portfolio!', 'color: #4A90E2; font-size: 16px; font-weight: bold;');
console.log('%cUse Ctrl+Left/Right to navigate between projects!', 'color: #2C3E50; font-size: 12px;');
