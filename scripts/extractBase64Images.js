const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('DATABASE_URL no definida en variables de entorno.');
    process.exit(1);
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

const regalosDir = path.join(__dirname, '..', 'public', 'regalos');
if (!fs.existsSync(regalosDir)) {
    fs.mkdirSync(regalosDir, { recursive: true });
}

function sanitizeName(str) {
    return (str || 'item')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .slice(0, 30);
}

function saveBase64ToFile(base64Str, prefix) {
    if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image')) {
        return null;
    }

    try {
        const matches = base64Str.match(/^data:image\/([A-Za-z0-9-+.]+);base64,(.+)$/s);
        if (!matches || matches.length !== 3) {
            console.warn(`  ⚠️ Formato Base64 no estándar para ${prefix}`);
            return null;
        }

        let ext = matches[1].toLowerCase();
        if (ext === 'jpeg') ext = 'jpg';
        if (ext.includes('svg')) ext = 'svg';
        if (ext.includes('png')) ext = 'png';
        if (ext.includes('webp')) ext = 'webp';

        const rawData = matches[2].replace(/\s/g, '');
        const buffer = Buffer.from(rawData, 'base64');

        const filename = `${prefix}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
        const filePath = path.join(regalosDir, filename);

        fs.writeFileSync(filePath, buffer);
        console.log(`  ✓ Imagen guardada: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);

        return `/regalos/${filename}`;
    } catch (e) {
        console.error(`  ❌ Error guardando imagen ${prefix}:`, e.message);
        return null;
    }
}

async function extractAndClean() {
    console.log('🚀 Iniciando extracción de imágenes Base64 de Supabase a archivos físicos...');

    try {
        // 1. Extraer avatares y nombres de QUEENS
        console.log('\n👑 1. Procesando tabla `queens`...');
        const qRes = await pool.query("SELECT id, name, avatar_img, nombre_img FROM queens WHERE avatar_img LIKE 'data:image%' OR nombre_img LIKE 'data:image%'");
        console.log(`Encontradas ${qRes.rows.length} reinas con imágenes en Base64.`);

        let queensUpdated = 0;
        for (const q of qRes.rows) {
            let newAvatar = q.avatar_img;
            let newNombre = q.nombre_img;
            let needsUpdate = false;

            if (q.avatar_img && q.avatar_img.startsWith('data:image')) {
                const savedPath = saveBase64ToFile(q.avatar_img, `avatar_${q.id}_${sanitizeName(q.name)}`);
                if (savedPath) {
                    newAvatar = savedPath;
                    needsUpdate = true;
                }
            }

            if (q.nombre_img && q.nombre_img.startsWith('data:image')) {
                const savedPath = saveBase64ToFile(q.nombre_img, `nombre_${q.id}_${sanitizeName(q.name)}`);
                if (savedPath) {
                    newNombre = savedPath;
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                await pool.query('UPDATE queens SET avatar_img = $1, nombre_img = $2 WHERE id = $3', [newAvatar, newNombre, q.id]);
                queensUpdated++;
            }
        }
        console.log(`✅ ${queensUpdated} reinas actualizadas con rutas de archivo.`);

        // 2. Extraer imágenes de REGALOS_CUSTOM
        console.log('\n🎁 2. Procesando tabla `regalos_custom`...');
        const rRes = await pool.query("SELECT id, nombre, imagen FROM regalos_custom WHERE imagen LIKE 'data:image%'");
        console.log(`Encontrados ${rRes.rows.length} regalos con imágenes en Base64.`);

        let regalosUpdated = 0;
        for (const r of rRes.rows) {
            if (r.imagen && r.imagen.startsWith('data:image')) {
                const savedPath = saveBase64ToFile(r.imagen, `custom_${r.id}_${sanitizeName(r.nombre)}`);
                if (savedPath) {
                    await pool.query('UPDATE regalos_custom SET imagen = $1 WHERE id = $2', [savedPath, r.id]);
                    regalosUpdated++;
                }
            }
        }
        console.log(`✅ ${regalosUpdated} regalos actualizados con rutas de archivo.`);

        // 3. Revisar tamaños de tablas finales
        console.log('\n📊 3. Verificando tamaños de tablas en Supabase...');
        const sizeRes = await pool.query(`
            SELECT 
                table_name,
                pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS tamaño_total
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name IN ('queens', 'regalos_custom', 'historial_regalos')
            ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC;
        `);
        console.table(sizeRes.rows);

        console.log('\n🎉 ¡Extracción y limpieza completadas exitosamente! Todas las imágenes fueron preservadas.');

    } catch (e) {
        console.error('❌ Error durante el proceso:', e);
    } finally {
        await pool.end();
    }
}

extractAndClean();
