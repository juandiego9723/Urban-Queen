function setupActivadoresDynamics(app, io, requireSession, activeSessions) {
    function ensureActivadoresState(s) {
        if (!s) return;
        if (!s.dinamicaActivadores) {
            s.dinamicaActivadores = {
                activo: true,
                conteos: {},
                participantes: [],
                lider: null,
                maxConteo: 0
            };
        }
        if (!s.dinamicaActivadores.conteos) {
            s.dinamicaActivadores.conteos = {};
        }

        // Sincronizar participantes con s.QUEENS o consultar directamente db si estuviera vacío
        let queensDisponibles = (s.QUEENS && s.QUEENS.length > 0) ? s.QUEENS : [];
        if (queensDisponibles.length === 0 && s.db && typeof s.db.getActiveQueenNames === 'function') {
            queensDisponibles = s.db.getActiveQueenNames() || [];
            if (queensDisponibles.length > 0) {
                s.QUEENS = [...queensDisponibles];
            }
        }
        if (queensDisponibles.length === 0 && s.db && typeof s.db.getAllQueensFull === 'function') {
            const allQ = s.db.getAllQueensFull() || [];
            queensDisponibles = allQ.filter(q => q.activo).map(q => q.name);
            if (queensDisponibles.length > 0) {
                s.QUEENS = [...queensDisponibles];
            }
        }

        if (!Array.isArray(s.dinamicaActivadores.participantes) || s.dinamicaActivadores.participantes.length === 0) {
            if (queensDisponibles.length > 0) {
                s.dinamicaActivadores.participantes = [...queensDisponibles];
            }
        }
        
        // Inicializar conteo en 0 para participantes que no tengan aún
        (s.dinamicaActivadores.participantes || []).forEach(p => {
            if (s.dinamicaActivadores.conteos[p] === undefined) {
                s.dinamicaActivadores.conteos[p] = 0;
            }
        });
    }

    function recalcularLiderActivadores(s) {
        ensureActivadoresState(s);
        let max = 0;
        let lider = null;
        const participantes = (s.dinamicaActivadores && s.dinamicaActivadores.participantes) || [];
        
        participantes.forEach(p => {
            const c = (s.dinamicaActivadores.conteos && s.dinamicaActivadores.conteos[p]) || 0;
            if (c > max) {
                max = c;
                lider = p;
            }
        });

        s.dinamicaActivadores.lider = (max > 0) ? lider : null;
        s.dinamicaActivadores.maxConteo = max;
        return s.dinamicaActivadores.lider;
    }

    function resolverRegaloImg(rawImg) {
        if (!rawImg) return '/regalos/Rosa.png';
        if (rawImg.startsWith('/') || rawImg.startsWith('http')) return rawImg;
        return '/regalos/' + rawImg;
    }

    function construirEstadoCompleto(s) {
        ensureActivadoresState(s);
        recalcularLiderActivadores(s);

        // Si equipos estuviera vacío, reconstruir desde db
        if ((!s.equipos || Object.keys(s.equipos).length === 0) && s.db && typeof s.db.getAllQueensFull === 'function') {
            s.equipos = {};
            const allQ = s.db.getAllQueensFull() || [];
            allQ.forEach(q => {
                if (q.activo) {
                    const display = (q.apodo && q.apodo.trim()) ? q.apodo.trim() : q.name;
                    s.equipos[q.name] = {
                        nombre: display.toUpperCase(),
                        color: q.color || '#FFD700',
                        regalo_img: q.regalo_img || '',
                        avatar_img: q.avatar_img || '',
                        nombre_img: q.nombre_img || '',
                        regalo_pts: q.regalo_pts || 0
                    };
                }
            });
        }

        let rawMapa = s.db ? s.db.getConfigVal('tiktok_regalo_mapa') : null;
        let mapa = rawMapa ? JSON.parse(rawMapa) : {};

        // Invertir mapa para saber qué nombre de regalo tiene cada chica
        const chicaToGiftName = {};
        for (const [gName, qName] of Object.entries(mapa)) {
            if (qName) {
                chicaToGiftName[qName.trim().toLowerCase()] = gName;
            }
        }

        const infoEquipos = {};
        const participantes = s.dinamicaActivadores.participantes || [];

        participantes.forEach(chica => {
            const eq = (s.equipos && s.equipos[chica]) || {};
            const cleanName = chica.trim().toLowerCase();
            const giftName = chicaToGiftName[cleanName] || eq.regalo_nombre || eq.regalo_img || '';
            const rawImg = eq.regalo_img || '';
            infoEquipos[chica] = {
                nombre: eq.nombre || chica.toUpperCase(),
                color: eq.color || '#FFD700',
                regalo_img: resolverRegaloImg(rawImg),
                giftName: giftName
            };
        });

        return {
            activo: s.dinamicaActivadores.activo,
            conteos: s.dinamicaActivadores.conteos,
            participantes: participantes,
            lider: s.dinamicaActivadores.lider,
            maxConteo: s.dinamicaActivadores.maxConteo,
            equipos: infoEquipos
        };
    }

    // ── API REST ──
    app.get('/api/activadores/estado', requireSession, async (req, res) => {
        const s = req.userSession;
        // Si db aún no cargó cache, forzar carga
        if (s.db && (!s.QUEENS || s.QUEENS.length === 0)) {
            try {
                await s.db.cargarCache();
            } catch (e) {}
        }
        res.json(construirEstadoCompleto(s));
    });

    app.all('/api/activadores/reset', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        ensureActivadoresState(s);

        const participantes = s.dinamicaActivadores.participantes || [...(s.QUEENS || [])];
        participantes.forEach(p => {
            s.dinamicaActivadores.conteos[p] = 0;
        });
        s.dinamicaActivadores.lider = null;
        s.dinamicaActivadores.maxConteo = 0;

        const payload = construirEstadoCompleto(s);
        io.to(user).emit('activadoresReset', payload);
        io.to(user).emit('activadoresEstado', payload);

        res.json({ status: 'OK', estado: payload });
    });

    app.all('/api/activadores/participantes', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        ensureActivadoresState(s);

        let parts = req.body && req.body.participantes;
        if (!parts && req.query.p) {
            parts = req.query.p.split(',').map(x => x.trim()).filter(Boolean);
        }

        if (Array.isArray(parts) && parts.length > 0) {
            s.dinamicaActivadores.participantes = parts;
            parts.forEach(p => {
                if (s.dinamicaActivadores.conteos[p] === undefined) {
                    s.dinamicaActivadores.conteos[p] = 0;
                }
            });
            recalcularLiderActivadores(s);
            const payload = construirEstadoCompleto(s);
            io.to(user).emit('activadoresEstado', payload);
        }

        res.json({ status: 'OK', estado: construirEstadoCompleto(s) });
    });

    app.all('/api/activadores/ajustar', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        ensureActivadoresState(s);

        const body = req.body || {};
        const chica = req.query.chica || body.chica;
        const delta = parseInt(req.query.delta !== undefined ? req.query.delta : body.delta);
        const valor = parseInt(req.query.valor !== undefined ? req.query.valor : body.valor);

        if (!chica) {
            return res.status(400).json({ error: 'Falta chica' });
        }

        if (!isNaN(valor)) {
            s.dinamicaActivadores.conteos[chica] = Math.max(0, valor);
        } else if (!isNaN(delta)) {
            const actual = s.dinamicaActivadores.conteos[chica] || 0;
            s.dinamicaActivadores.conteos[chica] = Math.max(0, actual + delta);
        }

        recalcularLiderActivadores(s);
        const payload = construirEstadoCompleto(s);
        io.to(user).emit('activadoresUpdate', {
            chica,
            delta: isNaN(delta) ? 0 : delta,
            conteo: s.dinamicaActivadores.conteos[chica],
            conteos: s.dinamicaActivadores.conteos,
            lider: s.dinamicaActivadores.lider,
            maxConteo: s.dinamicaActivadores.maxConteo
        });
        io.to(user).emit('activadoresEstado', payload);

        res.json({ status: 'OK', estado: payload });
    });

    app.all('/api/activadores/toggle', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        ensureActivadoresState(s);

        s.dinamicaActivadores.activo = !s.dinamicaActivadores.activo;
        const payload = construirEstadoCompleto(s);
        io.to(user).emit('activadoresEstado', payload);
        res.json({ status: 'OK', activo: s.dinamicaActivadores.activo });
    });

    return {
        ensureActivadoresState,
        recalcularLiderActivadores,
        construirEstadoCompleto
    };
}

module.exports = setupActivadoresDynamics;
