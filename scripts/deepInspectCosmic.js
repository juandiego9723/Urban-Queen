const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function deepInspect() {
    try {
        console.log('🔍 Realizando inspección profunda de la rama Cosmic-Agency...');
        const scratchDir = path.join(__dirname, '..', 'scratch');

        // 1. Diff de db.js
        try {
            const dbDiff = execSync('git diff HEAD:db.js Cosmic-Agency:TikDance/db.js', { encoding: 'utf-8' });
            fs.writeFileSync(path.join(scratchDir, 'cosmic_db_diff.txt'), dbDiff);
        } catch(e) { console.error('Error db diff:', e.message); }

        // 2. Diff de ranking.html
        try {
            const rankingDiff = execSync('git diff HEAD:public/ranking.html Cosmic-Agency:TikDance/public/ranking.html', { encoding: 'utf-8' });
            fs.writeFileSync(path.join(scratchDir, 'cosmic_ranking_diff.txt'), rankingDiff);
        } catch(e) { console.error('Error ranking diff:', e.message); }

        // 3. Diff de batalla.html y batalla.js
        try {
            const batallaHtmlDiff = execSync('git diff HEAD:public/batalla.html Cosmic-Agency:TikDance/public/batalla.html', { encoding: 'utf-8' });
            const batallaJsDiff = execSync('git diff HEAD:src/dynamics/batalla.js Cosmic-Agency:TikDance/src/dynamics/batalla.js', { encoding: 'utf-8' });
            fs.writeFileSync(path.join(scratchDir, 'cosmic_batalla_diff.txt'), `=== HTML ===\n${batallaHtmlDiff}\n=== JS ===\n${batallaJsDiff}`);
        } catch(e) { console.error('Error batalla diff:', e.message); }

        // 4. Diff de control.html (Campos de bailarinas/queens)
        try {
            const controlDiff = execSync('git diff HEAD:public/control.html Cosmic-Agency:TikDance/public/control.html', { encoding: 'utf-8' });
            fs.writeFileSync(path.join(scratchDir, 'cosmic_control_diff.txt'), controlDiff);
        } catch(e) { console.error('Error control diff:', e.message); }

        // 5. Diff de queensRoutes.js
        try {
            const queensRoutesDiff = execSync('git diff HEAD:src/routes/queensRoutes.js Cosmic-Agency:TikDance/src/routes/queensRoutes.js', { encoding: 'utf-8' });
            fs.writeFileSync(path.join(scratchDir, 'cosmic_queens_routes_diff.txt'), queensRoutesDiff);
        } catch(e) { console.error('Error queensRoutes diff:', e.message); }

        console.log('✅ Deep inspection guardado en scratch/cosmic_*_diff.txt');
    } catch (e) {
        console.error('Error:', e.message);
    }
}

deepInspect();
