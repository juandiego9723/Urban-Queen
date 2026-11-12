-- ═══════════════════════════════════════════════════════════════════
--  🏆 TikDance / Urban Queens – Supabase PostgreSQL Schema (1FN-3FN)
-- ═══════════════════════════════════════════════════════════════════

-- 1. Tabla de Usuarios Administradores (Tenants)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Solicitudes de Restablecimiento de Contraseña
CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at BIGINT NOT NULL
);

-- 3. Tabla de Queens (Normalizada por user_id)
CREATE TABLE IF NOT EXISTS queens (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    apodo VARCHAR(100) DEFAULT '',
    color VARCHAR(20) DEFAULT '#ffffff',
    avatar_img TEXT DEFAULT '',
    regalo_img TEXT DEFAULT '',
    regalo_pts INT DEFAULT 0,
    activo INT DEFAULT 1,
    ranking_diario INT DEFAULT 0,
    ranking_semanal INT DEFAULT 0,
    ranking_mensual INT DEFAULT 0,
    victorias INT DEFAULT 0,
    empates INT DEFAULT 0,
    derrotas INT DEFAULT 0,
    copa INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_queen UNIQUE(user_id, name)
);

-- 4. Aliases
CREATE TABLE IF NOT EXISTS aliases (
    id SERIAL PRIMARY KEY,
    queen_id INT NOT NULL REFERENCES queens(id) ON DELETE CASCADE,
    alias_name VARCHAR(100) NOT NULL,
    CONSTRAINT uq_queen_alias UNIQUE(queen_id, alias_name)
);

-- 5. Grupos
CREATE TABLE IF NOT EXISTS grupos (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#ffffff',
    CONSTRAINT uq_user_grupo UNIQUE(user_id, nombre)
);

-- 6. Integrantes de Grupos
CREATE TABLE IF NOT EXISTS grupo_miembros (
    grupo_id INT NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    queen_id INT NOT NULL REFERENCES queens(id) ON DELETE CASCADE,
    PRIMARY KEY (grupo_id, queen_id)
);

-- 7. Configuración Dinámica por Usuario
CREATE TABLE IF NOT EXISTS config (
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clave VARCHAR(100) NOT NULL,
    valor TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, clave)
);

-- 8. Historial de Regalos (TikTok Stream Events)
CREATE TABLE IF NOT EXISTS historial_regalos (
    id BIGSERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    queen_id INT NOT NULL REFERENCES queens(id) ON DELETE CASCADE,
    gift_name VARCHAR(100) NOT NULL,
    diamonds INT NOT NULL DEFAULT 0,
    viewer_name VARCHAR(100) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Regalos Personalizados
CREATE TABLE IF NOT EXISTS regalos_custom (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    accion VARCHAR(255) DEFAULT '',
    imagen TEXT NOT NULL,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. Sonidos por Evento
CREATE TABLE IF NOT EXISTS sonidos (
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    evento VARCHAR(100) NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, evento)
);

-- 11. Máximos Goleadores Mensuales de El Clásico (Exclusivo Cosmic)
CREATE TABLE IF NOT EXISTS clasico_goleadores (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mes_key VARCHAR(7) NOT NULL,
    equipo SMALLINT NOT NULL CHECK (equipo IN (1, 2)),
    viewer_name VARCHAR(255) NOT NULL,
    viewer_avatar TEXT NOT NULL DEFAULT '',
    puntos INT NOT NULL DEFAULT 0,
    goles INT NOT NULL DEFAULT 0,
    ultima_queen VARCHAR(255) NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, mes_key, equipo, viewer_name)
);

-- Índices de Optimización para Consultas Frecuentes
CREATE INDEX IF NOT EXISTS idx_queens_user ON queens(user_id);
CREATE INDEX IF NOT EXISTS idx_historial_user_queen ON historial_regalos(user_id, queen_id);
CREATE INDEX IF NOT EXISTS idx_historial_timestamp ON historial_regalos(timestamp);
CREATE INDEX IF NOT EXISTS idx_historial_user_ts ON historial_regalos(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_clasico_goleadores_lookup ON clasico_goleadores(user_id, mes_key, equipo, puntos DESC, goles DESC);
