const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

let pool = null;

if (connectionString) {
    const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

    pool = new Pool({
        connectionString,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 15000,
        connectionTimeoutMillis: 10000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000
    });

    pool.on('connect', () => {
        console.log(`⚡ Conexión establecida con PostgreSQL (${isLocal ? 'Local' : 'Supabase Cloud'})`);
    });

    pool.on('error', (err) => {
        console.error('⚠️ Error inesperado en el pool de PostgreSQL:', err.message);
    });
} else {
    console.warn('⚠️ ADVERTENCIA: DATABASE_URL no definida en variables de entorno. Supabase desacoplado en modo fallback.');
}

async function query(text, params, retries = 1) {
    if (!pool) {
        throw new Error('DATABASE_URL no está configurada en .env o variables de entorno.');
    }
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        if (process.env.DEBUG_SQL) {
            console.log('Executed query', { text, duration, rows: res.rowCount });
        }
        return res;
    } catch (err) {
        const isConnectionDrop = err.message && (
            err.message.includes('Connection terminated') ||
            err.message.includes('terminating connection') ||
            err.message.includes('ECONNRESET') ||
            err.message.includes('client was closed') ||
            err.code === '57P01' ||
            err.code === 'ECONNRESET'
        );
        if (retries > 0 && isConnectionDrop) {
            console.warn('⚠️ Conexión de base de datos interrumpida. Reintentando consulta automáticamente...');
            await new Promise(resolve => setTimeout(resolve, 150));
            return query(text, params, retries - 1);
        }
        throw err;
    }
}

module.exports = {
    pool,
    query
};
