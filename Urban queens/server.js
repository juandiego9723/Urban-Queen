const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const DB = require('./db');
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

const server = http.createServer(app);
const io = new Server(server);

let QUEENS = []; // cargado dinámicamente desde DB
let equipos = {}; // { name: { nombre, color } } — construido desde DB

function reconstruirEquipos() {
    equipos = {};
    DB.getAllQueensFull().forEach(q => {
        if (q.activo) {
            const display = (q.apodo && q.apodo.trim()) ? q.apodo.trim() : q.name;
            equipos[q.name] = { nombre: display.toUpperCase(), color: q.color, regalo_img: q.regalo_img || '' };
        }
    });
}

function reconstruirQueens() {
    QUEENS = DB.getActiveQueenNames();
    reconstruirEquipos();
}

// 🛡️ SISTEMA DE JUSTICIA (en memoria, no persistente)
let rachasPerdidas = {};
let amarillasAcumuladas = {};
let configFutbol = { limiteAmarilla: 3 };

let estadoBatalla = 'inactiva'; 
let tiempoBatalla = 0; 
let puntosBatalla = { Amy: 0, Ray: 0, Nucita: 0, Venus: 0 }; 
let participantesActuales = [...QUEENS]; 
let timerBatalla;

let timerBaile = { activo: false, tiempo: 0, chicaActual: 'Ray', orden: [...QUEENS], estado: 'inactivo', tiempoTransicion: 0 }; 
let intervaloTimerBaile;
let tiempoAcumulado = { Amy: 0, Ray: 0, Nucita: 0, Venus: 0 };

let conociendo = { activo: false, tiempo: 0, chicaActual: 'Ray', orden: [...QUEENS], estado: 'inactivo', tiempoTransicion: 0, meta: 2000, puntos: 0 }; 
let intervaloConociendo;

let lealtadUsuarios = {};

// ── TIKTOK LIVE ──
let tiktokConnection = null;
let tiktokEstado = 'desconectado';
let tiktokUsuario = '';
let tiktokMensajeError = '';
let regalosDetectados = new Set();
let catalogoRegalos = [];

// Regalos más comunes de TikTok (respaldo cuando no estás en vivo usando las imágenes locales si existen)
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


 // { id, name, diamondCount, imageUrl }



// ── DINÁMICAS PERSONALIZADAS ──
let dinamicaActiva = null;
let timerDinamica = null;
let tiempoDinamica = 0;
let puntosDinamica = {};
let rachasDinamica = {};
let amarillasDinamica = {};
let eliminadosDinamica = []; 

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- RUTAS DE PANTALLAS ---
const pub = (f) => path.join(__dirname, 'public', f);
app.get('/',              (req, res) => res.sendFile(pub('ranking.html')));
app.get('/batalla',       (req, res) => res.sendFile(pub('batalla.html')));
app.get('/batalla-futbol',(req, res) => res.sendFile(pub('batalla-futbol.html')));
app.get('/timer',         (req, res) => res.sendFile(pub('timer.html')));
app.get('/conociendo',    (req, res) => res.sendFile(pub('conociendo.html')));
app.get('/copa',          (req, res) => res.sendFile(pub('copa.html')));
app.get('/lista-regalos', (req, res) => res.sendFile(pub('lista-regalos.html')));
app.get('/control',       (req, res) => res.sendFile(pub('control.html')));
app.get('/dinamica',      (req, res) => res.sendFile(pub('dinamica.html')));
app.get('/gestor-regalos',(req, res) => res.sendFile(pub('gestor-regalos.html')));

// --- APIs DE DATOS ---
app.get('/api/queens', (req, res) => res.json(QUEENS));
app.get('/api/queens/all', (req, res) => res.json(DB.getAllQueensFull()));
app.get('/api/apodos', (req, res) => res.json(DB.getApodosMap()));

// --- CRUD QUEENS ---
app.all('/api/queens/crear', (req, res) => {
    const nombre = (req.query.nombre || (req.body && req.body.nombre) || '').trim();
    const color = req.query.color || (req.body && req.body.color) || '#ffffff';
    if (!nombre) return res.status(400).send('Falta nombre');
    DB.crearQueen(nombre, color);
    reconstruirQueens();
    QUEENS.forEach(q => { if (!rachasPerdidas[q]) rachasPerdidas[q] = 0; if (!amarillasAcumuladas[q]) amarillasAcumuladas[q] = 0; });
    io.emit('queensActualizadas', { queens: QUEENS, equipos, apodos: DB.getApodosMap() });
    res.send('OK');
});

app.all('/api/queens/editar', (req, res) => {
    const p      = (k) => req.query[k] !== undefined ? req.query[k] : (req.body && req.body[k] !== undefined ? req.body[k] : null);
    const nombre = p('nombre');
    const color  = p('color');
    const apodo  = p('apodo');
    const regImg = p('regalo_img');
    const regPts = p('regalo_pts') !== null ? parseInt(p('regalo_pts')) : null;
    if (!nombre || !color) return res.status(400).send('Faltan datos');
    DB.editarQueen(nombre, color, apodo, regImg, regPts);
    reconstruirEquipos();
    io.emit('queensActualizadas', { queens: QUEENS, equipos, apodos: DB.getApodosMap() });
    res.send('OK');
});

