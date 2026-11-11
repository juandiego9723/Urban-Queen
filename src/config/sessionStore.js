const path = require('path');
const crypto = require('crypto');
const { DBInstance } = require('../../db');

const sessions = {}; // token -> { user, name }
const activeSessions = {}; // username -> session
const sessionInitPromises = {}; // username -> Promise
let _procesarPuntosFn = null;

function setProcesarPuntosFn(fn) {
    _procesarPuntosFn = fn;
    if (typeof fn === 'function') {
        Object.keys(activeSessions).forEach(username => {
            const s = activeSessions[username];
            if (s && !s.batchInterval) {
                s.batchInterval = setInterval(() => fn(username), 300);
            }
        });
    }
}

function getUserId(req) {
    if (req.query && req.query.user) return req.query.user;
    if (req.body && req.body.user) return req.body.user;
    if (req.session && req.session.user) return req.session.user;

    // Fallback por Referer (si la petición proviene de un iframe o una pestaña con ?user=)
    const referer = req.headers && (req.headers.referer || req.headers.origin);
    if (referer) {
        try {
            const urlObj = new URL(referer);
            const userFromRef = urlObj.searchParams.get('user');
            if (userFromRef) return userFromRef;
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            if (pathParts.length > 0 && activeSessions[pathParts[0]]) {
                return pathParts[0];
            }
        } catch(e) {}
    }

    // Fallback: Si solo hay una única sesión activa en todo el sistema, asociar automáticamente
    const activeKeys = Object.keys(activeSessions);
    if (activeKeys.length === 1) {
        return activeKeys[0];
    }

    return null;
}

function getSocketUser(socket) {
    if (socket.handshake.query && socket.handshake.query.user) {
        return socket.handshake.query.user;
    }
    
    const cookieHeader = socket.handshake.headers.cookie;
    if (cookieHeader) {
        const list = {};
        cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            if (parts[0]) {
                list[parts[0].trim()] = decodeURIComponent(parts[1] || '').trim();
            }
        });
        const sessionToken = list['session_token'];
        if (sessionToken && sessions[sessionToken]) {
            return sessions[sessionToken].user;
        }
    }
    return null;
}

