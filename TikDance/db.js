const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let SQL = null;

async function initSQL() {
    if (!SQL) {
        SQL = await initSqlJs();
    }
    return SQL;
}

class DBInstance {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = null;
        this.dirty = false;
        this.saveTimer = null;
    }

    guardarADisco() {
        if (!this.db || !this.dirty) return;
        try {
            const data = this.db.export();
            fs.writeFileSync(this.dbPath, Buffer.from(data));
            this.dirty = false;
        } catch (e) {
            console.error(`⚠️ Error guardando ${this.dbPath}:`, e.message);
        }
    }

    close() {
        if (this.saveTimer) clearInterval(this.saveTimer);
        this.guardarADisco();
        if (this.db) {
            try { this.db.close(); } catch(e) {}
            this.db = null;
        }
    }

    marcarCambio() {
        this.dirty = true;
    }

    queryAll(sql, params) {
        if (!this.db) return [];
        const stmt = this.db.prepare(sql);
        if (params) stmt.bind(params);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    }

    queryOne(sql, params) {
        const rows = this.queryAll(sql, params);
        return rows.length > 0 ? rows[0] : null;
    }

    runSql(sql, params) {
        if (!this.db) return;
        this.db.run(sql, params);
        this.marcarCambio();
    }

    init() {
        if (fs.existsSync(this.dbPath)) {
            const buffer = fs.readFileSync(this.dbPath);
            this.db = new SQL.Database(buffer);
            console.log(`📂 Base de datos cargada desde ${this.dbPath}`);
        } else {
            this.db = new SQL.Database();
            console.log(`🆕 Base de datos nueva creada en ${this.dbPath}`);
        }

        // Crear tablas
        this.db.run(`CREATE TABLE IF NOT EXISTS queens (
            name TEXT PRIMARY KEY,
            color TEXT NOT NULL DEFAULT '#ffffff',
            ranking_semanal INTEGER NOT NULL DEFAULT 0,
            ranking_mensual INTEGER NOT NULL DEFAULT 0,
            victorias INTEGER NOT NULL DEFAULT 0,
            copa INTEGER NOT NULL DEFAULT 0,
            activo INTEGER NOT NULL DEFAULT 1,
            empates INTEGER NOT NULL DEFAULT 0,
            derrotas INTEGER NOT NULL DEFAULT 0
        )`);

        // Migraciones para columnas añadidas en versiones posteriores
        try { this.db.run(`ALTER TABLE queens ADD COLUMN activo INTEGER NOT NULL DEFAULT 1`); } catch(e) {}
        try { this.db.run(`ALTER TABLE queens ADD COLUMN apodo TEXT NOT NULL DEFAULT ''`); } catch(e) {}
        try { this.db.run(`ALTER TABLE queens ADD COLUMN ranking_diario INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
        try { this.db.run(`ALTER TABLE queens ADD COLUMN regalo_img TEXT NOT NULL DEFAULT ''`); } catch(e) {}
        try { this.db.run(`ALTER TABLE queens ADD COLUMN regalo_pts INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
        try { this.db.run(`ALTER TABLE queens ADD COLUMN empates INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
        try { this.db.run(`ALTER TABLE queens ADD COLUMN derrotas INTEGER NOT NULL DEFAULT 0`); } catch(e) {}

        this.db.run(`CREATE TABLE IF NOT EXISTS aliases (
            alias_name TEXT PRIMARY KEY COLLATE NOCASE,
            queen_name TEXT NOT NULL REFERENCES queens(name)
        )`);

        this.db.run(`CREATE TABLE IF NOT EXISTS grupos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT UNIQUE NOT NULL,
            color TEXT NOT NULL DEFAULT '#ffffff'
        )`);

        this.db.run(`CREATE TABLE IF NOT EXISTS grupo_miembros (
            grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
            queen_name TEXT NOT NULL REFERENCES queens(name),
            PRIMARY KEY (grupo_id, queen_name)
        )`);

        this.db.run(`CREATE TABLE IF NOT EXISTS sonidos (
            evento TEXT PRIMARY KEY,
            url TEXT NOT NULL DEFAULT ''
        )`);

        this.db.run(`CREATE TABLE IF NOT EXISTS dinamicas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            descripcion TEXT DEFAULT '',
            icono TEXT DEFAULT '⚔️',
            color TEXT DEFAULT '#6366f1',
            participantes TEXT DEFAULT 'todas',
            reglas TEXT DEFAULT '{}',
            creado_en TEXT DEFAULT CURRENT_TIMESTAMP
        )`);

        this.db.run(`CREATE TABLE IF NOT EXISTS config (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL DEFAULT ''
        )`);

        this.db.run(`CREATE TABLE IF NOT EXISTS regalos_custom (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            accion TEXT DEFAULT '',
            imagen TEXT NOT NULL,
            creado_en TEXT DEFAULT CURRENT_TIMESTAMP
        )`);

        this.db.run(`CREATE TABLE IF NOT EXISTS historial_regalos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            queen_name TEXT NOT NULL REFERENCES queens(name),
            gift_name TEXT NOT NULL,
            diamonds INTEGER NOT NULL,
            viewer_name TEXT NOT NULL,
            timestamp TEXT DEFAULT (datetime('now', 'localtime'))
        )`);

        this.dirty = true;
        this.guardarADisco();

        // Auto-guardar cada 3 segundos
        this.saveTimer = setInterval(() => this.guardarADisco(), 3000);
    }

    initQueens(queensArray) {
        const colores = { Amy: '#ff1493', Ray: '#ffd700', Nucita: '#00ffff', Venus: '#b026ff' };
        for (const name of queensArray) {
            const existing = this.queryOne('SELECT name FROM queens WHERE name = ?', [name]);
            if (!existing) {
                this.runSql('INSERT INTO queens (name, color, activo) VALUES (?, ?, 1)', [name, colores[name] || '#ffffff']);
            }
        }
    }

    getActiveQueenNames() {
        return this.queryAll('SELECT name FROM queens WHERE activo = 1 ORDER BY name').map(q => q.name);
    }

    getAllQueensFull() {
        return this.queryAll('SELECT * FROM queens ORDER BY activo DESC, name');
    }

    crearQueen(name, color, apodo = '', regaloImg = '', regaloPts = 0) {
        const existing = this.queryOne('SELECT name FROM queens WHERE name = ?', [name]);
        if (existing) {
            this.runSql('UPDATE queens SET activo = 1, color = ?, apodo = ?, regalo_img = ?, regalo_pts = ? WHERE name = ?', [color, apodo, regaloImg, regaloPts, name]);
        } else {
            this.runSql('INSERT INTO queens (name, color, activo, apodo, regalo_img, regalo_pts) VALUES (?, ?, 1, ?, ?, ?)', [name, color, apodo, regaloImg, regaloPts]);
        }
    }

    editarQueen(name, color, apodo = null, regaloImg = null, regaloPts = null) {
        let sets = ['color = ?'];
        let vals = [color];
        if (apodo     !== null) { sets.push('apodo = ?');       vals.push(apodo.trim()); }
        if (regaloImg !== null) { sets.push('regalo_img = ?');  vals.push(regaloImg); }
        if (regaloPts !== null) { sets.push('regalo_pts = ?');  vals.push(regaloPts); }
        vals.push(name);
        this.runSql(`UPDATE queens SET ${sets.join(', ')} WHERE name = ?`, vals);
    }

    getApodosMap() {
        const queens = this.queryAll('SELECT name, apodo FROM queens');
        const map = {};
        queens.forEach(q => { map[q.name] = (q.apodo && q.apodo.trim()) ? q.apodo.trim() : q.name; });
        return map;
    }

    toggleQueenActivo(name) {
        this.runSql('UPDATE queens SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END WHERE name = ?', [name]);
        const row = this.queryOne('SELECT activo FROM queens WHERE name = ?', [name]);
        return row ? row.activo : 0;
    }

    renombrarQueen(nombreViejo, nombreNuevo) {
        this.runSql('UPDATE aliases SET queen_name = ? WHERE queen_name = ?', [nombreNuevo, nombreViejo]);
        this.runSql('UPDATE grupo_miembros SET queen_name = ? WHERE queen_name = ?', [nombreNuevo, nombreViejo]);
        this.runSql('UPDATE queens SET name = ? WHERE name = ?', [nombreNuevo, nombreViejo]);
    }

    eliminarQueen(nombre) {
        this.runSql('DELETE FROM grupo_miembros WHERE queen_name = ?', [nombre]);
        this.runSql('DELETE FROM aliases WHERE queen_name = ?', [nombre]);
        this.runSql('DELETE FROM queens WHERE name = ?', [nombre]);
    }

    getRanking() {
        const queens = this.queryAll('SELECT name, ranking_semanal FROM queens ORDER BY ranking_semanal DESC');
        const obj = {};
        queens.forEach(q => obj[q.name] = q.ranking_semanal);
        return obj;
    }

    getRankingMensual() {
        const queens = this.queryAll('SELECT name, ranking_mensual FROM queens ORDER BY ranking_mensual DESC');
        const obj = {};
        queens.forEach(q => obj[q.name] = q.ranking_mensual);
        return obj;
    }

    getRankingDiario() {
        const queens = this.queryAll('SELECT name, ranking_diario FROM queens ORDER BY ranking_diario DESC');
        const obj = {};
        queens.forEach(q => obj[q.name] = q.ranking_diario);
        return obj;
    }

    getVictorias() {
        const queens = this.queryAll('SELECT name, victorias FROM queens');
        const obj = {};
        queens.forEach(q => obj[q.name] = q.victorias);
        return obj;
    }

    getCopa() {
        const queens = this.queryAll('SELECT name, copa FROM queens');
        const obj = {};
        queens.forEach(q => obj[q.name] = q.copa);
        return obj;
    }

    sumarPuntos(name, puntos) {
        this.runSql('UPDATE queens SET ranking_semanal = MAX(0, ranking_semanal + ?), ranking_mensual = MAX(0, ranking_mensual + ?), ranking_diario = MAX(0, ranking_diario + ?), copa = MAX(0, copa + ?) WHERE name = ?', [puntos, puntos, puntos, puntos, name]);
    }

    sumarVictoria(name) {
        this.runSql('UPDATE queens SET victorias = victorias + 1 WHERE name = ?', [name]);
    }

    sumarEmpate(name) {
        this.runSql('UPDATE queens SET empates = empates + 1 WHERE name = ?', [name]);
    }

    sumarDerrota(name) {
        this.runSql('UPDATE queens SET derrotas = derrotas + 1 WHERE name = ?', [name]);
    }

    resetSemanal() { this.runSql('UPDATE queens SET ranking_semanal = 0'); }
    resetMensual() { this.runSql('UPDATE queens SET ranking_mensual = 0'); }
    resetDiario()  { this.runSql('UPDATE queens SET ranking_diario = 0'); }
    resetCopa() { this.runSql('UPDATE queens SET copa = 0'); }
    resetVictorias() { 
        this.runSql('UPDATE queens SET victorias = 0'); 
        this.runSql('UPDATE queens SET empates = 0'); 
        this.runSql('UPDATE queens SET derrotas = 0'); 
    }

    resolverAlias(aliasName) {
        const row = this.queryOne('SELECT queen_name FROM aliases WHERE alias_name = ? COLLATE NOCASE', [aliasName]);
        return row ? row.queen_name : null;
    }

    agregarAlias(aliasName, queenName) {
        this.runSql('INSERT OR REPLACE INTO aliases (alias_name, queen_name) VALUES (?, ?)', [aliasName, queenName]);
    }

    eliminarAlias(aliasName) {
        this.runSql('DELETE FROM aliases WHERE alias_name = ?', [aliasName]);
    }

    getAliases() {
        return this.queryAll('SELECT * FROM aliases ORDER BY queen_name');
    }

    getAliasesPorQueen(queenName) {
        return this.queryAll('SELECT alias_name FROM aliases WHERE queen_name = ?', [queenName]).map(r => r.alias_name);
    }

    crearGrupo(nombre, color) {
        this.runSql('INSERT INTO grupos (nombre, color) VALUES (?, ?)', [nombre, color]);
        const row = this.queryOne('SELECT last_insert_rowid() as id');
        return row ? row.id : null;
    }

    getGrupos() {
        const grupos = this.queryAll('SELECT * FROM grupos ORDER BY nombre');
        return grupos.map(g => ({
            ...g,
            miembros: this.queryAll('SELECT queen_name FROM grupo_miembros WHERE grupo_id = ?', [g.id]).map(m => m.queen_name)
        }));
    }

    eliminarGrupo(id) {
        this.runSql('DELETE FROM grupo_miembros WHERE grupo_id = ?', [id]);
        this.runSql('DELETE FROM grupos WHERE id = ?', [id]);
    }

    agregarMiembro(grupoId, queenName) {
        this.runSql('INSERT OR IGNORE INTO grupo_miembros (grupo_id, queen_name) VALUES (?, ?)', [grupoId, queenName]);
    }

    removerMiembro(grupoId, queenName) {
        this.runSql('DELETE FROM grupo_miembros WHERE grupo_id = ? AND queen_name = ?', [grupoId, queenName]);
    }

    getSonidos() {
        return this.queryAll('SELECT * FROM sonidos');
    }

    setSonido(evento, url) {
        this.runSql('INSERT OR REPLACE INTO sonidos (evento, url) VALUES (?, ?)', [evento, url]);
    }

    getDinamicas() {
        return this.queryAll('SELECT * FROM dinamicas ORDER BY id DESC').map(d => ({ ...d, reglas: JSON.parse(d.reglas || '{}') }));
    }

    getDinamica(id) {
        const d = this.queryOne('SELECT * FROM dinamicas WHERE id = ?', [id]);
        return d ? { ...d, reglas: JSON.parse(d.reglas || '{}') } : null;
    }

    crearDinamica(data) {
        this.runSql(`INSERT INTO dinamicas (nombre, descripcion, icono, color, participantes, reglas) VALUES (?, ?, ?, ?, ?, ?)`,
            [data.nombre, data.descripcion || '', data.icono || '⚔️', data.color || '#6366f1', data.participantes || 'todas', JSON.stringify(data.reglas || {})]);
    }

    editarDinamica(id, data) {
        this.runSql(`UPDATE dinamicas SET nombre=?, descripcion=?, icono=?, color=?, participantes=?, reglas=? WHERE id=?`,
            [data.nombre, data.descripcion || '', data.icono || '⚔️', data.color || '#6366f1', data.participantes || 'todas', JSON.stringify(data.reglas || {}), id]);
    }

    eliminarDinamica(id) {
        this.runSql('DELETE FROM dinamicas WHERE id = ?', [id]);
    }

    duplicarDinamica(id) {
        const d = this.queryOne('SELECT * FROM dinamicas WHERE id = ?', [id]);
        if (!d) return;
        this.runSql(`INSERT INTO dinamicas (nombre, descripcion, icono, color, participantes, reglas) VALUES (?, ?, ?, ?, ?, ?)`,
            ['[Copia] ' + d.nombre, d.descripcion, d.icono, d.color, d.participantes, d.reglas]);
    }

    getConfigVal(clave) {
        const row = this.queryOne('SELECT valor FROM config WHERE clave = ?', [clave]);
        return row ? row.valor : null;
    }

    setConfigVal(clave, valor) {
        this.runSql('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor', [clave, valor]);
    }

    getRegalosCustom() {
        return this.queryAll('SELECT * FROM regalos_custom ORDER BY id DESC');
    }

    crearRegaloCustom(data) {
        this.runSql(`INSERT INTO regalos_custom (nombre, accion, imagen) VALUES (?, ?, ?)`,
            [data.nombre, data.accion || '', data.imagen || '']);
    }

    editarRegaloCustom(id, data) {
        this.runSql(`UPDATE regalos_custom SET nombre=?, accion=?, imagen=? WHERE id=?`,
            [data.nombre, data.accion || '', data.imagen || '', id]);
    }

    eliminarRegaloCustom(id) {
        this.runSql('DELETE FROM regalos_custom WHERE id = ?', [id]);
    }

    registrarRegalo(queenName, giftName, diamonds, viewerName) {
        this.runSql('INSERT INTO historial_regalos (queen_name, gift_name, diamonds, viewer_name) VALUES (?, ?, ?, ?)', [queenName, giftName, diamonds, viewerName]);
    }

    getResumenAnalytics() {
        const totalHistorico = this.queryOne("SELECT COALESCE(SUM(diamonds), 0) as total FROM historial_regalos").total;
        const totalHoy = this.queryOne("SELECT COALESCE(SUM(diamonds), 0) as total FROM historial_regalos WHERE date(timestamp) = date('now', 'localtime')").total;
        const totalMes = this.queryOne("SELECT COALESCE(SUM(diamonds), 0) as total FROM historial_regalos WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now', 'localtime')").total;
        
        const porQueen = this.queryAll("SELECT queen_name, COALESCE(SUM(diamonds), 0) as total_diamantes, COUNT(*) as cantidad_regalos FROM historial_regalos GROUP BY queen_name ORDER BY total_diamantes DESC");
        
        return {
            totalHistorico,
            totalHoy,
            totalMes,
            porQueen
        };
    }

    getHistorialRegalos(limite = 50) {
        return this.queryAll("SELECT * FROM historial_regalos ORDER BY id DESC LIMIT ?", [limite]);
    }

    getTopGifters(limite = 5) {
        return this.queryAll("SELECT viewer_name, COALESCE(SUM(diamonds), 0) as total_donado, COUNT(*) as cantidad_regalos FROM historial_regalos GROUP BY viewer_name ORDER BY total_donado DESC LIMIT ?", [limite]);
    }

    getRegalosPorDia() {
        return this.queryAll(`
            SELECT strftime('%Y-%m-%d', timestamp) as dia, COALESCE(SUM(diamonds), 0) as total_diamantes
            FROM historial_regalos
            WHERE timestamp >= datetime('now', '-6 days', 'start of day', 'localtime')
            GROUP BY dia
            ORDER BY dia ASC
        `);
    }

    close() {
        if (this.saveTimer) clearInterval(this.saveTimer);
        this.guardarADisco();
        if (this.db) this.db.close();
    }

    getFutbolConfig() {
        const raw = this.getConfigVal('futbol_config');
        if(raw) {
            try {
                return JSON.parse(raw);
            } catch(e){}
        }
        return {
            equipo1: { nombre: 'BARCELONA', color1: '#004D98', color2: '#A50044', miembros: ['Ray', 'Nucita'] },
            equipo2: { nombre: 'REAL MADRID', color1: '#FFFFFF', color2: '#CCCCCC', miembros: ['Amy', 'Venus'] }
        };
    }

    setFutbolConfig(configObj) {
        this.setConfigVal('futbol_config', JSON.stringify(configObj));
    }

    migrarDesdeJSON(filePath) {
        if (!fs.existsSync(filePath)) return false;
        
        const queens = this.queryAll('SELECT name, ranking_semanal FROM queens');
        const totalPuntos = queens.reduce((s, q) => s + q.ranking_semanal, 0);
        if (totalPuntos > 0) return false;
        
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const rankingData = data.ranking || data;
            const victoriasData = data.victorias || {};
            const copaData = data.copa || {};
            
            for (const name in rankingData) {
                this.runSql('UPDATE queens SET ranking_semanal = ?, ranking_mensual = ? WHERE name = ?', [rankingData[name] || 0, rankingData[name] || 0, name]);
            }
            for (const name in victoriasData) {
                this.runSql('UPDATE queens SET victorias = ? WHERE name = ?', [victoriasData[name] || 0, name]);
            }
            for (const name in copaData) {
                this.runSql('UPDATE queens SET copa = ? WHERE name = ?', [copaData[name] || 0, name]);
            }
            
            console.log('✅ Datos migrados desde datos.json a SQLite');
            return true;
        } catch (e) {
            console.error('⚠️ Error migrando datos.json:', e.message);
            return false;
        }
    }
}

module.exports = {
    initSQL,
    DBInstance
};
