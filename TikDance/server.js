// ═══════════════════════════════════════════════════════════════════
//  🏆 TikDance – server.js (Orchestrator)
//  Servidor principal: Express + Socket.IO + Módulos por Dinámica
// ═══════════════════════════════════════════════════════════════════
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const { initSQL, DBInstance } = require('./db');
const MasterDB = require('./masterDb');

// ── Módulos propios ──────────────────────────────────────────────
const {
    sessions, activeSessions,
    getUserId, getSocketUser, getUserSession,
    requireSession, resolverNombre
} = require('./src/config/sessionStore');

const createPointsProcessor   = require('./src/services/pointsProcessor');
const createTikTokService      = require('./src/services/tiktokService');

const setupTimerDynamics       = require('./src/dynamics/timer');
const setupConociendoDynamics  = require('./src/dynamics/conociendo');
const setupBatallaDynamics     = require('./src/dynamics/batalla');
const setupFutbolDynamics      = require('./src/dynamics/futbol');
const setupCustomDynamics      = require('./src/dynamics/customDynamics');

const setupQueensRoutes        = require('./src/routes/queensRoutes');
const setupAgencyRoutes        = require('./src/routes/agencyRoutes');
const setupAnalyticsRoutes     = require('./src/routes/analyticsRoutes');
const { setupSystemRoutes, cleanupAllSessions } = require('./src/routes/systemRoutes');

// ── Express + HTTP + Socket.IO ───────────────────────────────────
const app = express();

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// Middleware de sesiones simple basado en cookies en memoria
app.use((req, res, next) => {
    const list = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            if (parts[0]) {
                list[parts[0].trim()] = decodeURIComponent(parts[1] || '').trim();
            }
        });
    }
    req.cookies = list;
    
    const sessionToken = req.cookies['session_token'];
    if (sessionToken && sessions[sessionToken]) {
        req.session = sessions[sessionToken];
    } else {
        req.session = {};
    }
    
    res.setSession = (username, data = {}) => {
        const token = crypto.randomBytes(32).toString('hex');
        sessions[token] = { user: username, ...data };
        res.cookie('session_token', token, { httpOnly: true, path: '/' });
    };
    
    res.clearSession = () => {
        if (sessionToken) delete sessions[sessionToken];
        res.clearCookie('session_token');
    };
    
    next();
});

const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const _getUserSessionOriginal = getUserSession;
function getUserSessionWithBatch(username) {
    let session = activeSessions[username];
    if (!session) {
        session = _getUserSessionOriginal(username, io, (u) => procesarPuntosEnLote(u));
    } else if (!session.batchInterval && typeof procesarPuntosEnLote === 'function') {
        session.batchInterval = setInterval(() => {
            procesarPuntosEnLote(username);
        }, 300);
    }
    return session;
}

// ── Inicializar módulos de dinámicas (obtener handlers) ─────────
const timerHandlers      = setupTimerDynamics(app, io, requireSession, activeSessions);
const conociendoHandlers = setupConociendoDynamics(app, io, requireSession, activeSessions);

// ── Procesador de puntos central ────────────────────────────────
const { procesarRegaloTikTok, procesarPuntosEnLote } = createPointsProcessor(
    io, activeSessions, resolverNombre, timerHandlers, conociendoHandlers
);

// ── Servicio TikTok ─────────────────────────────────────────────
createTikTokService(app, io, requireSession, activeSessions, procesarRegaloTikTok);

// ── Resto de dinámicas ──────────────────────────────────────────
setupBatallaDynamics(app, io, requireSession);
setupFutbolDynamics(app, io, requireSession);
setupCustomDynamics(app, io, requireSession, activeSessions);

// ── Rutas API ───────────────────────────────────────────────────
setupQueensRoutes(app, io, requireSession);
setupAgencyRoutes(app, requireSession);
setupAnalyticsRoutes(app, requireSession);
setupSystemRoutes(app, io, requireSession, activeSessions);

// ── Rutas de autenticación ──────────────────────────────────────
const pub = (f) => path.join(__dirname, 'public', f);

app.get('/login', (req, res) => res.sendFile(pub('login.html')));
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Faltan datos');
    const user = MasterDB.verificarCredenciales(username, password);
    if (!user) return res.status(401).send('Usuario o contraseña incorrectos');
    res.setSession(user.username, { name: user.name });
    res.send('OK');
});

app.get('/register', (req, res) => res.sendFile(pub('register.html')));
app.post('/register', (req, res) => {
    const { name, username, password } = req.body;
    if (!name || !username || !password) return res.status(400).send('Todos los campos son obligatorios');
    try {
        MasterDB.registrarUsuario(username, password, name);
        res.setSession(username, { name });
        res.send('OK');
    } catch(e) {
        res.status(400).send(e.message || 'Error registrando usuario');
    }
});

app.all('/logout', (req, res) => {
    res.clearSession();
    res.redirect('/login');
});

// Rutas recuperación de contraseña
app.post('/api/forgot-password', (req, res) => {
    const username = (req.body.username || '').trim();
    if (!username) return res.status(400).send('Ingresa tu nombre de usuario');
    try {
        const token = MasterDB.crearTokenRecuperacion(username);
        const protocol = req.protocol || 'http';
        const host = req.get('host') || 'localhost:3000';
        const resetUrl = `${protocol}://${host}/reset-password.html?token=${token}`;
        res.json({ status: 'OK', token, resetUrl, username });
    } catch(e) {
        res.status(400).send(e.message || 'Error al solicitar token de recuperación');
    }
});

