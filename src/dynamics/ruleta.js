const OPCIONES_DEFAULT = [
    { id: 'opt-1', texto: 'Baile Sorpresa', emoji: '💃', color: '#FF2A5F', peso: 1 },
    { id: 'opt-2', texto: 'Reto del Chat',  emoji: '🔥', color: '#7C3AED', peso: 1 },
    { id: 'opt-3', texto: 'Cantar 30 seg',  emoji: '🎤', color: '#00E5FF', peso: 1 },
    { id: 'opt-4', texto: 'Castigo Random', emoji: '😈', color: '#F59E0B', peso: 1 },
    { id: 'opt-5', texto: 'Saludo VIP',     emoji: '👑', color: '#10B981', peso: 1 },
    { id: 'opt-6', texto: '¡Se Salva!',     emoji: '🍀', color: '#3B82F6', peso: 1 }
];

const COLORES_PALETA = [
    '#FF2A5F', '#7C3AED', '#00E5FF', '#F59E0B',
    '#10B981', '#3B82F6', '#EC4899', '#8B5CF6',
    '#14B8A6', '#F97316', '#EF4444', '#6366F1'
];

const CONFIG_DEFAULT = {
    activo: true,
    titulo: '¡RULETA DE RETOS!',
    regalo: '',
    regaloPts: 0,
    maxRepeticiones: 5,
    duracionGiroSeg: 5,
    tiempoResultadoSeg: 4,
    sonidoActivo: true,
    opciones: OPCIONES_DEFAULT
};

function normalizarOpciones(rawOpciones) {
    if (!Array.isArray(rawOpciones) || rawOpciones.length === 0) {
        return OPCIONES_DEFAULT.map(o => ({ ...o }));
    }
    const limpias = rawOpciones
        .map((o, idx) => {
            if (!o || typeof o !== 'object') return null;
            const texto = String(o.texto || '').trim();
            if (!texto) return null;
            return {
                id: String(o.id || `opt-${idx + 1}`),
                texto: texto.slice(0, 48),
                emoji: String(o.emoji || '').trim().slice(0, 8),
                color: /^#[0-9A-Fa-f]{3,8}$/.test(String(o.color || '').trim())
                    ? String(o.color).trim()
                    : COLORES_PALETA[idx % COLORES_PALETA.length],
                peso: Math.min(100, Math.max(1, parseInt(o.peso) || 1))
            };
        })
        .filter(Boolean);

    if (limpias.length < 2) {
        return OPCIONES_DEFAULT.map(o => ({ ...o }));
    }
    return limpias.slice(0, 24);
}

function elegirIndicePonderado(opciones) {
    if (!Array.isArray(opciones) || opciones.length === 0) return 0;
    const totalPeso = opciones.reduce((acc, o) => acc + Math.max(1, parseInt(o.peso) || 1), 0);
    let r = Math.random() * totalPeso;
    for (let i = 0; i < opciones.length; i++) {
        const p = Math.max(1, parseInt(opciones[i].peso) || 1);
        if (r < p) return i;
        r -= p;
    }
    return opciones.length - 1;
}

