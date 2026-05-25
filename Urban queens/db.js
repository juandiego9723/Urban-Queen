const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.db');

let db = null;
let saveTimer = null;
let dirty = false;

// --- Guardar a disco ---
function guardarADisco() {
    if (!db || !dirty) return;
    try {
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
        dirty = false;
    } catch (e) {
        console.error('⚠️ Error guardando database.db:', e.message);
    }
}

function marcarCambio() {
    dirty = true;
}

// --- Helper: ejecutar SELECT que retorna filas como objetos ---
function queryAll(sql, params) {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

function queryOne(sql, params) {
    const rows = queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

function runSql(sql, params) {
    db.run(sql, params);
    marcarCambio();
}

// --- INICIALIZACIÓN ASYNC ---
async function init() {
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
        console.log('📂 Base de datos cargada desde database.db');
    } else {
        db = new SQL.Database();
        console.log('🆕 Base de datos nueva creada');
    }

    // Crear tablas
    db.run(`CREATE TABLE IF NOT EXISTS queens (
        name TEXT PRIMARY KEY,
        color TEXT NOT NULL DEFAULT '#ffffff',
        ranking_semanal INTEGER NOT NULL DEFAULT 0,
        ranking_mensual INTEGER NOT NULL DEFAULT 0,
        victorias INTEGER NOT NULL DEFAULT 0,
        copa INTEGER NOT NULL DEFAULT 0,
        activo INTEGER NOT NULL DEFAULT 1
    )`);

    // Migraciones para columnas añadidas en versiones posteriores
    try { db.run(`ALTER TABLE queens ADD COLUMN activo INTEGER NOT NULL DEFAULT 1`); } catch(e) {}
    try { db.run(`ALTER TABLE queens ADD COLUMN apodo TEXT NOT NULL DEFAULT ''`); } catch(e) {}
    try { db.run(`ALTER TABLE queens ADD COLUMN ranking_diario INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
    try { db.run(`ALTER TABLE queens ADD COLUMN regalo_img TEXT NOT NULL DEFAULT ''`); } catch(e) {}
    try { db.run(`ALTER TABLE queens ADD COLUMN regalo_pts INTEGER NOT NULL DEFAULT 0`); } catch(e) {}

    db.run(`CREATE TABLE IF NOT EXISTS aliases (
        alias_name TEXT PRIMARY KEY COLLATE NOCASE,
        queen_name TEXT NOT NULL REFERENCES queens(name)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS grupos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL,
        color TEXT NOT NULL DEFAULT '#ffffff'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS grupo_miembros (
        grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
        queen_name TEXT NOT NULL REFERENCES queens(name),
        PRIMARY KEY (grupo_id, queen_name)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sonidos (
        evento TEXT PRIMARY KEY,
        url TEXT NOT NULL DEFAULT ''
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS dinamicas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        descripcion TEXT DEFAULT '',
        icono TEXT DEFAULT '⚔️',
        color TEXT DEFAULT '#6366f1',
        participantes TEXT DEFAULT 'todas',
        reglas TEXT DEFAULT '{}',
        creado_en TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS config (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL DEFAULT ''
    )`);

    dirty = true;
    guardarADisco();

    // Auto-guardar cada 3 segundos
    saveTimer = setInterval(guardarADisco, 3000);
}

// --- FUNCIONES EXPORTADAS ---

function initQueens(queensArray) {
    const colores = { Amy: '#ff1493', Ray: '#ffd700', Nucita: '#00ffff', Venus: '#b026ff' };
    for (const name of queensArray) {
        const existing = queryOne('SELECT name FROM queens WHERE name = ?', [name]);
        if (!existing) {
            runSql('INSERT INTO queens (name, color, activo) VALUES (?, ?, 1)', [name, colores[name] || '#ffffff']);
        }
    }
}

function getActiveQueenNames() {
    return queryAll('SELECT name FROM queens WHERE activo = 1 ORDER BY name').map(q => q.name);
}

function getAllQueensFull() {
    return queryAll('SELECT * FROM queens ORDER BY activo DESC, name');
}

function crearQueen(name, color) {
    const existing = queryOne('SELECT name FROM queens WHERE name = ?', [name]);
    if (existing) {
        runSql('UPDATE queens SET activo = 1, color = ? WHERE name = ?', [color, name]);
    } else {
        runSql('INSERT INTO queens (name, color, activo) VALUES (?, ?, 1)', [name, color]);
    }
}

function editarQueen(name, color, apodo = null, regaloImg = null, regaloPts = null) {
    let sets = ['color = ?'];
    let vals = [color];
    if (apodo     !== null) { sets.push('apodo = ?');       vals.push(apodo.trim()); }
    if (regaloImg !== null) { sets.push('regalo_img = ?');  vals.push(regaloImg); }
    if (regaloPts !== null) { sets.push('regalo_pts = ?');  vals.push(regaloPts); }
    vals.push(name);
    runSql(`UPDATE queens SET ${sets.join(', ')} WHERE name = ?`, vals);
}

function getApodosMap() {
    const queens = queryAll('SELECT name, apodo FROM queens');
    const map = {};
    queens.forEach(q => { map[q.name] = (q.apodo && q.apodo.trim()) ? q.apodo.trim() : q.name; });
    return map;
}

function toggleQueenActivo(name) {
    runSql('UPDATE queens SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END WHERE name = ?', [name]);
    const row = queryOne('SELECT activo FROM queens WHERE name = ?', [name]);
    return row ? row.activo : 0;
}

function renombrarQueen(nombreViejo, nombreNuevo) {
    runSql('UPDATE aliases SET queen_name = ? WHERE queen_name = ?', [nombreNuevo, nombreViejo]);
    runSql('UPDATE grupo_miembros SET queen_name = ? WHERE queen_name = ?', [nombreNuevo, nombreViejo]);
    runSql('UPDATE queens SET name = ? WHERE name = ?', [nombreNuevo, nombreViejo]);
}

function eliminarQueen(nombre) {
    runSql('DELETE FROM grupo_miembros WHERE queen_name = ?', [nombre]);
    runSql('DELETE FROM aliases WHERE queen_name = ?', [nombre]);
    runSql('DELETE FROM queens WHERE name = ?', [nombre]);
}

function getRanking() {
    const queens = queryAll('SELECT name, ranking_semanal FROM queens ORDER BY ranking_semanal DESC');
    const obj = {};
    queens.forEach(q => obj[q.name] = q.ranking_semanal);
    return obj;
}

function getRankingMensual() {
    const queens = queryAll('SELECT name, ranking_mensual FROM queens ORDER BY ranking_mensual DESC');
    const obj = {};
    queens.forEach(q => obj[q.name] = q.ranking_mensual);
    return obj;
}

function getRankingDiario() {
    const queens = queryAll('SELECT name, ranking_diario FROM queens ORDER BY ranking_diario DESC');
    const obj = {};
    queens.forEach(q => obj[q.name] = q.ranking_diario);
    return obj;
}

function getVictorias() {
    const queens = queryAll('SELECT name, victorias FROM queens');
    const obj = {};
    queens.forEach(q => obj[q.name] = q.victorias);
    return obj;
}

function getCopa() {
    const queens = queryAll('SELECT name, copa FROM queens');
    const obj = {};
    queens.forEach(q => obj[q.name] = q.copa);
    return obj;
}

function sumarPuntos(name, puntos) {
    runSql('UPDATE queens SET ranking_semanal = MAX(0, ranking_semanal + ?), ranking_mensual = MAX(0, ranking_mensual + ?), ranking_diario = MAX(0, ranking_diario + ?), copa = MAX(0, copa + ?) WHERE name = ?', [puntos, puntos, puntos, puntos, name]);
}

function sumarVictoria(name) {
    runSql('UPDATE queens SET victorias = victorias + 1 WHERE name = ?', [name]);
}

function resetSemanal() { runSql('UPDATE queens SET ranking_semanal = 0'); }
function resetMensual() { runSql('UPDATE queens SET ranking_mensual = 0'); }
function resetDiario()  { runSql('UPDATE queens SET ranking_diario = 0'); }
function resetCopa() { runSql('UPDATE queens SET copa = 0'); }
function resetVictorias() { runSql('UPDATE queens SET victorias = 0'); }

// Aliases
function resolverAlias(aliasName) {
    const row = queryOne('SELECT queen_name FROM aliases WHERE alias_name = ? COLLATE NOCASE', [aliasName]);
    return row ? row.queen_name : null;
}

function agregarAlias(aliasName, queenName) {
    runSql('INSERT OR REPLACE INTO aliases (alias_name, queen_name) VALUES (?, ?)', [aliasName, queenName]);
}

function eliminarAlias(aliasName) {
    runSql('DELETE FROM aliases WHERE alias_name = ?', [aliasName]);
}

function getAliases() {
    return queryAll('SELECT * FROM aliases ORDER BY queen_name');
}

function getAliasesPorQueen(queenName) {
    return queryAll('SELECT alias_name FROM aliases WHERE queen_name = ?', [queenName]).map(r => r.alias_name);
}

// Grupos
function crearGrupo(nombre, color) {
    runSql('INSERT INTO grupos (nombre, color) VALUES (?, ?)', [nombre, color]);
    const row = queryOne('SELECT last_insert_rowid() as id');
    return row ? row.id : null;
}

function getGrupos() {
    const grupos = queryAll('SELECT * FROM grupos ORDER BY nombre');
    return grupos.map(g => ({
        ...g,
        miembros: queryAll('SELECT queen_name FROM grupo_miembros WHERE grupo_id = ?', [g.id]).map(m => m.queen_name)
    }));
}

function eliminarGrupo(id) {
    runSql('DELETE FROM grupo_miembros WHERE grupo_id = ?', [id]);
    runSql('DELETE FROM grupos WHERE id = ?', [id]);
}

function agregarMiembro(grupoId, queenName) {
    runSql('INSERT OR IGNORE INTO grupo_miembros (grupo_id, queen_name) VALUES (?, ?)', [grupoId, queenName]);
}

function removerMiembro(grupoId, queenName) {
    runSql('DELETE FROM grupo_miembros WHERE grupo_id = ? AND queen_name = ?', [grupoId, queenName]);
}

// Sonidos
function getSonidos() {
    return queryAll('SELECT * FROM sonidos');
}

function setSonido(evento, url) {
    runSql('INSERT OR REPLACE INTO sonidos (evento, url) VALUES (?, ?)', [evento, url]);
}

// Dinámicas
function getDinamicas() {
    return queryAll('SELECT * FROM dinamicas ORDER BY id DESC').map(d => ({ ...d, reglas: JSON.parse(d.reglas || '{}') }));
}

function getDinamica(id) {
    const d = queryOne('SELECT * FROM dinamicas WHERE id = ?', [id]);
    return d ? { ...d, reglas: JSON.parse(d.reglas || '{}') } : null;
}

function crearDinamica(data) {
    runSql(`INSERT INTO dinamicas (nombre, descripcion, icono, color, participantes, reglas) VALUES (?, ?, ?, ?, ?, ?)`,
        [data.nombre, data.descripcion || '', data.icono || '⚔️', data.color || '#6366f1', data.participantes || 'todas', JSON.stringify(data.reglas || {})]);
}

function editarDinamica(id, data) {
    runSql(`UPDATE dinamicas SET nombre=?, descripcion=?, icono=?, color=?, participantes=?, reglas=? WHERE id=?`,
        [data.nombre, data.descripcion || '', data.icono || '⚔️', data.color || '#6366f1', data.participantes || 'todas', JSON.stringify(data.reglas || {}), id]);
}

function eliminarDinamica(id) {
    runSql('DELETE FROM dinamicas WHERE id = ?', [id]);
}

function duplicarDinamica(id) {
    const d = queryOne('SELECT * FROM dinamicas WHERE id = ?', [id]);
    if (!d) return;
    runSql(`INSERT INTO dinamicas (nombre, descripcion, icono, color, participantes, reglas) VALUES (?, ?, ?, ?, ?, ?)`,
        ['[Copia] ' + d.nombre, d.descripcion, d.icono, d.color, d.participantes, d.reglas]);
}

// Config
function getConfigVal(clave) {
    const row = queryOne('SELECT valor FROM config WHERE clave = ?', [clave]);
    return row ? row.valor : null;
}

function setConfigVal(clave, valor) {
    runSql('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)', [clave, String(valor)]);
}

// Migración: importar datos.json existente si la DB está vacía
function migrarDesdeJSON(filePath) {
    if (!fs.existsSync(filePath)) return false;
    
    const queens = queryAll('SELECT name, ranking_semanal FROM queens');
    const totalPuntos = queens.reduce((s, q) => s + q.ranking_semanal, 0);
    if (totalPuntos > 0) return false;
    
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const rankingData = data.ranking || data;
        const victoriasData = data.victorias || {};
        const copaData = data.copa || {};
        
        for (const name in rankingData) {
            runSql('UPDATE queens SET ranking_semanal = ?, ranking_mensual = ? WHERE name = ?', [rankingData[name] || 0, rankingData[name] || 0, name]);
        }
        for (const name in victoriasData) {
            runSql('UPDATE queens SET victorias = ? WHERE name = ?', [victoriasData[name] || 0, name]);
        }
        for (const name in copaData) {
            runSql('UPDATE queens SET copa = ? WHERE name = ?', [copaData[name] || 0, name]);
        }
        
        console.log('✅ Datos migrados desde datos.json a SQLite');
        return true;
    } catch (e) {
        console.error('⚠️ Error migrando datos.json:', e.message);
        return false;
    }
}

function close() {
    if (saveTimer) clearInterval(saveTimer);
    guardarADisco();
    if (db) db.close();
}

module.exports = {
    init,
    initQueens, getActiveQueenNames, getAllQueensFull,
    crearQueen, editarQueen, toggleQueenActivo, renombrarQueen, eliminarQueen, getApodosMap,
    getRanking, getRankingMensual, getRankingDiario, getVictorias, getCopa,
    sumarPuntos, sumarVictoria,
    resetSemanal, resetMensual, resetDiario, resetCopa, resetVictorias,
    resolverAlias, agregarAlias, eliminarAlias, getAliases, getAliasesPorQueen,
    crearGrupo, getGrupos, eliminarGrupo, agregarMiembro, removerMiembro,
    getSonidos, setSonido,
    getDinamicas, getDinamica, crearDinamica, editarDinamica, eliminarDinamica, duplicarDinamica,
    getConfigVal, setConfigVal,
    migrarDesdeJSON, close
};
