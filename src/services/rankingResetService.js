// ═══════════════════════════════════════════════════════════════════
//  🏆 TikDance / Urban Queens & Cosmic – rankingResetService.js
//  Servicio centralizado y robusto de reinicio de rankings
//  (Diario, Semanal, Mensual) con zona horaria local garantizada.
// ═══════════════════════════════════════════════════════════════════

const { query } = require('../config/dbPool');

function getTimezone() {
    return process.env.TIMEZONE || 'America/Bogota';
}

/**
 * Devuelve las cadenas de fecha local (dia, mes y semana ISO)
 * estrictamente calculadas según la zona horaria configurada.
 */
function getLocalDateStrings(tz = getTimezone(), date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    
    // YYYY-MM-DD en la zona horaria local
    const diaStr = formatter.format(date);
    // YYYY-MM
    const mesStr = diaStr.substring(0, 7);

    // Cálculo preciso de la semana ISO en la zona horaria local
    const parts = formatter.formatToParts(date);
    const y = parseInt(parts.find(p => p.type === 'year').value, 10);
    const m = parseInt(parts.find(p => p.type === 'month').value, 10) - 1;
    const d = parseInt(parts.find(p => p.type === 'day').value, 10);

    const target = new Date(Date.UTC(y, m, d));
    const dayNr = target.getUTCDay() || 7; // 1 = Lunes, 7 = Domingo
    target.setUTCDate(target.getUTCDate() + 4 - dayNr);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
    const semanaStr = `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;

    return { diaStr, mesStr, semanaStr };
}

/**
 * Verifica y ejecuta el reinicio si corresponde para una sesión en memoria activa.
 */
async function verificarResetParaSesion(session, username, io) {
    if (!session || !session.db) return { huboCambios: false };

    const tz = getTimezone();
    const { diaStr, mesStr, semanaStr } = getLocalDateStrings(tz);

    let huboCambios = false;
    let huboDiario = false;
    let huboSemanal = false;
    let huboMensual = false;

    try {
        const lastDiario = session.db.getConfigVal('last_reset_diario') || '';
        const lastSemanal = session.db.getConfigVal('last_reset_semanal') || '';
        const lastMensual = session.db.getConfigVal('last_reset_mensual') || '';

        // 1. Reset Diario
        if (!lastDiario) {
            await session.db.setConfigVal('last_reset_diario', diaStr);
        } else if (lastDiario !== diaStr) {
            console.log(`[RankingReset] [${username}] Nuevo día detectado: ${diaStr} (Anterior: ${lastDiario}). Reiniciando diario.`);
            await session.db.resetDiario();
            await session.db.setConfigVal('last_reset_diario', diaStr);
            if (io) io.to(username).emit('resetDiario');
            huboCambios = true;
            huboDiario = true;
        }

        // 2. Reset Semanal
        if (!lastSemanal) {
            await session.db.setConfigVal('last_reset_semanal', semanaStr);
        } else if (lastSemanal !== semanaStr) {
            console.log(`[RankingReset] [${username}] Nueva semana detectada: ${semanaStr} (Anterior: ${lastSemanal}). Reiniciando semanal.`);
            await session.db.resetSemanal();
            await session.db.setConfigVal('last_reset_semanal', semanaStr);
            if (io) {
                io.to(username).emit('resetRanking');
                io.to(username).emit('resetSemanal');
            }
            huboCambios = true;
            huboSemanal = true;
        }

        // 3. Reset Mensual
        if (!lastMensual) {
            await session.db.setConfigVal('last_reset_mensual', mesStr);
        } else if (lastMensual !== mesStr) {
            console.log(`[RankingReset] [${username}] Nuevo mes detectado: ${mesStr} (Anterior: ${lastMensual}). Reiniciando mensual.`);
            await session.db.resetMensual();
            await session.db.setConfigVal('last_reset_mensual', mesStr);
            if (io) io.to(username).emit('resetMensual');
            huboCambios = true;
            huboMensual = true;
        }

        if (huboCambios && io) {
            io.to(username).emit('rankingActualizado');
            io.to(username).emit('queensActualizadas', {
                queens: session.QUEENS,
                equipos: session.equipos,
                apodos: session.db.getApodosMap()
            });
        }
    } catch (e) {
        console.error(`[RankingReset] Error verificando resets para '${username}':`, e);
    }

    return { huboCambios, huboDiario, huboSemanal, huboMensual, diaStr, mesStr, semanaStr };
}

/**
 * Revisa y reinicia para TODOS los usuarios de la base de datos (tanto sesiones activas como inactivas).
 * Garantiza que a las 00:00:00 ambas agencias se reseteen limpiamente.
 */
async function verificarTodosLosUsuarios(io, activeSessions = {}) {
    const tz = getTimezone();
    const { diaStr, mesStr, semanaStr } = getLocalDateStrings(tz);

    // 1. Primero procesar sesiones activas en memoria
    const activeUsernames = Object.keys(activeSessions);
    for (const u of activeUsernames) {
        const session = activeSessions[u];
        if (session) {
            await verificarResetParaSesion(session, u, io);
        }
    }

    // 2. Procesar usuarios inactivos en base de datos para asegurar persistencia global
    try {
        const usersRes = await query('SELECT id, username FROM users');
        const allUsers = usersRes.rows || [];

        for (const u of allUsers) {
            if (activeSessions[u.username]) continue; // Ya procesado arriba

            const uId = u.id;
            const cfgRes = await query('SELECT clave, valor FROM config WHERE user_id = $1 AND clave LIKE $2', [uId, 'last_reset%']);
            const cfgMap = {};
            (cfgRes.rows || []).forEach(r => { cfgMap[r.clave] = r.valor; });

            const lastDiario = cfgMap['last_reset_diario'] || '';
            const lastSemanal = cfgMap['last_reset_semanal'] || '';
            const lastMensual = cfgMap['last_reset_mensual'] || '';

            // Diario
            if (!lastDiario) {
                await query('INSERT INTO config (user_id, clave, valor) VALUES ($1, $2, $3) ON CONFLICT (user_id, clave) DO UPDATE SET valor = EXCLUDED.valor', [uId, 'last_reset_diario', diaStr]);
            } else if (lastDiario !== diaStr) {
                console.log(`[RankingReset] [DB User ${u.username}] Nuevo día detectado: ${diaStr}. Reseteando ranking diario en DB.`);
                await query('UPDATE queens SET ranking_diario = 0 WHERE user_id = $1', [uId]);
                await query('UPDATE config SET valor = $1 WHERE user_id = $2 AND clave = $3', [diaStr, uId, 'last_reset_diario']);
            }

            // Semanal
            if (!lastSemanal) {
                await query('INSERT INTO config (user_id, clave, valor) VALUES ($1, $2, $3) ON CONFLICT (user_id, clave) DO UPDATE SET valor = EXCLUDED.valor', [uId, 'last_reset_semanal', semanaStr]);
            } else if (lastSemanal !== semanaStr) {
                console.log(`[RankingReset] [DB User ${u.username}] Nueva semana detectada: ${semanaStr}. Reseteando ranking semanal en DB.`);
                await query('UPDATE queens SET ranking_semanal = 0 WHERE user_id = $1', [uId]);
                await query('UPDATE config SET valor = $1 WHERE user_id = $2 AND clave = $3', [semanaStr, uId, 'last_reset_semanal']);
            }

            // Mensual
            if (!lastMensual) {
                await query('INSERT INTO config (user_id, clave, valor) VALUES ($1, $2, $3) ON CONFLICT (user_id, clave) DO UPDATE SET valor = EXCLUDED.valor', [uId, 'last_reset_mensual', mesStr]);
            } else if (lastMensual !== mesStr) {
                console.log(`[RankingReset] [DB User ${u.username}] Nuevo mes detectado: ${mesStr}. Reseteando ranking mensual en DB.`);
                await query('UPDATE queens SET ranking_mensual = 0 WHERE user_id = $1', [uId]);
                await query('UPDATE config SET valor = $1 WHERE user_id = $2 AND clave = $3', [mesStr, uId, 'last_reset_mensual']);
            }
        }
    } catch (e) {
        console.error('[RankingReset] Error en verificación global de usuarios en DB:', e.message);
    }
}

/**
 * Ejecuta un reset manual invocado desde la UI, sincronizando base de datos, memoria y sockets.
 */
async function ejecutarResetManual(userSession, username, io, tipo) {
    if (!userSession || !userSession.db) return;
    const tz = getTimezone();
    const { diaStr, mesStr, semanaStr } = getLocalDateStrings(tz);

    if (tipo === 'diario') {
        await userSession.db.resetDiario();
        await userSession.db.setConfigVal('last_reset_diario', diaStr);
        if (io) {
            io.to(username).emit('resetDiario');
            io.to(username).emit('rankingActualizado');
        }
    } else if (tipo === 'semanal') {
        await userSession.db.resetSemanal();
        await userSession.db.setConfigVal('last_reset_semanal', semanaStr);
        if (io) {
            io.to(username).emit('resetRanking');
            io.to(username).emit('resetSemanal');
            io.to(username).emit('rankingActualizado');
        }
    } else if (tipo === 'mensual') {
        await userSession.db.resetMensual();
        await userSession.db.setConfigVal('last_reset_mensual', mesStr);
        if (io) {
            io.to(username).emit('resetMensual');
            io.to(username).emit('rankingActualizado');
        }
    } else if (tipo === 'total') {
        await userSession.db.resetSemanal();
        await userSession.db.resetMensual();
        await userSession.db.resetDiario();
        await userSession.db.resetCopa();
        await userSession.db.resetVictorias();
        await userSession.db.setConfigVal('last_reset_diario', diaStr);
        await userSession.db.setConfigVal('last_reset_semanal', semanaStr);
        await userSession.db.setConfigVal('last_reset_mensual', mesStr);

        (userSession.QUEENS || []).forEach(q => {
            if (userSession.rachasPerdidas) userSession.rachasPerdidas[q] = 0;
            if (userSession.amarillasAcumuladas) userSession.amarillasAcumuladas[q] = 0;
        });

        if (io) {
            io.to(username).emit('resetRanking');
            io.to(username).emit('resetSemanal');
            io.to(username).emit('resetMensual');
            io.to(username).emit('resetDiario');
            io.to(username).emit('actualizarCopa', userSession.db.getCopa());
            io.to(username).emit('rankingActualizado');
        }
    }

    if (io) {
        io.to(username).emit('queensActualizadas', {
            queens: userSession.QUEENS,
            equipos: userSession.equipos,
            apodos: userSession.db.getApodosMap()
        });
    }
}

/**
 * Inicia el temporizador de fondo en el servidor para verificar cada 30 segundos
 * si ocurrió la medianoche o un cambio de ciclo en la hora local.
 */
let schedulerInterval = null;
let lastKnownDia = '';
let lastKnownSemana = '';
let lastKnownMes = '';

function iniciarScheduler(io, activeSessions) {
    if (schedulerInterval) return;

    const tz = getTimezone();
    const initial = getLocalDateStrings(tz);
    lastKnownDia = initial.diaStr;
    lastKnownSemana = initial.semanaStr;
    lastKnownMes = initial.mesStr;

    console.log(`⏰ [RankingReset] Scheduler iniciado. Zona: ${tz} | Día: ${lastKnownDia} | Semana: ${lastKnownSemana} | Mes: ${lastKnownMes}`);

    // Ejecutar verificación inicial de inmediato
    verificarTodosLosUsuarios(io, activeSessions).catch(e => {
        console.error('[RankingReset] Error en verificación inicial del scheduler:', e);
    });

    // Evaluar cada 30 segundos
    schedulerInterval = setInterval(async () => {
        try {
            const current = getLocalDateStrings(tz);
            const cambioDia = current.diaStr !== lastKnownDia;
            const cambioSemana = current.semanaStr !== lastKnownSemana;
            const cambioMes = current.mesStr !== lastKnownMes;

            if (cambioDia || cambioSemana || cambioMes) {
                console.log(`🌅 [RankingReset] Transición detectada en ${tz}: Día (${lastKnownDia} -> ${current.diaStr}), Semana (${lastKnownSemana} -> ${current.semanaStr}), Mes (${lastKnownMes} -> ${current.mesStr}). Ejecutando auto-resets...`);
                lastKnownDia = current.diaStr;
                lastKnownSemana = current.semanaStr;
                lastKnownMes = current.mesStr;

                await verificarTodosLosUsuarios(io, activeSessions);
            }
        } catch (err) {
            console.error('[RankingReset] Error en ciclo del scheduler:', err);
        }
    }, 30000);
}

module.exports = {
    getTimezone,
    getLocalDateStrings,
    verificarResetParaSesion,
    verificarTodosLosUsuarios,
    ejecutarResetManual,
    iniciarScheduler
};