function setupRuletaDynamics(app, io, requireSession, activeSessions) {
    function leerConfig(session) {
        try {
            const raw = session && session.db ? session.db.getConfigVal('ruleta_config') : null;
            const parsed = raw ? JSON.parse(raw) : {};
            return {
                ...CONFIG_DEFAULT,
                ...parsed,
                activo: parsed.activo !== false,
                titulo: String(parsed.titulo || CONFIG_DEFAULT.titulo).trim() || CONFIG_DEFAULT.titulo,
                regalo: String(parsed.regalo || '').trim(),
                regaloPts: Math.max(0, parseInt(parsed.regaloPts) || 0),
                maxRepeticiones: Math.min(20, Math.max(1, parseInt(parsed.maxRepeticiones) || CONFIG_DEFAULT.maxRepeticiones)),
                duracionGiroSeg: Math.min(15, Math.max(2, parseFloat(parsed.duracionGiroSeg) || CONFIG_DEFAULT.duracionGiroSeg)),
                tiempoResultadoSeg: Math.min(15, Math.max(2, parseFloat(parsed.tiempoResultadoSeg) || CONFIG_DEFAULT.tiempoResultadoSeg)),
                sonidoActivo: parsed.sonidoActivo !== false,
                opciones: normalizarOpciones(parsed.opciones)
            };
        } catch (e) {
            return { ...CONFIG_DEFAULT, opciones: OPCIONES_DEFAULT.map(o => ({ ...o })) };
        }
    }

    function estadoSesion(session) {
        if (!session.ruleta) {
            session.ruleta = {
                cola: [],
                actual: null,
                timerFinGiro: null,
                timerSiguiente: null,
                seq: 0,
                ultimoResultado: null,
                historial: []
            };
        }
        return session.ruleta;
    }

    function emitirEstado(username) {
        const session = activeSessions[username];
        if (!session) return;
        const st = estadoSesion(session);
        io.to(username).emit('ruletaEstado', {
            actual: st.actual,
            pendientes: st.cola.length,
            ultimoResultado: st.ultimoResultado,
            historial: st.historial.slice(0, 8)
        });
    }

    function coincideRegalo(config, giftName, giftId) {
        const objetivo = String(config.regalo || '').trim().toLowerCase();
        if (!objetivo) return false;
        const nombre = String(giftName || '').trim().toLowerCase();
        const gid = giftId ? String(giftId).trim() : '';
        return (nombre && nombre === objetivo) ||
            (gid && (gid === objetivo || `id:${gid}` === objetivo));
    }

    function lanzarSiguiente(username) {
        const session = activeSessions[username];
        if (!session) return;
        const st = estadoSesion(session);
        if (st.actual || st.cola.length === 0) {
            emitirEstado(username);
            return;
        }

        const config = leerConfig(session);
        const item = st.cola.shift();
        const opciones = config.opciones;
        const ganadorIndex = (typeof item.forzarIndex === 'number' && item.forzarIndex >= 0 && item.forzarIndex < opciones.length)
            ? item.forzarIndex
            : elegirIndicePonderado(opciones);
        const ganador = opciones[ganadorIndex] || opciones[0];

        const duracionGiroMs = Math.round((parseFloat(config.duracionGiroSeg) || 5) * 1000);
        const tiempoResultadoMs = Math.round((parseFloat(config.tiempoResultadoSeg) || 4) * 1000);

        // Offset aleatorio dentro del segmento ganador (-32% a +32% del arco) para que se vea natural
        const offsetSegmento = (Math.random() * 0.64) - 0.32;
        const vueltasExtras = 6 + Math.floor(Math.random() * 3); // 6 a 8 vueltas completas

        st.actual = {
            id: item.id,
            viewer: item.viewer || '',
            avatar: item.avatar || '',
            giftName: item.giftName || config.regalo || '',
            giftImg: item.giftImg || '',
            puntos: item.puntos || config.regaloPts || 0,
            titulo: config.titulo,
            sonidoActivo: config.sonidoActivo,
            opciones,
            ganadorIndex,
            ganador,
            vueltasExtras,
            offsetSegmento,
            duracionGiroMs,
            tiempoResultadoMs,
            pendientes: st.cola.length,
            timestamp: Date.now()
        };

        io.to(username).emit('ruletaGirar', st.actual);
        emitirEstado(username);

        clearTimeout(st.timerFinGiro);
        clearTimeout(st.timerSiguiente);

        // Cuando la rueda termina de girar y revela el ganador
        st.timerFinGiro = setTimeout(() => {
            if (!st.actual || st.actual.id !== item.id) return;
            const resObj = {
                id: item.id,
                viewer: st.actual.viewer,
                avatar: st.actual.avatar,
                ganadorIndex,
                ganador,
                timestamp: Date.now()
            };
            st.ultimoResultado = resObj;
            st.historial.unshift(resObj);
            if (st.historial.length > 15) st.historial.length = 15;
            io.to(username).emit('ruletaResultado', resObj);
            emitirEstado(username);
        }, duracionGiroMs);

        // Cuando termina el tiempo de exposición del resultado + margen de salida
        const cicloTotalMs = duracionGiroMs + tiempoResultadoMs + 750;
        st.timerSiguiente = setTimeout(() => {
            if (st.actual && st.actual.id === item.id) {
                st.actual = null;
            }
            lanzarSiguiente(username);
        }, cicloTotalMs);
    }

    function encolar(username, datos, cantidad) {
        const session = activeSessions[username];
        if (!session) return 0;
        const config = leerConfig(session);
        const st = estadoSesion(session);
        const tope = Math.max(1, parseInt(config.maxRepeticiones) || 1);
        const n = Math.min(Math.max(1, parseInt(cantidad) || 1), tope);

        for (let i = 0; i < n; i++) {
            st.seq++;
            st.cola.push({
                id: `ruleta-${Date.now()}-${st.seq}`,
                viewer: datos.viewer || '',
                avatar: datos.avatar || '',
                giftName: datos.giftName || '',
                giftImg: datos.giftImg || '',
                puntos: parseInt(datos.puntos) || 0,
                forzarIndex: typeof datos.forzarIndex === 'number' ? datos.forzarIndex : null
            });
        }
        lanzarSiguiente(username);
        return n;
    }

    function limpiarColaYEscena(username) {
        const session = activeSessions[username];
        if (!session) return;
        const st = estadoSesion(session);
        clearTimeout(st.timerFinGiro);
        clearTimeout(st.timerSiguiente);
        st.cola = [];
        st.actual = null;
        io.to(username).emit('ruletaLimpiar');
        emitirEstado(username);
    }

    // Llamado desde pointsProcessor por cada regalo recibido en TikTok Live
    function onGift(username, { giftName, giftId, viewer, avatar, repeat, giftImg, diamondUnit }) {
        const session = activeSessions[username];
        if (!session) return;
        const config = leerConfig(session);
        if (!config.activo || !coincideRegalo(config, giftName, giftId)) return;
        encolar(username, { viewer, avatar, giftName, giftImg, puntos: diamondUnit }, repeat);
    }

    // ── Rutas API ──
    app.get('/api/ruleta/config', requireSession, (req, res) => {
        res.json(leerConfig(req.userSession));
    });

    app.post('/api/ruleta/config', requireSession, (req, res) => {
        const s = req.userSession;
        const body = req.body || {};
        const prev = leerConfig(s);
        const config = {
            activo: body.activo !== false,
            titulo: String(body.titulo !== undefined ? body.titulo : prev.titulo).trim() || CONFIG_DEFAULT.titulo,
            regalo: String(body.regalo !== undefined ? body.regalo : prev.regalo).trim(),
            regaloPts: Math.max(0, parseInt(body.regaloPts !== undefined ? body.regaloPts : prev.regaloPts) || 0),
            maxRepeticiones: Math.min(20, Math.max(1, parseInt(body.maxRepeticiones) || prev.maxRepeticiones || CONFIG_DEFAULT.maxRepeticiones)),
            duracionGiroSeg: Math.min(15, Math.max(2, parseFloat(body.duracionGiroSeg) || prev.duracionGiroSeg || CONFIG_DEFAULT.duracionGiroSeg)),
            tiempoResultadoSeg: Math.min(15, Math.max(2, parseFloat(body.tiempoResultadoSeg) || prev.tiempoResultadoSeg || CONFIG_DEFAULT.tiempoResultadoSeg)),
            sonidoActivo: body.sonidoActivo !== false,
            opciones: normalizarOpciones(body.opciones !== undefined ? body.opciones : prev.opciones)
        };
        s.db.setConfigVal('ruleta_config', JSON.stringify(config));
        io.to(req.username).emit('ruletaConfigActualizada', config);
        res.json({ status: 'OK', config });
    });

    app.get('/api/ruleta/estado', requireSession, (req, res) => {
        const st = estadoSesion(req.userSession);
        res.json({
            actual: st.actual,
            pendientes: st.cola.length,
            ultimoResultado: st.ultimoResultado,
            historial: st.historial.slice(0, 8)
        });
    });

    app.all('/ruleta/girar', requireSession, (req, res) => {
        const body = req.body || {};
        const viewer = String(req.query.viewer || body.viewer || '').trim();
        const cantidad = parseInt(req.query.n || body.n) || 1;
        const rawIndex = req.query.index !== undefined ? req.query.index : body.index;
        const forzarIndex = (rawIndex !== undefined && rawIndex !== '' && !isNaN(parseInt(rawIndex)))
            ? parseInt(rawIndex)
            : null;

        const n = encolar(req.username, {
            viewer: viewer || '',
            avatar: '',
            forzarIndex
        }, cantidad);
        res.json({ status: 'OK', encolados: n });
    });

    app.all('/ruleta/limpiar', requireSession, (req, res) => {
        limpiarColaYEscena(req.username);
        res.json({ status: 'OK' });
    });

    return { onGift, leerConfig };
}

module.exports = setupRuletaDynamics;
