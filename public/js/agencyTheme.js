// ═══════════════════════════════════════════════════════════════════
//  🏆 TikDance – agencyTheme.js (Frontend Dynamic Theme & Rules)
// ═══════════════════════════════════════════════════════════════════
(function () {
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const reserved = ['login', 'register', 'reset-password', 'control', 'batalla', 'futbol', 'revivir', 'timer', 'api', 'admin'];
    
    let agencySlug = '';
    if (pathSegments.length > 0 && !reserved.includes(pathSegments[0])) {
        agencySlug = pathSegments[0];
    }

    function updateLinks() {
        if (!agencySlug) return;
        window.CURRENT_AGENCY_SLUG = agencySlug;
        document.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            if (href === '/register' || href === '/login' || href === '/reset-password') {
                a.setAttribute('href', `/${agencySlug}${href}`);
            }
        });
    }

    async function initAgencyTheme() {
        updateLinks();
        try {
            const url = agencySlug ? `/api/agency/config?agency=${agencySlug}` : '/api/agency/config';
            const res = await fetch(url);
            if (!res.ok) return;

            const agency = await res.json();
            if (!agency || !agency.theme_config) return;

            const tc = agency.theme_config;
            const root = document.documentElement;

            // Aplicar variables CSS dinámicas
            if (agency.primary_color) root.style.setProperty('--primary-color', agency.primary_color);
            if (agency.secondary_color) root.style.setProperty('--secondary-color', agency.secondary_color);
            if (tc.accentColor) root.style.setProperty('--accent-color', tc.accentColor);
            if (tc.cardBg) root.style.setProperty('--card-bg', tc.cardBg);

            if (tc.bodyBg) {
                document.body.style.backgroundColor = tc.bodyBg;
            }

            // Actualizar título de la página
            if (tc.agencyTitle) {
                document.title = tc.agencyTitle;
                const headerTitle = document.querySelector('.header-titulo, .header-title, .brand-name, h1');
                if (headerTitle && !headerTitle.dataset.customized) {
                    headerTitle.textContent = tc.agencyTitle;
                    headerTitle.dataset.customized = 'true';
                }
            }

            if (tc.modeLabel) {
                const modeEl = document.querySelector('.modo-label');
                if (modeEl) modeEl.textContent = tc.modeLabel;
            }

            if (tc.secondsPerCoinText) {
                const coinEl = document.querySelector('#caja-reloj .texto-monedas');
                if (coinEl) coinEl.textContent = tc.secondsPerCoinText;
            }

            // Actualizar logotipo si está disponible
            if (agency.logo_url) {
                const logoImgs = document.querySelectorAll('.agency-logo, .brand-logo');
                logoImgs.forEach(img => { img.src = agency.logo_url; });
            }

            // Exponer configuración global en el cliente
            window.AGENCY_CONFIG = agency;
            updateLinks();
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar la configuración dinámica de la agencia:', e.message);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            updateLinks();
            initAgencyTheme();
        });
    } else {
        updateLinks();
        initAgencyTheme();
    }
})();
