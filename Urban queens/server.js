const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { initSQL, DBInstance } = require('./db');
const MasterDB = require('./masterDb');
const { WebcastPushConnection } = require('tiktok-live-connector');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// Middleware de sesiones simple basado en cookies en memoria
const sessions = {}; // sessionToken -> { user: username, name: display_name }

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
        if (sessionToken) {
            delete sessions[sessionToken];
        }
        res.clearCookie('session_token');
    };
    
    next();
});

const server = http.createServer(app);
const io = new Server(server);

// Mapeo de sesiones activas (estado en memoria y DB de cada usuario/academia)
const activeSessions = {};

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
    return null;
}

function getUserSession(username) {
    if (!username) return null;
    if (!activeSessions[username]) {
        const dbPath = path.join(__dirname, `database_${username}.db`);
        const dbInstance = new DBInstance(dbPath);
        dbInstance.init();
        
        // Cargar Queens iniciales si no existen
        dbInstance.initQueens(['Amy', 'Ray', 'Nucita', 'Venus']);
        
        // Migración inicial para 'admin' o primer usuario registrado si existe datos.json
        if (username === 'admin' || username === 'master') {
            dbInstance.migrarDesdeJSON(path.join(__dirname, 'datos.json'));
        }
        
        const initialQueens = dbInstance.getActiveQueenNames();
        const initialEquipos = {};
        dbInstance.getAllQueensFull().forEach(q => {
            if (q.activo) {
                const display = (q.apodo && q.apodo.trim()) ? q.apodo.trim() : q.name;
                initialEquipos[q.name] = { nombre: display.toUpperCase(), color: q.color, regalo_img: q.regalo_img || '' };
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
            timerBaile: { activo: false, tiempo: 0, chicaActual: '', orden: [...initialQueens], estado: 'inactivo', tiempoTransicion: 0, segundosPorMoneda: 3 },
            intervaloTimerBaile: null,
            tiempoAcumulado: {},
            conociendo: { activo: false, tiempo: 0, chicaActual: '', orden: [...initialQueens], estado: 'inactivo', tiempoTransicion: 0, meta: 2000, puntos: 0 },
            intervaloConociendo: null,
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
        
        // Procesar puntos en lote cada 300ms para este usuario
        session.batchInterval = setInterval(() => {
            procesarPuntosEnLote(username);
        }, 300);

        activeSessions[username] = session;
    }
    return activeSessions[username];
}

io.on('connection', (socket) => {
    const username = getSocketUser(socket);
    if (!username) {
        socket.disconnect();
        return;
    }
    
    socket.join(username);
    const session = getUserSession(username);
    
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
        
        // Emitir branding de marca al conectar
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

function reconstruirEquipos(session) {
    session.equipos = {};
    session.db.getAllQueensFull().forEach(q => {
        if (q.activo) {
            const display = (q.apodo && q.apodo.trim()) ? q.apodo.trim() : q.name;
            session.equipos[q.name] = { nombre: display.toUpperCase(), color: q.color, regalo_img: q.regalo_img || '' };
        }
    });
}

function reconstruirQueens(session) {
    session.QUEENS = session.db.getActiveQueenNames();
    reconstruirEquipos(session);
}

// 🛡️ Middleware para requerir sesión válida
function requireSession(req, res, next) {
    const username = getUserId(req);
    if (!username) {
        return res.status(401).send('No autorizado: Falta especificar usuario');
    }
    const session = getUserSession(username);
    if (!session) {
        return res.status(404).send('Usuario no encontrado');
    }
    req.userSession = session;
    req.username = username;
    next();
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- RUTAS DE AUTENTICACIÓN ---
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

// Proteger el panel de control
app.get('/control', (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.redirect('/login');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// --- RUTAS DE PANTALLAS ---
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
app.get('/multicam',       (req, res) => res.sendFile(pub('multicam.html')));
app.get('/overlay-universal', (req, res) => res.sendFile(pub('overlay-universal.html')));
app.get('/overlay-acumulados', (req, res) => res.sendFile(pub('overlay-acumulados.html')));

// --- APIs DE DATOS ---
app.get('/api/me', requireSession, (req, res) => {
    res.json({ username: req.username, name: req.session.name });
});

// --- CONSOLA DE AGENCIA (solo admin) ---
app.get('/api/agency/overview', requireSession, (req, res) => {
    if (req.username !== 'admin' && req.username !== 'master') {
        return res.status(403).json({ error: 'No autorizado' });
    }
    try {
        const allUsers = MasterDB.getAllUsers();
        let totalHoyAgencia = 0;
        let totalMesAgencia = 0;
        let totalHistoricoAgencia = 0;
        
        const dancers = allUsers.map(u => {
            const session = getUserSession(u.username);
            let diamantesHoy = 0, diamantesMes = 0, diamantesHistorico = 0;
            try {
                const resumen = session.db.getResumenAnalytics();
                diamantesHoy = resumen.totalHoy || 0;
                diamantesMes = resumen.totalMes || 0;
                diamantesHistorico = resumen.totalHistorico || 0;
            } catch(e) {}
            
            totalHoyAgencia += diamantesHoy;
            totalMesAgencia += diamantesMes;
            totalHistoricoAgencia += diamantesHistorico;
            
            return {
                username: u.username,
                name: u.name || u.username,
                tiktokEstado: session.tiktokEstado || 'desconectado',
                tiktokUsuario: session.tiktokUsuario || '',
                vistaActiva: session.vistaActiva || '/batalla',
                diamantesHoy,
                diamantesMes,
                diamantesHistorico
            };
        });
        
        res.json({
            kpis: {
                totalHoy: totalHoyAgencia,
                totalMes: totalMesAgencia,
                totalHistorico: totalHistoricoAgencia
            },
            dancers
        });
    } catch(e) {
        console.error('Error en agency/overview:', e);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.get('/api/agency/login-as', (req, res) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    if (req.session.user !== 'admin' && req.session.user !== 'master') {
        return res.status(403).send('No autorizado');
    }
    const targetUser = req.query.user;
    if (!targetUser) return res.status(400).send('Falta parámetro user');
    const userExists = MasterDB.obtenerUsuario(targetUser);
    if (!userExists) return res.status(404).send('Usuario no encontrado');
    // Cambiar sesión al usuario destino
    res.setSession(targetUser, { name: userExists.name || targetUser });
    res.redirect('/control');
});

app.all('/api/agency/eliminar-usuario', (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).send('No autenticado');
    if (req.session.user !== 'admin' && req.session.user !== 'master') {
        return res.status(403).send('No autorizado');
    }
    const targetUser = (req.query.user || (req.body && req.body.user) || '').trim();
    if (!targetUser) return res.status(400).send('Falta parámetro user');
    if (targetUser.toLowerCase() === 'admin' || targetUser === req.session.user) {
        return res.status(400).send('No se puede eliminar la cuenta principal de administrador ni tu usuario activo');
    }
    try {
        const session = activeSessions[targetUser];
        if (session) {
            clearInterval(session.batchInterval);
            if (session.tiktokConnection) {
                try { session.tiktokConnection.disconnect(); } catch(e) {}
            }
            if (session.db) {
                session.db.close();
            }
            delete activeSessions[targetUser];
        }
        MasterDB.eliminarUsuario(targetUser);

        const userDbPath = path.join(__dirname, `database_${targetUser}.db`);
        if (fs.existsSync(userDbPath)) {
            try { fs.unlinkSync(userDbPath); } catch(e) { console.error('Error eliminando db:', e.message); }
        }

        res.json({ status: 'OK', message: `Usuario ${targetUser} eliminado correctamente` });
    } catch(e) {
        res.status(500).send(e.message || 'Error eliminando usuario');
    }
});

// ── RUTAS DE RECUPERACIÓN DE CONTRASEÑA CON TOKEN ──
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

app.get('/api/overlay/estado', requireSession, (req, res) => {
    res.json({ vistaActiva: req.userSession.vistaActiva || '/batalla' });
});

app.all('/api/overlay/cambiar-vista', requireSession, (req, res) => {
    const s = req.userSession;
    const vista = (req.query.vista || (req.body && req.body.vista) || '').trim();
    if (!vista) return res.status(400).send('Falta especificar la vista');
    s.vistaActiva = vista;
    io.to(req.username).emit('cambioVista', vista);
    res.json({ status: 'OK', vistaActiva: vista });
});

app.get('/api/overlay/estado-acumulados', requireSession, (req, res) => {
    res.json({ vistaAcumuladosActiva: req.userSession.vistaAcumuladosActiva || '/' });
});

app.all('/api/overlay/cambiar-vista-acumulados', requireSession, (req, res) => {
    const s = req.userSession;
    const vista = (req.query.vista || (req.body && req.body.vista) || '').trim();
    if (!vista) return res.status(400).send('Falta especificar la vista de acumulados');
    s.vistaAcumuladosActiva = vista;
    io.to(req.username).emit('cambioVistaAcumulados', vista);
    res.json({ status: 'OK', vistaAcumuladosActiva: vista });
});

app.get('/api/queens', requireSession, (req, res) => res.json(req.userSession.QUEENS));
app.get('/api/queens/all', requireSession, (req, res) => res.json(req.userSession.db.getAllQueensFull()));
app.get('/api/apodos', requireSession, (req, res) => res.json(req.userSession.db.getApodosMap()));

// --- CRUD QUEENS ---
app.all('/api/queens/crear', requireSession, (req, res) => {
    const s = req.userSession;
    const nombre = (req.query.nombre || (req.body && req.body.nombre) || '').trim();
    const color = req.query.color || (req.body && req.body.color) || '#ffffff';
    const apodo = (req.query.apodo || (req.body && req.body.apodo) || '').trim();
    const regaloImg = req.query.regalo_img || (req.body && req.body.regalo_img) || '';
    const regaloPts = parseInt(req.query.regalo_pts || (req.body && req.body.regalo_pts) || '0') || 0;
    if (!nombre) return res.status(400).send('Falta nombre');
    s.db.crearQueen(nombre, color, apodo, regaloImg, regaloPts);
    reconstruirQueens(s);
    s.QUEENS.forEach(q => { if (!s.rachasPerdidas[q]) s.rachasPerdidas[q] = 0; if (!s.amarillasAcumuladas[q]) s.amarillasAcumuladas[q] = 0; });
    io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
    res.send('OK');
});

app.all('/api/queens/editar', requireSession, (req, res) => {
    const s = req.userSession;
    const p      = (k) => req.query[k] !== undefined ? req.query[k] : (req.body && req.body[k] !== undefined ? req.body[k] : null);
    const nombre = p('nombre');
    const color  = p('color');
    const apodo  = p('apodo');
    const regImg = p('regalo_img');
    const regPts = p('regalo_pts') !== null ? parseInt(p('regalo_pts')) : null;
    if (!nombre || !color) return res.status(400).send('Faltan datos');
    s.db.editarQueen(nombre, color, apodo, regImg, regPts);
    reconstruirEquipos(s);
    io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
    res.send('OK');
});

app.all('/api/queens/renombrar', requireSession, (req, res) => {
    const s = req.userSession;
    const nombre = (req.query.nombre || (req.body && req.body.nombre) || '').trim();
    const nuevo  = (req.query.nuevo  || (req.body && req.body.nuevo)  || '').trim();
    if (!nombre || !nuevo) return res.status(400).send('Faltan datos');
    if (nombre === nuevo) return res.send('OK');
    s.db.renombrarQueen(nombre, nuevo);
    reconstruirQueens(s);
    io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
    res.send('OK');
});

app.all('/api/queens/eliminar', requireSession, (req, res) => {
    const s = req.userSession;
    const nombre = (req.query.nombre || (req.body && req.body.nombre) || '').trim();
    if (!nombre) return res.status(400).send('Falta nombre');
    s.db.eliminarQueen(nombre);
    reconstruirQueens(s);
    io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
    res.send('OK');
});

app.all('/api/queens/toggle', requireSession, (req, res) => {
    const s = req.userSession;
    const nombre = req.query.nombre || (req.body && req.body.nombre);
    if (!nombre) return res.status(400).send('Falta nombre');
    const nuevoEstado = s.db.toggleQueenActivo(nombre);
    reconstruirQueens(s);
    io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
    res.json({ activo: nuevoEstado });
});

// --- API IMÁGENES DE REGALOS ---
app.get('/api/regalos-imgs', (req, res) => {
    const dir = path.join(__dirname, 'public', 'regalos');
    fs.readdir(dir, (err, files) => {
        if (err) return res.json([]);
        const imgs = files.filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).sort();
        res.json(imgs);
    });
});

app.get('/api/ranking', requireSession, (req, res) => res.json(req.userSession.db.getRanking()));
app.get('/api/ranking-mensual', requireSession, (req, res) => res.json(req.userSession.db.getRankingMensual()));
app.get('/api/ranking-diario', requireSession, (req, res) => res.json(req.userSession.db.getRankingDiario()));
app.get('/api/copa', requireSession, (req, res) => res.json({ copa: req.userSession.db.getCopa(), equipos: req.userSession.equipos }));

// --- API FUTBOL CONFIG ---
app.get('/api/futbol/config', requireSession, (req, res) => {
    res.json(req.userSession.db.getFutbolConfig());
});

app.post('/api/futbol/config', requireSession, express.json(), (req, res) => {
    const s = req.userSession;
    const config = req.body;
    if(!config || !config.equipo1 || !config.equipo2) return res.status(400).send('Invalid config');
    s.db.setFutbolConfig(config);
    io.to(req.username).emit('futbolConfigActualizada', config);
    res.send('OK');
});

app.get('/api/victorias', requireSession, (req, res) => res.json(req.userSession.db.getVictorias()));

// --- APIs ALIASES ---
app.get('/api/aliases', requireSession, (req, res) => res.json(req.userSession.db.getAliases()));
app.all('/api/aliases/add', requireSession, (req, res) => {
    const s = req.userSession;
    const alias = req.query.alias || (req.body && req.body.alias);
    const queen = req.query.queen || (req.body && req.body.queen);
    if (alias && queen && s.QUEENS.includes(queen)) {
        s.db.agregarAlias(alias, queen);
        return res.send("OK");
    }
    res.status(400).send("Error");
});
app.all('/api/aliases/delete', requireSession, (req, res) => {
    const alias = req.query.alias || (req.body && req.body.alias);
    if (alias) { req.userSession.db.eliminarAlias(alias); return res.send("OK"); }
    res.status(400).send("Error");
});

// --- APIs GRUPOS ---
app.get('/api/grupos', requireSession, (req, res) => res.json(req.userSession.db.getGrupos()));
app.all('/api/grupos/crear', requireSession, (req, res) => {
    const s = req.userSession;
    const nombre = req.query.nombre || (req.body && req.body.nombre);
    const color = req.query.color || (req.body && req.body.color) || '#39FF14';
    if (nombre) {
        try { s.db.crearGrupo(nombre, color); return res.send("OK"); }
        catch(e) { return res.status(400).send("Grupo ya existe"); }
    }
    res.status(400).send("Error");
});
app.all('/api/grupos/eliminar', requireSession, (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    if (id) { req.userSession.db.eliminarGrupo(id); return res.send("OK"); }
    res.status(400).send("Error");
});
app.all('/api/grupos/agregar-miembro', requireSession, (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    const queen = req.query.queen || (req.body && req.body.queen);
    if (id && queen) { req.userSession.db.agregarMiembro(id, queen); return res.send("OK"); }
    res.status(400).send("Error");
});
app.all('/api/grupos/remover-miembro', requireSession, (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    const queen = req.query.queen || (req.body && req.body.queen);
    if (id && queen) { req.userSession.db.removerMiembro(id, queen); return res.send("OK"); }
    res.status(400).send("Error");
});

// --- APIs SONIDOS ---
app.get('/api/sonidos', requireSession, (req, res) => res.json(req.userSession.db.getSonidos()));
app.all('/api/sonidos/set', requireSession, (req, res) => {
    const s = req.userSession;
    const evento = req.query.evento || (req.body && req.body.evento);
    const url = req.query.url || (req.body && req.body.url);
    if (evento && url) { s.db.setSonido(evento, url); return res.send("OK"); }
    res.status(400).send("Error");
});

// ── LÓGICA TIKTOK LIVE Y BATCHING MULTI-TENANT (ZUKAA STYLE) ──
function conectarTikTok(username, usuarioTikTok) {
    const session = activeSessions[username];
    if (!session) return;

    if (session.tiktokConnection) {
        try { session.tiktokConnection.disconnect(); } catch(e) {}
        session.tiktokConnection = null;
    }

    session.tiktokEstado = 'conectando';
    session.tiktokUsuario = usuarioTikTok;
    session.tiktokMensajeError = '';
    io.to(username).emit('tiktokEstado', { estado: 'conectando', usuario: usuarioTikTok });

    const connection = new WebcastPushConnection(usuarioTikTok, {
        enableExtendedGiftInfo: true
    });

    session.tiktokConnection = connection;

    connection.connect().then(state => {
        session.tiktokEstado = 'conectado';
        session.tiktokMensajeError = '';
        io.to(username).emit('tiktokEstado', { estado: 'conectado', usuario: usuarioTikTok });
        connection.fetchAvailableGifts().then(gifts => {
            session.catalogoRegalos = (gifts || []).map(g => ({
                id: g.id || g.giftId,
                name: g.name,
                diamondCount: g.diamond_count || g.diamondCount || g.cost || 0,
                imageUrl: g.image?.url_list?.[0] || g.imageUrl || ''
            }));
            io.to(username).emit('catalogoCargado', session.catalogoRegalos.length);
        }).catch(err => {
            console.error('Error cargando catálogo de regalos de TikTok:', err);
        });
    }).catch(err => {
        console.error('Error al conectar TikTok:', err);
        session.tiktokEstado = 'error';
        session.tiktokMensajeError = err.message || (err.toString ? err.toString() : 'Error desconocido');
        io.to(username).emit('tiktokEstado', { estado: 'error', usuario: usuarioTikTok, error: session.tiktokMensajeError });
        session.tiktokConnection = null;
    });

    connection.on('gift', (data) => {
        procesarRegaloTikTok(username, data);
    });

    connection.on('chat', (data) => {
        io.to(username).emit('tiktokLiveEvent', { tipo: 'chat', usuario: data.uniqueId, comentario: data.comment, avatar: data.profilePictureUrl });
    });

    connection.on('like', (data) => {
        io.to(username).emit('tiktokLiveEvent', { tipo: 'like', usuario: data.uniqueId, cantidad: data.likeCount, avatar: data.profilePictureUrl });
    });

    connection.on('social', (data) => {
        const subtipo = data.displayType.includes('follow') ? 'follow' : 'share';
        io.to(username).emit('tiktokLiveEvent', { tipo: subtipo, usuario: data.uniqueId, descripcion: data.label, avatar: data.profilePictureUrl });
    });

    connection.on('member', (data) => {
        io.to(username).emit('tiktokLiveEvent', { tipo: 'join', usuario: data.uniqueId, avatar: data.profilePictureUrl });
    });

    connection.on('roomUser', (data) => {
        io.to(username).emit('tiktokLiveEvent', { tipo: 'roomUser', viewerCount: data.viewerCount });
    });

    connection.on('disconnected', () => {
        session.tiktokEstado = 'desconectado';
        session.tiktokUsuario = '';
        io.to(username).emit('tiktokEstado', { estado: 'desconectado', usuario: '' });
        session.tiktokConnection = null;
    });

    connection.on('streamEnd', () => {
        session.tiktokEstado = 'desconectado';
        session.tiktokUsuario = '';
        io.to(username).emit('tiktokEstado', { estado: 'desconectado', usuario: '' });
        session.tiktokConnection = null;
    });
}

function procesarRegaloTikTok(username, data) {
    const session = activeSessions[username];
    if (!session) return;
    
    const viewer = (data.uniqueId || '').trim();
    const avatar = data.profilePictureUrl || '';
    const giftName = (data.giftName || '').trim();
    const repeat = parseInt(data.repeatCount) || 1;
    const giftImgSrc = data.giftPictureUrl || '';
    
    // De acuerdo a la especificación oficial de tiktok-live-connector:
    // Los regalos de ráfaga (giftType === 1) envían eventos intermedios con repeatEnd: false.
    // Solo cuando se completa la ráfaga (repeatEnd: true o giftType !== 1) se acredita el valor final en puntos (diamondCount * repeatCount).
    const isStreakInProgress = (data.giftType === 1 && !data.repeatEnd);
    const coins = (data.diamondCount || 1) * repeat;
    
    let rawMapa = session.db.getConfigVal('tiktok_regalo_mapa');
    let mapa = rawMapa ? JSON.parse(rawMapa) : {};
    
    let rawTimerMapa = session.db.getConfigVal('tiktok_timer_mapa');
    let timerMapa = rawTimerMapa ? JSON.parse(rawTimerMapa) : {};
    
    let queenActivadora = mapa[giftName] || null;
    let queenSalto = timerMapa[giftName] || null;
    
    // SI EL TIMER DE BAILE ESTÁ ACTIVO: Forzar que cualquier regalo vaya a la bailarina actual
    if (session.timerBaile.activo && session.timerBaile.estado === 'bailando' && session.timerBaile.chicaActual) {
        queenActivadora = session.timerBaile.chicaActual;
    }
    // SI LA DINÁMICA CONOCIENDO ESTÁ ACTIVA: Forzar que cualquier regalo vaya a la bailarina actual
    else if (session.conociendo.activo && session.conociendo.estado === 'activo' && session.conociendo.chicaActual) {
        queenActivadora = session.conociendo.chicaActual;
    }
    
    if (data.toUser && data.toUser.uniqueId) {
        const dest = resolverNombre(session, data.toUser.uniqueId);
        if (dest) {
            queenActivadora = dest;
        }
    }
    
    try {
        let destinatarioFinal = 'Global';
        if (queenActivadora && session.QUEENS.includes(queenActivadora)) {
            const eq = session.equipos[queenActivadora] || {};
            const pts = eq.regalo_pts ? (eq.regalo_pts * repeat) : coins;
            destinatarioFinal = queenActivadora;
            
            if (!isStreakInProgress) {
                session.queueUpdate.push({ nombre: queenActivadora, puntos: pts, saltaTurno: queenSalto });
                session.db.registrarRegalo(queenActivadora, giftName, pts, viewer);
                session.lealtadUsuarios[viewer] = queenActivadora;
            }
            
            io.to(username).emit('nuevoRegalo', {
                nombre: queenActivadora,
                viewer,
                avatar,
                giftImg: eq.regalo_img || giftImgSrc,
                queenColor: eq.color || '#fff',
                coins: pts,
                giftName
            });
        } else {
            const queenAsignada = session.lealtadUsuarios[viewer] || null;
            if (queenAsignada && session.QUEENS.includes(queenAsignada)) {
                destinatarioFinal = queenAsignada;
                if (!isStreakInProgress) {
                    session.queueUpdate.push({ nombre: queenAsignada, puntos: coins, saltaTurno: queenSalto });
                    session.db.registrarRegalo(queenAsignada, giftName, coins, viewer);
                }
                const eq = session.equipos[queenAsignada] || {};
                
                io.to(username).emit('nuevoRegalo', {
                    nombre: queenAsignada,
                    viewer,
                    avatar,
                    giftImg: eq.regalo_img || giftImgSrc,
                    queenColor: eq.color || '#fff',
                    coins,
                    giftName
                });
            } else if (queenSalto && session.QUEENS.includes(queenSalto)) {
                destinatarioFinal = queenSalto;
                if (!isStreakInProgress) {
                    session.queueUpdate.push({ nombre: queenSalto, puntos: coins, saltaTurno: queenSalto });
                    session.db.registrarRegalo(queenSalto, giftName, coins, viewer);
                }
                const eq = session.equipos[queenSalto] || {};
                
                io.to(username).emit('nuevoRegalo', {
                    nombre: queenSalto,
                    viewer,
                    avatar,
                    giftImg: eq.regalo_img || giftImgSrc,
                    queenColor: eq.color || '#fff',
                    coins,
                    giftName
                });
            } else {
                if (!isStreakInProgress) {
                    session.queueUpdate.push({ nombre: null, puntos: coins, saltaTurno: queenSalto });
                    
                    const giftId = `gift-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                    const giftInstance = {
                        id: giftId,
                        giftName,
                        viewer,
                        coins,
                        giftImgSrc,
                        timestamp: new Date().toISOString()
                    };
                    session.regalosDetectados[giftId] = giftInstance;
                    io.to(username).emit('regaloDetectado', giftInstance);
                }
            }
        }

        io.to(username).emit('tiktokLiveEvent', {
            tipo: 'gift',
            usuario: viewer,
            avatar,
            giftName,
            coins,
            destinatario: destinatarioFinal,
            giftImg: giftImgSrc
        });
    } catch(e) {
        console.error('Error procesando regalo de TikTok:', e);
    }
}

function procesarPuntosEnLote(username) {
    const session = activeSessions[username];
    if (!session || session.queueUpdate.length === 0) return;
    
    const temp = [...session.queueUpdate];
    session.queueUpdate = [];
    
    const sumas = {};
    let pointsBatallaDelta = {};
    let pointsDinamicaDelta = {};
    let saltaTurnoPara = null;
    
    temp.forEach(item => {
        if (item.nombre) {
            sumas[item.nombre] = (sumas[item.nombre] || 0) + item.puntos;
            if (session.estadoBatalla === 'activa' && session.participantesActuales.includes(item.nombre)) {
                pointsBatallaDelta[item.nombre] = (pointsBatallaDelta[item.nombre] || 0) + item.puntos;
            }
            if (session.dinamicaActiva && session.dinamicaActiva.participantes.includes(item.nombre) && !session.eliminadosDinamica.includes(item.nombre)) {
                pointsDinamicaDelta[item.nombre] = (pointsDinamicaDelta[item.nombre] || 0) + item.puntos;
            }
        }
        if (item.saltaTurno) {
            saltaTurnoPara = item.saltaTurno;
        }
    });
    
    for (const queen in sumas) {
        session.db.sumarPuntos(queen, sumas[queen]);
    }
    
    io.to(username).emit('rankingActualizado');
    io.to(username).emit('actualizarCopa', session.db.getCopa());
    
    if (session.estadoBatalla === 'activa') {
        let actualizados = false;
        for (const queen in pointsBatallaDelta) {
            session.puntosBatalla[queen] = (session.puntosBatalla[queen] || 0) + pointsBatallaDelta[queen];
            actualizados = true;
        }
        if (actualizados) {
            io.to(username).emit('batallaPuntos', session.puntosBatalla);
        }
    }
    
    if (session.dinamicaActiva) {
        let actualizados = false;
        for (const queen in pointsDinamicaDelta) {
            session.puntosDinamica[queen] = (session.puntosDinamica[queen] || 0) + pointsDinamicaDelta[queen];
            actualizados = true;
        }
        if (actualizados) {
            io.to(username).emit('dinamicaPuntos', { puntos: session.puntosDinamica, eliminados: session.eliminadosDinamica });
        }
    }
    
    // Si el timer de baile está activo y en estado de baile, sumar segundos configurados por cada punto recibido por la chica actual
    if (session.timerBaile.activo && session.timerBaile.estado === 'bailando') {
        const chicaActual = session.timerBaile.chicaActual;
        const segs = session.timerBaile.segundosPorMoneda || 3;
        temp.forEach(item => {
            if (item.nombre === chicaActual && item.puntos > 0) {
                session.timerBaile.tiempo += (item.puntos * segs);
            }
        });
        io.to(username).emit('timerTick', session.timerBaile.tiempo);
    }

    // Si la dinámica conociendo está activa y en estado activo, sumar los puntos recibidos
    if (session.conociendo.activo && session.conociendo.estado === 'activo') {
        const chicaActual = session.conociendo.chicaActual;
        let nuevosPuntos = 0;
        temp.forEach(item => {
            if (item.nombre === chicaActual && item.puntos > 0) {
                nuevosPuntos += item.puntos;
            }
        });
        if (nuevosPuntos > 0) {
            session.conociendo.puntos += nuevosPuntos;
            io.to(username).emit('conociendoPuntos', { puntos: session.conociendo.puntos, meta: session.conociendo.meta });
        }
    }

    if (saltaTurnoPara) {
        if (session.timerBaile.activo) {
            saltarSiguienteChica(username, saltaTurnoPara);
        }
        if (session.conociendo.activo) {
            saltarConociendo(username, saltaTurnoPara);
        }
    }
}

function resolverParticipantesDinamica(session, participantes) {
    if (!participantes || participantes === 'todas') return [...session.QUEENS];
    if (participantes.startsWith('grupo:')) {
        const grupoId = parseInt(participantes.split(':')[1]);
        const grupo = session.db.getGrupos().find(g => g.id === grupoId);
        return grupo ? grupo.miembros.filter(m => session.QUEENS.includes(m)) : [...session.QUEENS];
    }
    if (participantes.startsWith('manual:')) {
        return participantes.split(':')[1].split(',').map(n => n.trim()).filter(n => session.QUEENS.includes(n));
    }
    return [...session.QUEENS];
}

function finalizarDinamica(username) {
    const session = activeSessions[username];
    if (!session || !session.dinamicaActiva) return;
    const activos = session.dinamicaActiva.participantes.filter(p => !session.eliminadosDinamica.includes(p));
    let maxPts = 0;
    activos.forEach(p => { if ((session.puntosDinamica[p] || 0) > maxPts) maxPts = session.puntosDinamica[p] || 0; });
    const ganadoras = activos.filter(p => (session.puntosDinamica[p] || 0) === maxPts);
    const ganadora = ganadoras.length === 1 && maxPts > 0 ? ganadoras[0] : maxPts === 0 ? 'SIN PUNTOS' : 'EMPATE';
    const payload = { ganadora, puntos: session.puntosDinamica, eliminados: session.eliminadosDinamica };
    io.to(username).emit('dinamicaFin', payload);
    setTimeout(() => io.to(username).emit('dinamicaFin', payload), 300);
    session.dinamicaActiva = null;
}

function resolverNombre(session, nombre) {
    if (!nombre) return null;
    if (session.QUEENS.includes(nombre)) return nombre;
    const queenDeAlias = session.db.resolverAlias(nombre);
    return queenDeAlias || null;
}

// BATCHING DE PUNTOS POR USUARIO
// Se ejecuta cada 300ms para cada sesión activa (definido en getUserSession)

app.all('/update', requireSession, (req, res) => {
    const s = req.userSession;
    let nombre = req.query.nombre || (req.body && req.body.nombre);
    const puntos = parseInt(req.query.puntos || (req.body && req.body.puntos));
    const viewer = req.query.viewer || (req.body && req.body.viewer);
    const avatar = req.query.avatar || (req.body && req.body.avatar) || '';
    
    nombre = resolverNombre(s, nombre);
    
    if (nombre && !isNaN(puntos)) {
        if (viewer && puntos > 0) s.lealtadUsuarios[viewer] = nombre;
        if (puntos !== 0) s.queueUpdate.push({ nombre, puntos });
        
        if (puntos > 0) {
            const vName = viewer || 'Admin';
            s.db.registrarRegalo(nombre, 'Regalo Manual', puntos, vName);
            if (viewer) {
                const eq = s.equipos[nombre] || {};
                io.to(req.username).emit('nuevoRegalo', {
                    nombre,
                    viewer,
                    avatar,
                    giftImg: eq.regalo_img || '',
                    queenColor: eq.color || '#fff',
                    coins: puntos,
                    giftName: 'Regalo Manual'
                });
            }
        }
        return res.send("OK");
    }
    res.status(400).send("Error");
});

app.all('/update-auto', requireSession, (req, res) => {
    const s = req.userSession;
    const viewer = req.query.viewer || (req.body && req.body.viewer);
    const avatar = req.query.avatar || (req.body && req.body.avatar) || '';
    const puntos = parseInt(req.query.puntos || (req.body && req.body.puntos));
    if (!isNaN(puntos) && puntos > 0) {
        let queenAsignada = (viewer && s.lealtadUsuarios[viewer]) ? s.lealtadUsuarios[viewer] : null;
        if (queenAsignada) {
            s.queueUpdate.push({ nombre: queenAsignada, puntos });
            const vName = viewer || 'Auto';
            s.db.registrarRegalo(queenAsignada, 'Regalo Auto', puntos, vName);
            const eq = s.equipos[queenAsignada] || {};
            if (viewer) {
                io.to(req.username).emit('nuevoRegalo', { nombre: queenAsignada, viewer, avatar, giftImg: eq.regalo_img || '', queenColor: eq.color || '#fff', coins: puntos, giftName: 'Regalo Auto' });
            }
            return res.send("Asignado a " + queenAsignada);
        } else {
            s.queueUpdate.push({ nombre: null, puntos });
            return res.send("Sumado Global");
        }
    }
    res.status(400).send("Ignorado");
});

// TIKTOK CONNECTION LOGIC: Implementada a nivel de usuario en getUserSession
// y conectarTikTok (ver arriba)

app.all('/tiktok/conectar', requireSession, (req, res) => {
    const usuario = (req.query.usuario || (req.body && req.body.usuario) || '').replace('@', '').trim();
    if (!usuario) return res.status(400).send('Falta usuario de TikTok');
    conectarTikTok(req.username, usuario);
    res.send('Conectando...');
});

app.all('/tiktok/desconectar', requireSession, (req, res) => {
    const s = req.userSession;
    if (s.tiktokConnection) {
        try { s.tiktokConnection.disconnect(); } catch(e) {}
        s.tiktokConnection = null;
    }
    s.tiktokEstado = 'desconectado';
    s.tiktokUsuario = '';
    io.to(req.username).emit('tiktokEstado', { estado: s.tiktokEstado, usuario: '' });
    res.send('OK');
});

app.get('/tiktok/test-gift', requireSession, (req, res) => {
    const giftName = req.query.gift || req.query.giftName || 'Rose';
    const repeat = parseInt(req.query.repeat || req.query.repeatCount || '1');
    const destName = req.query.to || req.query.toUser || '';
    const viewer = req.query.viewer || req.query.uniqueId || 'TesterUnique';
    const diamonds = parseInt(req.query.diamonds || req.query.coins || req.query.diamondCount || '10');
    const giftPic = req.query.giftPictureUrl || req.query.giftPic || 'https://p19-webcast.tiktokcdn.com/img/webcast/5f8efc0f4f9f6e72c84285fbfe4e2b00.png~tplv-obj.image';
    const fakeData = {
        uniqueId: viewer,
        profilePictureUrl: 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/7311145620163350534~tplv-tiktok-shrink:100:100.webp',
        giftName: giftName,
        diamondCount: diamonds,
        repeatCount: repeat,
        giftPictureUrl: giftPic
    };
    if (destName) {
        fakeData.toUser = {
            uniqueId: destName.toLowerCase(),
            nickname: destName + '💙'
        };
    }
    procesarRegaloTikTok(req.username, fakeData);
    res.send({ status: 'OK', simulatedData: fakeData });
});

app.get('/api/tiktok/estado', requireSession, (req, res) => {
    const s = req.userSession;
    res.json({ estado: s.tiktokEstado, usuario: s.tiktokUsuario, error: s.tiktokMensajeError });
});

app.post('/api/tiktok/mapa', requireSession, (req, res) => {
    const s = req.userSession;
    const mapa = req.body.mapa || req.body;
    s.db.setConfigVal('tiktok_regalo_mapa', JSON.stringify(mapa));
    io.to(req.username).emit('mapaRegalosCambiado', mapa);
    res.send('OK');
});

app.get('/api/tiktok/timer_mapa', requireSession, (req, res) => {
    const v = req.userSession.db.getConfigVal('tiktok_timer_mapa');
    res.json(v ? JSON.parse(v) : {});
});

app.post('/api/tiktok/timer_mapa', requireSession, (req, res) => {
    const s = req.userSession;
    const mapa = req.body.mapa || req.body;
    s.db.setConfigVal('tiktok_timer_mapa', JSON.stringify(mapa));
    io.to(req.username).emit('mapaTimerCambiado', mapa);
    res.send('OK');
});

app.get('/api/tiktok/mapa', requireSession, (req, res) => {
    const raw = req.userSession.db.getConfigVal('tiktok_regalo_mapa');
    res.json(raw ? JSON.parse(raw) : {});
});

app.get('/api/tiktok/regalos-detectados', requireSession, (req, res) => {
    res.json(Object.values(req.userSession.regalosDetectados));
});

app.all('/api/tiktok/regalos-detectados/limpiar', requireSession, (req, res) => {
    req.userSession.regalosDetectados = {};
    res.send('OK');
});

app.post('/api/tiktok/regalos-detectados/asignar', requireSession, (req, res) => {
    const s = req.userSession;
    const { id, queen } = req.body;
    
    if (!id || !queen || !s.QUEENS.includes(queen)) {
        return res.status(400).send('Faltan parámetros requeridos o reina inválida.');
    }
    
    const giftInstance = s.regalosDetectados[id];
    if (giftInstance) {
        const giftName = giftInstance.giftName;
        const coins = giftInstance.coins || 1;
        const viewer = giftInstance.viewer || 'Anónimo';
        
        s.db.registrarRegalo(queen, giftName, coins, viewer);
        s.queueUpdate.push({ nombre: queen, puntos: coins });
        s.lealtadUsuarios[viewer] = queen;
        
        const eq = s.equipos[queen] || {};
        io.to(req.username).emit('nuevoRegalo', {
            nombre: queen,
            viewer,
            avatar: '',
            giftImg: eq.regalo_img || giftInstance.giftImgSrc || '',
            queenColor: eq.color || '#fff',
            coins,
            giftName
        });
        
        // Eliminar de la lista de detectados para que desaparezca
        delete s.regalosDetectados[id];
        res.send('Asignado con éxito');
    } else {
        res.status(404).send('Regalo no encontrado.');
    }
});

app.get('/api/marca', requireSession, (req, res) => {
    const s = req.userSession;
    const logoUrl = s.db.getConfigVal('marca_logo_url') || '';
    const fontFamily = s.db.getConfigVal('marca_font_family') || 'Inter';
    const neonIntensity = s.db.getConfigVal('marca_neon_intensity') || 'normal';
    res.json({ logoUrl, fontFamily, neonIntensity });
});

app.post('/api/marca', requireSession, (req, res) => {
    const s = req.userSession;
    const { logoUrl, fontFamily, neonIntensity } = req.body;
    
    s.db.setConfigVal('marca_logo_url', logoUrl || '');
    s.db.setConfigVal('marca_font_family', fontFamily || 'Inter');
    s.db.setConfigVal('marca_neon_intensity', neonIntensity || 'normal');
    
    const config = { logoUrl, fontFamily, neonIntensity };
    io.to(req.username).emit('marcaCambiado', config);
    res.json({ status: 'OK', config });
});

app.get('/api/agency/dancers', requireSession, (req, res) => {
    if (req.username !== 'admin' && req.username !== 'master') {
        return res.status(403).send('No autorizado');
    }
    
    try {
        const files = fs.readdirSync(__dirname);
        const dbFiles = files.filter(f => f.startsWith('database_') && f.endsWith('.db'));
        
        const dancers = [];
        let grandTotalHistorico = 0;
        let grandTotalHoy = 0;
        let grandTotalMes = 0;
        
        for (const file of dbFiles) {
            const username = file.replace(/^database_/, '').replace(/\.db$/, '');
            const s = getUserSession(username);
            if (s && s.db) {
                const analytics = s.db.getResumenAnalytics();
                const hist = parseInt(analytics.totalHistorico || 0);
                const hoy = parseInt(analytics.totalHoy || 0);
                const mes = parseInt(analytics.totalMes || 0);
                
                grandTotalHistorico += hist;
                grandTotalHoy += hoy;
                grandTotalMes += mes;
                
                dancers.push({
                    username,
                    tiktokEstado: s.tiktokEstado || 'desconectado',
                    tiktokUsuario: s.tiktokUsuario || '',
                    vistaActiva: s.vistaActiva || '/batalla',
                    vistaAcumuladosActiva: s.vistaAcumuladosActiva || '/',
                    totalHistorico: hist,
                    totalHoy: hoy,
                    totalMes: mes,
                    totalQueens: s.QUEENS.length
                });
            }
        }
        
        res.json({
            grandTotalHistorico,
            grandTotalHoy,
            grandTotalMes,
            dancers
        });
    } catch (e) {
        console.error('Error cargando datos de agencia:', e);
        res.status(500).send('Error interno');
    }
});

app.get('/login-as', requireSession, (req, res) => {
    if (req.username !== 'admin' && req.username !== 'master') {
        return res.status(403).send('No autorizado');
    }
    
    const targetUser = req.query.user;
    if (!targetUser) return res.status(400).send('Falta usuario');
    
    const masterDb = require('./masterDb');
    const user = masterDb.obtenerUsuario(targetUser);
    if (!user) return res.status(404).send('Usuario no encontrado');
    
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions[targetUser] = getUserSession(targetUser);
    activeSessions[targetUser].token = token;
    
    res.cookie('session_token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    res.redirect('/control');
});

const CATALOGO_RESPALDO = [
    { id:5655, name:'Rose',             diamondCount:1,     imageUrl:'/regalos/Rosa.png' },
    { id:6948, name:'TikTok',           diamondCount:1,     imageUrl:'/regalos/tiktok.png' },
    { id:7493, name:'GG',               diamondCount:1,     imageUrl:'/regalos/GG.png' },
    { id:6551, name:'Heart',            diamondCount:1,     imageUrl:'/regalos/corazon.png' },
    { id:6104, name:'Finger Heart',     diamondCount:5,     imageUrl:'/regalos/Hand Hearts.png' },
    { id:6683, name:'Like',             diamondCount:1,     imageUrl:'' },
    { id:7494, name:'Super GG',         diamondCount:99,    imageUrl:'' },
    { id:6435, name:'Mic',              diamondCount:10,    imageUrl:'' },
    { id:5652, name:'Sunglasses',       diamondCount:199,   imageUrl:'/regalos/gafas verdes.png' },
    { id:7305, name:'Hand Heart',       diamondCount:100,   imageUrl:'/regalos/Hand Hearts.png' },
    { id:6812, name:'Soccer Ball',      diamondCount:1,     imageUrl:'' },
    { id:8525, name:'Cap',              diamondCount:99,    imageUrl:'/regalos/gorra.png' },
    { id:6056, name:'Lucky Cat',        diamondCount:199,   imageUrl:'' },
    { id:7394, name:'Ice Cream Cone',   diamondCount:1,     imageUrl:'' },
    { id:7560, name:'Cake',             diamondCount:299,   imageUrl:'' },
    { id:8121, name:'Crown',            diamondCount:99,    imageUrl:'/regalos/corona.png' },
    { id:7572, name:'Yacht',            diamondCount:1000,  imageUrl:'' },
    { id:8744, name:'Airplane',         diamondCount:1000,  imageUrl:'' },
    { id:8913, name:'Galaxy',           diamondCount:1000,  imageUrl:'/regalos/Galaxy.png' },
    { id:7028, name:'Concert',          diamondCount:500,   imageUrl:'' },
    { id:6557, name:'Lion',             diamondCount:29999, imageUrl:'' },
    { id:7071, name:'TikTok Universe',  diamondCount:44999, imageUrl:'/regalos/TikTok Universe.png' },
    { id:8604, name:'Island',           diamondCount:15000, imageUrl:'' },
    { id:6468, name:'Drama Queen',      diamondCount:5000,  imageUrl:'' },
    { id:7400, name:'Sports Car',       diamondCount:7000,  imageUrl:'' },
    { id:7399, name:'Bus',              diamondCount:1000,  imageUrl:'' },
    { id:8614, name:'Diamond Gun',      diamondCount:2999,  imageUrl:'/regalos/Diamond Gun.png' },
    { id:6648, name:'Perfume',          diamondCount:20,    imageUrl:'' },
    { id:7100, name:'Power Pump',       diamondCount:199,   imageUrl:'' },
    { id:8215, name:'Little Ghost',     diamondCount:299,   imageUrl:'' },
    { id:7781, name:'Star',             diamondCount:10,    imageUrl:'' },
    { id:8700, name:'Boxing Gloves',    diamondCount:299,   imageUrl:'' },
    { id:8701, name:'Corgi',            diamondCount:299,   imageUrl:'/regalos/Corgi.png' },
    { id:9002, name:'Doughnut',         diamondCount:30,    imageUrl:'/regalos/dona.png' },
    { id:9003, name:'Headphones',       diamondCount:20,    imageUrl:'' },
].sort((a,b) => a.name.localeCompare(b.name));

app.get('/api/tiktok/catalogo', requireSession, (req, res) => {
    const s = req.userSession;
    const q = (req.query.q || '').toLowerCase();
    
    let fuente = CATALOGO_RESPALDO;
    if (s.catalogoRegalos.length > 0) {
        const mapaDinamico = {};
        s.catalogoRegalos.forEach(r => {
            mapaDinamico[r.name.toLowerCase()] = r;
        });

        fuente = CATALOGO_RESPALDO.map(r => {
            const din = mapaDinamico[r.name.toLowerCase()];
            if (din) {
                return {
                    id: din.id || r.id,
                    name: din.name || r.name,
                    diamondCount: din.diamondCount || r.diamondCount,
                    imageUrl: din.imageUrl || r.imageUrl
                };
            }
            return r;
        });

        const nombresRespaldo = new Set(CATALOGO_RESPALDO.map(r => r.name.toLowerCase()));
        const extra = s.catalogoRegalos.filter(r => !nombresRespaldo.has(r.name.toLowerCase()));
        fuente = [...fuente, ...extra].sort((a,b) => a.name.localeCompare(b.name));
    }

    const lista = q
        ? fuente.filter(g => g.name.toLowerCase().includes(q))
        : fuente;
    
    res.json({ regalos: lista, esCatalogoCompleto: s.catalogoRegalos.length > 0 });
});

function saltarSiguienteChica(username, chicaEspecifica = null) { 
    const session = activeSessions[username];
    if (!session) return;
    if (session.timerBaile.orden.length === 0) session.timerBaile.orden = [...session.QUEENS];
    if (chicaEspecifica) session.timerBaile.chicaActual = chicaEspecifica; 
    else { 
        let idx = session.timerBaile.orden.indexOf(session.timerBaile.chicaActual); 
        session.timerBaile.chicaActual = session.timerBaile.orden[(idx + 1) % session.timerBaile.orden.length]; 
    } 
    session.timerBaile.estado = 'transicion'; 
    session.timerBaile.tiempoTransicion = 5; 
    session.timerBaile.tiempo = 0; 
    io.to(username).emit('timerTransicion', { chica: session.timerBaile.chicaActual, tiempo: session.timerBaile.tiempoTransicion }); 
}

app.all('/timer/start', requireSession, (req, res) => { 
    const s = req.userSession;
    const user = req.username;
    const tiempoBase = parseInt(req.query.t) || 30;
    const segundosPorMoneda = parseInt(req.query.s) || 3;
    
    s.timerBaile.orden = [...s.QUEENS];
    s.timerBaile.activo = true; 
    s.timerBaile.tiempo = tiempoBase; 
    s.timerBaile.segundosPorMoneda = segundosPorMoneda;
    s.timerBaile.chicaActual = s.QUEENS[0] || 'Ray'; 
    s.timerBaile.estado = 'bailando'; 
    s.tiempoAcumulado = {}; 
    s.QUEENS.forEach(q => s.tiempoAcumulado[q] = 0);
    let subTickBaile = 0; 
    let snipeBaile = 3; 
    clearInterval(s.intervaloTimerBaile); 
    
    io.to(user).emit('timerInicio', { 
        chica: s.timerBaile.chicaActual, 
        tiempo: s.timerBaile.tiempo,
        segundosPorMoneda: s.timerBaile.segundosPorMoneda
    }); 
    
    s.intervaloTimerBaile = setInterval(() => { 
        if (s.timerBaile.estado === 'transicion') { 
            s.timerBaile.tiempoTransicion--; 
            io.to(user).emit('timerTransicionTick', s.timerBaile.tiempoTransicion); 
            if (s.timerBaile.tiempoTransicion <= 0) { 
                s.timerBaile.estado = 'bailando'; 
                s.timerBaile.tiempo += tiempoBase; 
                snipeBaile = 3; 
                subTickBaile = 0; 
                io.to(user).emit('timerInicio', { chica: s.timerBaile.chicaActual, tiempo: s.timerBaile.tiempo }); 
            } 
        } else if (s.timerBaile.estado === 'bailando') { 
            s.tiempoAcumulado[s.timerBaile.chicaActual] = (s.tiempoAcumulado[s.timerBaile.chicaActual] || 0) + 1;
            io.to(user).emit('timerAcumulado', s.tiempoAcumulado);
            if (s.timerBaile.tiempo > 3) { 
                s.timerBaile.tiempo--; 
                io.to(user).emit('timerTick', s.timerBaile.tiempo); 
            } else if (s.timerBaile.tiempo > 0) { 
                subTickBaile++; 
                if(subTickBaile >= 2) { 
                    s.timerBaile.tiempo--; 
                    subTickBaile = 0; 
                } 
                io.to(user).emit('timerTick', s.timerBaile.tiempo); 
            } else { 
                io.to(user).emit('timerTick', 0); 
                snipeBaile--; 
                if(snipeBaile <= 0) { 
                    saltarSiguienteChica(user); 
                    snipeBaile = 3; 
                    subTickBaile = 0; 
                } 
            }
        } 
    }, 1000); 
    res.send("OK"); 
});

app.all('/timer/stop', requireSession, (req, res) => { 
    const s = req.userSession;
    s.timerBaile.activo = false; 
    s.timerBaile.estado = 'inactivo'; 
    clearInterval(s.intervaloTimerBaile); 
    io.to(req.username).emit('timerCancelado'); 
    res.send("OK"); 
});

app.all('/timer/skip', requireSession, (req, res) => { 
    const s = req.userSession;
    let target = req.query.c; 
    if(s.timerBaile.activo) saltarSiguienteChica(req.username, target || null); 
    res.send("OK"); 
});

function saltarConociendo(username, chicaEspecifica = null) { 
    const session = activeSessions[username];
    if (!session) return;
    if (session.conociendo.orden.length === 0) session.conociendo.orden = [...session.QUEENS]; 
    if (chicaEspecifica) session.conociendo.chicaActual = chicaEspecifica; 
    else { 
        let idx = session.conociendo.orden.indexOf(session.conociendo.chicaActual); 
        session.conociendo.chicaActual = session.conociendo.orden[(idx + 1) % session.conociendo.orden.length]; 
    } 
    session.conociendo.estado = 'transicion'; 
    session.conociendo.tiempoTransicion = 5; 
    session.conociendo.puntos = 0; 
    io.to(username).emit('conociendoTransicion', { chica: session.conociendo.chicaActual, tiempo: session.conociendo.tiempoTransicion }); 
}

app.all('/conociendo/start', requireSession, (req, res) => { 
    const s = req.userSession;
    const user = req.username;
    s.conociendo.orden = [...s.QUEENS];
    s.conociendo.activo = true; 
    s.conociendo.meta = parseInt(req.query.meta) || 2000; 
    s.conociendo.tiempo = 300; 
    s.conociendo.puntos = 0; 
    s.conociendo.chicaActual = s.QUEENS[0] || 'Ray'; 
    s.conociendo.estado = 'activo'; 
    let subTickConociendo = 0; 
    let snipeConociendo = 3; 
    clearInterval(s.intervaloConociendo); 
    
    io.to(user).emit('conociendoInicio', { chica: s.conociendo.chicaActual, tiempo: s.conociendo.tiempo, meta: s.conociendo.meta, puntos: s.conociendo.puntos }); 
    
    s.intervaloConociendo = setInterval(() => { 
        if(s.conociendo.estado === 'transicion') { 
            s.conociendo.tiempoTransicion--; 
            io.to(user).emit('conociendoTransicionTick', s.conociendo.tiempoTransicion); 
            if(s.conociendo.tiempoTransicion <= 0) { 
                s.conociendo.estado = 'activo'; 
                s.conociendo.tiempo = 300; 
                snipeConociendo = 3; 
                subTickConociendo = 0; 
                io.to(user).emit('conociendoInicio', { chica: s.conociendo.chicaActual, tiempo: s.conociendo.tiempo, meta: s.conociendo.meta, puntos: s.conociendo.puntos }); 
            } 
        } else if(s.conociendo.estado === 'activo') { 
            if (s.conociendo.tiempo > 3) { 
                s.conociendo.tiempo--; 
                io.to(user).emit('conociendoTick', s.conociendo.tiempo); 
            } else if (s.conociendo.tiempo > 0) { 
                subTickConociendo++; 
                if(subTickConociendo >= 2) { 
                    s.conociendo.tiempo--; 
                    subTickConociendo = 0; 
                } 
                io.to(user).emit('conociendoTick', s.conociendo.tiempo); 
            } else { 
                io.to(user).emit('conociendoTick', 0); 
                snipeConociendo--; 
                if(snipeConociendo <= 0) { 
                    if (s.conociendo.puntos >= s.conociendo.meta) { 
                        s.conociendo.tiempo = 300; 
                        s.conociendo.puntos = 0; 
                        io.to(user).emit('conociendoInicio', { chica: s.conociendo.chicaActual, tiempo: s.conociendo.tiempo, meta: s.conociendo.meta, puntos: s.conociendo.puntos }); 
                    } else { 
                        saltarConociendo(user); 
                    } 
                    snipeConociendo = 3; 
                    subTickConociendo = 0; 
                } 
            }
        } 
    }, 1000); 
    res.send("OK"); 
});

app.all('/conociendo/stop', requireSession, (req, res) => { 
    const s = req.userSession;
    s.conociendo.activo = false; 
    s.conociendo.estado = 'inactivo'; 
    clearInterval(s.intervaloConociendo); 
    io.to(req.username).emit('conociendoCancelado'); 
    res.send("OK"); 
});

app.all('/conociendo/skip', requireSession, (req, res) => { 
    const s = req.userSession;
    let target = req.query.c; 
    if(s.conociendo.activo) saltarConociendo(req.username, target); 
    res.send("OK"); 
});

app.all('/batalla/start', requireSession, (req, res) => { 
    const s = req.userSession;
    const user = req.username;
    s.tiempoBatalla = (parseInt(req.query.m) || 3) * 60; 
    s.participantesActuales = req.query.p ? req.query.p.split(',') : [...s.QUEENS]; 
    s.puntosBatalla = {}; 
    s.participantesActuales.forEach(p => s.puntosBatalla[p] = 0); 
    s.estadoBatalla = 'activa'; 
    clearInterval(s.timerBatalla); 
    let subTickBatalla = 0; 
    let tiempoExtraSnipe = 5; 
    const victorias = s.db.getVictorias();
    
    io.to(user).emit('batallaInicio', { tiempo: s.tiempoBatalla, puntos: s.puntosBatalla, victorias, equipos: s.equipos, participantes: s.participantesActuales }); 
    
    s.timerBatalla = setInterval(() => { 
        if (s.tiempoBatalla > 3) { 
            s.tiempoBatalla--; 
            io.to(user).emit('batallaTick', s.tiempoBatalla); 
        } else if (s.tiempoBatalla > 0) { 
            subTickBatalla++; 
            if (subTickBatalla >= 2) { 
                s.tiempoBatalla--; 
                subTickBatalla = 0; 
            } 
            io.to(user).emit('batallaTick', s.tiempoBatalla); 
        } else { 
            io.to(user).emit('batallaTick', 0); 
            tiempoExtraSnipe--; 
            if (tiempoExtraSnipe <= 0) { 
                clearInterval(s.timerBatalla); 
                s.estadoBatalla = 'finalizada'; 
                let maxPts = 0; 
                s.participantesActuales.forEach(p => { if (s.puntosBatalla[p] > maxPts) maxPts = s.puntosBatalla[p]; }); 
                let ganadoras = s.participantesActuales.filter(c => s.puntosBatalla[c] === maxPts); 
                let ganadora = (ganadoras.length === 1 && maxPts > 0) ? ganadoras[0] : (maxPts === 0 ? 'SIN PUNTOS' : 'EMPATE'); 
                
                if (ganadora !== 'EMPATE' && ganadora !== 'SIN PUNTOS') { 
                    s.db.sumarVictoria(ganadora);
                    s.participantesActuales.forEach(p => {
                        if (p !== ganadora) {
                            s.db.sumarDerrota(p);
                        }
                    });
                } else {
                    s.participantesActuales.forEach(p => {
                        s.db.sumarEmpate(p);
                    });
                } 
                
                const victoriasActuales = s.db.getVictorias();
                let reporteTarjetas = [];
                s.participantesActuales.forEach(chica => {
                    if (ganadoras.includes(chica) && maxPts > 0) { 
                        s.rachasPerdidas[chica] = 0; 
                    } else {
                        s.rachasPerdidas[chica]++; 
                        if (s.rachasPerdidas[chica] >= s.configFutbol.limiteAmarilla) { 
                            s.amarillasAcumuladas[chica]++; 
                            if (s.amarillasAcumuladas[chica] >= 2) { 
                                reporteTarjetas.push({ chica, equipo: s.equipos[chica]?.nombre || 'BAILARINA', tipo: 'ROJA' }); 
                                s.amarillasAcumuladas[chica] = 0; 
                            } else {
                                reporteTarjetas.push({ chica, equipo: s.equipos[chica]?.nombre || 'BAILARINA', tipo: 'AMARILLA' }); 
                            }
                            s.rachasPerdidas[chica] = 0; 
                        }
                    }
                });
                
                const payloadFin = { ganadora, victorias: victoriasActuales, reporteTarjetas, participantes: s.participantesActuales };
                io.to(user).emit('batallaFin', payloadFin);
                setTimeout(() => io.to(user).emit('batallaFin', payloadFin), 300);
                setTimeout(() => io.to(user).emit('batallaFin', payloadFin), 600);
            } 
        } 
    }, 1000); 
    res.send("OK"); 
});

app.all('/batalla/stop', requireSession, (req, res) => { 
    const s = req.userSession;
    clearInterval(s.timerBatalla); 
    s.estadoBatalla = 'inactiva'; 
    io.to(req.username).emit('batallaCancelada'); 
    setTimeout(() => io.to(req.username).emit('batallaCancelada'), 300);
    setTimeout(() => io.to(req.username).emit('batallaCancelada'), 600);
    res.send("OK"); 
});

app.all('/batalla/reset-wins', requireSession, (req, res) => { 
    req.userSession.db.resetVictorias();
    res.send("OK"); 
});

app.all('/futbol/reglas', requireSession, (req, res) => { 
    const s = req.userSession;
    if(req.query.fa) {
        s.configFutbol.limiteAmarilla = parseInt(req.query.fa);
        s.db.setConfigVal('limiteAmarilla', s.configFutbol.limiteAmarilla);
    }
    res.send("OK"); 
});

// ── CRUD DINÁMICAS ──
app.get('/api/dinamicas', requireSession, (req, res) => res.json(req.userSession.db.getDinamicas()));

app.all('/api/dinamicas/crear', requireSession, (req, res) => {
    const s = req.userSession;
    const body = req.body || {};
    const data = {
        nombre: body.nombre,
        descripcion: body.descripcion || '',
        icono: body.icono || '⚔️',
        color: body.color || '#6366f1',
        participantes: body.participantes || 'todas',
        reglas: typeof body.reglas === 'object' ? body.reglas : {}
    };
    if (!data.nombre) return res.status(400).send('Falta nombre');
    s.db.crearDinamica(data);
    res.send('OK');
});

app.all('/api/dinamicas/editar', requireSession, (req, res) => {
    const s = req.userSession;
    const body = req.body || {};
    const id = parseInt(req.query.id || body.id);
    const data = {
        nombre: body.nombre,
        descripcion: body.descripcion || '',
        icono: body.icono || '⚔️',
        color: body.color || '#6366f1',
        participantes: body.participantes || 'todas',
        reglas: typeof body.reglas === 'object' ? body.reglas : {}
    };
    if (!id || !data.nombre) return res.status(400).send('Datos incompletos');
    s.db.editarDinamica(id, data);
    res.send('OK');
});

app.all('/api/dinamicas/eliminar', requireSession, (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    if (!id) return res.status(400).send('Falta id');
    req.userSession.db.eliminarDinamica(id);
    res.send('OK');
});

app.all('/api/dinamicas/duplicar', requireSession, (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    if (!id) return res.status(400).send('Falta id');
    req.userSession.db.duplicarDinamica(id);
    res.send('OK');
});

// ── CRUD REGALOS CUSTOM ──
app.get('/api/regalos-custom', requireSession, (req, res) => res.json(req.userSession.db.getRegalosCustom()));

function procesarImagenBase64(base64Str) {
    if (!base64Str || !base64Str.startsWith('data:image')) return base64Str;
    try {
        const matches = base64Str.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches.length !== 3) return base64Str;
        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `custom_${crypto.randomUUID()}.${ext}`;
        const filepath = path.join(__dirname, 'public', 'regalos', filename);
        if (!fs.existsSync(path.join(__dirname, 'public', 'regalos'))) {
            fs.mkdirSync(path.join(__dirname, 'public', 'regalos'), { recursive: true });
        }
        fs.writeFileSync(filepath, buffer);
        return `/regalos/${filename}`;
    } catch (e) {
        console.error('Error procesando imagen base64:', e);
        return base64Str;
    }
}

app.all('/api/regalos-custom/crear', requireSession, (req, res) => {
    const s = req.userSession;
    const data = req.body || {};
    if (!data.nombre) return res.status(400).send('Falta nombre');
    data.imagen = procesarImagenBase64(data.imagen);
    s.db.crearRegaloCustom(data);
    io.to(req.username).emit('regalosCustomActualizados', s.db.getRegalosCustom());
    res.send('OK');
});

app.all('/api/regalos-custom/editar', requireSession, (req, res) => {
    const s = req.userSession;
    const data = req.body || {};
    const id = parseInt(req.query.id || data.id);
    if (!id || !data.nombre) return res.status(400).send('Datos incompletos');
    data.imagen = procesarImagenBase64(data.imagen);
    s.db.editarRegaloCustom(id, data);
    io.to(req.username).emit('regalosCustomActualizados', s.db.getRegalosCustom());
    res.send('OK');
});

app.all('/api/regalos-custom/eliminar', requireSession, (req, res) => {
    const s = req.userSession;
    const id = parseInt(req.query.id || (req.body && req.body.id));
    if (!id) return res.status(400).send('Falta id');
    s.db.eliminarRegaloCustom(id);
    io.to(req.username).emit('regalosCustomActualizados', s.db.getRegalosCustom());
    res.send('OK');
});

// ── API ANALYTICS ──
app.get('/api/analytics/resumen', requireSession, (req, res) => {
    try {
        res.json(req.userSession.db.getResumenAnalytics());
    } catch(e) {
        res.status(500).send(e.message);
    }
});

app.get('/api/analytics/historial', requireSession, (req, res) => {
    try {
        const limite = parseInt(req.query.limite) || 50;
        res.json(req.userSession.db.getHistorialRegalos(limite));
    } catch(e) {
        res.status(500).send(e.message);
    }
});

app.get('/api/analytics/top-gifters', requireSession, (req, res) => {
    try {
        const limite = parseInt(req.query.limite) || 5;
        res.json(req.userSession.db.getTopGifters(limite));
    } catch(e) {
        res.status(500).send(e.message);
    }
});

app.get('/api/analytics/grafica', requireSession, (req, res) => {
    try {
        res.json(req.userSession.db.getRegalosPorDia());
    } catch(e) {
        res.status(500).send(e.message);
    }
});

// ── RUNTIME DINÁMICAS ──
app.all('/dinamica/start/:id', requireSession, (req, res) => {
    const s = req.userSession;
    const user = req.username;
    const config = s.db.getDinamica(parseInt(req.params.id));
    if (!config) return res.status(404).send('Dinámica no encontrada');
    const participantes = resolverParticipantesDinamica(s, config.participantes);
    if (participantes.length < 2) return res.status(400).send('Se necesitan al menos 2 participantes activos');
    const reglas = config.reglas || {};
    clearInterval(s.timerDinamica);
    s.dinamicaActiva = { ...config, participantes };
    s.tiempoDinamica = (parseInt(reglas.duracion) || 3) * 60;
    s.puntosDinamica = {};
    s.rachasDinamica = {};
    s.amarillasDinamica = {};
    s.eliminadosDinamica = [];
    participantes.forEach(p => { s.puntosDinamica[p] = 0; s.rachasDinamica[p] = 0; s.amarillasDinamica[p] = 0; });
    const payload = { config: s.dinamicaActiva, participantes, puntos: s.puntosDinamica, tiempo: s.tiempoDinamica };
    io.to(user).emit('dinamicaInicio', payload);
    
    s.timerDinamica = setInterval(() => {
        if (s.tiempoDinamica > 0) {
            s.tiempoDinamica--;
            io.to(user).emit('dinamicaTick', s.tiempoDinamica);
        } else {
            clearInterval(s.timerDinamica);
            finalizarDinamica(user);
        }
    }, 1000);
    res.send('OK');
});

app.all('/dinamica/stop', requireSession, (req, res) => {
    const s = req.userSession;
    clearInterval(s.timerDinamica);
    s.dinamicaActiva = null;
    io.to(req.username).emit('dinamicaCancelada');
    res.send('OK');
});

app.all('/dinamica/eliminar', requireSession, (req, res) => {
    const s = req.userSession;
    const user = req.username;
    const q = req.query.q || (req.body && req.body.q);
    if (!q || !s.dinamicaActiva) return res.status(400).send('Sin dinámica activa o falta nombre');
    if (!s.eliminadosDinamica.includes(q)) s.eliminadosDinamica.push(q);
    io.to(user).emit('dinamicaPuntos', { puntos: s.puntosDinamica, eliminados: s.eliminadosDinamica });
    const activos = s.dinamicaActiva.participantes.filter(p => !s.eliminadosDinamica.includes(p));
    if (activos.length <= 1) { clearInterval(s.timerDinamica); finalizarDinamica(user); }
    res.send('OK');
});

app.all('/futbol/reset-tarjetas', requireSession, (req, res) => { 
    const s = req.userSession;
    s.QUEENS.forEach(q => { s.rachasPerdidas[q] = 0; s.amarillasAcumuladas[q] = 0; });
    io.to(req.username).emit('resetTarjetas'); res.send("OK");
});

app.all('/reset-semanal', requireSession, (req, res) => { 
    req.userSession.db.resetSemanal();
    io.to(req.username).emit('resetRanking'); res.send("OK"); 
});

app.all('/reset-diario', requireSession, (req, res) => { 
    req.userSession.db.resetDiario();
    io.to(req.username).emit('resetDiario'); res.send("OK"); 
});

app.all('/reset-mensual', requireSession, (req, res) => { 
    req.userSession.db.resetMensual();
    io.to(req.username).emit('resetMensual'); res.send("OK"); 
});

app.all('/copa/reset', requireSession, (req, res) => { 
    const s = req.userSession;
    s.db.resetCopa();
    io.to(req.username).emit('actualizarCopa', s.db.getCopa()); 
    res.send("OK"); 
});

app.all('/reset-total', requireSession, (req, res) => {
    const s = req.userSession;
    const user = req.username;
    s.db.resetSemanal();
    s.db.resetMensual();
    s.db.resetDiario();
    s.db.resetCopa();
    s.db.resetVictorias();
    s.QUEENS.forEach(q => { s.rachasPerdidas[q] = 0; s.amarillasAcumuladas[q] = 0; });
    io.to(user).emit('resetRanking');
    io.to(user).emit('resetMensual');
    io.to(user).emit('resetDiario');
    io.to(user).emit('actualizarCopa', s.db.getCopa());
    res.send("OK");
});

// Compatibilidad: /datos.json para overlays viejos que lo pidan
app.get('/datos.json', requireSession, (req, res) => {
    const s = req.userSession;
    res.json({ ranking: s.db.getRanking(), victorias: s.db.getVictorias(), copa: s.db.getCopa() });
});

// Endpoint para apagar el servidor al finalizar la jornada del día
app.all('/api/sistema/shutdown', requireSession, (req, res) => {
    const user = req.username;
    console.log(`🛑 Petición de apagado del servidor por parte del usuario '${user}'...`);
    io.to(user).emit('servidorApagado');
    res.json({ status: 'OK', message: 'Servidor apagado correctamente. Todas las bases de datos guardadas.' });
    setTimeout(() => {
        cleanupAllSessions();
        process.exit(0);
    }, 500);
});

process.on('uncaughtException', (err) => { 
    console.error('🚨 ESCUDO ACTIVADO:', err.message);
    if (err.code === 'EADDRINUSE' || (err.message && err.message.includes('EADDRINUSE'))) {
        console.error('⚠️ Proceso duplicado detectado en puerto 3000. Cerrando esta instancia para evitar duplicación de puntos.');
        process.exit(0);
    }
});
process.on('unhandledRejection', (reason) => { console.error('🚨 ESCUDO ACTIVADO:', reason); });

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error('⚠️ ATENCIÓN: El servidor de Urban Queens ya está ejecutándose en segundo plano (Puerto 3000 ocupado).');
        console.error('⚠️ Se ha cerrado este proceso duplicado para evitar que los regalos de TikTok se cuenten doble.');
        process.exit(0);
    } else {
        console.error('❌ Error en el servidor HTTP:', err);
        process.exit(1);
    }
});

function cleanupAllSessions() {
    console.log('🧹 Cerrando bases de datos de todas las sesiones...');
    Object.keys(activeSessions).forEach(username => {
        const session = activeSessions[username];
        if (session) {
            clearInterval(session.batchInterval);
            if (session.tiktokConnection) {
                try { session.tiktokConnection.disconnect(); } catch(e) {}
            }
            if (session.db) {
                session.db.close();
            }
        }
    });
}

process.on('SIGINT', () => { cleanupAllSessions(); process.exit(0); });
process.on('SIGTERM', () => { cleanupAllSessions(); process.exit(0); });

// --- ARRANQUE ASYNC: Inicializar DB y luego levantar servidor ---
(async () => {
    try {
        const SQLInstance = await initSQL();
        await MasterDB.initMasterDB(SQLInstance);
        
        server.listen(3000, '0.0.0.0', () => console.log('🚀 TikDance v2.0 con SQLite activo en puerto 3000'));
    } catch (err) {
        console.error('❌ Error iniciando el servidor:', err);
        process.exit(1);
    }
})();