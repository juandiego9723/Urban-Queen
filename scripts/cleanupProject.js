const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const assetsDir = path.join(publicDir, 'assets');

console.log('🧹 Iniciando limpieza y reorganización del proyecto...');

// 1. Crear carpeta public/assets si no existe
if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    console.log('📁 Carpeta public/assets creada.');
}

// 2. Mover logos e iconos a public/assets/
const assetsToMove = [
    'app-icon.ico',
    'logo-tikdance-horizontal.png',
    'logo-tikdance.jpg'
];

assetsToMove.forEach(file => {
    const src = path.join(publicDir, file);
    const dest = path.join(assetsDir, file);
    if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
        console.log(`  ✓ Movido: ${file} ➔ public/assets/${file}`);
    }
});

// 3. Mover scripts sobrantes a scripts/
const scriptsToMove = ['stress-test.js'];
const scriptsDir = path.join(rootDir, 'scripts');

scriptsToMove.forEach(file => {
    const src = path.join(rootDir, file);
    const dest = path.join(scriptsDir, file);
    if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
        console.log(`  ✓ Movido: ${file} ➔ scripts/${file}`);
    }
});

// 4. Eliminar archivos innecesarios, scripts .bat, .vbs, videos y archivos .db locales antiguos
const filesToDelete = [
    'WhatsApp Video 2026-07-11 at 15.06.30.mp4',
    'INICIAR_RANKING.bat',
    'Iniciar_TikDance.vbs',
    'Detener_TikDance.vbs',
    'Instalar.bat',
    'generate_icon.ps1',
    'move_conociendo.js',
    'server_stderr.log',
    'server_stdout.log',
    'database_admin.db',
    'database_daniel.db',
    'database_prueba.db',
    'master.db'
];

filesToDelete.forEach(file => {
    const filePath = path.join(rootDir, file);
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            console.log(`  🗑️ Eliminado: ${file}`);
        } catch (e) {
            console.error(`  ⚠️ No se pudo eliminar ${file}:`, e.message);
        }
    }
});

console.log('\n✨ ¡Proyecto organizado y limpiado exitosamente!');
