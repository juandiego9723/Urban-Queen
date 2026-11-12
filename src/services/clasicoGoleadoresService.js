const { query: defaultQuery } = require('../config/dbPool');
const { checkIsCosmic } = require('../utils/agencyUtils');
const { getLocalDateStrings } = require('../utils/dateUtils');

const DEFAULT_GOLEADORES_CONFIG = {
    criterio: 'puntos',     // 'puntos' | 'goles'
    soloEnBatalla: true,    // true = acumula únicamente durante batallas activas en Modo Clásico
    mostrarEnHud: false     // true = muestra bloque integrado debajo de batalla-futbol-hud
};

function normalizarEquipoConfig(rawEquipo, fallback) {
    if (Array.isArray(rawEquipo)) {
        return {
            nombre: fallback.nombre,
            diseno: fallback.diseno,
            color1: fallback.color1,
            color2: fallback.color2,
            miembros: rawEquipo.filter(Boolean).map(m => String(m).trim())
        };
    }
    const obj = (rawEquipo && typeof rawEquipo === 'object') ? rawEquipo : {};
    return {
        nombre: String(obj.nombre || fallback.nombre).trim() || fallback.nombre,
        diseno: String(obj.diseno || fallback.diseno).trim() || fallback.diseno,
        color1: String(obj.color1 || fallback.color1).trim() || fallback.color1,
        color2: String(obj.color2 || fallback.color2).trim() || fallback.color2,
        miembros: Array.isArray(obj.miembros)
            ? obj.miembros.filter(Boolean).map(m => String(m).trim())
            : []
    };
}

function normalizarFutbolConfig(rawConfig) {
    const src = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};
    return {
        equipo1: normalizarEquipoConfig(src.equipo1, {
            nombre: 'BARÇA',
            diseno: 'auto',
            color1: '#004D98',
            color2: '#A50044'
        }),
        equipo2: normalizarEquipoConfig(src.equipo2, {
            nombre: 'REAL',
            diseno: 'auto',
            color1: '#FFFFFF',
            color2: '#CCCCCC'
        })
    };
}

function getGoleadoresConfig(session) {
    if (!session || !session.db || typeof session.db.getConfigVal !== 'function') {
        return { ...DEFAULT_GOLEADORES_CONFIG };
    }
    try {
        const raw = session.db.getConfigVal('clasico_goleadores_config');
        if (!raw) return { ...DEFAULT_GOLEADORES_CONFIG };
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return {
            criterio: parsed && parsed.criterio === 'goles' ? 'goles' : 'puntos',
            soloEnBatalla: Boolean(parsed && parsed.soloEnBatalla),
            mostrarEnHud: Boolean(parsed && parsed.mostrarEnHud)
        };
    } catch (e) {
        return { ...DEFAULT_GOLEADORES_CONFIG };
    }
}

async function setGoleadoresConfig(session, body = {}) {
    if (!session || !session.db || typeof session.db.setConfigVal !== 'function') {
        return { ...DEFAULT_GOLEADORES_CONFIG };
    }
    const prev = getGoleadoresConfig(session);
    const next = {
        criterio: body.criterio !== undefined
            ? (body.criterio === 'goles' ? 'goles' : 'puntos')
            : prev.criterio,
        soloEnBatalla: body.soloEnBatalla !== undefined
            ? Boolean(body.soloEnBatalla)
            : prev.soloEnBatalla,
        mostrarEnHud: body.mostrarEnHud !== undefined
            ? Boolean(body.mostrarEnHud)
            : prev.mostrarEnHud
    };
    await session.db.setConfigVal('clasico_goleadores_config', JSON.stringify(next));
    return next;
}

function resolverEquipoPorQueen(session, queenName) {
    const clean = String(queenName || '').trim().toLowerCase();
    if (!clean || !session || !session.db || typeof session.db.getFutbolConfig !== 'function') {
        return null;
    }
    const futbol = normalizarFutbolConfig(session.db.getFutbolConfig());
    const enEq1 = futbol.equipo1.miembros.some(m => m.toLowerCase() === clean);
    if (enEq1) return 1;
    const enEq2 = futbol.equipo2.miembros.some(m => m.toLowerCase() === clean);
    if (enEq2) return 2;
    return null;
}

function getRoomUsername(session) {
    return (session && (session.username || (session.db && session.db.username))) || '';
}

