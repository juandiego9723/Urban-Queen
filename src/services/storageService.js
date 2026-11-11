const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'tikdance-508616-media';
let _storageClient = null;

function getStorageClient() {
    if (_storageClient) return _storageClient;
    try {
        const { Storage } = require('@google-cloud/storage');
        _storageClient = new Storage();
        return _storageClient;
    } catch (e) {
        console.warn('⚠️ @google-cloud/storage no disponible:', e.message);
        return null;
    }
}

function parseBase64Image(base64Str) {
    if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image')) {
        return null;
    }
    const matches = base64Str.match(/^data:image\/([A-Za-z0-9.+-]+)(?:;[A-Za-z0-9=+-]+)*;base64,(.+)$/s);
    if (!matches || matches.length !== 3) {
        return null;
    }
    const rawMime = matches[1].toLowerCase();
    let ext = rawMime;
    if (rawMime === 'jpeg') ext = 'jpg';
    else if (rawMime.includes('svg')) ext = 'svg';
    else if (rawMime.includes('png')) ext = 'png';
    else if (rawMime.includes('webp')) ext = 'webp';
    else if (rawMime.includes('gif')) ext = 'gif';

    const contentType = `image/${rawMime}`;
    const rawData = matches[2].replace(/\s/g, '');
    const buffer = Buffer.from(rawData, 'base64');
    if (!buffer || buffer.length === 0) return null;

    return { buffer, ext, contentType };
}

/**
 * Sube una imagen Base64 a Google Cloud Storage y devuelve su URL pública.
 * Si no es Base64 (ya es ruta o URL), la devuelve sin cambios.
 */
async function uploadBase64Image(base64Str, { folder = 'regalos', prefix = 'img' } = {}) {
    if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image')) {
        return base64Str;
    }

    const parsed = parseBase64Image(base64Str);
    if (!parsed) {
        console.warn(`⚠️ Formato Base64 no reconocido para ${prefix}`);
        return base64Str;
    }

    const safePrefix = String(prefix || 'img').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40);
    const filename = `${safePrefix}_${crypto.randomUUID()}.${parsed.ext}`;
    const objectPath = folder ? `${folder.replace(/^\/+|\/+$/g, '')}/${filename}` : filename;

    const storage = getStorageClient();
    if (storage && BUCKET_NAME) {
        try {
            const bucket = storage.bucket(BUCKET_NAME);
            const file = bucket.file(objectPath);
            await file.save(parsed.buffer, {
                resumable: false,
                metadata: {
                    contentType: parsed.contentType,
                    cacheControl: 'public, max-age=31536000, immutable'
                }
            });
            return `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath}`;
        } catch (err) {
            console.error(`⚠️ Error subiendo a GCS (${objectPath}):`, err.message);
        }
    }

    // Fallback local únicamente si GCS no está disponible (p. ej. desarrollo offline)
    try {
        const regalosDir = path.join(__dirname, '..', '..', 'public', 'regalos');
        if (!fs.existsSync(regalosDir)) fs.mkdirSync(regalosDir, { recursive: true });
        fs.writeFileSync(path.join(regalosDir, filename), parsed.buffer);
        return `/regalos/${filename}`;
    } catch (e) {
        console.error('Error en fallback local de imagen:', e.message);
        return base64Str;
    }
}

module.exports = {
    BUCKET_NAME,
    parseBase64Image,
    uploadBase64Image
};

