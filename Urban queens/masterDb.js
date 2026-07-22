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

module.exports = {
    initMasterDB,
    registrarUsuario,
    obtenerUsuario,
    verificarCredenciales,
    getAllUsers
};
