const { reconstruirQueens } = require('../config/sessionStore');

function setupTimerDynamics(app, io, requireSession, activeSessions) {
    
    function avanzarTurnoTorneo(username, chicaEspecifica = null) {
        const s = activeSessions[username];
        if (!s) return;

        let nextChica = null;
        if (chicaEspecifica && s.timerBaile.orden.includes(chicaEspecifica)) {
            nextChica = chicaEspecifica;
        } else {
            let idx = s.timerBaile.orden.indexOf(s.timerBaile.chicaActual);
            const esUltimaBailarina = (idx === s.timerBaile.orden.length - 1);
            if (esUltimaBailarina) {
                // Fin de ronda (cualquier ronda, intermedia o final)
                clearInterval(s.intervaloTimerBaile);
                
                const participantes = s.timerBaile.orden; // Usar orden actual (sólo activas)
                let lowestQueen = participantes[0];
                let lowestPoints = s.timerBaile.puntosTorneo[lowestQueen] || 0;
                participantes.forEach(q => {
                    const pts = s.timerBaile.puntosTorneo[q] || 0;
                    if (pts < lowestPoints) {
                        lowestPoints = pts;
                        lowestQueen = q;
                    }
                });

                s.timerBaile.chicaAEliminar = lowestQueen;
                s.timerBaile.estado = 'esperando_decision_ronda';

                io.to(username).emit('torneoFinRondaEsperandoDecision', {
                    chica: lowestQueen,
                    puntos: lowestPoints,
                    rondaActual: s.timerBaile.rondaActual,
                    esUltimaRonda: (s.timerBaile.rondaActual === s.timerBaile.rondasTotales)
                });

                io.to(username).emit('revivirFin', {
                    exito: false,
                    puntos: 0,
                    meta: s.timerBaile.metaTurno || 1000,
                    mvpName: '',
                    mvpAvatar: ''
                });
                return;
            } else {
                nextChica = s.timerBaile.orden[idx + 1];
            }
        }

        if (nextChica) {
            s.timerBaile.chicaActual = nextChica;
            s.timerBaile.tiempo = s.timerBaile.tiempoBase || 90;
            s.timerBaile.puntosTurnoActual = 0;
            
            // Limpiar donantes y regalos del turno
            s.timerBaile.donantesTorneo = {};
            s.timerBaile.donantesAvatarsTorneo = {};
            s.timerBaile.regalosEnviadosTorneo = {};
            s.timerBaile.regalosImgsTorneo = {};

            io.to(username).emit('revivirInicio', {
                chica: s.timerBaile.chicaActual,
                tiempo: s.timerBaile.tiempo,
                meta: s.timerBaile.metaTurno,
                puntos: 0,
                modoTorneo: true,
                rondaActual: s.timerBaile.rondaActual,
                rondasTotales: s.timerBaile.rondasTotales,
                clasificadas: s.timerBaile.clasificadas,
                regalosEnviados: {},
                regalosImgs: {},
                topDonantes: []
            });
        }
    }

    function saltarSiguienteChica(username, chicaEspecifica = null) {
        const session = activeSessions[username];
        if (!session) return;
        
        if (session.timerBaile.modoTorneo) {
            avanzarTurnoTorneo(username, chicaEspecifica);
            return;
        }
        
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
        
        s.timerBaile.modoTorneo = false; // Asegurar que apaga torneo
        s.timerBaile.orden = [...s.QUEENS];
        s.timerBaile.activo = true;
        s.timerBaile.tiempo = tiempoBase;
        s.timerBaile.segundosPorMoneda = segundosPorMoneda;
        s.timerBaile.chicaActual = s.QUEENS[0] || '';
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
                    if (subTickBaile >= 2) {
                        s.timerBaile.tiempo--;
                        subTickBaile = 0;
                    }
                    io.to(user).emit('timerTick', s.timerBaile.tiempo);
                } else {
                    io.to(user).emit('timerTick', 0);
                    snipeBaile--;
                    if (snipeBaile <= 0) {
                        saltarSiguienteChica(user);
                        snipeBaile = 3;
                        subTickBaile = 0;
                    }
                }
            }
        }, 1000);
        res.send("OK");
    });

    app.all('/timer/start-tournament', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        
        const participantesRaw = req.query.participantes || (req.body && req.body.participantes) || '';
        const tiempoBase = parseInt(req.query.tiempoBase || (req.body && req.body.tiempoBase)) || 90;
        const metaTurno = parseInt(req.query.metaTurno || (req.body && req.body.metaTurno)) || 1000;
        const rondas = parseInt(req.query.rondas || (req.body && req.body.rondas)) || 2;
        const clasificadas = parseInt(req.query.clasificadas || (req.body && req.body.clasificadas)) || 2;

        if (!participantesRaw) return res.status(400).send('Falta especificar los participantes');
        
        const participantes = participantesRaw.split(',').map(n => n.trim()).filter(n => s.db.getAllQueensFull().some(q => q.name === n));
        if (participantes.length === 0) return res.status(400).send('No hay participantes válidos');

        // Activar solo a los participantes del torneo en la base de datos, desactivando a las demás temporalmente
        s.db.getAllQueensFull().forEach(q => {
            const debeEstarActivo = participantes.includes(q.name);
            const estadoActual = q.activo === 1;
            if (debeEstarActivo !== estadoActual) {
                s.db.toggleQueenActivo(q.name);
            }
        });
        
        // Reconstruir Queens para actualizar s.QUEENS y avisar a los overlays
        reconstruirQueens(s);
        io.to(user).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });

        // Configurar estado del torneo
        s.timerBaile.activo = true;
        s.timerBaile.modoTorneo = true;
        s.timerBaile.rondasTotales = rondas;
        s.timerBaile.rondaActual = 1;
        s.timerBaile.orden = [...participantes];
        s.timerBaile.participantesOriginales = [...participantes];
        s.timerBaile.participantesActivas = [...participantes];
        s.timerBaile.eliminadas = [];
        s.timerBaile.tiempo = tiempoBase;
        s.timerBaile.tiempoBase = tiempoBase;
        s.timerBaile.chicaActual = participantes[0];
        s.timerBaile.estado = 'bailando';
        s.timerBaile.metaTurno = metaTurno;
        s.timerBaile.puntosTorneo = {};
        s.timerBaile.puntosTurnoActual = 0;
        s.timerBaile.clasificadas = clasificadas;

        // Limpiar donantes y regalos del turno
        s.timerBaile.donantesTorneo = {};
        s.timerBaile.donantesAvatarsTorneo = {};
        s.timerBaile.regalosEnviadosTorneo = {};
        s.timerBaile.regalosImgsTorneo = {};

        participantes.forEach(q => s.timerBaile.puntosTorneo[q] = 0);

        // Cambiar automáticamente la vista en los overlays universal y de acumulados
        s.vistaActiva = '/revivir';
        s.vistaAcumuladosActiva = '/revivir-ranking';
        io.to(user).emit('cambioVista', '/revivir');
        io.to(user).emit('cambioVistaAcumulados', '/revivir-ranking');

        clearInterval(s.intervaloTimerBaile);

        // Emitir el inicio al overlay de revivir
        io.to(user).emit('revivirInicio', {
            chica: s.timerBaile.chicaActual,
            tiempo: s.timerBaile.tiempo,
            meta: s.timerBaile.metaTurno,
            puntos: 0,
            modoTorneo: true,
            rondaActual: s.timerBaile.rondaActual,
            rondasTotales: s.timerBaile.rondasTotales,
            clasificadas: clasificadas,
            regalosEnviados: {},
            regalosImgs: {},
            topDonantes: []
        });

        // Iniciar loop del timer
        s.intervaloTimerBaile = setInterval(() => {
            console.log(`[Torneo Interval Tick] User: ${user}, Estado: ${s.timerBaile.estado}, Tiempo: ${s.timerBaile.tiempo}, Chica: ${s.timerBaile.chicaActual}, Ronda: ${s.timerBaile.rondaActual}`);
            if (s.timerBaile.estado === 'bailando') {
                if (s.timerBaile.tiempo > 0) {
                    s.timerBaile.tiempo--;
                    io.to(user).emit('revivirTick', s.timerBaile.tiempo);
                } else {
                    io.to(user).emit('revivirTick', 0);
                    
                    // Comprobar si es la última bailarina de la ronda
                    let idx = s.timerBaile.orden.indexOf(s.timerBaile.chicaActual);
                    const esUltimaBailarina = (idx === s.timerBaile.orden.length - 1);
                    
                    if (esUltimaBailarina) {
                        // Avanzar de inmediato al fin de la ronda
                        avanzarTurnoTorneo(user);
                    } else {
                        // Pausar el turno para mostrar al MVP (para bailarinas intermedias)
                        s.timerBaile.estado = 'esperando_confirmacion_turno';
                        
                        // Calcular MVP del turno
                        const topDonantes = Object.entries(s.timerBaile.donantesTorneo || {})
                            .map(([name, pts]) => ({ 
                                name, 
                                pts, 
                                avatar: s.timerBaile.donantesAvatarsTorneo[name] || '' 
                            }))
                            .sort((a, b) => b.pts - a.pts);
                        
                        const mvpName = topDonantes.length > 0 ? topDonantes[0].name : '';
                        const mvpAvatar = topDonantes.length > 0 ? topDonantes[0].avatar : '';
                        
                        io.to(user).emit('torneoTurnoTerminado', {
                            chica: s.timerBaile.chicaActual,
                            puntos: s.timerBaile.puntosTurnoActual,
                            mvpName,
                            mvpAvatar
                        });
                    }
                }
            }
        }, 1000);

        res.send("OK");
    });

    app.all('/timer/confirm-elimination', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        const chica = s.timerBaile.chicaAEliminar;
        if (!chica) return res.status(400).send('No hay bailarina por eliminar');
        
        // Registrar eliminación en el torneo sin apagar en la base de datos
        if (!s.timerBaile.eliminadas.includes(chica)) {
            s.timerBaile.eliminadas.push(chica);
        }
        s.timerBaile.participantesActivas = s.timerBaile.participantesActivas.filter(n => n !== chica);
        io.to(user).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });

        // Ocultar el overlay
        io.to(user).emit('revivirCancelado');

        // Verificar si el torneo ha terminado por rondas o por cupo de clasificadas
        const torneoTerminado = (s.timerBaile.rondaActual === s.timerBaile.rondasTotales) || (s.timerBaile.participantesActivas.length <= s.timerBaile.clasificadas);
        
        if (torneoTerminado) {
            s.timerBaile.estado = 'torneo_finalizado';
            s.timerBaile.ganadora = s.timerBaile.participantesActivas[0] || '';
            io.to(user).emit('torneoGanadoraAnunciada', {
                ganadora: s.timerBaile.ganadora,
                puntosTotales: s.timerBaile.puntosTorneo[s.timerBaile.ganadora] || 0
            });
        } else {
            // Pausar torneo esperando continuación manual del admin
            s.timerBaile.estado = 'esperando_siguiente_ronda';
            s.timerBaile.chicaAEliminar = '';
            
            // Avisar al panel que esta ronda se definió
            io.to(user).emit('torneoRondaDecidida', {
                siguienteRonda: s.timerBaile.rondaActual + 1
            });
        }
        
        res.send("OK");
    });

    app.all('/timer/next-round', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;

        if (!s.timerBaile.modoTorneo || s.timerBaile.estado !== 'esperando_siguiente_ronda') {
            return res.status(400).send(`No se puede iniciar la siguiente ronda. modoTorneo: ${s.timerBaile.modoTorneo}, estado: ${s.timerBaile.estado}`);
        }

        if (s.timerBaile.rondaActual >= s.timerBaile.rondasTotales) {
            return res.status(400).send(`El torneo ya ha finalizado todas sus rondas. rondaActual: ${s.timerBaile.rondaActual}, rondasTotales: ${s.timerBaile.rondasTotales}`);
        }

        s.timerBaile.rondaActual++;
        
        // Filtrar orden participante a las que sigan activas en el torneo
        s.timerBaile.orden = [...s.timerBaile.participantesActivas];

        if (s.timerBaile.orden.length === 0) {
            s.timerBaile.activo = false;
            s.timerBaile.estado = 'inactivo';
            s.timerBaile.modoTorneo = false;
            return res.send("TORNEO_FINALIZADO_SIN_PARTICIPANTES");
        }

        s.timerBaile.chicaActual = s.timerBaile.orden[0];
        s.timerBaile.tiempo = s.timerBaile.tiempoBase || 90;
        s.timerBaile.puntosTurnoActual = 0;
        s.timerBaile.estado = 'bailando';

        // Limpiar donantes y regalos del turno
        s.timerBaile.donantesTorneo = {};
        s.timerBaile.donantesAvatarsTorneo = {};
        s.timerBaile.regalosEnviadosTorneo = {};
        s.timerBaile.regalosImgsTorneo = {};

        io.to(user).emit('cambioVista', '/revivir');
        io.to(user).emit('cambioVistaAcumulados', '/revivir-ranking');

        clearInterval(s.intervaloTimerBaile);

        // Emitir el inicio al overlay de revivir
        io.to(user).emit('revivirInicio', {
            chica: s.timerBaile.chicaActual,
            tiempo: s.timerBaile.tiempo,
            meta: s.timerBaile.metaTurno,
            puntos: 0,
            modoTorneo: true,
            rondaActual: s.timerBaile.rondaActual,
            rondasTotales: s.timerBaile.rondasTotales,
            clasificadas: s.timerBaile.clasificadas,
            regalosEnviados: {},
            regalosImgs: {},
            topDonantes: []
        });

        // Iniciar loop del timer
        s.intervaloTimerBaile = setInterval(() => {
            if (s.timerBaile.estado === 'bailando') {
                if (s.timerBaile.tiempo > 0) {
                    s.timerBaile.tiempo--;
                    io.to(user).emit('revivirTick', s.timerBaile.tiempo);
                } else {
                    io.to(user).emit('revivirTick', 0);
                    
                    // Comprobar si es la última bailarina de la ronda
                    let idx = s.timerBaile.orden.indexOf(s.timerBaile.chicaActual);
                    const esUltimaBailarina = (idx === s.timerBaile.orden.length - 1);
                    
                    if (esUltimaBailarina) {
                        // Avanzar de inmediato al fin de la ronda
                        avanzarTurnoTorneo(user);
                    } else {
                        // Pausar el turno para mostrar al MVP (para bailarinas intermedias)
                        s.timerBaile.estado = 'esperando_confirmacion_turno';
                        
                        // Calcular MVP del turno
                        const topDonantes = Object.entries(s.timerBaile.donantesTorneo || {})
                            .map(([name, pts]) => ({ 
                                name, 
                                pts, 
                                avatar: s.timerBaile.donantesAvatarsTorneo[name] || '' 
                            }))
                            .sort((a, b) => b.pts - a.pts);
                        
                        const mvpName = topDonantes.length > 0 ? topDonantes[0].name : '';
                        const mvpAvatar = topDonantes.length > 0 ? topDonantes[0].avatar : '';
                        
                        io.to(user).emit('torneoTurnoTerminado', {
                            chica: s.timerBaile.chicaActual,
                            puntos: s.timerBaile.puntosTurnoActual,
                            mvpName,
                            mvpAvatar
                        });
                    }
                }
            }
        }, 1000);

        res.send("OK");
    });

    app.all('/timer/confirm-next-turn', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;

        if (s.timerBaile.modoTorneo && s.timerBaile.estado === 'esperando_confirmacion_turno') {
            s.timerBaile.estado = 'bailando';
            avanzarTurnoTorneo(user);
            res.send("OK");
        } else {
            res.status(400).send("No se puede avanzar el turno en este estado");
        }
    });

    app.all('/timer/present-champion', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;

        if (s.timerBaile.estado === 'torneo_finalizado' && s.timerBaile.ganadora) {
            io.to(user).emit('torneoCampeonaPantalla', {
                ganadora: s.timerBaile.ganadora,
                puntosTotales: s.timerBaile.puntosTorneo[s.timerBaile.ganadora] || 0
            });
            res.send("OK");
        } else {
            res.status(400).send("No hay campeona definida o el torneo no ha finalizado");
        }
    });

    app.all('/timer/status', requireSession, (req, res) => {
        res.json(req.userSession.timerBaile);
    });

    app.all('/timer/stop', requireSession, (req, res) => {
        const s = req.userSession;
        s.timerBaile.activo = false;
        s.timerBaile.estado = 'inactivo';
        s.timerBaile.modoTorneo = false;
        clearInterval(s.intervaloTimerBaile);
        io.to(req.username).emit('timerCancelado');
        io.to(req.username).emit('revivirCancelado');
        res.send("OK");
    });

    app.all('/timer/skip', requireSession, (req, res) => {
        const s = req.userSession;
        let target = req.query.c;
        if (s.timerBaile.activo) saltarSiguienteChica(req.username, target || null);
        res.send("OK");
    });

    return { saltarSiguienteChica };
}

module.exports = setupTimerDynamics;
