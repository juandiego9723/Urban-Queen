const crypto = require('crypto');
const { query } = require('./src/config/dbPool');

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
    if (!storedPassword) return false;
    const [salt, originalHash] = storedPassword.split(':');
    if (!salt || !originalHash) return false;
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === originalHash;
}

async function initMasterDB() {
    try {
        // Asegurar que el usuario admin inicial exista en Supabase
        const adminUser = await obtenerUsuario('admin');
        if (!adminUser) {
            const hashed = hashPassword('admin');
            await query('INSERT INTO users (username, password, name) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING', ['admin', hashed, 'Administrador']);
            console.log('👑 Usuario administrador inicial verificado en Supabase: admin');
        }
    } catch (e) {
        console.error('⚠️ Aviso en initMasterDB:', e.message);
    }
}

async function registrarUsuario(username, password, name) {
    const existing = await obtenerUsuario(username);
    if (existing) throw new Error('El usuario ya existe');
    
    const hashed = hashPassword(password);
    const res = await query(
        'INSERT INTO users (username, password, name) VALUES ($1, $2, $3) RETURNING *',
        [username.toLowerCase().trim(), hashed, name.trim()]
    );
    return res.rows[0];
}

async function obtenerUsuario(username) {
    if (!username) return null;
    try {
        const res = await query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
        return res.rows.length > 0 ? res.rows[0] : null;
    } catch (e) {
        console.error('Error al obtener usuario:', e.message);
        return null;
    }
}

async function verificarCredenciales(username, password) {
    const user = await obtenerUsuario(username);
    if (!user) return false;
    return verifyPassword(password, user.password) ? user : false;
}

async function getAllUsers() {
    try {
        const res = await query('SELECT id, username, name FROM users ORDER BY username');
        return res.rows;
    } catch (e) {
        console.error('Error al obtener lista de usuarios:', e.message);
        return [];
    }
}

async function eliminarUsuario(username) {
    if (!username) return false;
    if (username.toLowerCase() === 'admin') {
        throw new Error('No se puede eliminar la cuenta principal de administrador.');
    }
    await query('DELETE FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
    return true;
}

async function crearTokenRecuperacion(username) {
    const user = await obtenerUsuario(username);
    if (!user) throw new Error('El usuario ingresado no existe');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (30 * 60 * 1000); // 30 minutos
    await query('DELETE FROM password_resets WHERE LOWER(username) = LOWER($1)', [username.trim()]);
    await query('INSERT INTO password_resets (username, token, expires_at) VALUES ($1, $2, $3)', [username.trim(), token, expiresAt]);
    return token;
}

async function validarTokenRecuperacion(token) {
    if (!token) return null;
    const res = await query('SELECT * FROM password_resets WHERE token = $1 AND expires_at > $2', [token, Date.now()]);
    return res.rows.length > 0 ? res.rows[0] : null;
}

async function cambiarPasswordConToken(token, nuevaPassword) {
    const record = await validarTokenRecuperacion(token);
    if (!record) throw new Error('El token de recuperación es inválido o ha expirado');
    const hashed = hashPassword(nuevaPassword);
    await query('UPDATE users SET password = $1 WHERE LOWER(username) = LOWER($2)', [hashed, record.username.toLowerCase()]);
    await query('DELETE FROM password_resets WHERE token = $1', [token]);
    return record.username;
}

async function getAgencyBySlug(slug) {
    if (!slug) return null;
    try {
        const res = await query('SELECT * FROM agencies WHERE LOWER(slug) = LOWER($1)', [slug.trim()]);
        return res.rows.length > 0 ? res.rows[0] : null;
    } catch (e) {
        console.error('Error al obtener agencia:', e.message);
        return null;
    }
}

async function getAllAgencies() {
    try {
        const res = await query('SELECT * FROM agencies ORDER BY name');
        return res.rows;
    } catch (e) {
        console.error('Error al obtener lista de agencias:', e.message);
        return [];
    }
}

async function getAgencyById(id) {
    if (!id) return null;
    try {
        const res = await query('SELECT * FROM agencies WHERE id = $1', [id]);
        return res.rows.length > 0 ? res.rows[0] : null;
    } catch (e) {
        console.error('Error al obtener agencia por ID:', e.message);
        return null;
    }
}

async function asignarUsuarioAAgencia(username, agencySlug) {
    const agency = await getAgencyBySlug(agencySlug);
    if (!agency) throw new Error(`La agencia '${agencySlug}' no existe.`);
    await query('UPDATE users SET agency_id = $1 WHERE LOWER(username) = LOWER($2)', [agency.id, username.trim()]);
    return true;
}

module.exports = {
    initMasterDB,
    registrarUsuario,
    obtenerUsuario,
    verificarCredenciales,
    getAllUsers,
    eliminarUsuario,
    crearTokenRecuperacion,
    validarTokenRecuperacion,
    cambiarPasswordConToken,
    getAgencyBySlug,
    getAgencyById,
    getAllAgencies,
    asignarUsuarioAAgencia
};

