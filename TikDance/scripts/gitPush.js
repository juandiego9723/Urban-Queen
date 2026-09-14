const { execSync } = require('child_process');
const path = require('path');

const repoDir = path.join(__dirname, '..', '..');

console.log('🔒 Verificando seguridad de Git e iniciando commit/push en la rama gcp...');

try {
    // 1. Cambiar o crear la rama gcp
    try {
        execSync('git checkout gcp', { cwd: repoDir, stdio: 'inherit' });
    } catch (e) {
        console.log('🌿 Creando y cambiando a la nueva rama gcp...');
        execSync('git checkout -b gcp', { cwd: repoDir, stdio: 'inherit' });
    }

    // 2. Agregar cambios al staging
    execSync('git add .', { cwd: repoDir, stdio: 'inherit' });

    // 3. Escudo de seguridad para .env
    const status = execSync('git status --porcelain', { cwd: repoDir }).toString();
    const stagedLines = status.split('\n');
    const envStaged = stagedLines.some(line => (line.startsWith('A ') || line.startsWith('M ')) && line.includes('.env') && !line.includes('.env.example'));

    if (envStaged) {
        console.error('❌ ESCUDO DE SEGURIDAD ACTIVADO: Se detectó que el archivo .env está en el staging area. Cancelando commit.');
        execSync('git reset .env', { cwd: repoDir, stdio: 'inherit' });
        process.exit(1);
    }

    console.log('✓ Verificación de seguridad superada: El archivo .env está 100% protegido y excluido.');

    // 4. Crear commit completo de las actualizaciones
    const commitMessage = `fix: clean default queens for new users, fix async analytics routes, and update gcp branch

- Cleaned up default queen initialization in sessionStore.js so new users start with 0 default dancers.
- Resolved async Promise return issue in analyticsRoutes.js & db.js PostgreSQL aggregation queries.
- Ensured all agency, queen, and sound routes handle async Supabase calls properly.`;

    execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: repoDir, stdio: 'inherit' });
    console.log('✓ Commit adicional creado en la rama gcp.');

    // 5. Push a la rama gcp
    console.log('🚀 Subiendo cambios a origin/gcp...');
    execSync('git push origin gcp', { cwd: repoDir, stdio: 'inherit' });
    console.log('🎉 ¡Todos los cambios han sido subidos exitosamente a la rama gcp!');
} catch (e) {
    console.error('⚠️ Detalle de ejecución Git:', e.message);
}
