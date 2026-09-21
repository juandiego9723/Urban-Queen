const { query } = require('../config/dbPool');

// Cache en memoria para la configuración de agencias (TTL: 5 minutos)
const agencyCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchAgencyBySlug(slug) {
    if (!slug) return null;
    const lowerSlug = slug.toLowerCase().trim();
    
    // Revisar caché
    const cached = agencyCache.get(lowerSlug);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.data;
    }

    try {
        const res = await query('SELECT * FROM agencies WHERE LOWER(slug) = $1 AND active = true', [lowerSlug]);
        if (res.rows.length > 0) {
            const agency = res.rows[0];
            agencyCache.set(lowerSlug, { data: agency, timestamp: Date.now() });
            return agency;
        }
    } catch (e) {
        console.error(`⚠️ Error buscando agencia con slug '${slug}':`, e.message);
    }
    return null;
}

function clearAgencyCache(slug = null) {
    if (slug) {
        agencyCache.delete(slug.toLowerCase().trim());
    } else {
        agencyCache.clear();
    }
}

async function agencyMiddleware(req, res, next) {
    // 1. Extraer slug de la URL (/cosmic, /urbanqueens), header o query
    let slug = null;
    const urlParts = req.path.split('/').filter(Boolean);
    
    if (urlParts.length > 0) {
        const firstPart = urlParts[0].toLowerCase();
        // Evitar interceptar archivos estáticos o APIs globales directas que no tengan slug
        const reservedPrefixes = ['api', 'js', 'css', 'img', 'regalos', 'audio', 'favicon.ico', 'socket.io'];
        if (!reservedPrefixes.includes(firstPart)) {
            slug = firstPart;
        }
    }

    if (!slug) {
        slug = req.headers['x-agency-slug'] || req.query.agency || null;
    }

    if (slug) {
        const agency = await fetchAgencyBySlug(slug);
        if (agency) {
            req.agency = agency;
            req.agencySlug = agency.slug;
        }
    }

    // Fallback a agencia default si no se especifica slug
    if (!req.agency) {
        const defaultAgency = await fetchAgencyBySlug('urbanqueens') || await fetchAgencyBySlug('cosmic');
        if (defaultAgency) {
            req.agency = defaultAgency;
            req.agencySlug = defaultAgency.slug;
        }
    }

    next();
}

module.exports = {
    agencyMiddleware,
    fetchAgencyBySlug,
    clearAgencyCache
};
