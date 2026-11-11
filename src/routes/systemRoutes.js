const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { query } = require('../config/dbPool');
const { ejecutarResetManual, getTimezone } = require('../services/rankingResetService');

function setupSystemRoutes(app, io, requireSession, activeSessions) {
    // Regalos detectados sin asignar
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
            delete s.regalosDetectados[id];
            res.send('Asignado con éxito');
        } else {
            res.status(404).send('Regalo no encontrado.');
        }
    });

    app.post('/api/tiktok/regalos-detectados/asignar-todos', requireSession, (req, res) => {
        const s = req.userSession;
        let queen = (req.body && req.body.queen) || '';
        if (!queen) {
            if (s.podio && s.podio.activo && s.podio.chicaActual) {
                queen = s.podio.chicaActual;
            } else if (s.conociendo && s.conociendo.activo && s.conociendo.chicaActual) {
                queen = s.conociendo.chicaActual;
            } else if (s.timerBaile && s.timerBaile.activo && s.timerBaile.chicaActual) {
                queen = s.timerBaile.chicaActual;
            }
        }
        
        const queenClean = (queen || '').trim();
        const esValida = queenClean && (
            s.QUEENS.some(q => q.trim().toLowerCase() === queenClean.toLowerCase()) ||
            (s.db && s.db.getAllQueensFull().some(q => q.name.trim().toLowerCase() === queenClean.toLowerCase()))
        );

        if (!esValida) {
            return res.status(400).json({ error: 'No hay bailarina válida activa o especificada para asignar.' });
        }

        const canonQueen = s.QUEENS.find(q => q.trim().toLowerCase() === queenClean.toLowerCase()) || queenClean;
        const ids = Object.keys(s.regalosDetectados || {});
        let asignados = 0;
        let totalPuntos = 0;
        const eq = s.equipos[canonQueen] || {};

        ids.forEach(id => {
            const giftInstance = s.regalosDetectados[id];
            if (giftInstance) {
                const giftName = giftInstance.giftName;
                const coins = giftInstance.coins || 1;
                const viewer = giftInstance.viewer || 'Anónimo';
                s.db.registrarRegalo(canonQueen, giftName, coins, viewer);
                s.queueUpdate.push({ nombre: canonQueen, puntos: coins });
                s.lealtadUsuarios[viewer] = canonQueen;
                totalPuntos += coins;
                asignados++;
                io.to(req.username).emit('nuevoRegalo', {
                    nombre: canonQueen,
                    viewer,
                    avatar: '',
                    giftImg: eq.regalo_img || giftInstance.giftImgSrc || '',
                    queenColor: eq.color || '#fff',
                    coins,
                    giftName
                });
                delete s.regalosDetectados[id];
            }
        });

        if (s.podio && s.podio.activo && s.podio.chicaActual && s.podio.chicaActual.trim().toLowerCase() === canonQueen.toLowerCase() && totalPuntos > 0) {
            s.podio.puntos = (s.podio.puntos || 0) + totalPuntos;
            s.podio.puntosRanking = s.podio.puntosRanking || {};
            s.podio.puntosRanking[s.podio.chicaActual] = (s.podio.puntosRanking[s.podio.chicaActual] || 0) + totalPuntos;
            if (s.db && typeof s.db.setConfigVal === 'function') {
                try { s.db.setConfigVal('podio_ranking', JSON.stringify(s.podio.puntosRanking)); } catch(e) {}
            }
            io.to(req.username).emit('podioPuntos', {
                puntos: s.podio.puntos,
                meta: s.podio.meta || 2000
            });
            io.to(req.username).emit('podioRankingActualizado', {
                chicaActual: s.podio.chicaActual || '',
                puntosRanking: s.podio.puntosRanking,
                eliminadas: s.podio.eliminadas || []
            });
        }

        res.json({ status: 'OK', asignados, totalPuntos, queen: canonQueen });
    });

    // Regalos custom
    app.get('/api/regalos-imgs', (req, res) => {
        const dir = path.join(__dirname, '..', '..', 'public', 'regalos');
        fs.readdir(dir, (err, files) => {
            if (err) return res.json([]);
            const imgs = files.filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).sort();
            res.json(imgs);
        });
    });

    app.get('/api/regalos-custom', requireSession, (req, res) => {
        res.json(req.userSession.db.getRegalosCustom(req.query.lista_id));
    });

    function procesarImagenBase64(base64Str) {
        if (!base64Str || !base64Str.startsWith('data:image')) return base64Str;
        try {
            const matches = base64Str.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches.length !== 3) return base64Str;
            const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            const buffer = Buffer.from(matches[2], 'base64');
            const filename = `custom_${crypto.randomUUID()}.${ext}`;
            const regalosDir = path.join(__dirname, '..', '..', 'public', 'regalos');
            if (!fs.existsSync(regalosDir)) fs.mkdirSync(regalosDir, { recursive: true });
            fs.writeFileSync(path.join(regalosDir, filename), buffer);
            return `/regalos/${filename}`;
        } catch (e) {
            console.error('Error procesando imagen base64:', e);
            return base64Str;
        }
    }

    app.all('/api/regalos-custom/crear', requireSession, async (req, res) => {
        const s = req.userSession;
        const data = req.body || {};
        if (!data.nombre) return res.status(400).send('Falta nombre');
        data.imagen = procesarImagenBase64(data.imagen);
        const nuevo = await s.db.crearRegaloCustom(data);
        io.to(req.username).emit('regalosCustomActualizados', s.db.getRegalosCustom());
        res.json({ status: 'OK', regalo: nuevo });
    });

    app.all('/api/regalos-custom/editar', requireSession, async (req, res) => {
        const s = req.userSession;
        const data = req.body || {};
        const id = parseInt(req.query.id || data.id);
        if (!id || !data.nombre) return res.status(400).send('Datos incompletos');
        data.imagen = procesarImagenBase64(data.imagen);
        await s.db.editarRegaloCustom(id, data);
        io.to(req.username).emit('regalosCustomActualizados', s.db.getRegalosCustom());
        res.send('OK');
    });

    app.all('/api/regalos-custom/reordenar', requireSession, async (req, res) => {
        const s = req.userSession;
        const ids = (req.body && req.body.ids) || [];
        await s.db.reordenarRegalosCustom(ids);
        io.to(req.username).emit('regalosCustomActualizados', s.db.getRegalosCustom());
        res.send('OK');
    });

    app.all('/api/regalos-custom/eliminar', requireSession, async (req, res) => {
        const s = req.userSession;
        const id = parseInt(req.query.id || (req.body && req.body.id));
        if (!id) return res.status(400).send('Falta id');
        await s.db.eliminarRegaloCustom(id);
        io.to(req.username).emit('regalosCustomActualizados', s.db.getRegalosCustom());
        res.send('OK');
    });

    // Regalos Listas
    app.get('/api/regalos-listas', requireSession, (req, res) => res.json(req.userSession.db.getRegalosListas()));
    app.all('/api/regalos-listas/crear', requireSession, async (req, res) => {
        const s = req.userSession;
        const nombre = (req.body && req.body.nombre) || req.query.nombre || 'Nueva Lista';
        await s.db.crearRegaloLista(nombre);
        res.json(s.db.getRegalosListas());
    });
    app.all('/api/regalos-listas/eliminar', requireSession, async (req, res) => {
        const s = req.userSession;
        const id = parseInt(req.query.id || (req.body && req.body.id));
        if (id) await s.db.eliminarRegaloLista(id);
        io.to(req.username).emit('regalosCustomActualizados', s.db.getRegalosCustom());
        res.json(s.db.getRegalosListas());
    });
    app.all('/api/regalos-listas/activar', requireSession, async (req, res) => {
        const s = req.userSession;
        const id = parseInt(req.query.id || (req.body && req.body.id));
        if (id) await s.db.activarRegaloLista(id);
        io.to(req.username).emit('regalosCustomActualizados', s.db.getRegalosCustom());
        res.json(s.db.getRegalosListas());
    });

    // Marca
    app.get('/api/marca', requireSession, (req, res) => {
        const s = req.userSession;
        res.json({
            logoUrl: s.db.getConfigVal('marca_logo_url') || '',
            fontFamily: s.db.getConfigVal('marca_font_family') || 'Inter',
            neonIntensity: s.db.getConfigVal('marca_neon_intensity') || 'normal'
        });
    });

    app.post('/api/marca', requireSession, async (req, res) => {
        const s = req.userSession;
        const { logoUrl, fontFamily, neonIntensity } = req.body;
        await s.db.setConfigVal('marca_logo_url', logoUrl || '');
        await s.db.setConfigVal('marca_font_family', fontFamily || 'Inter');
        await s.db.setConfigVal('marca_neon_intensity', neonIntensity || 'normal');
        const config = { logoUrl, fontFamily, neonIntensity };
        io.to(req.username).emit('marcaCambiado', config);
        res.json({ status: 'OK', config });
    });

    // Sonidos
    app.get('/api/sonidos', requireSession, (req, res) => res.json(req.userSession.db.getSonidos()));
    app.all('/api/sonidos/set', requireSession, (req, res) => {
        const s = req.userSession;
        const evento = req.query.evento || (req.body && req.body.evento);
        const url = req.query.url || (req.body && req.body.url);
        if (evento && url) { s.db.setSonido(evento, url); return res.send("OK"); }
        res.status(400).send("Error");
    });

    // Overlay vistas
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
        if ((vista.includes('podio') || vista.includes('conociendo')) && s.podio) {
            setTimeout(() => {
                io.to(req.username).emit('podioRankingActualizado', {
                    chicaActual: s.podio.chicaActual || '',
                    puntosRanking: s.podio.puntosRanking || {},
                    eliminadas: s.podio.eliminadas || []
                });
            }, 350);
        }
        res.json({ status: 'OK', vistaAcumuladosActiva: vista });
    });

    // Resets
    app.all('/reset-semanal', requireSession, async (req, res) => {
        await ejecutarResetManual(req.userSession, req.username, io, 'semanal');
        res.send("OK");
    });

    app.all('/reset-diario', requireSession, async (req, res) => {
        await ejecutarResetManual(req.userSession, req.username, io, 'diario');
        res.send("OK");
    });

    app.all('/reset-mensual', requireSession, async (req, res) => {
        await ejecutarResetManual(req.userSession, req.username, io, 'mensual');
        res.send("OK");
    });

    app.all('/copa/reset', requireSession, async (req, res) => {
        const s = req.userSession;
        await s.db.resetCopa();
        io.to(req.username).emit('actualizarCopa', s.db.getCopa());
        res.send("OK");
    });

    app.all('/reset-total', requireSession, async (req, res) => {
        await ejecutarResetManual(req.userSession, req.username, io, 'total');
        res.send("OK");
    });

    // Compatibilidad con overlays viejos
    app.get('/datos.json', requireSession, async (req, res) => {
        const s = req.userSession;
        try { await s.db.sincronizarRankingsSiNecesario(3000); } catch(e) {}
        res.json({ ranking: s.db.getRanking(), victorias: s.db.getVictorias(), copa: s.db.getCopa() });
    });

    // Restaurar rankings desde el historial
    app.get('/api/rankings/restore', requireSession, async (req, res) => {
        try {
            const db = req.userSession.db;
            const uId = await db.ensureUserId();
            if (!uId) return res.status(400).send('Usuario no identificado');

            const syncRes = await db.sincronizarRankingsDesdeHistorial({ ignorarResetsManuales: true });

            io.to(req.username).emit('rankingActualizado', db.getRankingsPayload());
            io.to(req.username).emit('queensActualizadas', {
                queens: req.userSession.QUEENS,
                equipos: req.userSession.equipos,
                apodos: db.getApodosMap()
            });

            res.json({
                status: 'OK',
                mensaje: 'Rankings sincronizados con éxito a partir del historial de regalos.',
                detalles: {
                    timezone: syncRes.timezone,
                    diariosRestaurados: syncRes.diarios,
                    semanalesRestaurados: syncRes.semanales,
                    mensualesRestaurados: syncRes.mensuales
                }
            });
        } catch (e) {
            console.error('Error en /api/rankings/restore:', e);
            res.status(500).send(e.message);
        }
    });

    // Apagado
    app.all('/api/sistema/shutdown', requireSession, (req, res) => {
        const user = req.username;
        console.log(`🛑 Petición de apagado del servidor por parte del usuario '${user}'...`);
        io.to(user).emit('servidorApagado');
        res.json({ status: 'OK', message: 'Servidor apagado correctamente. Todas las bases de datos guardadas.' });
        setTimeout(() => {
            cleanupAllSessions(activeSessions);
            process.exit(0);
        }, 500);
    });
}

const { cleanupUserSession } = require('../config/sessionStore');

function cleanupAllSessions(activeSessions, io = null) {
    console.log('🧹 Cerrando bases de datos y conexiones de todas las sesiones...');
    Object.keys(activeSessions).forEach(username => {
        const session = activeSessions[username];
        if (session) {
            cleanupUserSession(session, io, username);
            delete activeSessions[username];
        }
    });
}

module.exports = { setupSystemRoutes, cleanupAllSessions };
