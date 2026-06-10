// ============================================
// DYNAMIC CONTENT LOADER
// Loads data.json and prepends user-added items into the
// Research slider and News slider so the NEWEST appear FIRST.
//
// Exposes: window.dynamicContentReady  (a Promise)
// script.js init awaits this before instantiating sliders.
// ============================================
window.dynamicContentReady = (async function loadDynamicContent() {
    if (document.readyState === 'loading') {
        await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    }

    let data = { research: [], news: [] };

    try {
        const res = await fetch('data.json', { cache: 'no-cache' });
        if (res.ok) data = await res.json();
    } catch (e) {
        console.warn('No data.json found or failed to load — skipping dynamic content.', e);
        return;
    }

    if (!data.research) data.research = [];
    if (!data.news) data.news = [];

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // ---------- RESEARCH ----------
    const projectsContainer = document.querySelector('.projects-container');
    if (projectsContainer && data.research.length > 0) {
        projectsContainer.querySelectorAll('.project-slide.active').forEach(s => s.classList.remove('active'));

        const frag = document.createDocumentFragment();

        data.research.forEach((item, idx) => {
            const slide = document.createElement('div');
            slide.className = 'project-slide' + (idx === 0 ? ' active' : '');
            slide.dataset.project = 'dyn-' + item.id;

            const imagesHtml = (item.images && item.images.length)
                ? item.images.map((src, i) =>
                    `<img src="${esc(src)}" alt="${esc(item.title)} ${i + 1}"${i === 0 ? ' class="active"' : ''}>`
                  ).join('')
                : '';

            const sliderHtml = imagesHtml ? `
                <div class="project-image-slider">
                    <div class="image-slider-container">
                        <button class="image-slider-btn prev-btn"><i class="fas fa-chevron-left"></i></button>
                        <div class="slider-images">${imagesHtml}</div>
                        <button class="image-slider-btn next-btn"><i class="fas fa-chevron-right"></i></button>
                    </div>
                    <div class="slider-dots"></div>
                </div>` : '';

            const linkHtml = item.link ? `
                <a href="${esc(item.link)}" target="_blank" class="btn btn-secondary">
                    <i class="fas fa-external-link-alt"></i> ${esc(item.linkLabel || 'View')}
                </a>` : '';

            slide.innerHTML = `
                <div class="project-content">
                    <h3>${esc(item.title)}</h3>
                    <p>${esc(item.description)}</p>
                    ${linkHtml}
                </div>
                ${sliderHtml}
            `;

            frag.appendChild(slide);
        });

        projectsContainer.insertBefore(frag, projectsContainer.firstChild);
    }

    // ---------- NEWS ----------
    const newsTrack = document.querySelector('.news-slider-track');
    if (newsTrack && data.news.length > 0) {
        const frag = document.createDocumentFragment();

        data.news.forEach((item) => {
            const card = document.createElement('div');
            card.className = 'news-card';

            if (item.images && item.images[0]) {
                card.style.backgroundImage = `url('${item.images[0].replace(/'/g, "\\'")}')`;
                card.style.backgroundSize = 'cover';
                card.style.backgroundPosition = 'center';
            } else {
                card.style.background = 'linear-gradient(135deg, #4A90E2 0%, #2C3E50 100%)';
            }

            const linkHtml = item.link ? `
                <div class="news-actions">
                    <a href="${esc(item.link)}" target="_blank" class="btn btn-primary btn-sm">
                        <i class="fas fa-external-link-alt"></i> ${esc(item.linkLabel || 'Learn More')}
                    </a>
                </div>` : '';

            card.innerHTML = `
                <div class="news-overlay"></div>
                <div class="news-content">
                    <span class="news-tag">${esc(item.tag || 'Update')}</span>
                    <span class="news-date"><i class="fas fa-calendar-alt"></i> ${esc(item.date || '')}</span>
                    <h3>${esc(item.title)}</h3>
                    <p>${esc(item.description)}</p>
                    ${linkHtml}
                </div>
            `;

            frag.appendChild(card);
        });

        newsTrack.insertBefore(frag, newsTrack.firstChild);
    }

    // Update slide counter total
    const totalSpan = document.querySelector('.total-projects');
    if (totalSpan) {
        totalSpan.textContent = document.querySelectorAll('.project-slide').length;
    }
})();
