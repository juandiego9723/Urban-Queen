const { query, initSQL } = require('./db');

(async () => {
    await initSQL();
    
    // Check all config entries with 'mapa' in the key
    const r = await query("SELECT clave, length(valor) as len FROM config WHERE clave LIKE '%mapa%'");
    console.log('Config mapa entries:', JSON.stringify(r.rows, null, 2));
    
    // Check tiktok_regalo_mapa value
    const r2 = await query("SELECT clave, valor FROM config WHERE clave = 'tiktok_regalo_mapa'");
    if (r2.rows.length > 0) {
        console.log('tiktok_regalo_mapa value:', r2.rows[0].valor.substring(0, 300));
    } else {
        console.log('tiktok_regalo_mapa: NO EXISTE EN DB');
    }

    // Check all config entries for this user
    const r3 = await query("SELECT clave FROM config ORDER BY clave");
    console.log('\nAll config keys:', r3.rows.map(r => r.clave));

    process.exit(0);
})();