async function getUserSessionAsync(username, io, procesarPuntosFn) {
    if (!username) return null;
    const fnBatch = procesarPuntosFn || _procesarPuntosFn;

    if (activeSessions[username]) {
        const existing = activeSessions[username];
        if (existing.db) {
            await existing.db.init();
            if (!existing.QUEENS || existing.QUEENS.length === 0) {
                reconstruirQueens(existing);
            }
        }
        if (!existing.batchInterval && typeof fnBatch === 'function') {
            existing.batchInterval = setInterval(() => {
                fnBatch(username);
            }, 300);
        }
        return existing;
    }

    if (sessionInitPromises[username]) {
        const s = await sessionInitPromises[username];
        if (s && !s.batchInterval && typeof fnBatch === 'function') {
            s.batchInterval = setInterval(() => fnBatch(username), 300);
        }
        return s;
    }

    sessionInitPromises[username] = (async () => {
        const dbInstance = new DBInstance(username);
        await dbInstance.init();
        
        const initialQueens = dbInstance.getActiveQueenNames();

        const session = {
            db: dbInstance,
            agencySlug: dbInstance.agencySlug || ((username && username.toLowerCase().includes('cosmic')) ? 'cosmic' : 'urbanqueens'),
            QUEENS: initialQueens,
            equipos: {},
            rachasPerdidas: {},
            amarillasAcumuladas: {},
            configFutbol: { limiteAmarilla: parseInt(dbInstance.getConfigVal('limiteAmarilla')) || 3 },
            estadoBatalla: 'inactiva',
            tiempoBatalla: 0,
            puntosBatalla: {},
            participantesActuales: [...initialQueens],
            batalla2X: false,
            batalla2XTiempo: 0,
            timerBatalla: null,
            timerBaile: { 
                activo: false, 
                tiempo: 0, 
                chicaActual: '', 
                orden: [...initialQueens], 
                estado: 'inactivo', 
                tiempoTransicion: 0, 
                segundosPorMoneda: 3,
                modoTorneo: false,
                rondasTotales: 0,
                rondaActual: 0,
                participantesOriginales: [],
                puntosTorneo: {},
                puntosTurnoActual: 0,
                chicaAEliminar: '',
                metaTurno: 1000,
                eliminadas: [],
                participantesActivas: []
            },
            intervaloTimerBaile: null,
            tiempoAcumulado: {},
            conociendo: { activo: false, tiempo: 0, chicaActual: '', orden: [...initialQueens], estado: 'inactivo', tiempoTransicion: 0, meta: 2000, puntos: 0, puntosRanking: {}, eliminadas: [] },
            intervaloConociendo: null,
            podio: { activo: false, tiempo: 0, chicaActual: '', orden: [...initialQueens], estado: 'inactivo', tiempoTransicion: 0, meta: 2000, puntos: 0, puntosRanking: {}, eliminadas: [] },
            intervaloPodio: null,
            revivir: { activo: false, tiempo: 0, chicaActual: '', estado: 'inactivo', meta: 5000, puntos: 0, donantes: {}, donantesAvatars: {}, regalosEnviados: {}, regalosImgs: {}, clasificadas: 2 },
            intervaloRevivir: null,
            lealtadUsuarios: {},
            tiktokConnection: null,
            tiktokEstado: 'desconectado',
            tiktokUsuario: '',
            tiktokMensajeError: '',
            regalosDetectados: {},
            catalogoRegalos: [],
            dinamicaActiva: null,
            timerDinamica: null,
            tiempoDinamica: 0,
            puntosDinamica: {},
            rachasDinamica: {},
            amarillasDinamica: {},
            eliminadosDinamica: [],
            queueUpdate: [],
            giftStreaks: {},
            vistaActiva: '/batalla',
            vistaAcumuladosActiva: '/',
            goalConfig: (() => {
                try {
                    const raw = dbInstance.getConfigVal('goal_config');
                    if (raw) return JSON.parse(raw);
                } catch (e) {}
                return { title: '¡NUEVA QUEEN!', target: 10000, current: 0 };
            })()
        };

        try {
            const rawPodioRank = dbInstance.getConfigVal('podio_ranking');
            if (rawPodioRank && session.podio) session.podio.puntosRanking = JSON.parse(rawPodioRank);
        } catch (e) {}
        try {
            const rawPodioElim = dbInstance.getConfigVal('podio_eliminadas');
            if (rawPodioElim && session.podio) session.podio.eliminadas = JSON.parse(rawPodioElim);
        } catch (e) {}

        reconstruirEquipos(session);
        
        initialQueens.forEach(q => {
            session.rachasPerdidas[q] = 0;
            session.amarillasAcumuladas[q] = 0;
            session.tiempoAcumulado[q] = 0;
        });
        
        if (typeof fnBatch === 'function') {
            session.batchInterval = setInterval(() => {
                fnBatch(username);
            }, 300);
        }

        activeSessions[username] = session;
        return session;
    })().finally(() => {
        delete sessionInitPromises[username];
    });

    return sessionInitPromises[username];
}

