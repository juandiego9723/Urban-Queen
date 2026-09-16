function setupRevivirDynamics(app, io, requireSession, activeSessions) {
    
    function concluirSalvacionTorneo(username, exito) {
        const s = activeSessions[username];
        if (!s || !s.timerBaile.modoTorneo) return;

        const chica = s.revivir.chicaActual || s.timerBaile.chicaAEliminar;
        
        if (!s.timerBaile.salvadas) s.timerBaile.salvadas = [];

        if (exito) {
            // Éxito en salvación -> Marcar como salvada y asegurar que permanezca activa
            if (!s.timerBaile.salvadas.includes(chica)) {
                s.timerBaile.salvadas.push(chica);
            }
            if (!s.timerBaile.participantesActivas.includes(chica)) {
                s.timerBaile.participantesActivas.push(chica);
            }
            s.timerBaile.eliminadas = s.timerBaile.eliminadas.filter(n => n !== chica);
        } else {
            // Falló la salvación -> Registrar eliminación
            if (!s.timerBaile.eliminadas.includes(chica)) {
                s.timerBaile.eliminadas.push(chica);
            }
            s.timerBaile.participantesActivas = s.timerBaile.participantesActivas.filter(n => n !== chica);
            s.timerBaile.salvadas = s.timerBaile.salvadas.filter(n => n !== chica);
        }

        io.to(username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });

        // Ocultar overlay
        io.to(username).emit('revivirCancelado');

        // Notificar al panel sobre el resultado de la salvación de esta chica
        io.to(username).emit('torneoSalvacionConcluida', {
            chica,
            exito,
            rondaActual: s.timerBaile.rondaActual,
            participantesActivas: s.timerBaile.participantesActivas,
            salvadas: s.timerBaile.salvadas,
            eliminadas: s.timerBaile.eliminadas
        });

        const torneoTerminado = (s.timerBaile.participantesActivas.length <= 1);
        if (torneoTerminado) {
            s.timerBaile.estado = 'torneo_finalizado';
            s.timerBaile.ganadora = s.timerBaile.participantesActivas[0] || '';
            io.to(username).emit('torneoGanadoraAnunciada', {
                ganadora: s.timerBaile.ganadora,
                puntosTotales: s.timerBaile.puntosTorneo[s.timerBaile.ganadora] || 0
            });
        } else {
            s.timerBaile.estado = 'esperando_decision_ronda';
            s.timerBaile.chicaAEliminar = '';
        }
    }
    function detenerRevivir(username, forceSuccess = false) {
        const s = activeSessions[username];
        if (!s) return;
        const eraActivo = s.revivir.activo;
        s.revivir.activo = false;
        s.revivir.estado = 'inactivo';
        clearTimeout(s.introTimeoutRevivir);
        clearInterval(s.intervaloRevivir);
        io.to(username).emit('revivirCancelado');

        if (eraActivo && s.timerBaile.modoTorneo) {
            concluirSalvacionTorneo(username, forceSuccess);
        }
    }
    app.all('/api/revivir/start', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        const chica = req.query.chica || (req.body && req.body.chica) || '';
        const tiempo = parseInt(req.query.tiempo || (req.body && req.body.tiempo)) || 90;
        const clasificadas = parseInt(req.query.clasificadas || (req.body && req.body.clasificadas)) || 1;

        if (!chica) return res.status(400).send('Falta especificar la bailarina a revivir');

        // Calcular meta dinámicamente para superar al 2.º lugar (limite de clasificados)
        const isTorneo = s.timerBaile && s.timerBaile.modoTorneo;
        let activeQueens = [];
        if (isTorneo) {
            activeQueens = s.timerBaile.participantesActivas.map(name => {
                const q = s.db.getAllQueensFull().find(item => item.name === name) || { name };
                return {
                    name: q.name,
                    puntos: s.timerBaile.puntosTorneo[q.name] || 0
                };
            });
        } else {
            activeQueens = s.db.getAllQueensFull().filter(q => q.activo).map(q => ({
                name: q.name,
                puntos: q.puntos ? parseInt(q.puntos) || 0 : 0
            }));
        }
        activeQueens.sort((a, b) => b.puntos - a.puntos);

        const thresholdIndex = Math.max(0, activeQueens.length - 2);
        const thresholdQueen = activeQueens[thresholdIndex] || null;
        const thresholdPoints = thresholdQueen ? thresholdQueen.puntos : 0;

        const activeQueenData = activeQueens.find(q => q.name === chica);
        const activeQueenPoints = activeQueenData ? activeQueenData.puntos : 0;

        // Meta para superar al 2.º lugar + 1 punto
        const meta = Math.max(1, thresholdPoints - activeQueenPoints + 1);

        s.revivir.chicaActual = chica;
        s.revivir.meta = meta;
        s.revivir.tiempo = tiempo;
        s.revivir.puntos = 0;
        s.revivir.donantes = {};
        s.revivir.donantesAvatars = {};
        s.revivir.regalosEnviados = {};
        s.revivir.regalosImgs = {};
        s.revivir.clasificadas = clasificadas;
        s.revivir.activo = true;
        s.revivir.estado = 'activo';

        clearTimeout(s.introTimeoutRevivir);
        clearInterval(s.intervaloRevivir);

        io.to(user).emit('revivirInicio', {
            chica: s.revivir.chicaActual,
            tiempo: s.revivir.tiempo,
            meta: s.revivir.meta,
            puntos: s.revivir.puntos,
            clasificadas: s.revivir.clasificadas,
            modoTorneo: s.timerBaile.modoTorneo,
            rondaActual: s.timerBaile.rondaActual,
            rondasTotales: s.timerBaile.rondasTotales,
            regalosEnviados: {},
            regalosImgs: {},
            topDonantes: []
        });

        // Retrasar el inicio del descuento en el servidor 4.2s para sincronizar con la intro (PREPÁRATE -> READY -> SET -> GO!)
        s.introTimeoutRevivir = setTimeout(() => {
            if (!s.revivir || !s.revivir.activo) return;

            s.intervaloRevivir = setInterval(() => {
                if (s.revivir.estado === 'activo') {
                    if (s.revivir.tiempo > 0) {
                        s.revivir.tiempo--;
                        io.to(user).emit('revivirTick', s.revivir.tiempo);
                    } else {
                        io.to(user).emit('revivirTick', 0);
                        clearInterval(s.intervaloRevivir);
                        
                        const exito = s.revivir.puntos >= s.revivir.meta;

                        if (exito) {
                            s.revivir.estado = 'inactivo';
                            s.revivir.activo = false;
                            
                            let mvpName = '';
                            let mvpAvatar = '';
                            const sortedDonors = Object.entries(s.revivir.donantes)
                                .map(([name, pts]) => ({ name, pts, avatar: s.revivir.donantesAvatars[name] || '' }))
                                .sort((a, b) => b.pts - a.pts);
                            if (sortedDonors.length > 0) {
                                mvpName = sortedDonors[0].name;
                                mvpAvatar = sortedDonors[0].avatar;
                            }

                            io.to(user).emit('revivirFin', { 
                                exito: true, 
                                puntos: s.revivir.puntos, 
                                meta: s.revivir.meta,
                                mvpName,
                                mvpAvatar
                            });

                            if (s.timerBaile.modoTorneo) {
                                concluirSalvacionTorneo(user, true);
                            }
                        } else {
                            s.revivir.estado = 'esperando_confirmacion_fallo';
                            io.to(user).emit('revivirFalloTiempoOut', {
                                chica: s.revivir.chicaActual,
                                puntos: s.revivir.puntos,
                                meta: s.revivir.meta
                            });
                        }
                    }
                }
            }, 1000);
        }, 4200);

        res.send("OK");
    });

    app.all('/api/revivir/confirm-fallo', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;

        if ((s.revivir && s.revivir.activo && s.revivir.estado === 'esperando_confirmacion_fallo') || (s.timerBaile && s.timerBaile.modoTorneo && s.timerBaile.chicaAEliminar)) {
            if (s.revivir) {
                s.revivir.estado = 'inactivo';
                s.revivir.activo = false;
            }
            
            io.to(user).emit('revivirFin', {
                exito: false,
                puntos: (s.revivir && s.revivir.puntos) || 0,
                meta: (s.revivir && s.revivir.meta) || 0
            });

            if (s.timerBaile && s.timerBaile.modoTorneo) {
                concluirSalvacionTorneo(user, false);
            }
            res.send("OK");
        } else {
            res.status(400).send("No se puede confirmar fallo en este estado");
        }
    });

    app.all('/api/revivir/stop', requireSession, (req, res) => {
        const forceSuccess = req.query.exito === 'true';
        detenerRevivir(req.username, forceSuccess);
        res.send("OK");
    });

    return { detenerRevivir };
}

module.exports = setupRevivirDynamics;
