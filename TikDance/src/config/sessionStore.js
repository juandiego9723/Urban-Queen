const path = require('path');
const crypto = require('crypto');
const { DBInstance } = require('../../db');

const sessions = {}; // token -> { user, name }
const activeSessions = {}; // username -> session

function getUserId(req) {
    if (req.query && req.query.user) return req.query.user;
    if (req.body && req.body.user) return req.body.user;
    if (req.session && req.session.user) return req.session.user;
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
    
    // Fallback inteligente para OBS Browser Sources aisladas (sin cookies ni ?user=)
    const activeKeys = Object.keys(activeSessions);
    if (activeKeys.length > 0) return activeKeys[0];
    
    const sessionTokens = Object.keys(sessions);
    if (sessionTokens.length > 0 && sessions[sessionTokens[0]].user) {
        return sessions[sessionTokens[0]].user;
    }
    
    return 'admin';
}

function getUserSession(username, io, procesarPuntosFn) {
    if (!username) return null;
    if (!activeSessions[username]) {
        const dbPath = path.join(__dirname, '..', '..', `database_${username}.db`);
        const dbInstance = new DBInstance(dbPath);
        dbInstance.init();
        
        dbInstance.initQueens(['Amy', 'Ray', 'Nucita', 'Venus']);
        
        const rootDir = path.join(__dirname, '..', '..');
        if (username === 'admin' || username === 'master') {
            dbInstance.migrarDesdeJSON(path.join(rootDir, 'datos.json'));
        }
        
        const initialQueens = dbInstance.getActiveQueenNames();
        const initialEquipos = {};
        dbInstance.getAllQueensFull().forEach(q => {
            if (q.activo) {
                const display = (q.apodo && q.apodo.trim()) ? q.apodo.trim() : q.name;
                initialEquipos[q.name] = { nombre: display.toUpperCase(), color: q.color, regalo_img: q.regalo_img || '', avatar_img: q.avatar_img || '' };
            }
        });

        const session = {
            db: dbInstance,
            QUEENS: initialQueens,
            equipos: initialEquipos,
            rachasPerdidas: {},
            amarillasAcumuladas: {},
            configFutbol: { limiteAmarilla: parseInt(dbInstance.getConfigVal('limiteAmarilla')) || 3 },
            estadoBatalla: 'inactiva',
            tiempoBatalla: 0,
            puntosBatalla: {},
            participantesActuales: [...initialQueens],
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
            conociendo: { activo: false, tiempo: 0, chicaActual: '', orden: [...initialQueens], estado: 'inactivo', tiempoTransicion: 0, meta: 2000, puntos: 0 },
            intervaloConociendo: null,
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
            vistaAcumuladosActiva: '/'
        };
        
        initialQueens.forEach(q => {
            session.rachasPerdidas[q] = 0;
            session.amarillasAcumuladas[q] = 0;
            session.tiempoAcumulado[q] = 0;
        });
        
        if (typeof procesarPuntosFn === 'function') {
            session.batchInterval = setInterval(() => {
                procesarPuntosFn(username);
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
            session.equipos[q.name] = { nombre: display.toUpperCase(), color: q.color, regalo_img: q.regalo_img || '', avatar_img: q.avatar_img || '' };
        }
    });
}

function reconstruirQueens(session) {
    session.QUEENS = session.db.getActiveQueenNames();
    reconstruirEquipos(session);
}

function requireSession(req, res, next) {
    const username = getUserId(req);
    if (!username) {
        return res.status(401).send('No autorizado: Falta especificar usuario');
    }
    let session = activeSessions[username];
    if (!session) {
        session = getUserSession(username);
    }
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

module.exports = {
    sessions,
    activeSessions,
    getUserId,
    getSocketUser,
    getUserSession,
    reconstruirEquipos,
    reconstruirQueens,
    requireSession,
    resolverNombre
};
