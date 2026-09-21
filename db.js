const { query } = require('./src/config/dbPool');

class DBInstance {
    constructor(username, userId = null) {
        this.username = username;
        this.userId = userId;
        this.cacheQueens = [];
        this.cacheAliases = [];
        this.cacheGrupos = [];
        this.cacheConfig = {};
        this.cacheSonidos = {};
        this.cacheRegalosCustom = [];
        this.cacheDinamicas = [];
    }

    close() {
        // No-op para compatibilidad
    }

    async ensureUserId() {
        if (this.userId) return this.userId;
        try {
            let res = await query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [this.username]);
            if (res.rows.length === 0) {
                const crypto = require('crypto');
                const salt = crypto.randomBytes(16).toString('hex');
                const hashed = `${salt}:${crypto.pbkdf2Sync(this.username, salt, 1000, 64, 'sha512').toString('hex')}`;
                const instRes = await query('INSERT INTO users (username, password, name) VALUES ($1, $2, $3) RETURNING id', [this.username.toLowerCase(), hashed, this.username]);
                if (instRes.rows.length > 0) this.userId = instRes.rows[0].id;
            } else {
                this.userId = res.rows[0].id;
            }
        } catch (e) {
            console.error('Error en ensureUserId:', e.message);
        }
        return this.userId;
    }

    async init(userId) {
        if (userId) this.userId = userId;
        await this.ensureUserId();
        await this.cargarCache();
    }

    async cargarCache() {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            const [qRes, aRes, gRes, cRes, sRes, rcRes] = await Promise.all([
                query('SELECT * FROM queens WHERE user_id = $1 ORDER BY activo DESC, name', [uId]),
                query('SELECT a.alias_name, q.name as queen_name FROM aliases a JOIN queens q ON a.queen_id = q.id WHERE q.user_id = $1', [uId]),
                query('SELECT * FROM grupos WHERE user_id = $1 ORDER BY nombre', [uId]),
                query('SELECT clave, valor FROM config WHERE user_id = $1', [uId]),
                query('SELECT evento, url FROM sonidos WHERE user_id = $1', [uId]),
                query('SELECT * FROM regalos_custom WHERE user_id = $1 ORDER BY id DESC', [uId])
            ]);

            this.cacheQueens = qRes.rows;
            this.cacheAliases = aRes.rows;
            this.cacheGrupos = gRes.rows;
            this.cacheConfig = {};
            cRes.rows.forEach(r => { this.cacheConfig[r.clave] = r.valor; });
            this.cacheSonidos = {};
            sRes.rows.forEach(r => { this.cacheSonidos[r.evento] = r.url; });
            this.cacheRegalosCustom = rcRes.rows;
        } catch (e) {
            console.error(`⚠️ Error cargando cache desde Supabase para ${this.username}:`, e.message);
        }
    }

    async initQueens(queensArray) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            const countRes = await query('SELECT COUNT(*) as total FROM queens WHERE user_id = $1', [uId]);
            if (parseInt(countRes.rows[0].total) > 0) return;

            const colores = { Amy: '#ff1493', Ray: '#ffd700', Nucita: '#00ffff', Venus: '#b026ff' };
            for (const name of queensArray) {
                await query(
                    'INSERT INTO queens (user_id, name, color, activo) VALUES ($1, $2, $3, 1) ON CONFLICT (user_id, name) DO NOTHING',
                    [uId, name, colores[name] || '#ffffff']
                );
            }
            await this.cargarCache();
        } catch (e) {
            console.error('Error en initQueens:', e.message);
        }
    }

    getActiveQueenNames() {
        return this.cacheQueens.filter(q => q.activo === 1 || q.activo === true).map(q => q.name);
    }

    getAllQueensFull() {
        return this.cacheQueens;
    }

    async crearQueen(name, color, apodo = '', regaloImg = '', regaloPts = 0, avatarImg = '', nombreImg = '') {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            await query(`
                INSERT INTO queens (user_id, name, color, apodo, regalo_img, regalo_pts, avatar_img, nombre_img, activo)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
                ON CONFLICT (user_id, name) DO UPDATE SET
                    color = EXCLUDED.color,
                    apodo = EXCLUDED.apodo,
                    regalo_img = EXCLUDED.regalo_img,
                    regalo_pts = EXCLUDED.regalo_pts,
                    avatar_img = EXCLUDED.avatar_img,
                    nombre_img = EXCLUDED.nombre_img,
                    activo = 1
            `, [uId, name, color, apodo, regaloImg, regaloPts, avatarImg, nombreImg]);
            await this.cargarCache();
        } catch (e) {
            console.error('Error en crearQueen:', e.message);
        }
    }

    async editarQueen(name, color, apodo = null, regaloImg = null, regaloPts = null, avatarImg = null, nombreImg = null) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            let sets = ['color = $1'];
            let vals = [color];
            let idx = 1;

            if (apodo !== null)     { sets.push(`apodo = $${++idx}`); vals.push(apodo.trim()); }
            if (regaloImg !== null) { sets.push(`regalo_img = $${++idx}`); vals.push(regaloImg); }
            if (regaloPts !== null) { sets.push(`regalo_pts = $${++idx}`); vals.push(regaloPts); }
            if (avatarImg !== null) { sets.push(`avatar_img = $${++idx}`); vals.push(avatarImg); }
            if (nombreImg !== null) { sets.push(`nombre_img = $${++idx}`); vals.push(nombreImg); }

            vals.push(uId);
            const idxUid = ++idx;
            vals.push(name);
            const idxName = ++idx;

            await query(`UPDATE queens SET ${sets.join(', ')} WHERE user_id = $${idxUid} AND LOWER(name) = LOWER($${idxName})`, vals);
            await this.cargarCache();
        } catch (e) {
            console.error('Error en editarQueen:', e.message);
        }
    }

    getApodosMap() {
        const map = {};
        this.cacheQueens.forEach(q => { map[q.name] = (q.apodo && q.apodo.trim()) ? q.apodo.trim() : q.name; });
        return map;
    }

    async toggleQueenActivo(name) {
        const uId = await this.ensureUserId();
        if (!uId) return 0;
        try {
            const res = await query('UPDATE queens SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END WHERE user_id = $1 AND LOWER(name) = LOWER($2) RETURNING activo', [uId, name]);
            await this.cargarCache();
            return res.rows.length > 0 ? res.rows[0].activo : 0;
        } catch (e) {
            console.error('Error en toggleQueenActivo:', e.message);
            return 0;
        }
    }

    async renombrarQueen(nombreViejo, nombreNuevo) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            await query('UPDATE queens SET name = $1 WHERE user_id = $2 AND LOWER(name) = LOWER($3)', [nombreNuevo, uId, nombreViejo]);
            await this.cargarCache();
        } catch (e) {
            console.error('Error en renombrarQueen:', e.message);
        }
    }

    async eliminarQueen(nombre) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            await query('DELETE FROM queens WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [uId, nombre]);
            await this.cargarCache();
        } catch (e) {
            console.error('Error en eliminarQueen:', e.message);
        }
    }

    getRanking() {
        const obj = {};
        this.cacheQueens.forEach(q => obj[q.name] = q.ranking_semanal || 0);
        return obj;
    }

    getRankingMensual() {
        const obj = {};
        this.cacheQueens.forEach(q => obj[q.name] = q.ranking_mensual || 0);
        return obj;
    }

    getRankingDiario() {
        const obj = {};
        this.cacheQueens.forEach(q => obj[q.name] = q.ranking_diario || 0);
        return obj;
    }

    getVictorias() {
        const obj = {};
        this.cacheQueens.forEach(q => obj[q.name] = q.victorias || 0);
        return obj;
    }

    getCopa() {
        const obj = {};
        this.cacheQueens.forEach(q => obj[q.name] = q.copa || 0);
        return obj;
    }

    getRankingTitulos() {
        return {
            semanal: this.getConfigVal('titulo_semanal') || '',
            mensual: this.getConfigVal('titulo_mensual') || '',
            diario:  this.getConfigVal('titulo_diario') || ''
        };
    }

    async setRankingTitulos({ semanal, mensual, diario }) {
        if (semanal !== undefined) await this.setConfigVal('titulo_semanal', semanal);
        if (mensual !== undefined) await this.setConfigVal('titulo_mensual', mensual);
        if (diario  !== undefined) await this.setConfigVal('titulo_diario', diario);
    }

    // Config Futbol
    getFutbolConfig() {
        const raw = this.getConfigVal('futbol_config');
        try {
            return raw ? JSON.parse(raw) : { equipo1: [], equipo2: [] };
        } catch (e) {
            return { equipo1: [], equipo2: [] };
        }
    }

    async setFutbolConfig(config) {
        await this.setConfigVal('futbol_config', JSON.stringify(config || {}));
    }

    // Config Agencia
    getAgenciaConfig() {
        const raw = this.getConfigVal('agencia_config');
        try {
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    async setAgenciaConfig(config) {
        await this.setConfigVal('agencia_config', JSON.stringify(config || {}));
    }

    async sumarPuntos(name, puntos) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            const q = this.cacheQueens.find(item => item.name.toLowerCase() === name.toLowerCase());
            if (q) {
                q.ranking_semanal = Math.max(0, (q.ranking_semanal || 0) + puntos);
                q.ranking_mensual = Math.max(0, (q.ranking_mensual || 0) + puntos);
                q.ranking_diario  = Math.max(0, (q.ranking_diario || 0) + puntos);
                q.copa            = Math.max(0, (q.copa || 0) + puntos);
            }
            await query(`
                UPDATE queens 
                SET ranking_semanal = GREATEST(0, ranking_semanal + $1),
                    ranking_mensual = GREATEST(0, ranking_mensual + $1),
                    ranking_diario = GREATEST(0, ranking_diario + $1),
                    copa = GREATEST(0, copa + $1)
                WHERE user_id = $2 AND LOWER(name) = LOWER($3)
            `, [puntos, uId, name]);
        } catch (e) {
            console.error('Error en sumarPuntos:', e.message);
        }
    }

    async sumarVictoria(name) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            const q = this.cacheQueens.find(item => item.name.toLowerCase() === name.toLowerCase());
            if (q) q.victorias = (q.victorias || 0) + 1;
            await query('UPDATE queens SET victorias = victorias + 1 WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [uId, name]);
        } catch (e) {
            console.error('Error en sumarVictoria:', e.message);
        }
    }

    async sumarEmpate(name) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            const q = this.cacheQueens.find(item => item.name.toLowerCase() === name.toLowerCase());
            if (q) q.empates = (q.empates || 0) + 1;
            await query('UPDATE queens SET empates = empates + 1 WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [uId, name]);
        } catch (e) {
            console.error('Error en sumarEmpate:', e.message);
        }
    }

    async sumarDerrota(name) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            const q = this.cacheQueens.find(item => item.name.toLowerCase() === name.toLowerCase());
            if (q) q.derrotas = (q.derrotas || 0) + 1;
            await query('UPDATE queens SET derrotas = derrotas + 1 WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [uId, name]);
        } catch (e) {
            console.error('Error en sumarDerrota:', e.message);
        }
    }

    async resetSemanal() {
        const uId = await this.ensureUserId();
        if (!uId) return;
        this.cacheQueens.forEach(q => q.ranking_semanal = 0);
        await query('UPDATE queens SET ranking_semanal = 0 WHERE user_id = $1', [uId]);
    }

    async resetMensual() {
        const uId = await this.ensureUserId();
        if (!uId) return;
        this.cacheQueens.forEach(q => q.ranking_mensual = 0);
        await query('UPDATE queens SET ranking_mensual = 0 WHERE user_id = $1', [uId]);
    }

    async resetDiario() {
        const uId = await this.ensureUserId();
        if (!uId) return;
        this.cacheQueens.forEach(q => q.ranking_diario = 0);
        await query('UPDATE queens SET ranking_diario = 0 WHERE user_id = $1', [uId]);
    }

    async resetCopa() {
        const uId = await this.ensureUserId();
        if (!uId) return;
        this.cacheQueens.forEach(q => q.copa = 0);
        await query('UPDATE queens SET copa = 0 WHERE user_id = $1', [uId]);
    }

    async resetVictorias() {
        const uId = await this.ensureUserId();
        if (!uId) return;
        this.cacheQueens.forEach(q => { q.victorias = 0; q.empates = 0; q.derrotas = 0; });
        await query('UPDATE queens SET victorias = 0, empates = 0, derrotas = 0 WHERE user_id = $1', [uId]);
    }

    resolverAlias(aliasName) {
        const found = this.cacheAliases.find(a => a.alias_name.toLowerCase() === aliasName.toLowerCase());
        return found ? found.queen_name : null;
    }

    async agregarAlias(aliasName, queenName) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            const qRes = await query('SELECT id FROM queens WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [uId, queenName]);
            if (qRes.rows.length === 0) return;
            const queenId = qRes.rows[0].id;
            await query('INSERT INTO aliases (queen_id, alias_name) VALUES ($1, $2) ON CONFLICT (queen_id, alias_name) DO NOTHING', [queenId, aliasName]);
            await this.cargarCache();
        } catch (e) {
            console.error('Error en agregarAlias:', e.message);
        }
    }

    async eliminarAlias(aliasName) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            await query('DELETE FROM aliases WHERE LOWER(alias_name) = LOWER($1) AND queen_id IN (SELECT id FROM queens WHERE user_id = $2)', [aliasName, uId]);
            await this.cargarCache();
        } catch (e) {
            console.error('Error en eliminarAlias:', e.message);
        }
    }

    getAliases() {
        return this.cacheAliases;
    }

    getAliasesPorQueen(queenName) {
        return this.cacheAliases.filter(a => a.queen_name === queenName).map(a => a.alias_name);
    }

    // Grupos
    getGrupos() {
        return this.cacheGrupos.map(g => ({
            ...g,
            miembros: []
        }));
    }

    async crearGrupo(nombre, color) {
        const uId = await this.ensureUserId();
        if (!uId) return null;
        const res = await query('INSERT INTO grupos (user_id, nombre, color) VALUES ($1, $2, $3) RETURNING id', [uId, nombre, color]);
        await this.cargarCache();
        return res.rows[0]?.id;
    }

    async eliminarGrupo(id) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        await query('DELETE FROM grupos WHERE user_id = $1 AND id = $2', [uId, id]);
        await this.cargarCache();
    }

    async agregarMiembro(grupoId, queenName) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        const qRes = await query('SELECT id FROM queens WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [uId, queenName]);
        if (qRes.rows.length > 0) {
            await query('INSERT INTO grupo_miembros (grupo_id, queen_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [grupoId, qRes.rows[0].id]);
        }
    }

    async removerMiembro(grupoId, queenName) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        const qRes = await query('SELECT id FROM queens WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [uId, queenName]);
        if (qRes.rows.length > 0) {
            await query('DELETE FROM grupo_miembros WHERE grupo_id = $1 AND queen_id = $2', [grupoId, qRes.rows[0].id]);
        }
    }

    // Sonidos
    getSonidos() {
        return Object.keys(this.cacheSonidos).map(evento => ({ evento, url: this.cacheSonidos[evento] }));
    }

    async setSonido(evento, url) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        await query('INSERT INTO sonidos (user_id, evento, url) VALUES ($1, $2, $3) ON CONFLICT (user_id, evento) DO UPDATE SET url = EXCLUDED.url', [uId, evento, url]);
        this.cacheSonidos[evento] = url;
    }

    // Dinámicas personalizadas
    getDinamicas() {
        return this.cacheDinamicas;
    }

    getDinamica(id) {
        return this.cacheDinamicas.find(d => d.id === parseInt(id)) || null;
    }

    async crearDinamica(data) {
        this.cacheDinamicas.push({ id: Date.now(), ...data });
    }

    async editarDinamica(id, data) {
        const idx = this.cacheDinamicas.findIndex(d => d.id === parseInt(id));
        if (idx !== -1) {
            this.cacheDinamicas[idx] = { id: parseInt(id), ...data };
        }
    }

    async eliminarDinamica(id) {
        this.cacheDinamicas = this.cacheDinamicas.filter(d => d.id !== parseInt(id));
    }

    async duplicarDinamica(id) {
        const d = this.getDinamica(id);
        if (d) {
            this.cacheDinamicas.push({ ...d, id: Date.now(), nombre: '[Copia] ' + d.nombre });
        }
    }

    // Regalos Custom
    getRegalosCustom() {
        return this.cacheRegalosCustom;
    }

    async crearRegaloCustom(data) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        const res = await query('INSERT INTO regalos_custom (user_id, nombre, accion, imagen) VALUES ($1, $2, $3, $4) RETURNING *', [uId, data.nombre, data.accion || '', data.imagen || '']);
        if (res.rows && res.rows.length > 0) {
            this.cacheRegalosCustom.unshift(res.rows[0]);
        } else {
            await this.cargarCache();
        }
    }

    async editarRegaloCustom(id, data) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        await query('UPDATE regalos_custom SET nombre=$1, accion=$2, imagen=$3 WHERE user_id=$4 AND id=$5', [data.nombre, data.accion || '', data.imagen || '', uId, id]);
        const item = this.cacheRegalosCustom.find(r => r.id === id);
        if (item) {
            item.nombre = data.nombre;
            item.accion = data.accion || '';
            item.imagen = data.imagen || '';
        }
    }

    async eliminarRegaloCustom(id) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        await query('DELETE FROM regalos_custom WHERE user_id=$1 AND id=$2', [uId, id]);
        this.cacheRegalosCustom = this.cacheRegalosCustom.filter(r => r.id !== id);
    }

    // Config
    getConfigVal(clave) {
        return this.cacheConfig[clave] || null;
    }

    async setConfigVal(clave, valor) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            await query(`
                INSERT INTO config (user_id, clave, valor) VALUES ($1, $2, $3)
                ON CONFLICT (user_id, clave) DO UPDATE SET valor = EXCLUDED.valor
            `, [uId, clave, String(valor)]);
            this.cacheConfig[clave] = String(valor);
        } catch (e) {
            console.error('Error en setConfigVal:', e.message);
        }
    }

    // REGISTRO DE REGALOS (Garantizado para Analíticas)
    async registrarRegalo(queenName, giftName, diamonds, viewerName) {
        const uId = await this.ensureUserId();
        if (!uId) return;
        try {
            let qRes = await query('SELECT id FROM queens WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [uId, queenName]);
            let queenId = null;
            if (qRes.rows.length === 0) {
                const insRes = await query('INSERT INTO queens (user_id, name, activo) VALUES ($1, $2, 1) RETURNING id', [uId, queenName]);
                if (insRes.rows.length > 0) queenId = insRes.rows[0].id;
            } else {
                queenId = qRes.rows[0].id;
            }
            if (!queenId) return;
            await query(
                'INSERT INTO historial_regalos (user_id, queen_id, gift_name, diamonds, viewer_name) VALUES ($1, $2, $3, $4, $5)',
                [uId, queenId, giftName || 'Regalo', diamonds || 0, viewerName || 'Anónimo']
            );
        } catch (e) {
            console.error('Error en registrarRegalo:', e.message);
        }
    }

    // CONSULTAS DE ANALÍTICAS
    async getResumenAnalytics() {
        const uId = await this.ensureUserId();
        if (!uId) return { totalHistorico: 0, totalHoy: 0, totalMes: 0, porQueen: [] };
        try {
            const hist = await query("SELECT COALESCE(SUM(diamonds), 0) as total FROM historial_regalos WHERE user_id = $1", [uId]);
            const hoy = await query("SELECT COALESCE(SUM(diamonds), 0) as total FROM historial_regalos WHERE user_id = $1 AND timestamp::date = CURRENT_DATE", [uId]);
            const mes = await query("SELECT COALESCE(SUM(diamonds), 0) as total FROM historial_regalos WHERE user_id = $1 AND DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)", [uId]);

            const pq = await query(`
                SELECT q.name as queen_name, COALESCE(SUM(h.diamonds), 0) as total_diamantes, COUNT(h.id) as cantidad_regalos
                FROM historial_regalos h
                JOIN queens q ON h.queen_id = q.id
                WHERE h.user_id = $1
                GROUP BY q.name
                ORDER BY total_diamantes DESC
            `, [uId]);

            return {
                totalHistorico: parseInt(hist.rows[0].total),
                totalHoy: parseInt(hoy.rows[0].total),
                totalMes: parseInt(mes.rows[0].total),
                porQueen: pq.rows
            };
        } catch (e) {
            console.error('Error en getResumenAnalytics:', e.message);
            return { totalHistorico: 0, totalHoy: 0, totalMes: 0, porQueen: [] };
        }
    }

    async getHistorialRegalos(limite = 50) {
        const uId = await this.ensureUserId();
        if (!uId) return [];
        try {
            const res = await query(`
                SELECT h.id, q.name as queen_name, h.gift_name, h.diamonds, h.viewer_name, h.timestamp
                FROM historial_regalos h
                JOIN queens q ON h.queen_id = q.id
                WHERE h.user_id = $1
                ORDER BY h.id DESC LIMIT $2
            `, [uId, limite]);
            return res.rows;
        } catch (e) {
            console.error('Error en getHistorialRegalos:', e.message);
            return [];
        }
    }

    async getTopGifters(limite = 5) {
        const uId = await this.ensureUserId();
        if (!uId) return [];
        try {
            const res = await query(`
                SELECT viewer_name, COALESCE(SUM(diamonds), 0) as total_donado, COUNT(*) as cantidad_regalos
                FROM historial_regalos
                WHERE user_id = $1
                GROUP BY viewer_name
                ORDER BY total_donado DESC LIMIT $2
            `, [uId, limite]);
            return res.rows;
        } catch (e) {
            console.error('Error en getTopGifters:', e.message);
            return [];
        }
    }

    async getRegalosPorDia() {
        const uId = await this.ensureUserId();
        if (!uId) return [];
        try {
            const res = await query(`
                SELECT TO_CHAR(timestamp, 'YYYY-MM-DD') as dia, COALESCE(SUM(diamonds), 0) as total_diamantes
                FROM historial_regalos
                WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '7 days'
                GROUP BY dia
                ORDER BY dia ASC
            `, [uId]);
            return res.rows;
        } catch (e) {
            console.error('Error en getRegalosPorDia:', e.message);
            return [];
        }
    }

    async getRegalosPorMes() {
        const uId = await this.ensureUserId();
        if (!uId) return [];
        try {
            const res = await query(`
                SELECT TO_CHAR(timestamp, 'YYYY-MM') as mes, COALESCE(SUM(diamonds), 0) as total_diamantes
                FROM historial_regalos
                WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '6 months'
                GROUP BY mes
                ORDER BY mes ASC
            `, [uId]);
            return res.rows;
        } catch (e) {
            console.error('Error en getRegalosPorMes:', e.message);
            return [];
        }
    }

    async getMesesConHistorial() {
        const uId = await this.ensureUserId();
        if (!uId) return [];
        try {
            const res = await query(`
                SELECT DISTINCT TO_CHAR(timestamp, 'YYYY-MM') as mes
                FROM historial_regalos
                WHERE user_id = $1 AND timestamp IS NOT NULL
                ORDER BY mes DESC
            `, [uId]);
            return res.rows;
        } catch (e) {
            console.error('Error en getMesesConHistorial:', e.message);
            return [];
        }
    }

    getDateFilterSQL(periodo) {
        if (!periodo || periodo === 'historico') return "1=1";
        const p = String(periodo).trim();
        if (p === 'diario')  return "timestamp::date = CURRENT_DATE";
        if (p === 'semanal') return "timestamp >= NOW() - INTERVAL '7 days'";
        if (p === 'mensual') return "DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)";
        if (/^\d{4}-\d{2}$/.test(p)) return `TO_CHAR(timestamp, 'YYYY-MM') = '${p}'`;
        return "1=1";
    }

    async getQueensAnalyticsPorPeriodo(periodo = 'historico') {
        const uId = await this.ensureUserId();
        if (!uId) return [];
        const filter = this.getDateFilterSQL(periodo);
        try {
            const res = await query(`
                SELECT q.name as queen_name, 
                       COALESCE(SUM(h.diamonds), 0) as total_diamantes, 
                       COUNT(h.id) as cantidad_regalos,
                       COALESCE(ROUND(AVG(h.diamonds), 1), 0) as promedio
                FROM historial_regalos h
                JOIN queens q ON h.queen_id = q.id
                WHERE h.user_id = $1 AND ${filter}
                GROUP BY q.name 
                ORDER BY total_diamantes DESC
            `, [uId]);
            return res.rows;
        } catch (e) {
            console.error('Error en getQueensAnalyticsPorPeriodo:', e.message);
            return [];
        }
    }

    async getDatosBailarina(name, periodo = 'historico') {
        const uId = await this.ensureUserId();
        if (!uId) return { total: 0, total_regalos: 0, promedio: 0 };
        const filter = this.getDateFilterSQL(periodo);
        try {
            const res = await query(`
                SELECT COALESCE(SUM(h.diamonds), 0) as total, 
                       COUNT(h.id) as total_regalos, 
                       COALESCE(ROUND(AVG(h.diamonds), 1), 0) as promedio 
                FROM historial_regalos h
                JOIN queens q ON h.queen_id = q.id
                WHERE h.user_id = $1 AND LOWER(q.name) = LOWER($2) AND ${filter}
            `, [uId, name]);
            return res.rows[0] || { total: 0, total_regalos: 0, promedio: 0 };
        } catch (e) {
            console.error('Error en getDatosBailarina:', e.message);
            return { total: 0, total_regalos: 0, promedio: 0 };
        }
    }

    async getTopDonadoresBailarina(name, limite = 5, periodo = 'historico') {
        const uId = await this.ensureUserId();
        if (!uId) return [];
        const filter = this.getDateFilterSQL(periodo);
        try {
            const res = await query(`
                SELECT h.viewer_name, COALESCE(SUM(h.diamonds), 0) as total_donado, COUNT(h.id) as cantidad_regalos
                FROM historial_regalos h
                JOIN queens q ON h.queen_id = q.id
                WHERE h.user_id = $1 AND LOWER(q.name) = LOWER($2) AND ${filter}
                GROUP BY h.viewer_name
                ORDER BY total_donado DESC LIMIT $3
            `, [uId, name, limite]);
            return res.rows;
        } catch (e) {
            console.error('Error en getTopDonadoresBailarina:', e.message);
            return [];
        }
    }

    async getDistribucionRegalosBailarina(name, periodo = 'historico') {
        const uId = await this.ensureUserId();
        if (!uId) return [];
        const filter = this.getDateFilterSQL(periodo);
        try {
            const res = await query(`
                SELECT h.gift_name, COALESCE(SUM(h.diamonds), 0) as total_diamantes, COUNT(h.id) as cantidad
                FROM historial_regalos h
                JOIN queens q ON h.queen_id = q.id
                WHERE h.user_id = $1 AND LOWER(q.name) = LOWER($2) AND ${filter}
                GROUP BY h.gift_name
                ORDER BY total_diamantes DESC
            `, [uId, name]);
            return res.rows;
        } catch (e) {
            console.error('Error en getDistribucionRegalosBailarina:', e.message);
            return [];
        }
    }

    async getEvolucionBailarina(name, periodo = 'historico') {
        const uId = await this.ensureUserId();
        if (!uId) return [];
        const filter = this.getDateFilterSQL(periodo);
        try {
            const res = await query(`
                SELECT TO_CHAR(h.timestamp, 'YYYY-MM-DD') as dia, COALESCE(SUM(h.diamonds), 0) as total_diamantes
                FROM historial_regalos h
                JOIN queens q ON h.queen_id = q.id
                WHERE h.user_id = $1 AND LOWER(q.name) = LOWER($2) AND ${filter}
                GROUP BY dia
                ORDER BY dia ASC
            `, [uId, name]);
            return res.rows;
        } catch (e) {
            console.error('Error en getEvolucionBailarina:', e.message);
            return [];
        }
    }

    async getDonacionesPorHora() {
        const uId = await this.ensureUserId();
        if (!uId) return [];
        try {
            const res = await query(`
                SELECT EXTRACT(HOUR FROM timestamp) as hora, COALESCE(SUM(diamonds), 0) as total_diamantes, COUNT(id) as cantidad_regalos
                FROM historial_regalos
                WHERE user_id = $1
                GROUP BY hora
                ORDER BY hora ASC
            `, [uId]);
            return res.rows;
        } catch (e) {
            console.error('Error en getDonacionesPorHora:', e.message);
            return [];
        }
    }
}

module.exports = {
    DBInstance
};
