const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { query } = require('../src/config/dbPool');

async function migrar() {
    console.log('🚀 Iniciando script de migración de SQLite a Supabase PostgreSQL...');

    if (!process.env.DATABASE_URL) {
        console.error('❌ Error: DATABASE_URL no está definida en las variables de entorno (.env).');
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const rootDir = path.join(__dirname, '..');

    // 1. Migrar master.db (usuarios)
    const masterPath = path.join(rootDir, 'master.db');
    if (fs.existsSync(masterPath)) {
        console.log('📂 Procesando master.db...');
        const buffer = fs.readFileSync(masterPath);
        const db = new SQL.Database(buffer);

        const stmt = db.prepare('SELECT * FROM users');
        while (stmt.step()) {
            const u = stmt.getAsObject();
            try {
                await query(
                    'INSERT INTO users (username, password, name) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
                    [u.username.toLowerCase(), u.password, u.name || u.username]
                );
                console.log(`  ✓ Usuario migrado: ${u.username}`);
            } catch (e) {
                console.error(`  ⚠️ Error migrando usuario ${u.username}:`, e.message);
            }
        }
        stmt.free();
        db.close();
    }

    // 2. Buscar todos los archivos database_*.db
    const files = fs.readdirSync(rootDir);
    const dbFiles = files.filter(f => f.startsWith('database_') && f.endsWith('.db'));

    for (const dbFile of dbFiles) {
        const username = dbFile.replace('database_', '').replace('.db', '').toLowerCase();
        console.log(`\n📂 Procesando ${dbFile} (Usuario: ${username})...`);

        // Obtener user_id de Supabase
        const userRes = await query('SELECT id FROM users WHERE LOWER(username) = $1', [username]);
        if (userRes.rows.length === 0) {
            console.warn(`  ⚠️ Usuario '${username}' no existe en la tabla users de Supabase. Saltando...`);
            continue;
        }
        const userId = userRes.rows[0].id;

        const buffer = fs.readFileSync(path.join(rootDir, dbFile));
        const db = new SQL.Database(buffer);

        // A. Migrar Queens
        try {
            const stmtQueens = db.prepare('SELECT * FROM queens');
            while (stmtQueens.step()) {
                const q = stmtQueens.getAsObject();
                await query(`
                    INSERT INTO queens (user_id, name, apodo, color, avatar_img, regalo_img, regalo_pts, activo, ranking_diario, ranking_semanal, ranking_mensual, victorias, empates, derrotas, copa)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                    ON CONFLICT (user_id, name) DO UPDATE SET
                        apodo = EXCLUDED.apodo, color = EXCLUDED.color, avatar_img = EXCLUDED.avatar_img
                `, [
                    userId, q.name, q.apodo || '', q.color || '#ffffff', q.avatar_img || '',
                    q.regalo_img || '', q.regalo_pts || 0, q.activo !== undefined ? q.activo : 1,
                    q.ranking_diario || 0, q.ranking_semanal || 0, q.ranking_mensual || 0,
                    q.victorias || 0, q.empates || 0, q.derrotas || 0, q.copa || 0
                ]);
                console.log(`  ✓ Queen migrada: ${q.name}`);
            }
            stmtQueens.free();
        } catch (e) {
            console.error('  ⚠️ Error migrando queens:', e.message);
        }

        // B. Migrar Aliases
        try {
            const stmtAliases = db.prepare('SELECT * FROM aliases');
            while (stmtAliases.step()) {
                const a = stmtAliases.getAsObject();
                const qRes = await query('SELECT id FROM queens WHERE user_id = $1 AND name = $2', [userId, a.queen_name]);
                if (qRes.rows.length > 0) {
                    const queenId = qRes.rows[0].id;
                    await query('INSERT INTO aliases (queen_id, alias_name) VALUES ($1, $2) ON CONFLICT (queen_id, alias_name) DO NOTHING', [queenId, a.alias_name]);
                }
            }
            stmtAliases.free();
            console.log('  ✓ Aliases migrados');
        } catch (e) {
            console.error('  ⚠️ Error migrando aliases:', e.message);
        }

        // C. Migrar Historial de Regalos
        try {
            const stmtHist = db.prepare('SELECT * FROM historial_regalos');
            let countHist = 0;
            while (stmtHist.step()) {
                const h = stmtHist.getAsObject();
                const qRes = await query('SELECT id FROM queens WHERE user_id = $1 AND name = $2', [userId, h.queen_name]);
                if (qRes.rows.length > 0) {
                    const queenId = qRes.rows[0].id;
                    await query(
                        'INSERT INTO historial_regalos (user_id, queen_id, gift_name, diamonds, viewer_name) VALUES ($1, $2, $3, $4, $5)',
                        [userId, queenId, h.gift_name, h.diamonds || 0, h.viewer_name]
                    );
                    countHist++;
                }
            }
            stmtHist.free();
            console.log(`  ✓ ${countHist} registros de regalos migrados`);
        } catch (e) {
            console.error('  ⚠️ Error migrando historial de regalos:', e.message);
        }

        db.close();
    }

    console.log('\n🎉 ¡Migración de datos completada exitosamente a Supabase PostgreSQL!');
    process.exit(0);
}

migrar().catch(err => {
    console.error('❌ Error fatal durante la migración:', err);
    process.exit(1);
});
