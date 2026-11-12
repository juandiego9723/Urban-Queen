/**
 * Determina si la petición o sesión pertenece exclusivamente a la agencia Cosmic.
 */
function checkIsCosmic(req, session) {
    if (session && session.db && session.db._initialized && session.db.agencySlug) {
        return session.db.agencySlug === 'cosmic';
    }
    if (session && session.agencySlug) {
        if (session.agencySlug === 'cosmic') return true;
        // Si ya viene resuelta otra agencia desde BD, respetarla ante spoilers en query/referer
        if (session.db && session.db.agencySlug && session.db.agencySlug !== 'cosmic') return false;
    }
    if (session && session.db && session.db.agencySlug === 'cosmic') return true;
    if (req && req.agencySlug === 'cosmic') return true;
    if (req && req.agency && req.agency.slug === 'cosmic') return true;
    if (req && req.query && req.query.agency === 'cosmic') return true;
    const referer = (req && req.headers && req.headers.referer) ? req.headers.referer.toLowerCase() : '';
    if (referer.includes('/cosmic') || referer.includes('agency=cosmic')) return true;
    const username = (req && req.username) || (session && (session.username || (session.db && session.db.username))) || '';
    if (username.toLowerCase().includes('cosmic')) return true;
    return false;
}

module.exports = {
    checkIsCosmic
};