app.get('/api/validate-token', (req, res) => {
    const token = (req.query.token || '').trim();
    const record = MasterDB.validarTokenRecuperacion(token);
    if (!record) return res.status(400).json({ valid: false, error: 'El enlace o token de recuperación es inválido o ha expirado (30 mins)' });
    res.json({ valid: true, username: record.username });
});

app.post('/api/reset-password', (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) return res.status(400).send('Datos incompletos');
    if (newPassword.length < 4) return res.status(400).send('La contraseña debe tener al menos 4 caracteres');
    try {
        const username = MasterDB.cambiarPasswordConToken(token, newPassword);
        res.json({ status: 'OK', message: `Contraseña actualizada correctamente para el usuario ${username}` });
    } catch(e) {
        res.status(400).send(e.message || 'Error restableciendo la contraseña');
    }
});

// Proteger panel de control
app.get('/control', (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
});

app.get('/api/me', requireSession, (req, res) => {
    res.json({ username: req.username, name: req.session.name });
});

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de pantallas
app.get('/',              (req, res) => res.sendFile(pub('ranking.html')));
app.get('/batalla',       (req, res) => res.sendFile(pub('batalla.html')));
app.get('/batalla-futbol',(req, res) => res.sendFile(pub('batalla-futbol.html')));
app.get('/batalla-pk',    (req, res) => res.sendFile(pub('batalla-pk.html')));
app.get('/timer',         (req, res) => res.sendFile(pub('timer.html')));
app.get('/conociendo',    (req, res) => res.sendFile(pub('conociendo.html')));
app.get('/copa',          (req, res) => res.sendFile(pub('copa.html')));
app.get('/lista-regalos', (req, res) => res.sendFile(pub('lista-regalos.html')));
app.get('/control',       (req, res) => res.sendFile(pub('control.html')));
app.get('/dinamica',      (req, res) => res.sendFile(pub('dinamica.html')));
app.get('/gestor-regalos',(req, res) => res.sendFile(pub('gestor-regalos.html')));
app.get('/multicam',      (req, res) => res.sendFile(pub('multicam.html')));
app.get('/overlay-universal', (req, res) => res.sendFile(pub('overlay-universal.html')));
app.get('/overlay-acumulados', (req, res) => res.sendFile(pub('overlay-acumulados.html')));

// ── Socket.IO ───────────────────────────────────────────────────
function getSocketUserLocal(socket) {
    if (socket.handshake.query && socket.handshake.query.user) {
        return socket.handshake.query.user;
    }
    const cookieHeader = socket.handshake.headers.cookie;
    if (cookieHeader) {
        const list = {};
        cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            if (parts[0]) list[parts[0].trim()] = decodeURIComponent(parts[1] || '').trim();
        });
        const sessionToken = list['session_token'];
        if (sessionToken && sessions[sessionToken]) return sessions[sessionToken].user;
    }
    return null;
}

io.on('connection', (socket) => {
    const username = getSocketUserLocal(socket);
    if (!username) { socket.disconnect(); return; }
    
    socket.join(username);
    const session = getUserSessionWithBatch(username);
    
    if (session) {
        if (session.estadoBatalla === 'activa') {
            const victorias = session.db.getVictorias();
            socket.emit('batallaInicio', {
                tiempo: session.tiempoBatalla,
                puntos: session.puntosBatalla,
                victorias,
                equipos: session.equipos,
                participantes: session.participantesActuales
            });
        }
        socket.emit('tiktokEstado', { estado: session.tiktokEstado, usuario: session.tiktokUsuario });
        socket.emit('cambioVista', session.vistaActiva || '/batalla');
        socket.emit('cambioVistaAcumulados', session.vistaAcumuladosActiva || '/');
        
        const logoUrl = session.db.getConfigVal('marca_logo_url') || '';
        const fontFamily = session.db.getConfigVal('marca_font_family') || 'Inter';
        const neonIntensity = session.db.getConfigVal('marca_neon_intensity') || 'normal';
        socket.emit('marcaCambiado', { logoUrl, fontFamily, neonIntensity });
        
        if (session.dinamicaActiva) {
            socket.emit('dinamicaInicio', {
                config: session.dinamicaActiva,
                participantes: session.dinamicaActiva.participantes,
                puntos: session.puntosDinamica,
                tiempo: session.tiempoDinamica
            });
        }
    }
});

// ── Seguridad: escudo de excepciones ────────────────────────────
process.on('uncaughtException', (err) => {
    console.error('🚨 ESCUDO ACTIVADO:', err.message);
    if (err.code === 'EADDRINUSE' || (err.message && err.message.includes('EADDRINUSE'))) {
        console.error('⚠️ Proceso duplicado detectado en puerto 3000. Cerrando esta instancia.');
        process.exit(0);
    }
});
process.on('unhandledRejection', (reason) => { console.error('🚨 ESCUDO ACTIVADO:', reason); });

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error('⚠️ ATENCIÓN: TikDance ya está ejecutándose en segundo plano (Puerto 3000 ocupado).');
        process.exit(0);
    } else {
        console.error('❌ Error en el servidor HTTP:', err);
        process.exit(1);
    }
});

process.on('SIGINT',  () => { cleanupAllSessions(activeSessions); process.exit(0); });
process.on('SIGTERM', () => { cleanupAllSessions(activeSessions); process.exit(0); });

// ── Arranque ────────────────────────────────────────────────────
(async () => {
    try {
        const SQLInstance = await initSQL();
        await MasterDB.initMasterDB(SQLInstance);
        server.listen(3000, '0.0.0.0', () => console.log('🚀 TikDance v3.0 Modular – Puerto 3000'));
    } catch (err) {
        console.error('❌ Error iniciando el servidor:', err);
        process.exit(1);
    }
})();