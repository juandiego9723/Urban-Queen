// ═══════════════════════════════════════════════════════════════════
//  🏆 TikDance – server.js (Orchestrator)
//  Servidor principal: Express + Socket.IO + Módulos por Dinámica
// ═══════════════════════════════════════════════════════════════════
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { initSQL, DBInstance } = require('./db');
const MasterDB = require('./masterDb');

// ── Módulos propios ──────────────────────────────────────────────
try { require('./scripts/cleanupProject'); } catch(e) {}







const {
    sessions, activeSessions,
    getUserId, getSocketUser, getUserSession,
    requireSession, resolverNombre, cleanupUserSession
} = require('./src/config/sessionStore');

const createPointsProcessor   = require('./src/services/pointsProcessor');
const createTikTokService      = require('./src/services/tiktokService');

const setupTimerDynamics       = require('./src/dynamics/timer');
const setupConociendoDynamics  = require('./src/dynamics/conociendo');
const setupRevivirDynamics     = require('./src/dynamics/revivir');
const setupBatallaDynamics     = require('./src/dynamics/batalla');
const setupFutbolDynamics      = require('./src/dynamics/futbol');
const setupCustomDynamics      = require('./src/dynamics/customDynamics');

const setupQueensRoutes        = require('./src/routes/queensRoutes');
const setupAgencyRoutes        = require('./src/routes/agencyRoutes');
const setupAnalyticsRoutes     = require('./src/routes/analyticsRoutes');
const { setupSystemRoutes, cleanupAllSessions } = require('./src/routes/systemRoutes');
const { agencyMiddleware } = require('./src/middlewares/agencyMiddleware');

// ── Express + HTTP + Socket.IO ───────────────────────────────────
const app = express();

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    res.header("Pragma", "no-cache");
    res.header("Expires", "0");
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// Middleware de Agencias (Multi-Tenancy)
app.use(agencyMiddleware);

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
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── Inicializar módulos de dinámicas (obtener handlers) ─────────
const timerHandlers      = setupTimerDynamics(app, io, requireSession, activeSessions);
const conociendoHandlers = setupConociendoDynamics(app, io, requireSession, activeSessions);
const revivirHandlers    = setupRevivirDynamics(app, io, requireSession, activeSessions);

const { procesarRegaloTikTok, procesarPuntosEnLote } = createPointsProcessor(
    io, activeSessions, resolverNombre, timerHandlers, conociendoHandlers, revivirHandlers
);

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
app.post('/login', async (req, res) => {
    const { username, password, agency } = req.body;
    if (!username || !password) return res.status(400).send('Faltan datos');
    const user = await MasterDB.verificarCredenciales(username, password);
    if (!user) return res.status(401).send('Usuario o contraseña incorrectos');
    
    let userAgencySlug = 'urbanqueens';
    let userAgencyName = 'Urban Queens';
    if (user.agency_id) {
        const agencyObj = await MasterDB.getAgencyById(user.agency_id);
        if (agencyObj) {
            userAgencySlug = agencyObj.slug;
            userAgencyName = agencyObj.name;
        }
    }

    const targetAgencySlug = agency || req.agencySlug || (req.agency ? req.agency.slug : null);
    const isSuperUser = (user.username.toLowerCase() === 'admin' || user.username.toLowerCase() === 'master');

    if (targetAgencySlug && !isSuperUser) {
        if (userAgencySlug.toLowerCase() !== targetAgencySlug.toLowerCase()) {
            return res.status(403).send(`Este usuario pertenece a la agencia '${userAgencyName}' y no tiene acceso a esta plataforma`);
        }
    }
    
    res.setSession(user.username, { name: user.name, agencySlug: userAgencySlug });
    if (activeSessions[user.username]) {
        activeSessions[user.username].agencySlug = userAgencySlug;
    }
    res.json({ status: 'OK', agencySlug: userAgencySlug, username: user.username });
});