function createClasicoGoleadoresService(deps = {}) {
    const queryFn = deps.query || defaultQuery;
    const getDateStringsFn = deps.getLocalDateStrings || getLocalDateStrings;
    const userQueues = new Map();

    // Serializa escrituras/emisiones por usuario para evitar desorden de eventos en ráfagas rápidas
    function enqueueByUser(key, taskFn) {
        const lockKey = String(key || 'global');
        const prev = userQueues.get(lockKey) || Promise.resolve();
        const next = prev.then(taskFn, taskFn);
        userQueues.set(lockKey, next);
        next.finally(() => {
            if (userQueues.get(lockKey) === next) {
                userQueues.delete(lockKey);
            }
        });
        return next;
    }

    async function obtenerTopGoleadores(session, limite = 3, mesKeyOverride = null) {
        const mesKey = mesKeyOverride || getDateStringsFn().mesStr;
        const cfg = getGoleadoresConfig(session);
        const futbol = session && session.db && typeof session.db.getFutbolConfig === 'function'
            ? normalizarFutbolConfig(session.db.getFutbolConfig())
            : normalizarFutbolConfig(null);

        const basePayload = {
            enabled: Boolean(session && checkIsCosmic(null, session)),
            mesKey,
            config: cfg,
            equipos: {
                equipo1: {
                    nombre: futbol.equipo1.nombre,
                    diseno: futbol.equipo1.diseno,
                    color1: futbol.equipo1.color1,
                    color2: futbol.equipo1.color2
                },
                equipo2: {
                    nombre: futbol.equipo2.nombre,
                    diseno: futbol.equipo2.diseno,
                    color1: futbol.equipo2.color1,
                    color2: futbol.equipo2.color2
                }
            },
            equipo1: [],
            equipo2: []
        };

        if (!basePayload.enabled || !session || !session.db) {
            return basePayload;
        }

        const userId = typeof session.db.ensureUserId === 'function'
            ? await session.db.ensureUserId()
            : session.db.userId;

        if (!userId) return basePayload;

        const maxRows = Math.max(1, Math.min(20, parseInt(limite, 10) || 3));
        const res = await queryFn(
            `SELECT equipo, viewer_name, viewer_avatar, puntos, goles, ultima_queen
             FROM (
                 SELECT
                     equipo,
                     viewer_name,
                     viewer_avatar,
                     puntos,
                     goles,
                     ultima_queen,
                     ROW_NUMBER() OVER (
                         PARTITION BY equipo
                         ORDER BY
                             CASE WHEN $4 = 'goles' THEN goles ELSE puntos END DESC,
                             CASE WHEN $4 = 'goles' THEN puntos ELSE goles END DESC,
                             updated_at ASC,
                             viewer_name ASC
                     ) AS rn
                 FROM clasico_goleadores
                 WHERE user_id = $1
                   AND mes_key = $2
                   AND (CASE WHEN $4 = 'goles' THEN goles ELSE puntos END) > 0
             ) ranked
             WHERE rn <= $3
             ORDER BY equipo ASC, rn ASC`,
            [userId, mesKey, maxRows, cfg.criterio]
        );

        for (const row of (res.rows || [])) {
            const puntosVal = parseInt(row.puntos, 10) || 0;
            const golesVal = parseInt(row.goles, 10) || 0;
            const entry = {
                viewer: row.viewer_name,
                avatar: row.viewer_avatar || '',
                puntos: puntosVal,
                goles: golesVal,
                score: cfg.criterio === 'goles' ? golesVal : puntosVal,
                ultimaQueen: row.ultima_queen || ''
            };
            if (parseInt(row.equipo, 10) === 1) {
                entry.rank = basePayload.equipo1.length + 1;
                basePayload.equipo1.push(entry);
            } else if (parseInt(row.equipo, 10) === 2) {
                entry.rank = basePayload.equipo2.length + 1;
                basePayload.equipo2.push(entry);
            }
        }

        return basePayload;
    }

    async function emitirEstadoGoleadores(session, io, targetSocket = null) {
        if (!session || !checkIsCosmic(null, session)) return null;
        try {
            const payload = await obtenerTopGoleadores(session, 3);
            const roomName = getRoomUsername(session);
            if (targetSocket) {
                targetSocket.emit('goleadoresClasicoActualizados', payload);
            } else if (io && roomName) {
                io.to(roomName).emit('goleadoresClasicoActualizados', payload);
            }
            return payload;
        } catch (err) {
            console.error('[ClasicoGoleadores] Error emitiendo estado:', err.message);
            return null;
        }
    }

    async function registrarAporteGoleador({
        session,
        io = null,
        queenName,
        viewerName,
        viewerAvatar = '',
        puntos = 0,
        goles = 1,
        mesKey = null
    }) {
        if (!session || !session.db || !checkIsCosmic(null, session)) {
            return { recorded: false, reason: 'not-cosmic' };
        }

        const viewer = String(viewerName || '').trim();
        const viewerLower = viewer.toLowerCase();
        if (!viewer || viewerLower === 'anónimo' || viewerLower === 'anonimo') {
            return { recorded: false, reason: 'empty-viewer' };
        }

        const deltaPuntos = Math.max(0, parseInt(puntos, 10) || 0);
        const deltaGoles = Math.max(0, parseInt(goles, 10) || 0);
        if (deltaPuntos === 0 && deltaGoles === 0) {
            return { recorded: false, reason: 'zero-delta' };
        }

        const cfg = getGoleadoresConfig(session);
        if (cfg.soloEnBatalla && !(session.estadoBatalla === 'activa' && session.esBatallaFutbol)) {
            return { recorded: false, reason: 'battle-inactive' };
        }

        const equipo = resolverEquipoPorQueen(session, queenName);
        if (!equipo) {
            return { recorded: false, reason: 'no-team' };
        }

        const userId = typeof session.db.ensureUserId === 'function'
            ? await session.db.ensureUserId()
            : session.db.userId;

        if (!userId) {
            return { recorded: false, reason: 'no-user-id' };
        }

        const activeMes = mesKey || getDateStringsFn().mesStr;
        const avatarClean = String(viewerAvatar || '').trim();
        const queenClean = String(queenName || '').trim();
        const roomName = getRoomUsername(session);

        return enqueueByUser(roomName || userId, async () => {
            await queryFn(
                `INSERT INTO clasico_goleadores (user_id, mes_key, equipo, viewer_name, viewer_avatar, puntos, goles, ultima_queen, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id, mes_key, equipo, viewer_name)
                 DO UPDATE SET
                     puntos = clasico_goleadores.puntos + EXCLUDED.puntos,
                     goles = clasico_goleadores.goles + EXCLUDED.goles,
                     viewer_avatar = CASE WHEN EXCLUDED.viewer_avatar <> '' THEN EXCLUDED.viewer_avatar ELSE clasico_goleadores.viewer_avatar END,
                     ultima_queen = CASE WHEN EXCLUDED.ultima_queen <> '' THEN EXCLUDED.ultima_queen ELSE clasico_goleadores.ultima_queen END,
                     updated_at = CURRENT_TIMESTAMP`,
                [userId, activeMes, equipo, viewer, avatarClean, deltaPuntos, deltaGoles, queenClean]
            );

            const payload = await obtenerTopGoleadores(session, 3, activeMes);
            if (io && roomName) {
                io.to(roomName).emit('goleadoresClasicoActualizados', payload);
            }

            return { recorded: true, equipo, mesKey: activeMes, payload };
        });
    }

    async function reiniciarGoleadoresMes({
        userId = null,
        session = null,
        io = null,
        mesKey = null,
        equipo = null
    }) {
        if (session && !checkIsCosmic(null, session)) {
            return { reset: false, reason: 'not-cosmic' };
        }

        const targetUserId = userId || (session && session.db && (
            typeof session.db.ensureUserId === 'function'
                ? await session.db.ensureUserId()
                : session.db.userId
        ));

        if (!targetUserId) {
            return { reset: false, reason: 'no-user-id' };
        }

        const targetMes = mesKey || getDateStringsFn().mesStr;
        const teamFilter = (equipo === 1 || equipo === 2 || equipo === '1' || equipo === '2')
            ? parseInt(equipo, 10)
            : null;
        const roomName = getRoomUsername(session);

        return enqueueByUser(roomName || targetUserId, async () => {
            if (teamFilter) {
                await queryFn(
                    'DELETE FROM clasico_goleadores WHERE user_id = $1 AND mes_key = $2 AND equipo = $3',
                    [targetUserId, targetMes, teamFilter]
                );
            } else {
                await queryFn(
                    'DELETE FROM clasico_goleadores WHERE user_id = $1 AND mes_key = $2',
                    [targetUserId, targetMes]
                );
            }

            let payload = null;
            if (session && io && roomName) {
                payload = await obtenerTopGoleadores(session, 3, targetMes);
                io.to(roomName).emit('resetGoleadoresClasico', { mesKey: targetMes, equipo: teamFilter });
                io.to(roomName).emit('goleadoresClasicoActualizados', payload);
            }

            return { reset: true, mesKey: targetMes, equipo: teamFilter, payload };
        });
    }

    return {
        DEFAULT_GOLEADORES_CONFIG,
        normalizarFutbolConfig,
        getGoleadoresConfig,
        setGoleadoresConfig,
        resolverEquipoPorQueen,
        obtenerTopGoleadores,
        emitirEstadoGoleadores,
        registrarAporteGoleador,
        reiniciarGoleadoresMes
    };
}

const defaultInstance = createClasicoGoleadoresService();

module.exports = {
    createClasicoGoleadoresService,
    ...defaultInstance
};
