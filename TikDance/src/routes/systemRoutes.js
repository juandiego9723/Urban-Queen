const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

    // Regalos custom
    app.get('/api/regalos-imgs', (req, res) => {
        const dir = path.join(__dirname, '..', '..', 'public', 'regalos');
        fs.readdir(dir, (err, files) => {
            if (err) return res.json([]);
            const imgs = files.filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).sort();
            res.json(imgs);
        });
    });

    app.get('/api/regalos-custom', requireSession, (req, res) => res.json(req.userSession.db.getRegalosCustom()));

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

    // Marca
    app.get('/api/marca', requireSession, (req, res) => {
        const s = req.userSession;
        res.json({
            logoUrl: s.db.getConfigVal('marca_logo_url') || '',
            fontFamily: s.db.getConfigVal('marca_font_family') || 'Inter',
            neonIntensity: s.db.getConfigVal('marca_neon_intensity') || 'normal'
        });
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
        res.json({ status: 'OK', vistaAcumuladosActiva: vista });
    });

    // Resets
    app.all('/reset-semanal', requireSession, (req, res) => {
        req.userSession.db.resetSemanal();
        io.to(req.username).emit('resetRanking');
        res.send("OK");
    });

    app.all('/reset-diario', requireSession, (req, res) => {
        req.userSession.db.resetDiario();
        io.to(req.username).emit('resetDiario');
        res.send("OK");
    });

    app.all('/reset-mensual', requireSession, (req, res) => {
        req.userSession.db.resetMensual();
        io.to(req.username).emit('resetMensual');
        res.send("OK");
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

    // Compatibilidad con overlays viejos
    app.get('/datos.json', requireSession, (req, res) => {
        const s = req.userSession;
        res.json({ ranking: s.db.getRanking(), victorias: s.db.getVictorias(), copa: s.db.getCopa() });
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

function cleanupAllSessions(activeSessions) {
    console.log('🧹 Cerrando bases de datos de todas las sesiones...');
    Object.keys(activeSessions).forEach(username => {
        const session = activeSessions[username];
        if (session) {
            clearInterval(session.batchInterval);
            if (session.tiktokConnection) {
                try { session.tiktokConnection.disconnect(); } catch (e) {}
            }
            if (session.db) {
                session.db.close();
            }
        }
    });
}

module.exports = { setupSystemRoutes, cleanupAllSessions };