app.get('/register', (req, res) => res.sendFile(pub('register.html')));
app.post('/register', async (req, res) => {
    const { name, username, password, agency } = req.body;
    if (!name || !username || !password) return res.status(400).send('Todos los campos son obligatorios');
    const agencySlug = agency || req.agencySlug || (req.agency ? req.agency.slug : null);
    try {
        await MasterDB.registrarUsuario(username, password, name, agencySlug);
        res.setSession(username, { name, agencySlug });
        res.send('OK');
    } catch(e) {
        res.status(400).send(e.message || 'Error registrando usuario');
    }
});

function handleLogout(req, res) {
    let agencySlug = 'urbanqueens';
    const sessionToken = req.cookies['session_token'];
    if (sessionToken && sessions[sessionToken]) {
        if (sessions[sessionToken].agencySlug) {
            agencySlug = sessions[sessionToken].agencySlug;
        }
        const username = sessions[sessionToken].user;
        if (username && activeSessions[username]) {
            cleanupUserSession(activeSessions[username]);
            delete activeSessions[username];
        }
    }
    if (req.params && req.params.agencySlug) {
        agencySlug = req.params.agencySlug;
    } else if (req.agencySlug) {
        agencySlug = req.agencySlug;
    }
    res.clearSession();
    res.redirect(`/${agencySlug}/login`);
}

app.all('/logout', handleLogout);
app.all('/:agencySlug/logout', handleLogout);

