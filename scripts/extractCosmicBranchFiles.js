const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function extractCosmicFiles() {
    try {
        console.log('📦 Extrayendo archivos nativos de la rama Cosmic-Agency...');
        const rootDir = path.join(__dirname, '..');
        const cosmicPublicDir = path.join(rootDir, 'public', 'agencies', 'cosmic');
        const regalosDir = path.join(rootDir, 'public', 'regalos');

        if (!fs.existsSync(cosmicPublicDir)) {
            fs.mkdirSync(cosmicPublicDir, { recursive: true });
        }
        if (!fs.existsSync(regalosDir)) {
            fs.mkdirSync(regalosDir, { recursive: true });
        }

        // Archivos HTML principales de la rama Cosmic
        const htmlFiles = [
            'ranking.html',
            'control.html',
            'timer.html',
            'revivir.html',
            'revivir-ranking.html',
            'batalla.html',
            'batalla-futbol.html',
            'batalla-pk.html',
            'conociendo.html',
            'copa.html',
            'dinamica.html',
            'gestor-regalos.html',
            'lista-regalos.html',
            'login.html',
            'multicam.html',
            'overlay-acumulados.html',
            'overlay-universal.html'
        ];

        let count = 0;
        for (const file of htmlFiles) {
            try {
                const content = execSync(`git show Cosmic-Agency:TikDance/public/${file}`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                const destPath = path.join(cosmicPublicDir, file);
                fs.writeFileSync(destPath, content);
                count++;
                console.log(`  ✓ Extraído: public/agencies/cosmic/${file}`);
            } catch (e) {
                console.warn(`  ⚠️ No se pudo extraer ${file}: ${e.message}`);
            }
        }

        // Extraer banderas / regalos específicos
        const regalosCosmic = [
            'Argentina.webp',
            'Colombia.webp',
            'España.webp',
            'Portugal.png',
            'mexico.png'
        ];

        for (const regalo of regalosCosmic) {
            try {
                const buf = execSync(`git show Cosmic-Agency:TikDance/public/regalos/${regalo}`);
                fs.writeFileSync(path.join(regalosDir, regalo), buf);
                console.log(`  ✓ Regalo extraído: public/regalos/${regalo}`);
            } catch (e) {}
        }

        console.log(`\n🎉 ¡${count} vistas HTML nativas de Cosmic-Agency extraídas exitosamente en public/agencies/cosmic/!`);
    } catch (e) {
        console.error('❌ Error en extracción de archivos:', e);
    }
}

extractCosmicFiles();
