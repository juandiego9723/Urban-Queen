const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Master DB for users
const MASTER_DB_PATH = path.join(__dirname, 'master.db');
let masterDb = null;
let SQL = null;

async function initMasterDB(sqlInstance) {
    SQL = sqlInstance;
    if (fs.existsSync(MASTER_DB_PATH)) {
        const buffer = fs.readFileSync(MASTER_DB_PATH);
        masterDb = new SQL.Database(buffer);
        console.log('📂 Base de datos master cargada desde master.db');
    } else {
        masterDb = new SQL.Database();
        console.log('🆕 Base de datos master creada');
    }
    
    masterDb.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT
    )`);
    
    masterDb.run(`CREATE TABLE IF NOT EXISTS password_resets (
        username TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at INTEGER NOT NULL
    )`);
    
    if (!obtenerUsuario('admin')) {
        try {
            const hashed = hashPassword('admin');
            masterDb.run('INSERT INTO users (username, password, name) VALUES (?, ?, ?)', ['admin', hashed, 'Administrador']);
            console.log('👑 Usuario administrador inicial creado automáticamente: admin (Clave: admin)');
        } catch(e) {}
    }
    
    guardarMaster();
}

function guardarMaster() {
    if (!masterDb) return;
    try {
        const data = masterDb.export();
        fs.writeFileSync(MASTER_DB_PATH, Buffer.from(data));
    } catch(e) {
        console.error('⚠️ Error guardando master.db:', e.message);
    }
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
    const [salt, originalHash] = storedPassword.split(':');
    if (!salt || !originalHash) return false;
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === originalHash;
}

function registrarUsuario(username, password, name) {
    const existing = obtenerUsuario(username);
    if (existing) throw new Error('El usuario ya existe');
    
    const hashed = hashPassword(password);
    masterDb.run('INSERT INTO users (username, password, name) VALUES (?, ?, ?)', [username, hashed, name]);
    guardarMaster();
}

function obtenerUsuario(username) {
    if (!masterDb) return null;
    const stmt = masterDb.prepare('SELECT * FROM users WHERE username = ?');
    stmt.bind([username]);
    let user = null;
    if (stmt.step()) {
        user = stmt.getAsObject();
    }
    stmt.free();
    return user;
}

function verificarCredenciales(username, password) {
    const user = obtenerUsuario(username);
    if (!user) return false;
    return verifyPassword(password, user.password) ? user : false;
}

function getAllUsers() {
    if (!masterDb) return [];
    const stmt = masterDb.prepare('SELECT username, name FROM users ORDER BY username');
    const users = [];
    while (stmt.step()) {
        users.push(stmt.getAsObject());
    }
    stmt.free();
    return users;
}

function eliminarUsuario(username) {
    if (!masterDb) return false;
    if (username.toLowerCase() === 'admin') {
        throw new Error('No se puede eliminar la cuenta principal de administrador.');
    }
    masterDb.run('DELETE FROM users WHERE username = ?', [username]);
    guardarMaster();
    return true;
}

function crearTokenRecuperacion(username) {
    const user = obtenerUsuario(username);
    if (!user) throw new Error('El usuario ingresado no existe');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (30 * 60 * 1000); // 30 minutos de validez
    masterDb.run('DELETE FROM password_resets WHERE username = ?', [username]);
    masterDb.run('INSERT INTO password_resets (username, token, expires_at) VALUES (?, ?, ?)', [username, token, expiresAt]);
    guardarMaster();
    return token;
}

function validarTokenRecuperacion(token) {
    if (!masterDb || !token) return null;
    const stmt = masterDb.prepare('SELECT * FROM password_resets WHERE token = ? AND expires_at > ?');
    stmt.bind([token, Date.now()]);
    let record = null;
    if (stmt.step()) {
        record = stmt.getAsObject();
    }
    stmt.free();
    return record;
}

function cambiarPasswordConToken(token, nuevaPassword) {
    const record = validarTokenRecuperacion(token);
    if (!record) throw new Error('El token de recuperación es inválido o ha expirado');
    const hashed = hashPassword(nuevaPassword);
    masterDb.run('UPDATE users SET password = ? WHERE username = ?', [hashed, record.username]);
    masterDb.run('DELETE FROM password_resets WHERE username = ?', [record.username]);
    guardarMaster();
    return record.username;
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
    cambiarPasswordConToken
};
