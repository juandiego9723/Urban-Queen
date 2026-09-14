const { execSync } = require('child_process');
const path = require('path');

const repoDir = path.join(__dirname, '..', '..');

console.log('🔒 Verificando seguridad de Git e iniciando commit/push en la rama gcp...');

try {
    // 1. Cambiar o crear la rama gcp
    try {
        execSync('git checkout gcp', { cwd: repoDir, stdio: 'pipe' });
    } catch (e) {
        console.log('🌿 Creando y cambiando a la nueva rama gcp...');
        execSync('git checkout -b gcp', { cwd: repoDir, stdio: 'pipe' });
    }

    // 2. Agregar cambios al staging
    execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });

    // 3. Escudo de seguridad para .env
    try {
        const status = execSync('git status --porcelain', { cwd: repoDir }).toString();
        const stagedLines = status.split('\n');
        const envStaged = stagedLines.some(line => (line.startsWith('A ') || line.startsWith('M ')) && line.includes('.env') && !line.includes('.env.example'));

        if (envStaged) {
            console.error('❌ ESCUDO DE SEGURIDAD ACTIVADO: Se detectó .env en staging area. Desmarcando...');
            execSync('git reset .env', { cwd: repoDir, stdio: 'pipe' });
        }
    } catch(e) {}

    // 4. Intentar commit
    try {
        const commitMessage = "feat: refactor backend to Supabase PostgreSQL, Cloud Run Dockerfile & Firebase Hosting";
        execSync(`git commit -m "${commitMessage}"`, { cwd: repoDir, stdio: 'pipe' });
        console.log('✓ Commit creado en la rama gcp.');
    } catch (e) {
        console.log('ℹ️ Commit listo o sin cambios pendientes por confirmar.');
    }

    // 5. Push a la rama gcp en GitHub
    console.log('🚀 Subiendo rama gcp a GitHub (git push -u origin gcp)...');
    const pushRes = execSync('git push -u origin gcp', { cwd: repoDir }).toString();
    console.log('🎉 ¡La rama gcp fue creada y subida con éxito a GitHub!');
    if (pushRes) console.log(pushRes);
} catch (e) {
    console.error('⚠️ Detalle de ejecución Git:', e.stdout ? e.stdout.toString() : e.message);
}