app.all('/api/queens/renombrar', (req, res) => {
    const nombre = (req.query.nombre || (req.body && req.body.nombre) || '').trim();
    const nuevo  = (req.query.nuevo  || (req.body && req.body.nuevo)  || '').trim();
    if (!nombre || !nuevo) return res.status(400).send('Faltan datos');
    if (nombre === nuevo) return res.send('OK');
    DB.renombrarQueen(nombre, nuevo);
    reconstruirQueens();
    io.emit('queensActualizadas', { queens: QUEENS, equipos, apodos: DB.getApodosMap() });
    res.send('OK');
});

app.all('/api/queens/eliminar', (req, res) => {
    const nombre = (req.query.nombre || (req.body && req.body.nombre) || '').trim();
    if (!nombre) return res.status(400).send('Falta nombre');
    DB.eliminarQueen(nombre);
    reconstruirQueens();
    io.emit('queensActualizadas', { queens: QUEENS, equipos, apodos: DB.getApodosMap() });
    res.send('OK');
});

app.all('/api/queens/toggle', (req, res) => {
    const nombre = req.query.nombre || (req.body && req.body.nombre);
    if (!nombre) return res.status(400).send('Falta nombre');
    const nuevoEstado = DB.toggleQueenActivo(nombre);
    reconstruirQueens();
    io.emit('queensActualizadas', { queens: QUEENS, equipos, apodos: DB.getApodosMap() });
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

app.get('/api/ranking', (req, res) => res.json(DB.getRanking()));
app.get('/api/ranking-mensual', (req, res) => res.json(DB.getRankingMensual()));
app.get('/api/ranking-diario', (req, res) => res.json(DB.getRankingDiario()));
app.get('/api/copa', (req, res) => res.json({ copa: DB.getCopa(), equipos }));

// --- API FUTBOL CONFIG ---
app.get('/api/futbol/config', (req, res) => {
    res.json(DB.getFutbolConfig());
});

app.post('/api/futbol/config', express.json(), (req, res) => {
    const config = req.body;
    if(!config || !config.equipo1 || !config.equipo2) return res.status(400).send('Invalid config');
    DB.setFutbolConfig(config);
    io.emit('futbolConfigActualizada', config);
    res.send('OK');
});

app.get('/api/victorias', (req, res) => res.json(DB.getVictorias()));

// --- APIs ALIASES ---
app.get('/api/aliases', (req, res) => res.json(DB.getAliases()));
app.all('/api/aliases/add', (req, res) => {
    const alias = req.query.alias || (req.body && req.body.alias);
    const queen = req.query.queen || (req.body && req.body.queen);
    if (alias && queen && QUEENS.includes(queen)) {
        DB.agregarAlias(alias, queen);
        return res.send("OK");
    }
    res.status(400).send("Error");
});
app.all('/api/aliases/delete', (req, res) => {
    const alias = req.query.alias || (req.body && req.body.alias);
    if (alias) { DB.eliminarAlias(alias); return res.send("OK"); }
    res.status(400).send("Error");
});

// --- APIs GRUPOS ---
app.get('/api/grupos', (req, res) => res.json(DB.getGrupos()));
app.all('/api/grupos/crear', (req, res) => {
    const nombre = req.query.nombre || (req.body && req.body.nombre);
    const color = req.query.color || (req.body && req.body.color) || '#39FF14';
    if (nombre) {
        try { DB.crearGrupo(nombre, color); return res.send("OK"); }
        catch(e) { return res.status(400).send("Grupo ya existe"); }
    }
    res.status(400).send("Error");
});
app.all('/api/grupos/eliminar', (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    if (id) { DB.eliminarGrupo(id); return res.send("OK"); }
    res.status(400).send("Error");
});
app.all('/api/grupos/agregar-miembro', (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    const queen = req.query.queen || (req.body && req.body.queen);
    if (id && queen) { DB.agregarMiembro(id, queen); return res.send("OK"); }
    res.status(400).send("Error");
});
app.all('/api/grupos/remover-miembro', (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    const queen = req.query.queen || (req.body && req.body.queen);
    if (id && queen) { DB.removerMiembro(id, queen); return res.send("OK"); }
    res.status(400).send("Error");
});

// --- APIs SONIDOS ---
app.get('/api/sonidos', (req, res) => res.json(DB.getSonidos()));
app.all('/api/sonidos/set', (req, res) => {
    const evento = req.query.evento || (req.body && req.body.evento);
    const url = req.query.url || (req.body && req.body.url);
    if (evento && url) { DB.setSonido(evento, url); return res.send("OK"); }
    res.status(400).send("Error");
});

function resolverParticipantesDinamica(participantes) {
    if (!participantes || participantes === 'todas') return [...QUEENS];
    if (participantes.startsWith('grupo:')) {
        const grupoId = parseInt(participantes.split(':')[1]);
        const grupo = DB.getGrupos().find(g => g.id === grupoId);
        return grupo ? grupo.miembros.filter(m => QUEENS.includes(m)) : [...QUEENS];
    }
    if (participantes.startsWith('manual:')) {
        return participantes.split(':')[1].split(',').map(n => n.trim()).filter(n => QUEENS.includes(n));
    }
    return [...QUEENS];
}

function finalizarDinamica() {
    if (!dinamicaActiva) return;
    const activos = dinamicaActiva.participantes.filter(p => !eliminadosDinamica.includes(p));
    let maxPts = 0;
    activos.forEach(p => { if ((puntosDinamica[p] || 0) > maxPts) maxPts = puntosDinamica[p] || 0; });
    const ganadoras = activos.filter(p => (puntosDinamica[p] || 0) === maxPts);
    const ganadora = ganadoras.length === 1 && maxPts > 0 ? ganadoras[0] : maxPts === 0 ? 'SIN PUNTOS' : 'EMPATE';
    const payload = { ganadora, puntos: puntosDinamica, eliminados: eliminadosDinamica };
    io.emit('dinamicaFin', payload);
    setTimeout(() => io.emit('dinamicaFin', payload), 300);
    dinamicaActiva = null;
}

// --- FUNCIÓN: Resolver nombre (busca alias si no es queen directa) ---
function resolverNombre(nombre) {
    if (!nombre) return null;
    if (QUEENS.includes(nombre)) return nombre;
    const queenDeAlias = DB.resolverAlias(nombre);
    return queenDeAlias || null;
}

// --- SISTEMA DE BATCHING PARA PUNTOS ---
let queueUpdate = [];

function procesarPuntosEnLote() {
    if (queueUpdate.length === 0) return;
    
    let rankingDirty = false;
    let nombresCambiados = new Set();
    
    let tareas = [...queueUpdate];
    queueUpdate = [];
    
    for (let t of tareas) {
        let nombre = t.nombre;
        let puntos = t.puntos;
        
        if (nombre && QUEENS.includes(nombre)) {
            DB.sumarPuntos(nombre, puntos);
            rankingDirty = true;
            nombresCambiados.add(nombre);
        }
        
        if (nombre && estadoBatalla === 'activa' && participantesActuales.includes(nombre)) {
            puntosBatalla[nombre] = Math.max(0, (puntosBatalla[nombre] || 0) + puntos);
        }
        
        if (timerBaile.activo) {
            if (t.saltaTurno && QUEENS.includes(t.saltaTurno) && t.saltaTurno !== timerBaile.chicaActual) {
                saltarSiguienteChica(t.saltaTurno);
            } else if (puntos > 0) { 
                timerBaile.tiempo += (puntos * 3); 
            }
        }
        
        if (conociendo.activo) {
            conociendo.puntos = Math.max(0, conociendo.puntos + puntos);
        }

        if (dinamicaActiva && nombre && dinamicaActiva.participantes.includes(nombre) && !eliminadosDinamica.includes(nombre)) {
            puntosDinamica[nombre] = Math.max(0, (puntosDinamica[nombre] || 0) + puntos);
            if (dinamicaActiva.reglas.modo === 'meta') {
                const meta = parseInt(dinamicaActiva.reglas.meta) || 500;
                if (puntosDinamica[nombre] >= meta) { clearInterval(timerDinamica); finalizarDinamica(); }
            }
        }
    }
    
    // Emisiones agrupadas (Batched Emits)
    if (rankingDirty) {
        const ranking = DB.getRanking();
        const rankingMensual = DB.getRankingMensual();
        const rankingDiario = DB.getRankingDiario();
        nombresCambiados.forEach(nombre => {
            io.emit('actualizarRanking', { nombre, puntosSemanal: ranking[nombre], puntosMensual: rankingMensual[nombre], puntosDiario: rankingDiario[nombre] });
        });
        io.emit('actualizarCopa', DB.getCopa()); 
    }
    
    if (estadoBatalla === 'activa') {
        io.emit('batallaPuntos', puntosBatalla);
    }
    
    if (timerBaile.activo && timerBaile.estado === 'bailando') {
        io.emit('timerTick', timerBaile.tiempo);
    }
    
    if (conociendo.activo && conociendo.estado === 'activo') {
        io.emit('conociendoPuntos', { puntos: conociendo.puntos, meta: conociendo.meta });
    }
    
    if (dinamicaActiva) {
        io.emit('dinamicaPuntos', { puntos: puntosDinamica, eliminados: eliminadosDinamica });
    }
}

// Ejecutar el lote de actualizaciones cada 300ms
setInterval(procesarPuntosEnLote, 300);

app.all('/update', (req, res) => {
    let nombre = req.query.nombre || (req.body && req.body.nombre);
    const puntos = parseInt(req.query.puntos || (req.body && req.body.puntos));
    const viewer = req.query.viewer || (req.body && req.body.viewer);
    const avatar = req.query.avatar || (req.body && req.body.avatar) || '';
    
    nombre = resolverNombre(nombre);
    
    if (nombre && !isNaN(puntos)) {
        if (viewer && puntos > 0) lealtadUsuarios[viewer] = nombre;
        if (puntos !== 0) queueUpdate.push({ nombre, puntos });
        // Emitir inmediatamente para el feed de espectadores en batalla
        if (viewer && puntos > 0 && nombre) {
            const eq = equipos[nombre] || {};
            io.emit('nuevoRegalo', {
                nombre,
                viewer,
                avatar,
                giftImg: eq.regalo_img || '',
                queenColor: eq.color || '#fff',
                coins: puntos,
                giftName: ''
            });
        }
        return res.send("OK");
    }
    res.status(400).send("Error");
});

app.all('/update-auto', (req, res) => {
    const viewer = req.query.viewer || (req.body && req.body.viewer);
    const avatar = req.query.avatar || (req.body && req.body.avatar) || '';
    const puntos = parseInt(req.query.puntos || (req.body && req.body.puntos));
    if (!isNaN(puntos) && puntos > 0) {
        let queenAsignada = (viewer && lealtadUsuarios[viewer]) ? lealtadUsuarios[viewer] : null;
        if (queenAsignada) {
            queueUpdate.push({ nombre: queenAsignada, puntos });
            const eq = equipos[queenAsignada] || {};
            if (viewer) io.emit('nuevoRegalo', { nombre: queenAsignada, viewer, avatar, giftImg: eq.regalo_img || '', queenColor: eq.color || '#fff', coins: puntos, giftName: '' });
            return res.send("Asignado a " + queenAsignada);
        } else {
            queueUpdate.push({ nombre: null, puntos });
            return res.send("Sumado Global");
        }
    }
    res.status(400).send("Ignorado");
});

// ── TIKTOK LIVE: Lógica de Conexión ──
function procesarRegaloTikTok(data) {
    try {
        const viewer   = data.uniqueId || 'anon';
        const avatar   = data.profilePictureUrl || '';
        const giftName = (data.giftName || '').trim();
        
        // Multiplicar por el repeatCount para que los streaks (combos) sumen el total correcto
        const baseDiamond = data.diamondCount || 1;
        const repeat = data.repeatCount || 1;
        const coins = baseDiamond * repeat;
        const giftImgSrc = data.giftPictureUrl || '';

        // Auto-detectar el regalo y notificar al panel
        if (giftName && !regalosDetectados.has(giftName)) {
            regalosDetectados.add(giftName);
            io.emit('regaloDetectado', giftName);
        }

        const mapaRaw = DB.getConfigVal('tiktok_regalo_mapa');
        const mapa = mapaRaw ? JSON.parse(mapaRaw) : {};
        let queenActivadora = mapa[giftName] || null;

        const timerMapaRaw = DB.getConfigVal('tiktok_timer_mapa');
        const timerMapa = timerMapaRaw ? JSON.parse(timerMapaRaw) : {};
        let queenSalto = timerMapa[giftName] || null;

        if (queenActivadora && QUEENS.includes(queenActivadora)) {
            lealtadUsuarios[viewer] = queenActivadora;
            const eq = equipos[queenActivadora] || {};
            // Si tiene puntos configurados, multiplicarlo por la racha. Si no, usar los coins totales.
            const pts = eq.regalo_pts ? (eq.regalo_pts * repeat) : coins;
            // Quitamos esActivador de acá porque ahora el salto se maneja por queenSalto independiente
            queueUpdate.push({ nombre: queenActivadora, puntos: pts, saltaTurno: queenSalto });
            io.emit('nuevoRegalo', { nombre: queenActivadora, viewer, avatar, giftImg: eq.regalo_img || giftImgSrc, queenColor: eq.color || '#fff', coins, giftName });
        } else {
            const queenAsignada = lealtadUsuarios[viewer] || null;
            if (queenAsignada && QUEENS.includes(queenAsignada)) {
                queueUpdate.push({ nombre: queenAsignada, puntos: coins, saltaTurno: queenSalto });
                const eq = equipos[queenAsignada] || {};
                io.emit('nuevoRegalo', { nombre: queenAsignada, viewer, avatar, giftImg: giftImgSrc, queenColor: eq.color || '#fff', coins, giftName });
            } else if (queenSalto && QUEENS.includes(queenSalto)) {
                // Si mandan un regalo de salto PERO no tienen lealtad asignada aún,
                // enviamos los puntos directo a la queenSalto para no perderlos, y ejecutamos el salto.
                queueUpdate.push({ nombre: queenSalto, puntos: coins, saltaTurno: queenSalto });
                const eq = equipos[queenSalto] || {};
                io.emit('nuevoRegalo', { nombre: queenSalto, viewer, avatar, giftImg: giftImgSrc, queenColor: eq.color || '#fff', coins, giftName });
            }
        }
    } catch(e) {
        console.error('❌ Error procesando regalo TikTok:', e.message);
    }
}

function conectarTikTok(usuario) {
    if (tiktokEstado === 'conectando') {
        console.log('⚠️ Ya hay un intento de conexión en progreso, ignorando nuevo intento.');
        return;
    }

    if (tiktokConnection) {
        try { tiktokConnection.disconnect(); } catch(e) {}
        tiktokConnection = null;
    }

    tiktokUsuario = usuario;
    tiktokEstado = 'conectando';
    tiktokMensajeError = '';
    io.emit('tiktokEstado', { estado: tiktokEstado, usuario: tiktokUsuario });
    console.log(`🔗 Conectando a TikTok Live: @${usuario}`);

    tiktokConnection = new WebcastPushConnection(usuario, {
        processInitialData: false,
        enableExtendedGiftInfo: true
    });

    tiktokConnection.connect().then(async () => {
        tiktokEstado = 'conectado';
        console.log(`✅ Conectado a TikTok Live: @${usuario}`);
        DB.setConfigVal('tiktok_usuario', usuario);
        io.emit('tiktokEstado', { estado: tiktokEstado, usuario: tiktokUsuario });
        // Cargar catálogo de regalos disponibles
        try {
            const gifts = await tiktokConnection.fetchAvailableGifts();
            if (gifts && gifts.length > 0) {
                catalogoRegalos = gifts.map(g => ({
                    id: g.id,
                    name: g.name,
                    diamondCount: g.diamond_count || g.diamondCount || 0,
                    imageUrl: g.image?.url_list?.[0] || g.image?.url || ''
                })).sort((a,b) => a.name.localeCompare(b.name));
                console.log(`🎁 Catálogo de regalos cargado: ${catalogoRegalos.length} regalos`);
                io.emit('catalogoCargado', catalogoRegalos.length);
            }
        } catch(e) {
            console.warn('⚠️ No se pudo cargar el catálogo de regalos:', e.message);
        }
    }).catch(err => {
        tiktokEstado = 'error';
        tiktokMensajeError = err.message || 'Error desconocido';
        console.error(`❌ Error conectando a TikTok: ${tiktokMensajeError}`);
        io.emit('tiktokEstado', { estado: tiktokEstado, usuario: tiktokUsuario, error: tiktokMensajeError });
    });


    // Evento de regalo (gifType=1 son los que se pueden hacer streak)
    tiktokConnection.on('gift', (data) => {
        // Para regalos streak, solo contar cuando termina el combo (repeatEnd)
        if (data.giftType === 1 && !data.repeatEnd) return;
        procesarRegaloTikTok(data);
    });

    tiktokConnection.on('disconnected', () => {
        tiktokEstado = 'desconectado';
        console.log('⚠️ TikTok Live desconectado');
        io.emit('tiktokEstado', { estado: tiktokEstado, usuario: tiktokUsuario });
    });

    tiktokConnection.on('error', (err) => {
        tiktokMensajeError = err.message || 'Error';
        tiktokEstado = 'error';
        io.emit('tiktokEstado', { estado: tiktokEstado, usuario: tiktokUsuario, error: tiktokMensajeError });
    });
}

// ── ENDPOINTS TIKTOK ──
app.all('/tiktok/conectar', (req, res) => {
    const usuario = (req.query.usuario || (req.body && req.body.usuario) || '').replace('@', '').trim();
    if (!usuario) return res.status(400).send('Falta usuario de TikTok');
    conectarTikTok(usuario);
    res.send('Conectando...');
});

app.all('/tiktok/desconectar', (req, res) => {
    if (tiktokConnection) {
        try { tiktokConnection.disconnect(); } catch(e) {}
        tiktokConnection = null;
    }
    tiktokEstado = 'desconectado';
    tiktokUsuario = '';
    io.emit('tiktokEstado', { estado: tiktokEstado, usuario: '' });
    res.send('OK');
});

app.get('/api/tiktok/estado', (req, res) => {
    res.json({ estado: tiktokEstado, usuario: tiktokUsuario, error: tiktokMensajeError });
});

app.post('/api/tiktok/mapa', (req, res) => {
    const mapa = req.body.mapa || req.body;
    DB.setConfigVal('tiktok_regalo_mapa', JSON.stringify(mapa));
    io.emit('mapaRegalosCambiado', mapa);
    res.send('OK');
});

app.get('/api/tiktok/timer_mapa', (req, res) => {
    const v = DB.getConfigVal('tiktok_timer_mapa');
    res.json(v ? JSON.parse(v) : {});
});

app.post('/api/tiktok/timer_mapa', (req, res) => {
    const mapa = req.body.mapa || req.body;
    DB.setConfigVal('tiktok_timer_mapa', JSON.stringify(mapa));
    io.emit('mapaTimerCambiado', mapa);
    res.send('OK');
});

app.get('/api/tiktok/mapa', (req, res) => {
    const raw = DB.getConfigVal('tiktok_regalo_mapa');
    res.json(raw ? JSON.parse(raw) : {});
});

app.get('/api/tiktok/regalos-detectados', (req, res) => {
    res.json([...regalosDetectados].sort());
});

app.all('/api/tiktok/regalos-detectados/limpiar', (req, res) => {
    regalosDetectados.clear();
    res.send('OK');
});

app.get('/api/tiktok/catalogo', (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    
    let fuente = CATALOGO_RESPALDO;
    if (catalogoRegalos.length > 0) {
        // Combinar asegurando que los del respaldo (con nuestras imágenes y precios verificados) prevalezcan
        const nombresRespaldo = new Set(CATALOGO_RESPALDO.map(r => r.name.toLowerCase()));
        const extra = catalogoRegalos.filter(r => !nombresRespaldo.has(r.name.toLowerCase()));
        fuente = [...CATALOGO_RESPALDO, ...extra].sort((a,b) => a.name.localeCompare(b.name));
    }

    const lista = q
        ? fuente.filter(g => g.name.toLowerCase().includes(q))
        : fuente;
    
    res.json({ regalos: lista, esCatalogoCompleto: catalogoRegalos.length > 0 });
});

function saltarSiguienteChica(chicaEspecifica = null) { 
    if (timerBaile.orden.length === 0) timerBaile.orden = [...QUEENS];
    if (chicaEspecifica) timerBaile.chicaActual = chicaEspecifica; 
    else { let idx = timerBaile.orden.indexOf(timerBaile.chicaActual); timerBaile.chicaActual = timerBaile.orden[(idx + 1) % timerBaile.orden.length]; } 
    timerBaile.estado = 'transicion'; 
    timerBaile.tiempoTransicion = 5; 
    timerBaile.tiempo = 0; 
    io.emit('timerTransicion', { chica: timerBaile.chicaActual, tiempo: timerBaile.tiempoTransicion }); 
}

app.all('/timer/start', (req, res) => { 
    const tiempoBase = parseInt(req.query.t) || 30;
    timerBaile.orden = [...QUEENS];
    timerBaile.activo = true; timerBaile.tiempo = tiempoBase; timerBaile.chicaActual = QUEENS[0] || 'Ray'; timerBaile.estado = 'bailando'; 
    tiempoAcumulado = {}; QUEENS.forEach(q => tiempoAcumulado[q] = 0);
    let subTickBaile = 0; let snipeBaile = 3; clearInterval(intervaloTimerBaile); 
    io.emit('timerInicio', { chica: timerBaile.chicaActual, tiempo: timerBaile.tiempo }); 
    intervaloTimerBaile = setInterval(() => { 
        if (timerBaile.estado === 'transicion') { 
            timerBaile.tiempoTransicion--; io.emit('timerTransicionTick', timerBaile.tiempoTransicion); 
            if (timerBaile.tiempoTransicion <= 0) { 
                timerBaile.estado = 'bailando'; 
                timerBaile.tiempo += tiempoBase; 
                snipeBaile = 3; subTickBaile = 0; 
                io.emit('timerInicio', { chica: timerBaile.chicaActual, tiempo: timerBaile.tiempo }); 
            } 
        } else if (timerBaile.estado === 'bailando') { 
            tiempoAcumulado[timerBaile.chicaActual] = (tiempoAcumulado[timerBaile.chicaActual] || 0) + 1;
            io.emit('timerAcumulado', tiempoAcumulado);
            if (timerBaile.tiempo > 3) { timerBaile.tiempo--; io.emit('timerTick', timerBaile.tiempo); } 
            else if (timerBaile.tiempo > 0) { subTickBaile++; if(subTickBaile >= 2) { timerBaile.tiempo--; subTickBaile = 0; } io.emit('timerTick', timerBaile.tiempo); } 
            else { io.emit('timerTick', 0); snipeBaile--; if(snipeBaile <= 0) { saltarSiguienteChica(); snipeBaile = 3; subTickBaile = 0; } }
        } 
    }, 1000); res.send("OK"); 
});

app.all('/timer/stop', (req, res) => { timerBaile.activo = false; timerBaile.estado = 'inactivo'; clearInterval(intervaloTimerBaile); io.emit('timerCancelado'); res.send("OK"); });
app.all('/timer/skip', (req, res) => { let target = req.query.c; if(timerBaile.activo && target) saltarSiguienteChica(target); res.send("OK"); });

function saltarConociendo(chicaEspecifica = null) { if (conociendo.orden.length === 0) conociendo.orden = [...QUEENS]; if (chicaEspecifica) conociendo.chicaActual = chicaEspecifica; else { let idx = conociendo.orden.indexOf(conociendo.chicaActual); conociendo.chicaActual = conociendo.orden[(idx + 1) % conociendo.orden.length]; } conociendo.estado = 'transicion'; conociendo.tiempoTransicion = 5; conociendo.puntos = 0; io.emit('conociendoTransicion', { chica: conociendo.chicaActual, tiempo: conociendo.tiempoTransicion }); }

app.all('/conociendo/start', (req, res) => { 
    conociendo.orden = [...QUEENS];
    conociendo.activo = true; conociendo.meta = parseInt(req.query.meta) || 2000; conociendo.tiempo = 300; conociendo.puntos = 0; conociendo.chicaActual = QUEENS[0] || 'Ray'; conociendo.estado = 'activo'; 
    let subTickConociendo = 0; let snipeConociendo = 3; clearInterval(intervaloConociendo); 
    io.emit('conociendoInicio', { chica: conociendo.chicaActual, tiempo: conociendo.tiempo, meta: conociendo.meta, puntos: conociendo.puntos }); 
    intervaloConociendo = setInterval(() => { 
        if(conociendo.estado === 'transicion') { 
            conociendo.tiempoTransicion--; io.emit('conociendoTransicionTick', conociendo.tiempoTransicion); 
            if(conociendo.tiempoTransicion <= 0) { conociendo.estado = 'activo'; conociendo.tiempo = 300; snipeConociendo = 3; subTickConociendo = 0; io.emit('conociendoInicio', { chica: conociendo.chicaActual, tiempo: conociendo.tiempo, meta: conociendo.meta, puntos: conociendo.puntos }); } 
        } else if(conociendo.estado === 'activo') { 
            if (conociendo.tiempo > 3) { conociendo.tiempo--; io.emit('conociendoTick', conociendo.tiempo); } 
            else if (conociendo.tiempo > 0) { subTickConociendo++; if(subTickConociendo >= 2) { conociendo.tiempo--; subTickConociendo = 0; } io.emit('conociendoTick', conociendo.tiempo); } 
            else { io.emit('conociendoTick', 0); snipeConociendo--; if(snipeConociendo <= 0) { 
                if (conociendo.puntos >= conociendo.meta) { conociendo.tiempo = 300; conociendo.puntos = 0; io.emit('conociendoInicio', { chica: conociendo.chicaActual, tiempo: conociendo.tiempo, meta: conociendo.meta, puntos: conociendo.puntos }); } else { saltarConociendo(); } 
                snipeConociendo = 3; subTickConociendo = 0; 
            } }
        } 
    }, 1000); res.send("OK"); 
});

app.all('/conociendo/stop', (req, res) => { conociendo.activo = false; conociendo.estado = 'inactivo'; clearInterval(intervaloConociendo); io.emit('conociendoCancelado'); res.send("OK"); });
app.all('/conociendo/skip', (req, res) => { let target = req.query.c; if(conociendo.activo) saltarConociendo(target); res.send("OK"); });

app.all('/batalla/start', (req, res) => { 
    tiempoBatalla = (parseInt(req.query.m) || 3) * 60; participantesActuales = req.query.p ? req.query.p.split(',') : [...QUEENS]; 
    puntosBatalla = {}; participantesActuales.forEach(p => puntosBatalla[p] = 0); estadoBatalla = 'activa'; clearInterval(timerBatalla); 
    let subTickBatalla = 0; let tiempoExtraSnipe = 5; 
    const victorias = DB.getVictorias();
    
    io.emit('batallaInicio', { tiempo: tiempoBatalla, puntos: puntosBatalla, victorias, equipos, participantes: participantesActuales }); 
    
    timerBatalla = setInterval(() => { 
        if (tiempoBatalla > 3) { tiempoBatalla--; io.emit('batallaTick', tiempoBatalla); } 
        else if (tiempoBatalla > 0) { subTickBatalla++; if (subTickBatalla >= 2) { tiempoBatalla--; subTickBatalla = 0; } io.emit('batallaTick', tiempoBatalla); } 
        else { io.emit('batallaTick', 0); tiempoExtraSnipe--; 
            if (tiempoExtraSnipe <= 0) { 
                clearInterval(timerBatalla); estadoBatalla = 'finalizada'; 
                let maxPts = 0; participantesActuales.forEach(p => { if (puntosBatalla[p] > maxPts) maxPts = puntosBatalla[p]; }); 
                let ganadoras = participantesActuales.filter(c => puntosBatalla[c] === maxPts); 
                let ganadora = (ganadoras.length === 1 && maxPts > 0) ? ganadoras[0] : (maxPts === 0 ? 'SIN PUNTOS' : 'EMPATE'); 
                
                if (ganadora !== 'EMPATE' && ganadora !== 'SIN PUNTOS') { 
                    DB.sumarVictoria(ganadora);
                } 
                
                const victoriasActuales = DB.getVictorias();
                let reporteTarjetas = [];
                participantesActuales.forEach(chica => {
                    if (ganadoras.includes(chica) && maxPts > 0) { 
                        rachasPerdidas[chica] = 0; 
                    } else {
                        rachasPerdidas[chica]++; 
                        if (rachasPerdidas[chica] >= configFutbol.limiteAmarilla) { 
                            amarillasAcumuladas[chica]++; 
                            if (amarillasAcumuladas[chica] >= 2) { 
                                reporteTarjetas.push({ chica, equipo: equipos[chica].nombre, tipo: 'ROJA' }); 
                                amarillasAcumuladas[chica] = 0; 
                            } else {
                                reporteTarjetas.push({ chica, equipo: equipos[chica].nombre, tipo: 'AMARILLA' }); 
                            }
                            rachasPerdidas[chica] = 0; 
                        }
                    }
                });
                
                const payloadFin = { ganadora, victorias: victoriasActuales, reporteTarjetas, participantes: participantesActuales };
                io.emit('batallaFin', payloadFin);
                setTimeout(() => io.emit('batallaFin', payloadFin), 300);
                setTimeout(() => io.emit('batallaFin', payloadFin), 600);
            } 
        } 
    }, 1000); res.send("OK"); 
});

app.all('/batalla/stop', (req, res) => { 
    clearInterval(timerBatalla); 
    estadoBatalla = 'inactiva'; 
    io.emit('batallaCancelada'); 
    setTimeout(() => io.emit('batallaCancelada'), 300);
    setTimeout(() => io.emit('batallaCancelada'), 600);
    res.send("OK"); 
});

app.all('/batalla/reset-wins', (req, res) => { 
    DB.resetVictorias();
    res.send("OK"); 
});

// ⚽ RUTA: Solo guarda la configuración de faltas
app.all('/futbol/reglas', (req, res) => { 
    if(req.query.fa) {
        configFutbol.limiteAmarilla = parseInt(req.query.fa);
        DB.setConfigVal('limiteAmarilla', configFutbol.limiteAmarilla);
    }
    res.send("OK"); 
});

// ── CRUD DINÁMICAS ──
app.get('/api/dinamicas', (req, res) => res.json(DB.getDinamicas()));

app.all('/api/dinamicas/crear', (req, res) => {
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
    DB.crearDinamica(data);
    res.send('OK');
});

app.all('/api/dinamicas/editar', (req, res) => {
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
    DB.editarDinamica(id, data);
    res.send('OK');
});

app.all('/api/dinamicas/eliminar', (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    if (!id) return res.status(400).send('Falta id');
    DB.eliminarDinamica(id);
    res.send('OK');
});

app.all('/api/dinamicas/duplicar', (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    if (!id) return res.status(400).send('Falta id');
    DB.duplicarDinamica(id);
    res.send('OK');
});

// ── CRUD REGALOS CUSTOM ──
app.get('/api/regalos-custom', (req, res) => res.json(DB.getRegalosCustom()));

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

app.all('/api/regalos-custom/crear', (req, res) => {
    const data = req.body || {};
    if (!data.nombre) return res.status(400).send('Falta nombre');
    data.imagen = procesarImagenBase64(data.imagen);
    DB.crearRegaloCustom(data);
    io.emit('regalosCustomActualizados', DB.getRegalosCustom());
    res.send('OK');
});

app.all('/api/regalos-custom/editar', (req, res) => {
    const data = req.body || {};
    const id = parseInt(req.query.id || data.id);
    if (!id || !data.nombre) return res.status(400).send('Datos incompletos');
    data.imagen = procesarImagenBase64(data.imagen);
    DB.editarRegaloCustom(id, data);
    io.emit('regalosCustomActualizados', DB.getRegalosCustom());
    res.send('OK');
});

app.all('/api/regalos-custom/eliminar', (req, res) => {
    const id = parseInt(req.query.id || (req.body && req.body.id));
    if (!id) return res.status(400).send('Falta id');
    DB.eliminarRegaloCustom(id);
    io.emit('regalosCustomActualizados', DB.getRegalosCustom());
    res.send('OK');
});

// ── RUNTIME DINÁMICAS ──
app.all('/dinamica/start/:id', (req, res) => {
    const config = DB.getDinamica(parseInt(req.params.id));
    if (!config) return res.status(404).send('Dinámica no encontrada');
    const participantes = resolverParticipantesDinamica(config.participantes);
    if (participantes.length < 2) return res.status(400).send('Se necesitan al menos 2 participantes activos');
    const reglas = config.reglas || {};
    clearInterval(timerDinamica);
    dinamicaActiva = { ...config, participantes };
    tiempoDinamica = (parseInt(reglas.duracion) || 3) * 60;
    puntosDinamica = {};
    rachasDinamica = {};
    amarillasDinamica = {};
    eliminadosDinamica = [];
    participantes.forEach(p => { puntosDinamica[p] = 0; rachasDinamica[p] = 0; amarillasDinamica[p] = 0; });
    const payload = { config: dinamicaActiva, participantes, puntos: puntosDinamica, tiempo: tiempoDinamica };
    io.emit('dinamicaInicio', payload);
    timerDinamica = setInterval(() => {
        if (tiempoDinamica > 0) {
            tiempoDinamica--;
            io.emit('dinamicaTick', tiempoDinamica);
        } else {
            clearInterval(timerDinamica);
            finalizarDinamica();
        }
    }, 1000);
    res.send('OK');
});

app.all('/dinamica/stop', (req, res) => {
    clearInterval(timerDinamica);
    dinamicaActiva = null;
    io.emit('dinamicaCancelada');
    res.send('OK');
});

app.all('/dinamica/eliminar', (req, res) => {
    const q = req.query.q || (req.body && req.body.q);
    if (!q || !dinamicaActiva) return res.status(400).send('Sin dinámica activa o falta nombre');
    if (!eliminadosDinamica.includes(q)) eliminadosDinamica.push(q);
    io.emit('dinamicaPuntos', { puntos: puntosDinamica, eliminados: eliminadosDinamica });
    const activos = dinamicaActiva.participantes.filter(p => !eliminadosDinamica.includes(p));
    if (activos.length <= 1) { clearInterval(timerDinamica); finalizarDinamica(); }
    res.send('OK');
});

app.all('/futbol/reset-tarjetas', (req, res) => { 
    QUEENS.forEach(q => { rachasPerdidas[q] = 0; amarillasAcumuladas[q] = 0; });
    io.emit('resetTarjetas'); res.send("OK");
});

app.all('/reset-semanal', (req, res) => { 
    DB.resetSemanal();
    io.emit('resetRanking'); res.send("OK"); 
});

app.all('/reset-diario', (req, res) => { 
    DB.resetDiario();
    io.emit('resetDiario'); res.send("OK"); 
});

app.all('/reset-mensual', (req, res) => { 
    DB.resetMensual();
    io.emit('resetMensual'); res.send("OK"); 
});

app.all('/copa/reset', (req, res) => { 
    DB.resetCopa();
    io.emit('actualizarCopa', DB.getCopa()); 
    res.send("OK"); 
});

app.all('/reset-total', (req, res) => {
    DB.resetSemanal();
    DB.resetMensual();
    DB.resetDiario();
    DB.resetCopa();
    DB.resetVictorias();
    QUEENS.forEach(q => { rachasPerdidas[q] = 0; amarillasAcumuladas[q] = 0; });
    io.emit('resetRanking');
    io.emit('resetMensual');
    io.emit('resetDiario');
    io.emit('actualizarCopa', DB.getCopa());
    res.send("OK");
});

// Compatibilidad: /datos.json para overlays viejos que lo pidan
app.get('/datos.json', (req, res) => {
    res.json({ ranking: DB.getRanking(), victorias: DB.getVictorias(), copa: DB.getCopa() });
});

process.on('uncaughtException', (err) => { console.error('🚨 ESCUDO ACTIVADO:', err.message); });
process.on('unhandledRejection', (reason) => { console.error('🚨 ESCUDO ACTIVADO:', reason); });

process.on('SIGINT', () => { DB.close(); process.exit(0); });
process.on('SIGTERM', () => { DB.close(); process.exit(0); });

// --- ARRANQUE ASYNC: Inicializar DB y luego levantar servidor ---
(async () => {
    try {
        await DB.init();
        DB.initQueens(['Amy', 'Ray', 'Nucita', 'Venus']);
        DB.migrarDesdeJSON(path.join(__dirname, 'datos.json'));
        reconstruirQueens();
        QUEENS.forEach(q => { rachasPerdidas[q] = 0; amarillasAcumuladas[q] = 0; });
        configFutbol.limiteAmarilla = parseInt(DB.getConfigVal('limiteAmarilla')) || 3;
        
        server.listen(3000, '0.0.0.0', () => console.log('🚀 Urban Queens con SQLite activo en puerto 3000'));
    } catch (err) {
        console.error('❌ Error iniciando la base de datos:', err);
        process.exit(1);
    }
})();