function getUserSession(username, io, procesarPuntosFn) {
    if (!username) return null;
    const fnBatch = procesarPuntosFn || _procesarPuntosFn;
    if (!activeSessions[username]) {
        // Enrutador síncrono que inicializa el objeto sesión de forma inmediata
        const dbInstance = new DBInstance(username);

        const session = {
            db: dbInstance,
            agencySlug: (username && username.toLowerCase().includes('cosmic')) ? 'cosmic' : 'urbanqueens',
            QUEENS: [],
            equipos: {},
            rachasPerdidas: {},
            amarillasAcumuladas: {},
            configFutbol: { limiteAmarilla: 3 },
            estadoBatalla: 'inactiva',
            tiempoBatalla: 0,
            puntosBatalla: {},
            participantesActuales: [],
            batalla2X: false,
            batalla2XTiempo: 0,
            timerBatalla: null,
            timerBaile: { 
                activo: false, tiempo: 0, chicaActual: '', orden: [], 
                estado: 'inactivo', tiempoTransicion: 0, segundosPorMoneda: 3, modoTorneo: false,
                rondasTotales: 0, rondaActual: 0, participantesOriginales: [], puntosTorneo: {},
                puntosTurnoActual: 0, chicaAEliminar: '', metaTurno: 1000, eliminadas: [], participantesActivas: []
            },
            intervaloTimerBaile: null,
            tiempoAcumulado: {},
            conociendo: { activo: false, tiempo: 0, chicaActual: '', orden: [], estado: 'inactivo', tiempoTransicion: 0, meta: 2000, puntos: 0, puntosRanking: {}, eliminadas: [] },
            intervaloConociendo: null,
            podio: { activo: false, tiempo: 0, chicaActual: '', orden: [], estado: 'inactivo', tiempoTransicion: 0, meta: 2000, puntos: 0, puntosRanking: {}, eliminadas: [] },
            intervaloPodio: null,
            revivir: { activo: false, tiempo: 0, chicaActual: '', estado: 'inactivo', meta: 5000, puntos: 0, donantes: {}, donantesAvatars: {}, regalosEnviados: {}, regalosImgs: {}, clasificadas: 2 },
            intervaloRevivir: null,
            lealtadUsuarios: {},
            tiktokConnection: null,
            tiktokEstado: 'desconectado',
            tiktokUsuario: '',
            tiktokMensajeError: '',
            regalosDetectados: {},
            catalogoRegalos: [],
            dinamicaActiva: null,
            timerDinamica: null,
            tiempoDinamica: 0,
            puntosDinamica: {},
            rachasDinamica: {},
            amarillasDinamica: {},
            eliminadosDinamica: [],
            queueUpdate: [],
            giftStreaks: {},
            vistaActiva: '/batalla',
            vistaAcumuladosActiva: '/',
            goalConfig: { title: '¡NUEVA QUEEN!', target: 10000, current: 0 }
        };

        dbInstance.init().then(() => {
            try {
                const rawGoal = session.db.getConfigVal('goal_config');
                if (rawGoal) session.goalConfig = JSON.parse(rawGoal);
                const rawPodioRank = session.db.getConfigVal('podio_ranking');
                if (rawPodioRank && session.podio) {
                    try { session.podio.puntosRanking = JSON.parse(rawPodioRank); } catch(e){}
                }
                const rawPodioElim = session.db.getConfigVal('podio_eliminadas');
                if (rawPodioElim && session.podio) {
                    try { session.podio.eliminadas = JSON.parse(rawPodioElim); } catch(e){}
                }
                if (dbInstance.agencySlug) session.agencySlug = dbInstance.agencySlug;
            } catch (e) {}
            reconstruirQueens(session);
            session.participantesActuales = [...session.QUEENS];
            session.timerBaile.orden = [...session.QUEENS];
            session.conociendo.orden = [...session.QUEENS];
            if (session.podio) session.podio.orden = [...session.QUEENS];
            if (io) {
                io.to(username).emit('queensActualizadas', { queens: session.QUEENS, equipos: session.equipos, apodos: session.db.getApodosMap() });
                io.to(username).emit('rankingActualizado', session.db.getRankingsPayload());
            }
        }).catch(err => console.error('Error cargando BD Supabase para usuario:', username, err));

        if (typeof fnBatch === 'function') {
            session.batchInterval = setInterval(() => {
                fnBatch(username);
            }, 300);
        }

        activeSessions[username] = session;
    }
    return activeSessions[username];
}

function reconstruirEquipos(session) {
    session.equipos = {};
    session.db.getAllQueensFull().forEach(q => {
        if (q.activo) {
            const display = (q.apodo && q.apodo.trim()) ? q.apodo.trim() : q.name;
            session.equipos[q.name] = { nombre: display.toUpperCase(), color: q.color, regalo_img: q.regalo_img || '', avatar_img: q.avatar_img || '', nombre_img: q.nombre_img || '', regalo_pts: q.regalo_pts || 0 };
        }
    });
}

