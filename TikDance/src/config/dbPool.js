const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

let pool = null;

if (connectionString) {
    pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }, // Requerido para Supabase y conexiones SSL cloud
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    pool.on('connect', () => {
        console.log('⚡ Conexión establecida con Supabase PostgreSQL');
    });

    pool.on('error', (err) => {
        console.error('⚠️ Error inesperado en el pool de PostgreSQL:', err.message);
    });
} else {
    console.warn('⚠️ ADVERTENCIA: DATABASE_URL no definida en variables de entorno. Supabase desacoplado en modo fallback.');
}

async function query(text, params) {
    if (!pool) {
        throw new Error('DATABASE_URL no está configurada en .env o variables de entorno.');
    }
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.DEBUG_SQL) {
        console.log('Executed query', { text, duration, rows: res.rowCount });
    }
    return res;
}

module.exports = {
    pool,
    query
};
