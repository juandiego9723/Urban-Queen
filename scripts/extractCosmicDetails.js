const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function extract() {
    try {
        console.log('🔍 Extrayendo detalles de archivos clave de Cosmic-Agency...');
        const scratchDir = path.join(__dirname, '..', 'scratch');

        const filesToCompare = [
            ['public/ranking.html', 'TikDance/public/ranking.html'],
            ['public/timer.html', 'TikDance/public/timer.html'],
            ['public/revivir.html', 'TikDance/public/revivir.html'],
            ['public/control.html', 'TikDance/public/control.html'],
            ['src/dynamics/timer.js', 'TikDance/src/dynamics/timer.js'],
            ['src/dynamics/revivir.js', 'TikDance/src/dynamics/revivir.js'],
            ['src/services/pointsProcessor.js', 'TikDance/src/services/pointsProcessor.js']
        ];

        let summary = '=== RESUMEN DE CAMBIOS ESPECÍFICOS EN COSMIC ===\n\n';

        for (const [mainFile, cosmicFile] of filesToCompare) {
            try {
                const diff = execSync(`git diff HEAD:${mainFile} Cosmic-Agency:${cosmicFile}`, { encoding: 'utf-8' });
                summary += `\n--- DIFF: ${mainFile} vs Cosmic-Agency:${cosmicFile} ---\n`;
                summary += diff.substring(0, 3000) + (diff.length > 3000 ? '\n... (truncado)' : '');
                summary += '\n';
            } catch (err) {
                summary += `\n⚠️ No se pudo comparar ${mainFile} vs ${cosmicFile}: ${err.message}\n`;
            }
        }

        fs.writeFileSync(path.join(scratchDir, 'cosmic_key_diffs.txt'), summary);
        console.log('✅ Resumen guardado en scratch/cosmic_key_diffs.txt');
    } catch (e) {
        console.error('Error:', e.message);
    }
}

extract();
