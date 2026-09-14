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

    // 4. Crear commit completo
    const detailedMessage = `feat: refactor backend to Supabase PostgreSQL, Cloud Run Dockerfile & Firebase Hosting

- Database & Architecture:
  * Migrated from multi-file WASM SQLite (sql.js) to a unified multi-tenant PostgreSQL schema on Supabase.
  * Added 1FN-3FN DDL schema (src/config/schema.sql) with user_id multi-tenancy, foreign keys, and analytics indexes.
  * Created singleton connection pool (src/config/dbPool.js) using 'pg' with SSL.

- Server & Asynchronous Layer:
  * Refactored masterDb.js, db.js, sessionStore.js, server.js, queensRoutes.js, analyticsRoutes.js, and agencyRoutes.js to async/await.
  * Retained high-performance in-memory cache for live TikTok gift streams while persisting to Supabase asynchronously.
  * Configured dynamic PORT environment variable for Cloud Run compatibility.

- Analytics & Data Integrity:
  * Implemented native PostgreSQL analytics queries (TO_CHAR, NOW() - INTERVAL, DATE_TRUNC).
  * Added ensureUserId() and auto-queen creation in registrarRegalo to guarantee 100% data capture in historial_regalos.

- Cloud Infrastructure & Security:
  * Created multi-stage production Dockerfile for Google Cloud Run (WebSocket persistent connection support).
  * Added firebase.json for static CDN hosting on Firebase.
  * Configured strict .gitignore rules to prevent committing .env (Supabase credentials), .db files, node_modules, and logs.

- Project Cleanup & Asset Organization:
  * Organized logos and app icon into public/assets/ and updated HTML path references.
  * Created automated migration script (scripts/migrateFromSqliteToSupabase.js) and cleanup script (scripts/cleanupProject.js).
  * Removed obsolete .bat, .vbs scripts, heavy 10MB media assets, and legacy SQLite files.`;

    execSync(`git commit -m "${detailedMessage.replace(/"/g, '\\"')}"`, { cwd: repoDir, stdio: 'inherit' });
    console.log('✓ Commit completo creado exitosamente en la rama gcp.');

    // 5. Push a la rama gcp
    console.log('🚀 Subiendo cambios a origin/gcp...');
    execSync('git push -u origin gcp', { cwd: repoDir, stdio: 'inherit' });
    console.log('🎉 ¡Todos los cambios han sido subidos exitosamente a la rama gcp!');
} catch (e) {
    console.error('⚠️ Detalle de ejecución Git:', e.message);
}
