require('dotenv').config();
const { query, pool } = require('../src/config/dbPool');
const { uploadBase64Image, BUCKET_NAME } = require('../src/services/storageService');

async function migrate() {
    console.log(`🚀 Migrando imágenes Base64 de Supabase hacia GCS (gs://${BUCKET_NAME})...`);

    let queensMigrated = 0;
    const qRes = await query(`
        SELECT q.id, u.username, q.name, q.avatar_img, q.regalo_img, q.nombre_img
        FROM queens q
        JOIN users u ON q.user_id = u.id
        WHERE q.avatar_img LIKE 'data:image%'
           OR q.regalo_img LIKE 'data:image%'
           OR q.nombre_img LIKE 'data:image%'
    `);
    console.log(`👑 Encontradas ${qRes.rows.length} reinas con imágenes Base64.`);

    for (const q of qRes.rows) {
        let newAvatar = q.avatar_img;
        let newRegalo = q.regalo_img;
        let newNombre = q.nombre_img;
        let updated = false;

        if (q.avatar_img && q.avatar_img.startsWith('data:image')) {
            const url = await uploadBase64Image(q.avatar_img, { folder: 'avatars', prefix: `avatar_${q.username}_${q.name}_${q.id}` });
            if (url && url.startsWith('https://storage.googleapis.com/')) {
                newAvatar = url;
                updated = true;
                console.log(`  ✓ Queen [${q.username}/${q.name}] avatar -> ${url}`);
            }
        }
        if (q.regalo_img && q.regalo_img.startsWith('data:image')) {
            const url = await uploadBase64Image(q.regalo_img, { folder: 'regalos', prefix: `regalo_${q.username}_${q.name}_${q.id}` });
            if (url && url.startsWith('https://storage.googleapis.com/')) {
                newRegalo = url;
                updated = true;
                console.log(`  ✓ Queen [${q.username}/${q.name}] regalo -> ${url}`);
            }
        }
        if (q.nombre_img && q.nombre_img.startsWith('data:image')) {
            const url = await uploadBase64Image(q.nombre_img, { folder: 'nombres', prefix: `nombre_${q.username}_${q.name}_${q.id}` });
            if (url && url.startsWith('https://storage.googleapis.com/')) {
                newNombre = url;
                updated = true;
                console.log(`  ✓ Queen [${q.username}/${q.name}] nombre -> ${url}`);
            }
        }

        if (updated) {
            await query('UPDATE queens SET avatar_img = $1, regalo_img = $2, nombre_img = $3 WHERE id = $4', [newAvatar, newRegalo, newNombre, q.id]);
            queensMigrated++;
        }
    }

    let customMigrated = 0;
    let firstSampleUrl = null;
    const rRes = await query(`
        SELECT r.id, u.username, r.nombre, r.imagen
        FROM regalos_custom r
        JOIN users u ON r.user_id = u.id
        WHERE r.imagen LIKE 'data:image%'
    `);
    console.log(`🎁 Encontrados ${rRes.rows.length} regalos_custom con imágenes Base64.`);

    for (const r of rRes.rows) {
        const url = await uploadBase64Image(r.imagen, { folder: 'regalos', prefix: `custom_${r.username}_${r.nombre}_${r.id}` });
        if (url && url.startsWith('https://storage.googleapis.com/')) {
            await query('UPDATE regalos_custom SET imagen = $1 WHERE id = $2', [url, r.id]);
            if (!firstSampleUrl) firstSampleUrl = url;
            customMigrated++;
            console.log(`  ✓ Regalo [${r.username}/${r.nombre}] -> ${url}`);
        }
    }

    // Revisar también marca_logo_url en config por si acaso
    const cfgRes = await query(`
        SELECT c.user_id, u.username, c.valor
        FROM config c
        JOIN users u ON c.user_id = u.id
        WHERE c.clave = 'marca_logo_url' AND c.valor LIKE 'data:image%'
    `);
    for (const c of cfgRes.rows) {
        const url = await uploadBase64Image(c.valor, { folder: 'marcas', prefix: `logo_${c.username}` });
        if (url && url.startsWith('https://storage.googleapis.com/')) {
            await query("UPDATE config SET valor = $1 WHERE user_id = $2 AND clave = 'marca_logo_url'", [url, c.user_id]);
            console.log(`  ✓ Logo marca [${c.username}] -> ${url}`);
        }
    }

    console.log(`\n🧹 Reclamando espacio TOAST en Supabase (VACUUM FULL en queens y regalos_custom)...`);
    await query('VACUUM FULL queens');
    await query('VACUUM FULL regalos_custom');

    const sizes = await query(`
        SELECT relname AS table_name,
               pg_size_pretty(pg_total_relation_size(relid)) AS total_size
        FROM pg_stat_user_tables
        WHERE relname IN ('queens', 'regalos_custom', 'historial_regalos')
        ORDER BY pg_total_relation_size(relid) DESC
    `);
    console.log('\n📊 Tamaños actualizados en Supabase:');
    console.table(sizes.rows);

    const remainingBase64 = await query(`
        SELECT 
            (SELECT COUNT(*) FROM queens WHERE avatar_img LIKE 'data:image%' OR regalo_img LIKE 'data:image%' OR nombre_img LIKE 'data:image%')::int AS queens_left,
            (SELECT COUNT(*) FROM regalos_custom WHERE imagen LIKE 'data:image%')::int AS custom_left
    `);
    console.log('Base64 restantes en BD:', remainingBase64.rows[0]);

    if (firstSampleUrl) {
        const headRes = await fetch(firstSampleUrl, { method: 'HEAD' });
        console.log(`🌐 Verificación lectura pública (${firstSampleUrl}): HTTP ${headRes.status}`);
    }

    console.log(`\n🎉 Migración completada: ${queensMigrated} reinas y ${customMigrated} regalos custom migrados a GCS.`);
    if (pool) await pool.end();
    process.exit(0);
}

migrate().catch(e => {
    console.error('❌ Error en migración:', e);
    process.exit(1);
});

