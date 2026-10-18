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
    app.get('/datos.json', requireSession, (req, res) => {
        const s = req.userSession;
        res.json({ ranking: s.db.getRanking(), victorias: s.db.getVictorias(), copa: s.db.getCopa() });
    });

    // Restaurar rankings desde el historial
    app.get('/api/rankings/restore', requireSession, async (req, res) => {
        try {
            const db = req.userSession.db;
            const uId = await db.ensureUserId();
            if (!uId) return res.status(400).send('Usuario no identificado');

            const tz = getTimezone();

            // 1. Resetear contadores de ranking en DB
            await query('UPDATE queens SET ranking_diario = 0, ranking_semanal = 0, ranking_mensual = 0 WHERE user_id = $1', [uId]);

            // 2. Calcular acumulados diarios (hoy en zona horaria local)
            const diariosRes = await query(`
                SELECT q.name as queen_name, COALESCE(SUM(h.diamonds), 0)::int as total 
                FROM historial_regalos h 
                JOIN queens q ON h.queen_id = q.id 
                WHERE h.user_id = $1 AND (h.timestamp AT TIME ZONE $2)::date >= (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
                GROUP BY q.name
            `, [uId, tz]);
            const diarios = diariosRes.rows || [];
            for (const d of diarios) {
                await query('UPDATE queens SET ranking_diario = $1 WHERE user_id = $2 AND LOWER(name) = LOWER($3)', [d.total, uId, d.queen_name]);
            }

            // 3. Calcular acumulados semanales (desde lunes en zona horaria local)
            const semanalesRes = await query(`
                SELECT q.name as queen_name, COALESCE(SUM(h.diamonds), 0)::int as total 
                FROM historial_regalos h 
                JOIN queens q ON h.queen_id = q.id 
                WHERE h.user_id = $1 AND (h.timestamp AT TIME ZONE $2)::date >= DATE_TRUNC('week', CURRENT_TIMESTAMP AT TIME ZONE $2)::date
                GROUP BY q.name
            `, [uId, tz]);
            const semanales = semanalesRes.rows || [];
            for (const s of semanales) {
                await query('UPDATE queens SET ranking_semanal = $1 WHERE user_id = $2 AND LOWER(name) = LOWER($3)', [s.total, uId, s.queen_name]);
            }

            // 4. Calcular acumulados mensuales (desde día 1 en zona horaria local)
            const mensualesRes = await query(`
                SELECT q.name as queen_name, COALESCE(SUM(h.diamonds), 0)::int as total 
                FROM historial_regalos h 
                JOIN queens q ON h.queen_id = q.id 
                WHERE h.user_id = $1 AND (h.timestamp AT TIME ZONE $2)::date >= DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE $2)::date
                GROUP BY q.name
            `, [uId, tz]);
            const mensuales = mensualesRes.rows || [];
            for (const m of mensuales) {
                await query('UPDATE queens SET ranking_mensual = $1 WHERE user_id = $2 AND LOWER(name) = LOWER($3)', [m.total, uId, m.queen_name]);
            }

            // 5. Recargar la memoria cache y notificar por Socket.IO
            await db.cargarCache();

            io.to(req.username).emit('resetRanking');
            io.to(req.username).emit('resetSemanal');
            io.to(req.username).emit('resetMensual');
            io.to(req.username).emit('resetDiario');
            io.to(req.username).emit('rankingActualizado');
            io.to(req.username).emit('queensActualizadas', {
                queens: req.userSession.QUEENS,
                equipos: req.userSession.equipos,
                apodos: db.getApodosMap()
            });

            res.json({
                status: 'OK',
                mensaje: 'Rankings restaurados con éxito a partir del historial de regalos.',
                detalles: {
                    timezone: tz,
                    diariosRestaurados: diarios,
                    semanalesRestaurados: semanales,
                    mensualesRestaurados: mensuales
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
