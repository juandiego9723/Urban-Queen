require('dotenv').config();
const { query } = require('../src/config/dbPool');

async function test() {
    try {
        const uId = 10;
        
        console.log('=== DISTINCT GIFTS AND THEIR RECORDED DIAMOND VALUES ===');
        const gifts = await query(`
            SELECT gift_name, 
                   MIN(diamonds) as min_diamonds, 
                   MAX(diamonds) as max_diamonds,
                   COUNT(*) as veces_recibido,
                   SUM(diamonds) as total_diamantes
            FROM historial_regalos
            WHERE user_id = $1
              AND (timestamp AT TIME ZONE 'America/Bogota')::date = '2026-10-23'
            GROUP BY gift_name
            ORDER BY total_diamantes DESC
        `, [uId]);
        console.table(gifts.rows);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit(0);
    }
}

test();
