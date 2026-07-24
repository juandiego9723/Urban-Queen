const { reconstruirQueens, reconstruirEquipos, resolverNombre } = require('../config/sessionStore');

function setupQueensRoutes(app, io, requireSession) {
    app.get('/api/queens', requireSession, (req, res) => res.json(req.userSession.QUEENS));
    app.get('/api/queens/all', requireSession, (req, res) => res.json(req.userSession.db.getAllQueensFull()));
    app.get('/api/apodos', requireSession, (req, res) => res.json(req.userSession.db.getApodosMap()));

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

    app.get('/api/ranking', requireSession, (req, res) => res.json(req.userSession.db.getRanking()));
    app.get('/api/ranking-mensual', requireSession, (req, res) => res.json(req.userSession.db.getRankingMensual()));
    app.get('/api/ranking-diario', requireSession, (req, res) => res.json(req.userSession.db.getRankingDiario()));
    app.get('/api/copa', requireSession, (req, res) => res.json({ copa: req.userSession.db.getCopa(), equipos: req.userSession.equipos }));
    app.get('/api/victorias', requireSession, (req, res) => res.json(req.userSession.db.getVictorias()));

    // Aliases
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

    // Grupos
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

    // Manual Updates
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
}

module.exports = setupQueensRoutes;
