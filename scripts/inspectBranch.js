const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function inspect() {
    try {
        console.log('🔍 Extrayendo diferencias de la rama Cosmic-Agency...');
        const scratchDir = path.join(__dirname, '..', 'scratch');
        if (!fs.existsSync(scratchDir)) {
            fs.mkdirSync(scratchDir, { recursive: true });
        }

        // 1. Archivos modificados/creados
        const nameStatus = execSync('git diff HEAD..Cosmic-Agency --name-status', { encoding: 'utf-8' });
        fs.writeFileSync(path.join(scratchDir, 'cosmic_files_changed.txt'), nameStatus);

        // 2. Stat de diferencias
        const stat = execSync('git diff HEAD..Cosmic-Agency --stat', { encoding: 'utf-8' });
        fs.writeFileSync(path.join(scratchDir, 'cosmic_diff_stat.txt'), stat);

        // 3. Diff completo
        const fullDiff = execSync('git diff HEAD..Cosmic-Agency', { encoding: 'utf-8' });
        fs.writeFileSync(path.join(scratchDir, 'cosmic_diff_full.txt'), fullDiff);

        console.log('----------------------------------------------------');
        console.log('📂 Archivos modificados en la rama Cosmic-Agency:');
        console.log(nameStatus);
        console.log('----------------------------------------------------');
        console.log('✅ Diff extraído exitosamente en la carpeta scratch/');
    } catch (e) {
        console.error('❌ Error inspeccionando la rama Cosmic-Agency:', e.message);
    }
}

inspect();
