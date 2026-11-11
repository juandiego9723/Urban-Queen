const { reconstruirQueens, reconstruirEquipos, resolverNombre } = require('../config/sessionStore');
const { verificarResetParaSesion } = require('../services/rankingResetService');
const { uploadBase64Image } = require('../services/storageService');

function setupQueensRoutes(app, io, requireSession) {
    app.get('/api/queens', requireSession, (req, res) => {
        const s = req.userSession;
        if (s.timerBaile && s.timerBaile.activo && s.timerBaile.modoTorneo) {
            return res.json(s.timerBaile.participantesOriginales);
        }
        res.json(s.QUEENS);
    });
    app.get('/api/tournament/eliminated', requireSession, (req, res) => {
        const s = req.userSession;
        if (s.timerBaile && s.timerBaile.activo && s.timerBaile.modoTorneo) {
            return res.json(s.timerBaile.eliminadas || []);
        }
        res.json([]);
    });
    app.get('/api/queens/all', requireSession, (req, res) => res.json(req.userSession.db.getAllQueensFull()));
    app.get('/api/apodos', requireSession, (req, res) => res.json(req.userSession.db.getApodosMap()));

    app.all('/api/queens/crear', requireSession, async (req, res) => {
        const s = req.userSession;
        const nombre = (req.query.nombre || (req.body && req.body.nombre) || '').trim();
        if (!nombre) return res.status(400).send('Falta nombre');

        const color = req.query.color || (req.body && req.body.color) || '#ffffff';
        const apodo = (req.query.apodo || (req.body && req.body.apodo) || '').trim();
        const regaloImgRaw = req.query.regalo_img || (req.body && req.body.regalo_img) || '';
        const regaloPts = parseInt(req.query.regalo_pts || (req.body && req.body.regalo_pts) || '0') || 0;
        const avatarImgRaw = req.query.avatar_img || (req.body && req.body.avatar_img) || '';
        const nombreImgRaw = req.query.nombre_img || (req.body && req.body.nombre_img) || '';

        const [regaloImg, avatarImg, nombreImg] = await Promise.all([
            uploadBase64Image(regaloImgRaw, { folder: 'regalos', prefix: `regalo_${req.username}_${nombre}` }),
            uploadBase64Image(avatarImgRaw, { folder: 'avatars', prefix: `avatar_${req.username}_${nombre}` }),
            uploadBase64Image(nombreImgRaw, { folder: 'nombres', prefix: `nombre_${req.username}_${nombre}` })
        ]);

        await s.db.crearQueen(nombre, color, apodo, regaloImg, regaloPts, avatarImg, nombreImg);
        reconstruirQueens(s);
        s.QUEENS.forEach(q => { if (!s.rachasPerdidas[q]) s.rachasPerdidas[q] = 0; if (!s.amarillasAcumuladas[q]) s.amarillasAcumuladas[q] = 0; });
        io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
        res.send('OK');
    });

    app.all('/api/queens/editar', requireSession, async (req, res) => {
        const s = req.userSession;
        const p      = (k) => req.query[k] !== undefined ? req.query[k] : (req.body && req.body[k] !== undefined ? req.body[k] : null);
        const nombre = p('nombre');
        const color  = p('color');
        if (!nombre || !color) return res.status(400).send('Faltan datos');

        const apodo  = p('apodo');
        const regImgRaw = p('regalo_img');
        const regPts = p('regalo_pts') !== null ? parseInt(p('regalo_pts')) : null;
        const avatarImgRaw = p('avatar_img');
        const nombreImgRaw = p('nombre_img');

        const [regImg, avatarImg, nombreImg] = await Promise.all([
            regImgRaw !== null ? uploadBase64Image(regImgRaw, { folder: 'regalos', prefix: `regalo_${req.username}_${nombre}` }) : Promise.resolve(null),
            avatarImgRaw !== null ? uploadBase64Image(avatarImgRaw, { folder: 'avatars', prefix: `avatar_${req.username}_${nombre}` }) : Promise.resolve(null),
            nombreImgRaw !== null ? uploadBase64Image(nombreImgRaw, { folder: 'nombres', prefix: `nombre_${req.username}_${nombre}` }) : Promise.resolve(null)
        ]);

        await s.db.editarQueen(nombre, color, apodo, regImg, regPts, avatarImg, nombreImg);
        reconstruirEquipos(s);
        io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
        res.send('OK');
    });

    app.all('/api/queens/renombrar', requireSession, async (req, res) => {
        const s = req.userSession;
        const nombre = (req.query.nombre || (req.body && req.body.nombre) || '').trim();
        const nuevo  = (req.query.nuevo  || (req.body && req.body.nuevo)  || '').trim();
        if (!nombre || !nuevo) return res.status(400).send('Faltan datos');
        if (nombre === nuevo) return res.send('OK');
        await s.db.renombrarQueen(nombre, nuevo);
        reconstruirQueens(s);
        io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
        res.send('OK');
    });

    app.all('/api/queens/eliminar', requireSession, async (req, res) => {
        const s = req.userSession;
        const nombre = (req.query.nombre || (req.body && req.body.nombre) || '').trim();
        if (!nombre) return res.status(400).send('Falta nombre');
        await s.db.eliminarQueen(nombre);
        reconstruirQueens(s);
        io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
        res.send('OK');
    });

    app.all('/api/queens/toggle', requireSession, async (req, res) => {
        const s = req.userSession;
        const nombre = req.query.nombre || (req.body && req.body.nombre);
        if (!nombre) return res.status(400).send('Falta nombre');
        const nuevoEstado = await s.db.toggleQueenActivo(nombre);
        reconstruirQueens(s);
        io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
        res.json({ activo: nuevoEstado });
    });

    app.get('/api/ranking', requireSession, async (req, res) => {
        const s = req.userSession;
        try { await verificarResetParaSesion(s, req.username, io); } catch(e) {}
        if (s.timerBaile && s.timerBaile.activo && s.timerBaile.modoTorneo) {
            return res.json(s.timerBaile.puntosTorneo);
        }
        try { await s.db.sincronizarRankingsSiNecesario(3000); } catch(e) {}
        res.json(s.db.getRanking());
    });
    app.get('/api/ranking-mensual', requireSession, async (req, res) => {
        const s = req.userSession;
        try { await verificarResetParaSesion(s, req.username, io); } catch(e) {}
        try { await s.db.sincronizarRankingsSiNecesario(3000); } catch(e) {}
        res.json(s.db.getRankingMensual());
    });
    app.get('/api/ranking-diario', requireSession, async (req, res) => {
        const s = req.userSession;
        try { await verificarResetParaSesion(s, req.username, io); } catch(e) {}
        try { await s.db.sincronizarRankingsSiNecesario(3000); } catch(e) {}
        res.json(s.db.getRankingDiario());
    });
    app.get('/api/ranking/titulos', requireSession, (req, res) => res.json(req.userSession.db.getRankingTitulos()));
    app.all('/api/ranking/titulos/set', requireSession, async (req, res) => {
        const s = req.userSession;
        const titulos = req.body || {};
        const semanal = req.query.semanal !== undefined ? req.query.semanal.trim() : (titulos.semanal !== undefined ? titulos.semanal.trim() : undefined);
        const mensual = req.query.mensual !== undefined ? req.query.mensual.trim() : (titulos.mensual !== undefined ? titulos.mensual.trim() : undefined);
        const diario  = req.query.diario  !== undefined ? req.query.diario.trim()  : (titulos.diario  !== undefined ? titulos.diario.trim()  : undefined);
        const revivir = req.query.revivir !== undefined ? req.query.revivir.trim() : (titulos.revivir !== undefined ? titulos.revivir.trim() : undefined);
        const color_semanal = req.query.color_semanal || titulos.color_semanal;
        const color_mensual = req.query.color_mensual || titulos.color_mensual;
        const color_diario  = req.query.color_diario  || titulos.color_diario;
        const color_revivir = req.query.color_revivir || titulos.color_revivir;
        await s.db.setRankingTitulos({ semanal, mensual, diario, revivir, color_semanal, color_mensual, color_diario, color_revivir });
        const nuevosTitulos = s.db.getRankingTitulos();
        io.to(req.username).emit('rankingTitulosActualizados', nuevosTitulos);
        res.json({ status: 'OK', titulos: nuevosTitulos });
    });
    app.post('/api/ranking/titulos', requireSession, async (req, res) => {
        const s = req.userSession;
        const titulos = req.body || {};
        await s.db.setRankingTitulos(titulos);
        const nuevosTitulos = s.db.getRankingTitulos();
        io.to(req.username).emit('rankingTitulosActualizados', nuevosTitulos);
        res.json({ status: 'OK', titulos: nuevosTitulos });
    });
    app.get('/api/copa', requireSession, (req, res) => res.json({ copa: req.userSession.db.getCopa(), equipos: req.userSession.equipos }));
    app.get('/api/victorias', requireSession, (req, res) => res.json(req.userSession.db.getVictorias()));

    // Aliases
    app.get('/api/aliases', requireSession, (req, res) => res.json(req.userSession.db.getAliases()));
    app.all('/api/aliases/add', requireSession, async (req, res) => {
        const s = req.userSession;
        const alias = req.query.alias || (req.body && req.body.alias);
        const queen = req.query.queen || (req.body && req.body.queen);
        if (alias && queen && s.QUEENS.includes(queen)) {
            await s.db.agregarAlias(alias, queen);
            return res.send("OK");
        }
        res.status(400).send("Error");
    });
    app.all('/api/aliases/delete', requireSession, async (req, res) => {
        const alias = req.query.alias || (req.body && req.body.alias);
        if (alias) { await req.userSession.db.eliminarAlias(alias); return res.send("OK"); }
        res.status(400).send("Error");
    });

    // Grupos
    app.get('/api/grupos', requireSession, (req, res) => res.json(req.userSession.db.getGrupos()));
    app.all('/api/grupos/crear', requireSession, async (req, res) => {
        const s = req.userSession;
        const nombre = req.query.nombre || (req.body && req.body.nombre);
        const color = req.query.color || (req.body && req.body.color) || '#39FF14';
        if (nombre) {
            try { await s.db.crearGrupo(nombre, color); return res.send("OK"); }
            catch(e) { return res.status(400).send("Grupo ya existe"); }
        }
        res.status(400).send("Error");
    });
    app.all('/api/grupos/eliminar', requireSession, async (req, res) => {
        const id = parseInt(req.query.id || (req.body && req.body.id));
        if (id) { await req.userSession.db.eliminarGrupo(id); return res.send("OK"); }
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
    app.all('/update', requireSession, async (req, res) => {
        const s = req.userSession;
        let nombre = req.query.nombre || (req.body && req.body.nombre);
        const puntos = parseInt(req.query.puntos || (req.body && req.body.puntos));
        const viewer = req.query.viewer || (req.body && req.query.viewer);
        const avatar = req.query.avatar || (req.body && req.body.avatar) || '';
        
        nombre = resolverNombre(s, nombre);
        
        if (nombre && !isNaN(puntos)) {
            const vName = viewer || 'Admin';
            if (puntos > 0) {
                if (viewer) s.lealtadUsuarios[viewer] = nombre;
                s.queueUpdate.push({ 
                    nombre, 
                    puntos, 
                    viewer: vName, 
                    avatar: avatar || '', 
                    giftName: 'Regalo Manual', 
                    repeat: 1 
                });
                await s.db.registrarRegalo(nombre, 'Regalo Manual', puntos, vName);
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
            } else if (puntos < 0) {
                const currentDiario = (s.db.getRankingDiario && s.db.getRankingDiario()[nombre]) || 0;
                const currentSemanal = (s.db.getRanking && s.db.getRanking()[nombre]) || 0;
                const maxDescuento = currentDiario > 0 ? currentDiario : Math.max(0, currentSemanal);
                const descuento = maxDescuento > 0 ? -Math.min(Math.abs(puntos), maxDescuento) : 0;
                if (descuento < 0) {
                    s.queueUpdate.push({ 
                        nombre, 
                        puntos: descuento, 
                        viewer: vName, 
                        avatar: avatar || '', 
                        giftName: 'Ajuste Manual', 
                        repeat: 1 
                    });
                    await s.db.registrarRegalo(nombre, 'Ajuste Manual', descuento, vName);
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
                s.queueUpdate.push({ 
                    nombre: queenAsignada, 
                    puntos, 
                    viewer: viewer || 'Auto', 
                    avatar: avatar || '', 
                    giftName: 'Regalo Auto', 
                    repeat: 1 
                });
                const vName = viewer || 'Auto';
                s.db.registrarRegalo(queenAsignada, 'Regalo Auto', puntos, vName);
                const eq = s.equipos[queenAsignada] || {};
                if (viewer) {
                    io.to(req.username).emit('nuevoRegalo', { nombre: queenAsignada, viewer, avatar, giftImg: eq.regalo_img || '', queenColor: eq.color || '#fff', coins: puntos, giftName: 'Regalo Auto' });
                }
                return res.send("Asignado a " + queenAsignada);
            } else {
                s.queueUpdate.push({ 
                    nombre: null, 
                    puntos, 
                    viewer: viewer || 'Auto', 
                    avatar: avatar || '', 
                    giftName: 'Regalo Auto', 
                    repeat: 1 
                });
                return res.send("Sumado Global");
            }
        }
        res.status(400).send("Ignorado");
    });
}

module.exports = setupQueensRoutes;
