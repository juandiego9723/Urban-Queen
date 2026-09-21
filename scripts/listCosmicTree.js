const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function listTree() {
    try {
        console.log('🔍 Inspeccionando árbol completo de la rama Cosmic-Agency...');
        const scratchDir = path.join(__dirname, '..', 'scratch');

        // Listar todos los archivos en la rama Cosmic-Agency
        const filesList = execSync('git ls-tree -r --name-only Cosmic-Agency', { encoding: 'utf-8' });
        fs.writeFileSync(path.join(scratchDir, 'cosmic_tree_files.txt'), filesList);
        console.log('✓ Lista de archivos guardada en scratch/cosmic_tree_files.txt');

        // Extraer diff completo entre Cosmic-Agency y Urban-Gravity-Agency
        try {
            const diffAgencies = execSync('git diff Urban-Gravity-Agency..Cosmic-Agency', { encoding: 'utf-8' });
            fs.writeFileSync(path.join(scratchDir, 'cosmic_vs_urban_diff.txt'), diffAgencies);
            console.log('✓ Diff Cosmic vs Urban guardado en scratch/cosmic_vs_urban_diff.txt');
        } catch (e) {
            console.log('Aviso al comparar con Urban-Gravity-Agency:', e.message);
        }

        // Ejecutar deep inspect también
        const dbDiff = execSync('git diff HEAD Cosmic-Agency', { encoding: 'utf-8' });
        fs.writeFileSync(path.join(scratchDir, 'cosmic_full_raw_diff.txt'), dbDiff);
        console.log('✓ Raw diff guardado en scratch/cosmic_full_raw_diff.txt');

    } catch (e) {
        console.error('Error:', e.message);
    }
}

listTree();
