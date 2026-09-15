const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const fs = require('fs');
const initSqlJs = require('sql.js');
const { query } = require('../src/config/dbPool');
const crypto = require('crypto');

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function hasTable(db, tableName) {
    try {
        const res = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
        return res.length > 0 && res[0].values.length > 0;
    } catch (e) {
        return false;
    }
}

async function migrar() {
    console.log('🚀 Iniciando script de migración ultra-rápida a Supabase PostgreSQL...');

    if (!process.env.DATABASE_URL) {
        console.error('❌ Error: DATABASE_URL no está definida en las variables de entorno (.env).');
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const rootDir = path.join(__dirname, '..');

    // 1. Migrar master.db (si existe)
    const masterPath = path.join(rootDir, 'master.db');
    if (fs.existsSync(masterPath)) {
        console.log('📂 Procesando master.db...');
        const buffer = fs.readFileSync(masterPath);
        const db = new SQL.Database(buffer);

        if (hasTable(db, 'users')) {
            const stmt = db.prepare('SELECT * FROM users');
            while (stmt.step()) {
                const u = stmt.getAsObject();
                try {
                    await query(
                        'INSERT INTO users (username, password, name) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
                        [u.username.toLowerCase(), u.password, u.name || u.username]
                    );
                    console.log(`  ✓ Usuario migrado desde master.db: ${u.username}`);
                } catch (e) {
                    console.error(`  ⚠️ Error migrando usuario ${u.username}:`, e.message);
                }
            }
            stmt.free();
        }
        db.close();
    }

    // 2. Buscar todos los archivos database_*.db
    const files = fs.readdirSync(rootDir);
    const dbFiles = files.filter(f => f.startsWith('database_') && f.endsWith('.db'));

    if (dbFiles.length === 0) {
        console.log('⚠️ No se encontraron archivos database_*.db en la raíz del proyecto.');
    }

    for (const dbFile of dbFiles) {
        const username = dbFile.replace('database_', '').replace('.db', '').toLowerCase();
        console.log(`\n📂 Procesando ${dbFile} (Usuario: ${username})...`);

        // Obtener o crear user_id en Supabase
        let userId;
        const userRes = await query('SELECT id FROM users WHERE LOWER(username) = $1', [username]);
        if (userRes.rows.length === 0) {
            console.log(`  ➕ El usuario '${username}' no existía en Supabase. Creándolo...`);
            const defaultHashed = hashPassword('123456');
            const newU = await query(
                'INSERT INTO users (username, password, name) VALUES ($1, $2, $3) RETURNING id',
                [username, defaultHashed, username]
            );
            userId = newU.rows[0].id;
            console.log(`  ✓ Usuario '${username}' creado con ID: ${userId}`);
        } else {
            userId = userRes.rows[0].id;
            console.log(`  ✓ Usuario '${username}' encontrado con ID: ${userId}`);
        }

        const buffer = fs.readFileSync(path.join(rootDir, dbFile));
        const db = new SQL.Database(buffer);

        // A. Migrar Queens
        if (hasTable(db, 'queens')) {
            try {
                const stmtQueens = db.prepare('SELECT * FROM queens');
                let countQ = 0;
                while (stmtQueens.step()) {
                    const q = stmtQueens.getAsObject();
                    await query(`
                        INSERT INTO queens (user_id, name, apodo, color, avatar_img, regalo_img, regalo_pts, activo, ranking_diario, ranking_semanal, ranking_mensual, victorias, empates, derrotas, copa)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                        ON CONFLICT (user_id, name) DO UPDATE SET
                            apodo = EXCLUDED.apodo, color = EXCLUDED.color, avatar_img = EXCLUDED.avatar_img,
                            regalo_img = EXCLUDED.regalo_img, regalo_pts = EXCLUDED.regalo_pts, activo = EXCLUDED.activo,
                            ranking_diario = EXCLUDED.ranking_diario, ranking_semanal = EXCLUDED.ranking_semanal,
                            ranking_mensual = EXCLUDED.ranking_mensual, victorias = EXCLUDED.victorias,
                            empates = EXCLUDED.empates, derrotas = EXCLUDED.derrotas, copa = EXCLUDED.copa
                    `, [
                        userId, q.name, q.apodo || '', q.color || '#ffffff', q.avatar_img || '',
                        q.regalo_img || '', q.regalo_pts || 0, q.activo !== undefined ? q.activo : 1,
                        q.ranking_diario || 0, q.ranking_semanal || 0, q.ranking_mensual || 0,
                        q.victorias || 0, q.empates || 0, q.derrotas || 0, q.copa || 0
                    ]);
                    countQ++;
                }
                stmtQueens.free();
                console.log(`  ✓ ${countQ} queens migradas/actualizadas`);
            } catch (e) {
                console.error('  ⚠️ Error migrando queens:', e.message);
            }
        }

        // B. Mapa de Queens para referencias por ID
        const qMapRes = await query('SELECT id, name FROM queens WHERE user_id = $1', [userId]);
        const queenMap = new Map();
        qMapRes.rows.forEach(r => queenMap.set(r.name, r.id));

        // C. Migrar Aliases
        if (hasTable(db, 'aliases')) {
            try {
                const stmtAliases = db.prepare('SELECT * FROM aliases');
                let countA = 0;
                while (stmtAliases.step()) {
                    const a = stmtAliases.getAsObject();
                    const queenId = queenMap.get(a.queen_name);
                    if (queenId) {
                        await query('INSERT INTO aliases (queen_id, alias_name) VALUES ($1, $2) ON CONFLICT (queen_id, alias_name) DO NOTHING', [queenId, a.alias_name]);
                        countA++;
                    }
                }
                stmtAliases.free();
                console.log(`  ✓ ${countA} aliases migrados`);
            } catch (e) {
                console.error('  ⚠️ Error migrando aliases:', e.message);
            }
        }

        // D. Migrar Historial de Regalos (optimizado por lotes)
        if (hasTable(db, 'historial_regalos')) {
            try {
                const stmtHist = db.prepare('SELECT * FROM historial_regalos');
                const batch = [];
                let countHist = 0;
                while (stmtHist.step()) {
                    const h = stmtHist.getAsObject();
                    const queenId = queenMap.get(h.queen_name);
                    if (queenId) {
                        batch.push([userId, queenId, h.gift_name || 'Regalo', h.diamonds || 0, h.viewer_name || 'Anónimo']);
                        countHist++;
                    }
                }
                stmtHist.free();

                const BATCH_SIZE = 200;
                for (let i = 0; i < batch.length; i += BATCH_SIZE) {
                    const chunk = batch.slice(i, i + BATCH_SIZE);
                    const values = [];
                    const params = [];
                    let paramIdx = 1;
                    for (const row of chunk) {
                        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
                        params.push(...row);
                    }
                    if (values.length > 0) {
                        await query(
                            `INSERT INTO historial_regalos (user_id, queen_id, gift_name, diamonds, viewer_name) VALUES ${values.join(', ')}`,
                            params
                        );
                    }
                }
                console.log(`  ✓ ${countHist} registros de historial de regalos migrados (en lotes súper rápidos)`);
            } catch (e) {
                console.error('  ⚠️ Error migrando historial de regalos:', e.message);
            }
        }

        // E. Migrar Grupos (si existía)
        if (hasTable(db, 'grupos')) {
            try {
                const stmtG = db.prepare('SELECT * FROM grupos');
                let countG = 0;
                while (stmtG.step()) {
                    const g = stmtG.getAsObject();
                    await query(
                        'INSERT INTO grupos (user_id, nombre, color) VALUES ($1, $2, $3) ON CONFLICT (user_id, nombre) DO NOTHING',
                        [userId, g.nombre, g.color || '#ffffff']
                    );
                    countG++;
                }
                stmtG.free();
                console.log(`  ✓ ${countG} grupos migrados`);
            } catch (e) {
                console.error('  ⚠️ Error migrando grupos:', e.message);
            }
        }

        // F. Migrar Config (si existía)
        if (hasTable(db, 'config')) {
            try {
                const stmtC = db.prepare('SELECT * FROM config');
                let countC = 0;
                while (stmtC.step()) {
                    const c = stmtC.getAsObject();
                    await query(
                        'INSERT INTO config (user_id, clave, valor) VALUES ($1, $2, $3) ON CONFLICT (user_id, clave) DO UPDATE SET valor = EXCLUDED.valor',
                        [userId, c.clave, c.valor || '']
                    );
                    countC++;
                }
                stmtC.free();
                console.log(`  ✓ ${countC} registros de configuración migrados`);
            } catch (e) {
                console.error('  ⚠️ Error migrando configuración:', e.message);
            }
        }

        // G. Migrar Sonidos (si existía)
        if (hasTable(db, 'sonidos')) {
            try {
                const stmtS = db.prepare('SELECT * FROM sonidos');
                let countS = 0;
                while (stmtS.step()) {
                    const s = stmtS.getAsObject();
                    await query(
                        'INSERT INTO sonidos (user_id, evento, url) VALUES ($1, $2, $3) ON CONFLICT (user_id, evento) DO UPDATE SET url = EXCLUDED.url',
                        [userId, s.evento, s.url || '']
                    );
                    countS++;
                }
                stmtS.free();
                console.log(`  ✓ ${countS} sonidos migrados`);
            } catch (e) {
                console.error('  ⚠️ Error migrando sonidos:', e.message);
            }
        }

        // H. Migrar Regalos Custom (si existía)
        if (hasTable(db, 'regalos_custom')) {
            try {
                const stmtRC = db.prepare('SELECT * FROM regalos_custom');
                let countRC = 0;
                while (stmtRC.step()) {
                    const rc = stmtRC.getAsObject();
                    await query(
                        'INSERT INTO regalos_custom (user_id, nombre, accion, imagen) VALUES ($1, $2, $3, $4)',
                        [userId, rc.nombre, rc.accion || '', rc.imagen]
                    );
                    countRC++;
                }
                stmtRC.free();
                console.log(`  ✓ ${countRC} regalos custom migrados`);
            } catch (e) {
                console.error('  ⚠️ Error migrando regalos custom:', e.message);
            }
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
