// Quick diagnostic: check current reset keys and what the auto-reset logic would compute
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function main() {
    const SQL = await initSqlJs();
    
    // Find all database files
    const rootDir = path.join(__dirname, '..');
    const dbFiles = fs.readdirSync(rootDir).filter(f => f.startsWith('database_') && f.endsWith('.db'));
    
    if (dbFiles.length === 0) {
        console.log('No database files found.');
        return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const diaStr = `${year}-${month}-${day}`;
    const mesStr = `${year}-${month}`;

    function getISOWeekString(date) {
        const y = date.getFullYear();
        const m = date.getMonth();
        const d = date.getDate();
        const target = new Date(y, m, d);
        const dayNum = target.getDay() || 7;
        target.setDate(target.getDate() + 4 - dayNum);
        const yearStart = new Date(target.getFullYear(), 0, 1);
        const weekNo = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
        return `${target.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }

    const semanaStr = getISOWeekString(now);

    console.log('=== CURRENT DATE INFO ===');
    console.log(`Now:        ${now.toISOString()}`);
    console.log(`Day of week: ${now.getDay()} (0=Sun, 1=Mon, ..., 6=Sat)`);
    console.log(`diaStr:     ${diaStr}`);
    console.log(`mesStr:     ${mesStr}`);
    console.log(`semanaStr:  ${semanaStr}`);
    console.log('');

    for (const dbFile of dbFiles) {
        const dbPath = path.join(rootDir, dbFile);
        const buffer = fs.readFileSync(dbPath);
        const db = new SQL.Database(buffer);

        console.log(`=== ${dbFile} ===`);

        // Read config values
        try {
            const stmt = db.prepare("SELECT clave, valor FROM config WHERE clave LIKE 'last_reset_%'");
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            stmt.free();

            if (rows.length === 0) {
                console.log('  No last_reset_* keys found in config table!');
            } else {
                rows.forEach(r => {
                    console.log(`  ${r.clave} = "${r.valor}"`);
                });
            }
        } catch (e) {
            console.log(`  Error reading config: ${e.message}`);
        }

        // Read current ranking values
        try {
            const stmt2 = db.prepare("SELECT name, ranking_diario, ranking_semanal, ranking_mensual FROM queens");
            const queens = [];
            while (stmt2.step()) queens.push(stmt2.getAsObject());
            stmt2.free();

            console.log('  Rankings:');
            queens.forEach(q => {
                console.log(`    ${q.name}: diario=${q.ranking_diario}, semanal=${q.ranking_semanal}, mensual=${q.ranking_mensual}`);
            });
        } catch (e) {
            console.log(`  Error reading queens: ${e.message}`);
        }

        console.log('');
        console.log('  COMPARISON:');
        const configRows = {};
        try {
            const stmt3 = db.prepare("SELECT clave, valor FROM config WHERE clave LIKE 'last_reset_%'");
            while (stmt3.step()) {
                const obj = stmt3.getAsObject();
                configRows[obj.clave] = obj.valor;
            }
            stmt3.free();
        } catch(e) {}

        const lastDiario = configRows['last_reset_diario'] || '';
        const lastSemanal = configRows['last_reset_semanal'] || '';
        const lastMensual = configRows['last_reset_mensual'] || '';

        console.log(`  Diario:  stored="${lastDiario}" vs current="${diaStr}" => ${lastDiario !== diaStr ? '⚠️ SHOULD RESET' : '✅ OK (same day)'}`);
        console.log(`  Semanal: stored="${lastSemanal}" vs current="${semanaStr}" => ${lastSemanal !== semanaStr ? '⚠️ SHOULD RESET' : '✅ OK (same week)'}`);
        console.log(`  Mensual: stored="${lastMensual}" vs current="${mesStr}" => ${lastMensual !== mesStr ? '⚠️ SHOULD RESET' : '✅ OK (same month)'}`);

        db.close();
        console.log('');
    }
}

main().catch(console.error);
