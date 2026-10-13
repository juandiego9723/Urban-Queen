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

async function vacuum() {
    try {
        console.log('🧹 Ejecutando VACUUM FULL para liberar espacio en disco...');
        await pool.query('VACUUM FULL queens;');
        await pool.query('VACUUM FULL regalos_custom;');
        console.log('✅ VACUUM completado.');

        const sizeRes = await pool.query(`
            SELECT 
                table_name,
                pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS tamaño_total
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name IN ('queens', 'regalos_custom', 'historial_regalos')
            ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC;
        `);
        console.table(sizeRes.rows);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
}

vacuum();
