const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const MasterDB = require('../../masterDb');
const { getUserSession, activeSessions } = require('../config/sessionStore');

function setupAgencyRoutes(app, requireSession) {
    app.get('/api/agency/overview', requireSession, (req, res) => {
        if (req.username !== 'admin' && req.username !== 'master') {
            return res.status(403).json({ error: 'No autorizado' });
        }
        try {
            const allUsers = MasterDB.getAllUsers();
            let totalHoyAgencia = 0;
            let totalMesAgencia = 0;
            let totalHistoricoAgencia = 0;
            
            const dancers = allUsers.map(u => {
                const session = getUserSession(u.username);
                let diamantesHoy = 0, diamantesMes = 0, diamantesHistorico = 0;
                try {
                    const resumen = session.db.getResumenAnalytics();
                    diamantesHoy = resumen.totalHoy || 0;
                    diamantesMes = resumen.totalMes || 0;
                    diamantesHistorico = resumen.totalHistorico || 0;
                } catch (e) {}
                
                totalHoyAgencia += diamantesHoy;
                totalMesAgencia += diamantesMes;
                totalHistoricoAgencia += diamantesHistorico;
                
                return {
                    username: u.username,
                    name: u.name || u.username,
                    tiktokEstado: session.tiktokEstado || 'desconectado',
                    tiktokUsuario: session.tiktokUsuario || '',
                    vistaActiva: session.vistaActiva || '/batalla',
                    diamantesHoy,
                    diamantesMes,
                    diamantesHistorico
                };
            });
            
            res.json({
                kpis: {
                    totalHoy: totalHoyAgencia,
                    totalMes: totalMesAgencia,
                    totalHistorico: totalHistoricoAgencia
                },
                dancers
            });
        } catch (e) {
            console.error('Error en agency/overview:', e);
            res.status(500).json({ error: 'Error interno' });
        }
    });

    app.get('/api/agency/login-as', (req, res) => {
        if (!req.session || !req.session.user) return res.redirect('/login');
        if (req.session.user !== 'admin' && req.session.user !== 'master') {
            return res.status(403).send('No autorizado');
        }
        const targetUser = req.query.user;
        if (!targetUser) return res.status(400).send('Falta parámetro user');
        const userExists = MasterDB.obtenerUsuario(targetUser);
        if (!userExists) return res.status(404).send('Usuario no encontrado');
        res.setSession(targetUser, { name: userExists.name || targetUser });
        res.redirect('/control');
    });

    app.get('/login-as', requireSession, (req, res) => {
        if (req.username !== 'admin' && req.username !== 'master') {
            return res.status(403).send('No autorizado');
        }
        
        const targetUser = req.query.user;
        if (!targetUser) return res.status(400).send('Falta usuario');
        
        const user = MasterDB.obtenerUsuario(targetUser);
        if (!user) return res.status(404).send('Usuario no encontrado');
        
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions[targetUser] = getUserSession(targetUser);
        activeSessions[targetUser].token = token;
        
        res.cookie('session_token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
        res.redirect('/control');
    });

    app.all('/api/agency/eliminar-usuario', (req, res) => {
        if (!req.session || !req.session.user) return res.status(401).send('No autenticado');
        if (req.session.user !== 'admin' && req.session.user !== 'master') {
            return res.status(403).send('No autorizado');
        }
        const targetUser = (req.query.user || (req.body && req.body.user) || '').trim();
        if (!targetUser) return res.status(400).send('Falta parámetro user');
        if (targetUser.toLowerCase() === 'admin' || targetUser === req.session.user) {
            return res.status(400).send('No se puede eliminar la cuenta principal de administrador ni tu usuario activo');
        }
        try {
            const session = activeSessions[targetUser];
            if (session) {
                clearInterval(session.batchInterval);
                if (session.tiktokConnection) {
                    try { session.tiktokConnection.disconnect(); } catch (e) {}
                }
                if (session.db) {
                    session.db.close();
                }
                delete activeSessions[targetUser];
            }
            MasterDB.eliminarUsuario(targetUser);

            const rootDir = path.join(__dirname, '..', '..');
            const userDbPath = path.join(rootDir, `database_${targetUser}.db`);
            if (fs.existsSync(userDbPath)) {
                try { fs.unlinkSync(userDbPath); } catch (e) { console.error('Error eliminando db:', e.message); }
            }

            res.json({ status: 'OK', message: `Usuario ${targetUser} eliminado correctamente` });
        } catch (e) {
            res.status(500).send(e.message || 'Error eliminando usuario');
        }
    });
}

module.exports = setupAgencyRoutes;