// Rutas recuperación de contraseña
app.post('/api/forgot-password', (req, res) => {
    const username = (req.body.username || '').trim();
    if (!username) return res.status(400).send('Ingresa tu nombre de usuario');
    try {
        const token = MasterDB.crearTokenRecuperacion(username);
        const protocol = req.protocol || 'http';
        const host = req.get('host') || 'localhost:3000';
        const agencyPrefix = req.agencySlug ? `/${req.agencySlug}` : (req.agency ? `/${req.agency.slug}` : '');
        const resetUrl = `${protocol}://${host}${agencyPrefix}/reset-password?token=${token}`;
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
app.use('/regalos', express.static(path.join(__dirname, 'public', 'regalos')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.get('/logo-tikdance-horizontal.png', (req, res) => res.sendFile(path.join(__dirname, 'public', 'assets', 'logo-tikdance-horizontal.png')));
app.get('/logo-tikdance.jpg', (req, res) => res.sendFile(path.join(__dirname, 'public', 'assets', 'logo-tikdance.jpg')));
app.get('/app-icon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'assets', 'app-icon.ico')));
app.get('/custom_:file', (req, res) => {
    const file = `custom_${req.params.file}`;
    const regalosPath = path.join(__dirname, 'public', 'regalos', file);
    if (fs.existsSync(regalosPath)) {
        res.sendFile(regalosPath);
    } else {
        res.sendFile(path.join(__dirname, 'public', file));
    }
});
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de pantallas
app.get('/',              (req, res) => res.sendFile(pub('ranking.html')));
app.get('/batalla',       (req, res) => res.sendFile(pub('batalla.html')));
app.get('/batalla-futbol',(req, res) => res.sendFile(pub('batalla-futbol.html')));
app.get('/batalla-pk',    (req, res) => res.sendFile(pub('batalla-pk.html')));
app.get('/timer',         (req, res) => res.sendFile(pub('timer.html')));
app.get('/conociendo',    (req, res) => res.sendFile(pub('conociendo.html')));
app.get('/revivir',       (req, res) => res.sendFile(pub('revivir.html')));
app.get('/revivir-ranking', (req, res) => res.sendFile(pub('revivir-ranking.html')));
app.get('/copa',          (req, res) => res.sendFile(pub('copa.html')));
app.get('/lista-regalos', (req, res) => res.sendFile(pub('lista-regalos.html')));
app.get('/control', (req, res) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    const slug = req.session.agencySlug || (req.agency ? req.agency.slug : null);
    if (slug) {
        return res.redirect(`/${slug}/control`);
    }
    return res.sendFile(pub('control.html'));
});
app.get('/dinamica',      (req, res) => res.sendFile(pub('dinamica.html')));
app.get('/gestor-regalos',(req, res) => res.sendFile(pub('gestor-regalos.html')));
app.get('/multicam',      (req, res) => res.sendFile(pub('multicam.html')));
app.get('/overlay-universal', (req, res) => res.sendFile(pub('overlay-universal.html')));
app.get('/overlay-acumulados', (req, res) => res.sendFile(pub('overlay-acumulados.html')));

const agencyPub = (slug, file) => {
    const customAgencyFile = path.join(__dirname, 'public', 'agencies', slug, file);
    if (fs.existsSync(customAgencyFile)) {
        return customAgencyFile;
    }
    return pub(file);
};

// ── Rutas Dinámicas por Agencia (/:agencySlug/*) ────────────────
app.get('/:agencySlug', (req, res, next) => {
    if (req.agency && req.params.agencySlug.toLowerCase() === req.agency.slug.toLowerCase()) {
        return res.sendFile(agencyPub(req.agency.slug, 'ranking.html'));
    }
    next();
});

app.get('/:agencySlug/login', (req, res, next) => {
    if (req.agency && req.params.agencySlug.toLowerCase() === req.agency.slug.toLowerCase()) {
        return res.sendFile(agencyPub(req.agency.slug, 'login.html'));
    }
    next();
});

app.get('/:agencySlug/register', (req, res, next) => {
    if (req.agency && req.params.agencySlug.toLowerCase() === req.agency.slug.toLowerCase()) {
        return res.sendFile(agencyPub(req.agency.slug, 'register.html'));
    }
    next();
});

app.get('/:agencySlug/reset-password', (req, res, next) => {
    if (req.agency && req.params.agencySlug.toLowerCase() === req.agency.slug.toLowerCase()) {
        return res.sendFile(agencyPub(req.agency.slug, 'reset-password.html'));
    }
    next();
});

app.get('/:agencySlug/control', (req, res, next) => {
    if (req.agency && req.params.agencySlug.toLowerCase() === req.agency.slug.toLowerCase()) {
        if (!req.session || !req.session.user) return res.redirect(`/${req.agency.slug}/login`);
        return res.sendFile(agencyPub(req.agency.slug, 'control.html'));
    }
    next();
});

app.get('/:agencySlug/:page', (req, res, next) => {
    if (req.agency && req.params.agencySlug.toLowerCase() === req.agency.slug.toLowerCase()) {
        const pageName = req.params.page.endsWith('.html') ? req.params.page : `${req.params.page}.html`;
        const fileToServe = agencyPub(req.agency.slug, pageName);
        if (fs.existsSync(fileToServe)) {
            return res.sendFile(fileToServe);
        }
    }
    next();
});

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
        
        if (session.modoRanking) {
            socket.emit('modoRankingCambiado', session.modoRanking);
        }

        if (session.dinamicaActiva) {
            socket.emit('dinamicaInicio', {
                config: session.dinamicaActiva,
                participantes: session.dinamicaActiva.participantes,
                puntos: session.puntosDinamica,
                tiempo: session.tiempoDinamica
            });
        }
    }

    socket.on('cambiarModoRanking', (modo) => {
        if (session) {
            session.modoRanking = modo;
            io.to(username).emit('modoRankingCambiado', modo);
        }
    });
});

// ── Seguridad: escudo de excepciones ────────────────────────────
process.on('uncaughtException', (err) => {
    const msg = (err && err.message) ? err.message : String(err);
    if (msg.includes("reading 'map'") || msg.includes("getTopViewerAttributes")) {
        return; // Omitir aviso inofensivo del decodificador de tiktok-live-connector
    }
    console.error('🚨 ESCUDO ACTIVADO:', msg);
    if (err.code === 'EADDRINUSE' || msg.includes('EADDRINUSE')) {
        console.error('⚠️ Proceso duplicado detectado en puerto 3000. Cerrando esta instancia.');
        process.exit(0);
    }
});
process.on('unhandledRejection', (reason) => {
    const msg = (reason && reason.message) ? reason.message : String(reason);
    if (msg.includes("reading 'map'") || msg.includes("getTopViewerAttributes")) return;
    console.error('🚨 ESCUDO ACTIVADO:', reason);
});

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
        await MasterDB.initMasterDB();
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => console.log(`🚀 TikDance Server activo en puerto ${PORT}`));
    } catch (err) {
        console.error('❌ Error iniciando el servidor:', err);
        process.exit(1);
    }
})();