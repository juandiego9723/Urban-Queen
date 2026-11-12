(function (global) {
    'use strict';

    const STYLE_ID = 'cosmic-goleadores-widget-styles';

    const DEMO_PAYLOAD = {
        enabled: true,
        mesKey: new Date().toISOString().slice(0, 7),
        config: { criterio: 'puntos', soloEnBatalla: false, mostrarEnHud: true },
        equipos: {
            equipo1: { nombre: 'BARÇA', diseno: 'barsa', color1: '#004D98', color2: '#A50044' },
            equipo2: { nombre: 'REAL', diseno: 'real', color1: '#FFFFFF', color2: '#CCCCCC' }
        },
        equipo1: [
            { rank: 1, viewer: 'JUANITO', avatar: '', puntos: 12, goles: 12, score: 12 },
            { rank: 2, viewer: 'DAVID', avatar: '', puntos: 8, goles: 8, score: 8 },
            { rank: 3, viewer: 'CARLOS', avatar: '', puntos: 3, goles: 3, score: 3 }
        ],
        equipo2: [
            { rank: 1, viewer: 'MATEO', avatar: '', puntos: 9, goles: 9, score: 9 },
            { rank: 2, viewer: 'SANTI', avatar: '', puntos: 5, goles: 5, score: 5 },
            { rank: 3, viewer: 'LUCAS', avatar: '', puntos: 2, goles: 2, score: 2 }
        ]
    };

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .cgw-board {
                display: grid;
                grid-template-columns: repeat(2, minmax(250px, 345px));
                gap: clamp(14px, 3vw, 38px);
                justify-content: center;
                align-items: start;
                width: 100%;
                font-family: 'TikTok Sans', 'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif;
            }
            .cgw-board.cgw-hud-mode {
                grid-template-columns: repeat(2, minmax(220px, 315px));
                gap: clamp(12px, 2.5vw, 32px);
                margin-top: 8px;
            }
            .cgw-card {
                position: relative;
                border-radius: 16px;
                padding: 10px 14px 13px 22px;
                box-shadow:
                    0 12px 26px rgba(0, 0, 0, 0.72),
                    inset 0 1px 0 rgba(255, 255, 255, 0.35),
                    inset 0 -2px 6px rgba(0, 0, 0, 0.45);
                overflow: visible;
                transition: background 0.35s ease, border-color 0.35s ease;
            }
            .cgw-card::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: 15px;
                background: linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 42%);
                pointer-events: none;
            }
            .cgw-theme-barsa {
                background: linear-gradient(112deg, #062559 0%, #0c3576 42%, #4c1147 72%, #7c0e38 100%);
                border: 2px solid #d4af37;
            }
            .cgw-theme-real {
                background: linear-gradient(112deg, #272e38 0%, #48525f 48%, #7c8a99 100%);
                border: 2px solid #2b323d;
                box-shadow:
                    0 12px 26px rgba(0, 0, 0, 0.65),
                    inset 0 1px 0 rgba(255, 255, 255, 0.65),
                    inset 0 -2px 6px rgba(0, 0, 0, 0.45);
            }
            .cgw-theme-psg {
                background: linear-gradient(112deg, #071936 0%, #0d2b57 48%, #7f1224 100%);
                border: 2px solid #da291c;
            }
            .cgw-header {
                position: relative;
                text-align: center;
                font-size: clamp(14px, 1.8vw, 17px);
                font-weight: 900;
                font-style: italic;
                letter-spacing: 0.7px;
                color: #ffffff;
                text-transform: uppercase;
                margin-bottom: 9px;
                padding-right: 6px;
                text-shadow:
                    0 2px 0 rgba(0, 0, 0, 0.85),
                    0 3px 8px rgba(0, 0, 0, 0.9);
            }
            .cgw-rows {
                position: relative;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .cgw-row {
                position: relative;
                display: flex;
                align-items: center;
                gap: 7px;
                min-height: 44px;
                padding: 4px 12px 4px 16px;
                border-radius: 999px;
                background: linear-gradient(90deg, rgba(6, 20, 52, 0.92) 0%, rgba(12, 34, 78, 0.82) 100%);
                border: 1.5px solid rgba(155, 195, 255, 0.35);
                box-shadow:
                    inset 0 1px 0 rgba(255, 255, 255, 0.22),
                    0 4px 10px rgba(0, 0, 0, 0.45);
                transition: transform 0.25s ease, box-shadow 0.25s ease;
            }
            .cgw-theme-real .cgw-row {
                background: linear-gradient(90deg, rgba(24, 29, 36, 0.9) 0%, rgba(44, 53, 64, 0.82) 100%);
                border-color: rgba(255, 255, 255, 0.35);
            }
            .cgw-row.cgw-rank-1 {
                border-color: rgba(245, 203, 76, 0.75);
            }
            .cgw-row.cgw-empty {
                opacity: 0.58;
            }
            .cgw-row.cgw-flash {
                animation: cgwRowPulse 0.65s ease-out;
            }
            @keyframes cgwRowPulse {
                0% { transform: scale(1); filter: brightness(1); }
                40% { transform: scale(1.03); filter: brightness(1.35); box-shadow: 0 0 18px rgba(255, 224, 72, 0.65); }
                100% { transform: scale(1); filter: brightness(1); }
            }
            .cgw-badge {
                position: absolute;
                left: -21px;
                top: 50%;
                transform: translateY(-50%);
                width: 34px;
                height: 34px;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
                filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.75));
                z-index: 3;
            }
            .cgw-badge-crown {
                width: 40px;
                height: 40px;
                left: -23px;
            }
            .cgw-pos {
                font-size: 16px;
                font-weight: 900;
                font-style: italic;
                color: #ffffff;
                min-width: 18px;
                text-align: center;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.9);
            }
            .cgw-avatar-ring {
                width: 34px;
                height: 34px;
                border-radius: 50%;
                flex-shrink: 0;
                padding: 2px;
                background: linear-gradient(135deg, #b8c4d4, #64748b);
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.65);
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .cgw-rank-1 .cgw-avatar-ring {
                background: linear-gradient(135deg, #ffe97d, #d49617);
            }
            .cgw-rank-2 .cgw-avatar-ring {
                background: linear-gradient(135deg, #ffffff, #94a3b8);
            }
            .cgw-rank-3 .cgw-avatar-ring {
                background: linear-gradient(135deg, #f1aa6c, #994f1c);
            }
            .cgw-avatar-inner {
                width: 100%;
                height: 100%;
                border-radius: 50%;
                overflow: hidden;
                background: #14213d;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #ffffff;
                font-weight: 900;
                font-size: 14px;
            }
            .cgw-avatar-inner img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .cgw-name {
                flex: 1;
                min-width: 0;
                font-size: clamp(14px, 1.55vw, 17px);
                font-weight: 900;
                font-style: italic;
                color: #ffffff;
                text-transform: uppercase;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                letter-spacing: 0.3px;
                text-shadow:
                    0 2px 0 rgba(0, 0, 0, 0.85),
                    0 2px 6px rgba(0, 0, 0, 0.8);
            }
            .cgw-empty .cgw-name {
                font-size: 12px;
                letter-spacing: 0.6px;
                color: rgba(255, 255, 255, 0.65);
            }
            .cgw-score-wrap {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
                margin-left: 4px;
            }
            .cgw-ball {
                width: 21px;
                height: 21px;
                flex-shrink: 0;
                filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.7));
            }
            .cgw-score {
                font-size: clamp(18px, 2vw, 22px);
                font-weight: 900;
                font-style: italic;
                line-height: 1;
                min-width: 20px;
                text-align: right;
                text-shadow:
                    0 2px 0 rgba(0, 0, 0, 0.9),
                    0 3px 8px rgba(0, 0, 0, 0.85);
            }
            .cgw-rank-1 .cgw-score { color: #ffe838; }
            .cgw-rank-2 .cgw-score { color: #ffffff; }
            .cgw-rank-3 .cgw-score { color: #e89a56; }

            @media (max-width: 600px) {
                .cgw-board {
                    grid-template-columns: minmax(250px, 345px);
                    gap: 18px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatScore(val) {
        const num = Math.max(0, parseInt(val, 10) || 0);
        if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 100000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        if (num >= 10000) return num.toLocaleString('en-US');
        return String(num);
    }

    function resolveTeamTheme(equipoCfg, defaultTheme) {
        const cfg = equipoCfg || {};
        const d = String(cfg.diseno || 'auto').trim().toLowerCase();
        const name = String(cfg.nombre || '').trim().toLowerCase().replace(/\./g, '');
        const c1 = String(cfg.color1 || '').trim();
        const c2 = String(cfg.color2 || '').trim();

        if (d === 'barsa') return { className: 'cgw-theme-barsa', customStyle: '' };
        if (d === 'real') return { className: 'cgw-theme-real', customStyle: '' };
        if (d === 'psg') return { className: 'cgw-theme-psg', customStyle: '' };
        if (d === 'personalizado' && c1 && c2) {
            return {
                className: 'cgw-theme-custom',
                customStyle: `background: linear-gradient(115deg, ${escapeHtml(c1)}, ${escapeHtml(c2)}); border: 2px solid #d4af37;`
            };
        }

        if (/bar[csç]a|barcelona|fcb/i.test(name)) return { className: 'cgw-theme-barsa', customStyle: '' };
        if (/(^|\s)(real(\s*madrid)?|madrid|rmadrid)(\s|$)/i.test(name) || name.includes('madrid')) {
            return { className: 'cgw-theme-real', customStyle: '' };
        }
        if (/(^|\s)(psg|paris)/i.test(name) || name.includes('psg')) {
            return { className: 'cgw-theme-psg', customStyle: '' };
        }

        const c1Low = c1.toLowerCase();
        const c2Low = c2.toLowerCase();
        if (c1Low === '#004d98' || c2Low === '#a50044') return { className: 'cgw-theme-barsa', customStyle: '' };
        if (c1Low.includes('fff') && c2Low.includes('ccc')) return { className: 'cgw-theme-real', customStyle: '' };
        if (c1Low === '#001c3d' && c2Low === '#da291c') return { className: 'cgw-theme-psg', customStyle: '' };
        if (c1 && c2) {
            return {
                className: 'cgw-theme-custom',
                customStyle: `background: linear-gradient(115deg, ${escapeHtml(c1)}, ${escapeHtml(c2)}); border: 2px solid rgba(255,255,255,0.45);`
            };
        }

        return { className: defaultTheme === 'real' ? 'cgw-theme-real' : 'cgw-theme-barsa', customStyle: '' };
    }

    function crownSvg(gradId) {
        const gid = gradId || 'cgwCrownGrad';
        return `<svg viewBox="0 0 64 56" width="100%" height="100%" aria-hidden="true">
            <defs>
                <linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#fff49c"/>
                    <stop offset="50%" stop-color="#ffd028"/>
                    <stop offset="100%" stop-color="#b9770e"/>
                </linearGradient>
            </defs>
            <path d="M8 44 L4 16 L19 27 L32 8 L45 27 L60 16 L56 44 Z" fill="url(#${gid})" stroke="#4a2b00" stroke-width="3" stroke-linejoin="round"/>
            <rect x="8" y="42" width="48" height="8" rx="3" fill="#e59c14" stroke="#4a2b00" stroke-width="2.5"/>
            <circle cx="4" cy="14" r="3.5" fill="#fff176" stroke="#4a2b00" stroke-width="2"/>
            <circle cx="32" cy="7" r="4" fill="#fff176" stroke="#4a2b00" stroke-width="2"/>
            <circle cx="60" cy="14" r="3.5" fill="#fff176" stroke="#4a2b00" stroke-width="2"/>
        </svg>`;
    }

    function medalSvg(rank) {
        const isSilver = rank === 2;
        const ringLight = isSilver ? '#f8fafc' : '#f3ad73';
        const ringDark = isSilver ? '#7f8ea3' : '#964b19';
        const faceMid = isSilver ? '#cfd8e3' : '#cf7838';
        return `<svg viewBox="0 0 48 56" width="100%" height="100%" aria-hidden="true">
            <path d="M12 2 L22 2 L24 18 L14 18 Z" fill="#1d4ed8" stroke="#0f172a" stroke-width="1.5"/>
            <path d="M36 2 L26 2 L24 18 L34 18 Z" fill="#dc2626" stroke="#0f172a" stroke-width="1.5"/>
            <circle cx="24" cy="35" r="16" fill="${ringDark}" stroke="#1e293b" stroke-width="2.2"/>
            <circle cx="24" cy="34" r="13.5" fill="${faceMid}" stroke="${ringLight}" stroke-width="2"/>
            <text x="24" y="40" text-anchor="middle" font-size="17" font-weight="900" font-family="Arial, sans-serif" fill="#1e293b" opacity="0.4">${rank}</text>
            <text x="24" y="39" text-anchor="middle" font-size="16" font-weight="900" font-family="Arial, sans-serif" fill="#ffffff">${rank}</text>
        </svg>`;
    }

    function soccerBallSvg() {
        return `<svg class="cgw-ball" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="16" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>
            <polygon points="18,10 25,15 22,23 14,23 11,15" fill="#111827"/>
            <polygon points="18,2 23,6 18,10 13,6" fill="#111827"/>
            <polygon points="32,12 34,19 28,20 25,15 29,10" fill="#111827"/>
            <polygon points="4,12 7,10 11,15 8,20 2,19" fill="#111827"/>
            <polygon points="9,31 7,26 14,23 16,29 12,33" fill="#111827"/>
            <polygon points="27,31 24,33 20,29 22,23 29,26" fill="#111827"/>
            <path d="M18 10 L18 6 M25 15 L29 13 M22 23 L26 27 M14 23 L10 27 M11 15 L7 13" stroke="#1e293b" stroke-width="1.3"/>
        </svg>`;
    }

    function renderAvatar(viewer, avatarUrl) {
        const initial = escapeHtml((String(viewer || '?').replace(/^@/, '').charAt(0) || '?').toUpperCase());
        if (!avatarUrl) {
            return `<div class="cgw-avatar-inner">${initial}</div>`;
        }
        return `<div class="cgw-avatar-inner">
            <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(viewer)}" onerror="this.style.display='none'; this.parentElement.textContent='${initial}';">
        </div>`;
    }

    function buildRowHtml(rank, item, flashed, keyName) {
        const badgeHtml = rank === 1 ? crownSvg(`cgwCrown-${keyName}`) : medalSvg(rank);
        if (!item) {
            return `<div class="cgw-row cgw-rank-${rank} cgw-empty">
                <div class="cgw-badge ${rank === 1 ? 'cgw-badge-crown' : ''}">${badgeHtml}</div>
                <div class="cgw-pos">${rank}.</div>
                <div class="cgw-avatar-ring"><div class="cgw-avatar-inner">-</div></div>
                <div class="cgw-name">ESPERANDO GOL</div>
                <div class="cgw-score-wrap">${soccerBallSvg()}<span class="cgw-score">0</span></div>
            </div>`;
        }
        const handle = String(item.viewer || 'DONADOR').replace(/^@/, '');
        const scoreVal = item.score !== undefined ? item.score : (item.puntos || item.goles || 0);
        return `<div class="cgw-row cgw-rank-${rank} ${flashed ? 'cgw-flash' : ''}">
            <div class="cgw-badge ${rank === 1 ? 'cgw-badge-crown' : ''}">${badgeHtml}</div>
            <div class="cgw-pos">${rank}.</div>
            <div class="cgw-avatar-ring">${renderAvatar(handle, item.avatar)}</div>
            <div class="cgw-name">@${escapeHtml(handle)}</div>
            <div class="cgw-score-wrap">${soccerBallSvg()}<span class="cgw-score">${escapeHtml(formatScore(scoreVal))}</span></div>
        </div>`;
    }

    const previousScores = { eq1: {}, eq2: {} };

    function renderTeamCard(list, cfg, defaultTheme, keyName) {
        const theme = resolveTeamTheme(cfg, defaultTheme);
        const rows = [];
        const nextMap = {};
        for (let i = 0; i < 3; i++) {
            const rank = i + 1;
            const item = list[i] || null;
            let flashed = false;
            if (item && item.viewer) {
                const sc = Number(item.score !== undefined ? item.score : item.puntos || 0);
                nextMap[item.viewer] = sc;
                if (previousScores[keyName][item.viewer] !== undefined && sc > previousScores[keyName][item.viewer]) {
                    flashed = true;
                }
            }
            rows.push(buildRowHtml(rank, item, flashed, keyName));
        }
        previousScores[keyName] = nextMap;

        return `<div class="cgw-card ${theme.className}" ${theme.customStyle ? `style="${theme.customStyle}"` : ''}>
            <div class="cgw-header">MÁXIMOS GOLEADORES</div>
            <div class="cgw-rows">${rows.join('')}</div>
        </div>`;
    }

    function renderGoleadoresClasicoCards(container, payload, options = {}) {
        if (!container) return;
        injectStyles();

        const data = payload || {};
        const eq1List = Array.isArray(data.equipo1) ? data.equipo1 : [];
        const eq2List = Array.isArray(data.equipo2) ? data.equipo2 : [];
        const eq1Cfg = (data.equipos && data.equipos.equipo1) || {};
        const eq2Cfg = (data.equipos && data.equipos.equipo2) || {};

        const hudModeClass = options.hudMode ? 'cgw-hud-mode' : '';
        container.innerHTML = `<div class="cgw-board ${hudModeClass}">
            ${renderTeamCard(eq1List, eq1Cfg, 'barsa', 'eq1')}
            ${renderTeamCard(eq2List, eq2Cfg, 'real', 'eq2')}
        </div>`;
    }

    global.CosmicGoleadoresWidget = {
        DEMO_PAYLOAD,
        render: renderGoleadoresClasicoCards,
        formatScore
    };
})(window);
