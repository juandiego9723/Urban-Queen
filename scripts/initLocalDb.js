const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const { query, pool } = require('../src/config/dbPool');

async function initLocalDb() {
    console.log('⚡ Inicializando Base de Datos Local PostgreSQL...');

    if (!pool) {
        console.error('❌ Error: DATABASE_URL no está configurada en .env o variables de entorno.');
        console.log('💡 Ejemplo para Postgres Local: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tikdance_local');
        process.exit(1);
    }

    try {
        // 1. Crear tablas base si no existen
        console.log('📦 1. Verificando/Creando tablas base PostgreSQL...');
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS password_resets (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) NOT NULL,
                token VARCHAR(255) UNIQUE NOT NULL,
                expires_at BIGINT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS queens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                apodo VARCHAR(100) DEFAULT '',
                color VARCHAR(20) DEFAULT '#ffffff',
                avatar_img TEXT DEFAULT '',
                nombre_img TEXT DEFAULT '',
                regalo_img TEXT DEFAULT '',
                regalo_pts INTEGER DEFAULT 0,
                activo INTEGER DEFAULT 1,
                ranking_diario INTEGER DEFAULT 0,
                ranking_semanal INTEGER DEFAULT 0,
                ranking_mensual INTEGER DEFAULT 0,
                victorias INTEGER DEFAULT 0,
                empates INTEGER DEFAULT 0,
                derrotas INTEGER DEFAULT 0,
                copa INTEGER DEFAULT 0,
                CONSTRAINT unq_user_queen UNIQUE(user_id, name)
            );

            CREATE TABLE IF NOT EXISTS aliases (
                id SERIAL PRIMARY KEY,
                queen_id INTEGER REFERENCES queens(id) ON DELETE CASCADE,
                alias_name VARCHAR(100) NOT NULL,
                CONSTRAINT unq_queen_alias UNIQUE(queen_id, alias_name)
            );

            CREATE TABLE IF NOT EXISTS grupos (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                nombre VARCHAR(100) NOT NULL,
                color VARCHAR(20) DEFAULT '#ffffff',
                CONSTRAINT unq_user_grupo UNIQUE(user_id, nombre)
            );

            CREATE TABLE IF NOT EXISTS config (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                clave VARCHAR(100) NOT NULL,
                valor TEXT DEFAULT '',
                CONSTRAINT unq_user_config UNIQUE(user_id, clave)
            );

            CREATE TABLE IF NOT EXISTS sonidos (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                evento VARCHAR(100) NOT NULL,
                url TEXT DEFAULT '',
                CONSTRAINT unq_user_sonido UNIQUE(user_id, evento)
            );

            CREATE TABLE IF NOT EXISTS regalos_custom (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                nombre VARCHAR(100) NOT NULL,
                accion VARCHAR(255) DEFAULT '',
                imagen TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS historial_regalos (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                queen_id INTEGER REFERENCES queens(id) ON DELETE CASCADE,
                gift_name VARCHAR(100) NOT NULL,
                diamonds INTEGER DEFAULT 0,
                viewer_name VARCHAR(100) DEFAULT 'Anónimo',
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ Tablas base creadas/verificadas correctamente.');

        // 2. Ejecutar script de migración multi-agencia
        console.log('🚀 2. Ejecutando migración Multi-Agencia...');
        const migrationSql = fs.readFileSync(path.join(__dirname, 'agencies_migration.sql'), 'utf-8');
        await query(migrationSql);
        console.log('✓ Script Multi-Agencia ejecutado exitosamente.');

        // 3. Crear usuarios de prueba para Cosmic y Urban Queens si no existen
        const MasterDB = require('../masterDb');
        console.log('👑 3. Creando usuarios y asignando agencias...');

        // Asegurar admin
        await MasterDB.initMasterDB();

        // Obtener agencias
        const cosmicAgency = (await query("SELECT id FROM agencies WHERE slug = 'cosmic'")).rows[0];
        const urbanAgency = (await query("SELECT id FROM agencies WHERE slug = 'urbanqueens'")).rows[0];

        // Crear/Verificar usuario cosmic_admin
        let cosmicUser = await MasterDB.obtenerUsuario('cosmic_admin');
        if (!cosmicUser) {
            cosmicUser = await MasterDB.registrarUsuario('cosmic_admin', '123456', 'Administrador Cosmic');
        }
        if (cosmicAgency) {
            await query('UPDATE users SET agency_id = $1 WHERE id = $2', [cosmicAgency.id, cosmicUser.id]);
            console.log('  ✓ Usuario cosmic_admin (Password: 123456) vinculado a la Agencia Cosmic.');
        }

        // Crear/Verificar usuario urban_admin
        let urbanUser = await MasterDB.obtenerUsuario('urban_admin');
        if (!urbanUser) {
            urbanUser = await MasterDB.registrarUsuario('urban_admin', '123456', 'Administrador Urban Queens');
        }
        if (urbanAgency) {
            await query('UPDATE users SET agency_id = $1 WHERE id = $2', [urbanAgency.id, urbanUser.id]);
            console.log('  ✓ Usuario urban_admin (Password: 123456) vinculado a la Agencia Urban Queens.');
        }

        console.log('\n🎉 ¡Base de datos local inicializada exitosamente para desarrollo Multi-Agencia!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Error inicializando base de datos local:', e);
        process.exit(1);
    }
}

initLocalDb();
