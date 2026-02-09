

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
// MASTER PROJECT SLIDER
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
        // Set total projects count
        this.totalProjectsSpan.textContent = this.totalProjects;
        
        // Create project indicators
        this.createIndicators();
        
        // Add event listeners
        this.prevProjectBtn.addEventListener('click', () => this.prevProject());
        this.nextProjectBtn.addEventListener('click', () => this.nextProject());
        
        // Initialize button states
        this.updateButtonStates();

        // ADDED: Initialize Swipe Support for text areas
        this.addTouchSupport();
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' && e.ctrlKey) {
                this.prevProject();
            } else if (e.key === 'ArrowRight' && e.ctrlKey) {
                this.nextProject();
            }
        });
    }

    
    addTouchSupport() {
        let startX = 0, startY = 0;
        const threshold = 50;

        document.querySelectorAll('.project-content').forEach(area => {
            area.addEventListener('touchstart', e => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            }, { passive: true });

            area.addEventListener('touchend', e => {
                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;

                const diffX = startX - endX;
                const diffY = startY - endY;

                // Only horizontal swipe
                if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > threshold) {
                    diffX > 0 ? this.nextProject() : this.prevProject();
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
        
        images.forEach((img, idx) => {
            idx === 0 ? img.classList.add('active') : img.classList.remove('active');
        });
        
        
        dots.forEach((dot, idx) => {
            idx === 0 ? dot.classList.add('active') : dot.classList.remove('active');
        });
    }
}

// ============================================
// IMAGE SLIDER (within each project)
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
        // Create dots
        this.createDots();
        
        // Ensure first image is visible
        if (this.images.length > 0) {
            this.images[0].classList.add('active');
        }
        
        // Add event listeners
        this.prevBtn.addEventListener('click', () => this.prevSlide());
        this.nextBtn.addEventListener('click', () => this.nextSlide());
        
        // Touch support for mobile
        this.addTouchSupport();
    }

    createDots() {
        this.images.forEach((_, index) => {
            const dot = document.createElement('span');
            dot.classList.add('dot');
            if (index === 0) dot.classList.add('active');
            dot.addEventListener('click', () => this.goToSlide(index));
            this.dotsContainer.appendChild(dot);
        });
        this.dots = this.dotsContainer.querySelectorAll('.dot');
    }

    goToSlide(index) {
        if (index === this.currentIndex) return;
        
        const oldIndex = this.currentIndex;
        const newIndex = index;
        
        this.currentIndex = newIndex;
        
        this.images[oldIndex].classList.remove('active');
        this.dots[oldIndex].classList.remove('active');
        
        this.images[newIndex].classList.add('active');
        this.dots[newIndex].classList.add('active');
    }

    nextSlide() {
        let nextIndex = (this.currentIndex + 1) % this.images.length;
        this.goToSlide(nextIndex);
    }

    prevSlide() {
        let prevIndex = (this.currentIndex - 1 + this.images.length) % this.images.length;
        this.goToSlide(prevIndex);
    }

    addTouchSupport() {
        let touchStartX = 0;
        let touchEndX = 0;

        this.slider.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        });

        this.slider.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            this.handleSwipe();
        });

        const handleSwipe = () => {
            if (touchEndX < touchStartX - 50) {
                this.nextSlide();
            }
            if (touchEndX > touchStartX + 50) {
                this.prevSlide();
            }
        };
        this.handleSwipe = handleSwipe;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Master Project Slider
    const masterSlider = new MasterProjectSlider();
    
    // Initialize all image sliders within projects
    const imageSliders = document.querySelectorAll('.project-image-slider');
    imageSliders.forEach(slider => new ImageSlider(slider));
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

// Prevent double-tap zoom ONLY on buttons (iOS-safe)
document.querySelectorAll('button, .btn, .image-slider-btn, .master-nav-btn').forEach(el => {
    let lastTouchEnd = 0;
    el.addEventListener('touchend', e => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
            e.preventDefault();
        }
        lastTouchEnd = now;
    });
});
// Console message
console.log('%c👋 Welcome to Bibek Koirala\'s Portfolio!', 'color: #4A90E2; font-size: 16px; font-weight: bold;');
console.log('%cUse Ctrl+Left/Right to navigate between projects!', 'color: #2C3E50; font-size: 12px;');
