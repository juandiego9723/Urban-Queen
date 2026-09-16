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
                // Fin de ronda: Pausar el timer e iniciar la fase de gestión de decisiones de la ronda
                clearInterval(s.intervaloTimerBaile);
                
                s.timerBaile.estado = 'esperando_decision_ronda';

                if (!s.timerBaile.enRiesgo) s.timerBaile.enRiesgo = [];
                if (!s.timerBaile.salvadas) s.timerBaile.salvadas = [];
                if (!s.timerBaile.eliminadas) s.timerBaile.eliminadas = [];

                // Determinar la última bailarina de esta ronda (la de menor puntaje acumulado en el torneo que no esté ya salvada ni eliminada)
                const candidatas = (s.timerBaile.participantesActivas || []).filter(c => 
                    !s.timerBaile.salvadas.includes(c) && !s.timerBaile.eliminadas.includes(c)
                );

                if (candidatas.length > 0) {
                    candidatas.sort((a, b) => (s.timerBaile.puntosTorneo[a] || 0) - (s.timerBaile.puntosTorneo[b] || 0));
                    const ultimaLugar = candidatas[0];
                    if (ultimaLugar && !s.timerBaile.enRiesgo.includes(ultimaLugar)) {
                        s.timerBaile.enRiesgo.push(ultimaLugar);
                    }
                }

                io.to(username).emit('torneoFinRondaEsperandoDecision', {
                    rondaActual: s.timerBaile.rondaActual,
                    puntosTorneo: s.timerBaile.puntosTorneo,
                    participantesActivas: s.timerBaile.participantesActivas,
                    eliminadas: s.timerBaile.eliminadas,
                    salvadas: s.timerBaile.salvadas || [],
                    enRiesgo: s.timerBaile.enRiesgo || []
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
            s.timerBaile.estado = 'intro';
            
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

            clearTimeout(s.introTimeoutTorneo);
            s.introTimeoutTorneo = setTimeout(() => {
                if (s.timerBaile && s.timerBaile.modoTorneo && s.timerBaile.estado === 'intro') {
                    s.timerBaile.estado = 'bailando';
                }
            }, 4200);
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
        const clasificadas = 1;

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
        s.timerBaile.rondasTotales = 0;
        s.timerBaile.rondaActual = 1;
        s.timerBaile.orden = [...participantes];
        s.timerBaile.participantesOriginales = [...participantes];
        s.timerBaile.participantesActivas = [...participantes];
        s.timerBaile.eliminadas = [];
        s.timerBaile.salvadas = [];
        s.timerBaile.enRiesgo = [];
        s.timerBaile.revividasEnRonda = [];
        s.timerBaile.tiempo = tiempoBase;
        s.timerBaile.tiempoBase = tiempoBase;
        s.timerBaile.chicaActual = participantes[0];
        s.timerBaile.estado = 'intro';
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

        clearTimeout(s.introTimeoutTorneo);
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

        s.introTimeoutTorneo = setTimeout(() => {
            if (s.timerBaile && s.timerBaile.modoTorneo && s.timerBaile.estado === 'intro') {
                s.timerBaile.estado = 'bailando';
            }
        }, 4200);

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

    app.all('/timer/start-salvacion', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        const chica = req.query.chica || (req.body && req.body.chica) || '';
        const tiempo = parseInt(req.query.tiempo || (req.body && req.body.tiempo)) || 90;
        const meta = parseInt(req.query.meta || (req.body && req.body.meta)) || 500;

        if (!chica) return res.status(400).send('Falta especificar la bailarina');

        s.revivir.chicaActual = chica;
        s.revivir.meta = meta;
        s.revivir.tiempo = tiempo;
        s.revivir.puntos = 0;
        s.revivir.donantes = {};
        s.revivir.donantesAvatars = {};
        s.revivir.regalosEnviados = {};
        s.revivir.regalosImgs = {};
        s.revivir.activo = true;
        s.revivir.estado = 'activo';

        s.vistaActiva = '/revivir';
        io.to(user).emit('cambioVista', '/revivir');

        io.to(user).emit('revivirInicio', {
            chica: s.revivir.chicaActual,
            tiempo: s.revivir.tiempo,
            meta: s.revivir.meta,
            puntos: 0,
            modoTorneo: true,
            rondaActual: s.timerBaile.rondaActual,
            rondasTotales: s.timerBaile.rondasTotales,
            regalosEnviados: {},
            regalosImgs: {},
            topDonantes: []
        });

        clearTimeout(s.introTimeoutRevivir);
        clearInterval(s.intervaloRevivir);

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
                        s.revivir.activo = false;
                        s.revivir.estado = 'inactivo';

                        if (!s.timerBaile.salvadas) s.timerBaile.salvadas = [];
                        if (!s.timerBaile.enRiesgo) s.timerBaile.enRiesgo = [];
                        if (exito) {
                            if (!s.timerBaile.salvadas.includes(chica)) s.timerBaile.salvadas.push(chica);
                            if (!s.timerBaile.participantesActivas.includes(chica)) s.timerBaile.participantesActivas.push(chica);
                            s.timerBaile.enRiesgo = s.timerBaile.enRiesgo.filter(n => n !== chica);
                            s.timerBaile.eliminadas = s.timerBaile.eliminadas.filter(n => n !== chica);

                            io.to(user).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
                            io.to(user).emit('revivirCancelado');
                            io.to(user).emit('torneoSalvacionConcluida', {
                                chica,
                                exito: true,
                                rondaActual: s.timerBaile.rondaActual,
                                participantesActivas: s.timerBaile.participantesActivas,
                                salvadas: s.timerBaile.salvadas,
                                eliminadas: s.timerBaile.eliminadas,
                                enRiesgo: s.timerBaile.enRiesgo
                            });
                            s.timerBaile.estado = 'esperando_decision_ronda';
                        } else {
                            // En fallo por tiempo, NO eliminar automáticamente.
                            // Mantener en riesgo, fijar chicaAEliminar y notificar fallo para que el admin decida en el control panel.
                            s.timerBaile.chicaAEliminar = chica;
                            if (!s.timerBaile.enRiesgo.includes(chica)) s.timerBaile.enRiesgo.push(chica);

                            io.to(user).emit('revivirFalloTiempoOut', {
                                chica,
                                apodo: s.db.getApodosMap()[chica] || chica,
                                puntos: s.revivir.puntos,
                                meta: s.revivir.meta
                            });

                            io.to(user).emit('torneoSalvacionConcluida', {
                                chica,
                                exito: false,
                                tiempoOut: true,
                                rondaActual: s.timerBaile.rondaActual,
                                participantesActivas: s.timerBaile.participantesActivas,
                                salvadas: s.timerBaile.salvadas || [],
                                eliminadas: s.timerBaile.eliminadas || [],
                                enRiesgo: s.timerBaile.enRiesgo
                            });
                            s.timerBaile.estado = 'esperando_decision_ronda';
                        }
                    }
                }
            }, 1000);
        }, 4200);

        res.send("OK");
    });

    app.all('/timer/save-direct', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        const chica = req.query.chica || (req.body && req.body.chica) || '';
        if (!chica) return res.status(400).send('Falta especificar la bailarina');

        if (!s.timerBaile.salvadas) s.timerBaile.salvadas = [];
        if (!s.timerBaile.enRiesgo) s.timerBaile.enRiesgo = [];
        if (!s.timerBaile.salvadas.includes(chica)) s.timerBaile.salvadas.push(chica);
        if (!s.timerBaile.participantesActivas.includes(chica)) s.timerBaile.participantesActivas.push(chica);
        s.timerBaile.enRiesgo = s.timerBaile.enRiesgo.filter(n => n !== chica);
        s.timerBaile.eliminadas = s.timerBaile.eliminadas.filter(n => n !== chica);

        io.to(user).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });
        io.to(user).emit('torneoSalvacionConcluida', {
            chica,
            exito: true,
            paseDirecto: true,
            rondaActual: s.timerBaile.rondaActual,
            participantesActivas: s.timerBaile.participantesActivas,
            salvadas: s.timerBaile.salvadas,
            eliminadas: s.timerBaile.eliminadas,
            enRiesgo: s.timerBaile.enRiesgo
        });

        res.send("OK");
    });

    app.all('/timer/confirm-elimination', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        const chica = req.query.chica || (req.body && req.body.chica) || s.timerBaile.chicaAEliminar;
        if (!chica) return res.status(400).send('No hay bailarina por eliminar');
        
        if (!s.timerBaile.eliminadas.includes(chica)) {
            s.timerBaile.eliminadas.push(chica);
        }
        s.timerBaile.participantesActivas = s.timerBaile.participantesActivas.filter(n => n !== chica);
        if (!s.timerBaile.enRiesgo) s.timerBaile.enRiesgo = [];
        s.timerBaile.enRiesgo = s.timerBaile.enRiesgo.filter(n => n !== chica);
        if (s.timerBaile.salvadas) {
            s.timerBaile.salvadas = s.timerBaile.salvadas.filter(n => n !== chica);
        }
        io.to(user).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });

        io.to(user).emit('revivirCancelado');
        io.to(user).emit('torneoSalvacionConcluida', {
            chica,
            exito: false,
            eliminada: true,
            rondaActual: s.timerBaile.rondaActual,
            participantesActivas: s.timerBaile.participantesActivas,
            salvadas: s.timerBaile.salvadas || [],
            eliminadas: s.timerBaile.eliminadas,
            enRiesgo: s.timerBaile.enRiesgo
        });

        const torneoTerminado = (s.timerBaile.participantesActivas.length <= 1);
        if (torneoTerminado) {
            s.timerBaile.estado = 'torneo_finalizado';
            s.timerBaile.ganadora = s.timerBaile.participantesActivas[0] || '';
            io.to(user).emit('torneoGanadoraAnunciada', {
                ganadora: s.timerBaile.ganadora,
                puntosTotales: s.timerBaile.puntosTorneo[s.timerBaile.ganadora] || 0
            });
        } else {
            s.timerBaile.estado = 'esperando_decision_ronda';
            s.timerBaile.chicaAEliminar = '';
        }

        res.send("OK");
    });

    app.all('/timer/next-round', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;

        if (!s.timerBaile.modoTorneo) {
            return res.status(400).send('El modo torneo no está activo');
        }

        s.timerBaile.rondaActual++;
        s.timerBaile.revividasEnRonda = [];
        s.timerBaile.salvadas = [];
        s.timerBaile.enRiesgo = [];
        
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
        s.timerBaile.estado = 'intro';

        // Limpiar donantes y regalos del turno
        s.timerBaile.donantesTorneo = {};
        s.timerBaile.donantesAvatarsTorneo = {};
        s.timerBaile.regalosEnviadosTorneo = {};
        s.timerBaile.regalosImgsTorneo = {};

        io.to(user).emit('cambioVista', '/revivir');
        io.to(user).emit('cambioVistaAcumulados', '/revivir-ranking');

        clearTimeout(s.introTimeoutTorneo);
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
            participantesActivas: s.timerBaile.participantesActivas,
            salvadas: [],
            enRiesgo: [],
            regalosEnviados: {},
            regalosImgs: {},
            topDonantes: []
        });

        s.introTimeoutTorneo = setTimeout(() => {
            if (s.timerBaile && s.timerBaile.modoTorneo && s.timerBaile.estado === 'intro') {
                s.timerBaile.estado = 'bailando';
            }
        }, 4200);

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
            const targetChica = s.timerBaile.proximoInicioTurno || null;
            s.timerBaile.proximoInicioTurno = null;
            avanzarTurnoTorneo(user, targetChica);
            res.send("OK");
        } else {
            res.status(400).send("No se puede avanzar el turno en este estado");
        }
    });

    app.all('/timer/present-champion', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;

        if (!s.timerBaile.ganadora && s.timerBaile.participantesActivas && s.timerBaile.participantesActivas.length <= 1) {
            s.timerBaile.ganadora = s.timerBaile.participantesActivas[0] || '';
            s.timerBaile.estado = 'torneo_finalizado';
        }

        if (s.timerBaile.ganadora) {
            s.timerBaile.estado = 'torneo_finalizado';
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
        s.timerBaile.rondaActual = 0;
        s.timerBaile.rondasTotales = 0;
        s.timerBaile.participantesActivas = [];
        s.timerBaile.eliminadas = [];
        s.timerBaile.revividasEnRonda = [];
        s.timerBaile.puntosTorneo = {};
        s.timerBaile.chicaActual = '';
        s.timerBaile.chicaAEliminar = '';
        s.timerBaile.ganadora = '';
        clearTimeout(s.introTimeoutTorneo);
        clearInterval(s.intervaloTimerBaile);

        // Reconstruir Queens para notificar a los clientes y refrescar interfaz
        reconstruirQueens(s);
        io.to(req.username).emit('queensActualizadas', { queens: s.QUEENS, equipos: s.equipos, apodos: s.db.getApodosMap() });

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