function reconstruirQueens(session) {
    session.QUEENS = session.db.getActiveQueenNames();
    reconstruirEquipos(session);
    if (session.dinamicaActivadores) {
        if (!session.dinamicaActivadores.participantes || session.dinamicaActivadores.participantes.length === 0) {
            session.dinamicaActivadores.participantes = [...session.QUEENS];
        }
    }
}

async function requireSession(req, res, next) {
    const username = getUserId(req);
    if (!username) {
        return res.status(401).send('No autorizado: Falta especificar usuario');
    }
    const session = await getUserSessionAsync(username);
    if (!session) {
        return res.status(404).send('Usuario no encontrado');
    }
    req.userSession = session;
    req.username = username;
    next();
}

function resolverNombre(session, nombre) {
    if (!nombre) return null;
    if (session.QUEENS.includes(nombre)) return nombre;
    const queenDeAlias = session.db.resolverAlias(nombre);
    return queenDeAlias || null;
}

function cleanupUserSession(session, io = null, username = null) {
    if (!session) return;

    // 0. Vaciar cola de puntos pendiente antes de detener los intervalos
    const targetUser = username || (session.db ? session.db.username : null);
    if (targetUser && session.queueUpdate && session.queueUpdate.length > 0 && typeof _procesarPuntosFn === 'function') {
        try {
            _procesarPuntosFn(targetUser);
        } catch (e) {}
    }

    // 1. Cancelar todos los temporizadores e intervalos de la sesión
    if (session.timerBatalla) {
        clearInterval(session.timerBatalla);
        session.timerBatalla = null;
    }
    if (session.intervaloTimerBaile) {
        clearInterval(session.intervaloTimerBaile);
        session.intervaloTimerBaile = null;
    }
    if (session.intervaloConociendo) {
        clearInterval(session.intervaloConociendo);
        session.intervaloConociendo = null;
    }
    if (session.intervaloPodio) {
        clearInterval(session.intervaloPodio);
        session.intervaloPodio = null;
    }
    if (session.intervaloRevivir) {
        clearInterval(session.intervaloRevivir);
        session.intervaloRevivir = null;
    }
    if (session.timerDinamica) {
        clearInterval(session.timerDinamica);
        session.timerDinamica = null;
    }
    if (session.batchInterval) {
        clearInterval(session.batchInterval);
        session.batchInterval = null;
    }

    // 2. Resetear estados de la sesión
    session.estadoBatalla = 'inactiva';
    session.tiempoBatalla = 0;
    if (session.timerBaile) session.timerBaile.activo = false;
    if (session.conociendo) session.conociendo.activo = false;
    if (session.podio) session.podio.activo = false;
    if (session.revivir) session.revivir.activo = false;
    session.dinamicaActiva = null;

    // 3. Notificar via sockets si la batalla estaba activa para limpiar overlays
    const targetRoom = username || (session.db ? session.db.dbName : null);
    if (io && targetRoom) {
        try {
            io.to(targetRoom).emit('batallaCancelada');
        } catch (e) {}
    }

    // 4. Desconexión segura de TikTok Live
    if (session.tiktokConnection) {
        try {
            if (typeof session.tiktokConnection.removeAllListeners === 'function') {
                session.tiktokConnection.removeAllListeners();
            }
            session.tiktokConnection.disconnect();
        } catch (e) {}
        session.tiktokConnection = null;
    }
    session.tiktokEstado = 'desconectado';
    session.tiktokUsuario = '';

    // 5. Cierre seguro de la base de datos si aplica
    if (session.db && typeof session.db.close === 'function') {
        try {
            session.db.close();
        } catch (e) {}
    }
}

module.exports = {
    sessions,
    activeSessions,
    setProcesarPuntosFn,
    getUserId,
    getSocketUser,
    getUserSession,
    getUserSessionAsync,
    reconstruirEquipos,
    reconstruirQueens,
    requireSession,
    resolverNombre,
    cleanupUserSession
};
