const fs = require('fs');
const path = require('path');

function applyPatch() {
    const targetPath = path.join(__dirname, '..', 'node_modules', 'tiktok-live-connector', 'dist', 'legacy.js');

    if (!fs.existsSync(targetPath)) {
        console.log('[Patch] tiktok-live-connector no está instalado aún. Omitiendo parche.');
        return;
    }

    try {
        let code = fs.readFileSync(targetPath, 'utf8');
        let modified = false;

        // 1. Parche getTopViewerAttributes
        if (!code.includes('if (!Array.isArray(topViewers)) return [];')) {
            code = code.replace(
                'function getTopViewerAttributes(topViewers) {',
                'function getTopViewerAttributes(topViewers) {\n\tif (!Array.isArray(topViewers)) return [];'
            );
            modified = true;
        }

        // 2. Parche getUserAttributes
        if (!code.includes('const avatarUrls = webcastUser.avatarLarge')) {
            const targetPattern = /function getUserAttributes\(webcastUser\) \{[\s\S]*?const userAttributes = \{[\s\S]*?profilePictureUrl: getPreferredPictureFormat\(webcastUser\.avatarLarge\),/;
            if (targetPattern.test(code)) {
                code = code.replace(
                    targetPattern,
                    `function getUserAttributes(webcastUser) {
\twebcastUser ||= {};
\tconst avatarUrls = webcastUser.avatarLarge?.urlList || webcastUser.avatarLarge?.url_list ||
\t                   webcastUser.avatarMedium?.urlList || webcastUser.avatarMedium?.url_list ||
\t                   webcastUser.avatarThumb?.urlList || webcastUser.avatarThumb?.url_list ||
\t                   webcastUser.avatarLarge || webcastUser.avatarThumb;
\tconst userAttributes = {
\t\tuserId: webcastUser.idStr?.toString(),
\t\tsecUid: webcastUser.secUid?.toString(),
\t\tuniqueId: webcastUser.displayId !== "" ? webcastUser.displayId : void 0,
\t\tnickname: webcastUser.nickname !== "" ? webcastUser.nickname : void 0,
\t\tprofilePictureUrl: getPreferredPictureFormat(avatarUrls),`
            );
            modified = true;
        }
    }

    // 3. Parche getPreferredPictureFormat
    if (!code.includes("typeof pictureUrls === 'object'")) {
        code = code.replace(
            'function getPreferredPictureFormat(pictureUrls) {\n\tif (!pictureUrls || !Array.isArray(pictureUrls) || !pictureUrls.length) return null;',
            `function getPreferredPictureFormat(pictureUrls) {
\tif (pictureUrls && typeof pictureUrls === 'object' && !Array.isArray(pictureUrls)) {
\t\tpictureUrls = pictureUrls.urlList || pictureUrls.url_list || pictureUrls.urls || null;
\t}
\tif (!pictureUrls || !Array.isArray(pictureUrls) || !pictureUrls.length) return null;`
        );
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(targetPath, code, 'utf8');
        console.log('✅ [Patch] tiktok-live-connector/dist/legacy.js parcheado exitosamente.');
    } else {
        console.log('ℹ️ [Patch] tiktok-live-connector/dist/legacy.js ya cuenta con las correcciones necesarias.');
    }
    } catch (err) {
        console.error('⚠️ [Patch] Error aplicando parche a tiktok-live-connector:', err.message);
    }
}

applyPatch();
module.exports = applyPatch;
