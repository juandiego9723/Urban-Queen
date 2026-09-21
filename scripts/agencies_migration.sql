-- ═══════════════════════════════════════════════════════════════════
--  🏆 TikDance – Script de Migración Multi-Agencia (PostgreSQL / Supabase)
-- ═══════════════════════════════════════════════════════════════════

-- 1. Tabla de Agencias
CREATE TABLE IF NOT EXISTS agencies (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    logo_url TEXT,
    primary_color VARCHAR(50) DEFAULT '#8A2BE2',
    secondary_color VARCHAR(50) DEFAULT '#4B0082',
    theme_config JSONB DEFAULT '{
        "fontFamily": "Outfit, sans-serif",
        "backgroundGradient": "linear-gradient(135deg, #0d0614 0%, #1a0933 100%)",
        "cardBackground": "rgba(30, 15, 50, 0.85)",
        "accentColor": "#D8BFD8"
    }'::jsonb,
    ranking_config JSONB DEFAULT '{
        "multiplier": 1.0,
        "dailyResetHour": 0,
        "monthlyResetDay": 1,
        "titles": [
            { "minPts": 0, "title": "Nivel Cómputo", "icon": "⭐" },
            { "minPts": 1000, "title": "Estrella Cósmica", "icon": "🌌" },
            { "minPts": 5000, "title": "Reina de Galaxias", "icon": "👑" }
        ]
    }'::jsonb,
    dynamics_config JSONB DEFAULT '{
        "timerDefaultSeconds": 60,
        "yellowCardThreshold": 2,
        "eliminationMode": "classic"
    }'::jsonb,
    points_config JSONB DEFAULT '{
        "diamondToPointsRatio": 1.0,
        "streakBonusEnabled": true
    }'::jsonb,
    enabled_dynamics JSONB DEFAULT '["timer", "batalla", "futbol", "revivir", "conociendo", "custom"]'::jsonb,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agencies_slug ON agencies(slug);

-- 2. Vincular Usuarios a Agencias
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='agency_id') THEN
        ALTER TABLE users ADD COLUMN agency_id INTEGER REFERENCES agencies(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_agency_id ON users(agency_id);

-- 3. Vincular Queens (Bailarinas) a Agencias y agregar nombre_img
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='queens' AND column_name='agency_id') THEN
        ALTER TABLE queens ADD COLUMN agency_id INTEGER REFERENCES agencies(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='queens' AND column_name='nombre_img') THEN
        ALTER TABLE queens ADD COLUMN nombre_img TEXT DEFAULT '';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_queens_agency_id ON queens(agency_id);

-- 4. Asegurar columna timestamp en historial_regalos y tabla regalos_listas
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='historial_regalos' AND column_name='timestamp') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='historial_regalos' AND column_name='created_at') THEN
            ALTER TABLE historial_regalos RENAME COLUMN created_at TO timestamp;
        ELSE
            ALTER TABLE historial_regalos ADD COLUMN timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS regalos_listas (
    id SERIAL PRIMARY KEY,
    agency_id INTEGER REFERENCES agencies(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    activa INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='regalos_custom' AND column_name='lista_id') THEN
        ALTER TABLE regalos_custom ADD COLUMN lista_id INTEGER REFERENCES regalos_listas(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='regalos_custom' AND column_name='orden') THEN
        ALTER TABLE regalos_custom ADD COLUMN orden INTEGER DEFAULT 0;
    END IF;
END $$;

-- 5. Inserción de Agencias Iniciales de Prueba
INSERT INTO agencies (slug, name, logo_url, primary_color, secondary_color, theme_config, ranking_config, dynamics_config)
VALUES (
    'cosmic',
    'Agencia Cosmic',
    '/img/cosmic_logo.png',
    '#8A2BE2',
    '#4B0082',
    '{
        "agencyTitle": "COSMIC AGENCY RANKING",
        "primaryColor": "#8A2BE2",
        "secondaryColor": "#4B0082",
        "accentColor": "#00FFFF",
        "cardBg": "rgba(20, 10, 40, 0.9)",
        "badgeText": "COSMIC DANCER",
        "modeLabel": "MODO TORNEO - COSMIC",
        "secondsPerCoinText": "+3 SEGUNDOS POR MONEDA (O PUNTO)",
        "bodyBg": "transparent"
    }'::jsonb,
    '{
        "multiplier": 1.5,
        "rankingType": "cosmic_points",
        "titles": [
            { "minPts": 0, "title": "Iniciada Cósmica", "icon": "✨" },
            { "minPts": 500, "title": "Estrella Pulsar", "icon": "💫" },
            { "minPts": 2000, "title": "Supernova Queen", "icon": "🌟" },
            { "minPts": 10000, "title": "Diosa Cósmica", "icon": "👑" }
        ]
    }'::jsonb,
    '{
        "timerDefaultSeconds": 45,
        "yellowCardThreshold": 3,
        "revivirCost": 500,
        "eliminationMode": "lowest_points_loop",
        "segundosPorMoneda": 3
    }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    primary_color = EXCLUDED.primary_color,
    theme_config = EXCLUDED.theme_config,
    ranking_config = EXCLUDED.ranking_config,
    dynamics_config = EXCLUDED.dynamics_config;

INSERT INTO agencies (slug, name, logo_url, primary_color, secondary_color, theme_config, ranking_config, dynamics_config)
VALUES (
    'urbanqueens',
    'Urban Queens Agency',
    '/img/urban_logo.png',
    '#FF1493',
    '#FF69B4',
    '{
        "agencyTitle": "URBAN QUEENS RANKING",
        "primaryColor": "#FF1493",
        "secondaryColor": "#FF69B4",
        "accentColor": "#FFD700",
        "cardBg": "rgba(40, 10, 30, 0.9)",
        "badgeText": "URBAN QUEEN"
    }'::jsonb,
    '{
        "multiplier": 1.0,
        "rankingType": "standard_diamonds",
        "titles": [
            { "minPts": 0, "title": "Bailarina Novata", "icon": "💖" },
            { "minPts": 1000, "title": "Queen Destacada", "icon": "👑" },
            { "minPts": 5000, "title": "Reina de la Pista", "icon": "🔥" }
        ]
    }'::jsonb,
    '{
        "timerDefaultSeconds": 60,
        "yellowCardThreshold": 2,
        "revivirCost": 300
    }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    primary_color = EXCLUDED.primary_color,
    theme_config = EXCLUDED.theme_config,
    ranking_config = EXCLUDED.ranking_config,
    dynamics_config = EXCLUDED.dynamics_config;

-- 5. Asignar agencia por defecto a usuarios existentes que no tengan una asignada
UPDATE users 
SET agency_id = (SELECT id FROM agencies WHERE slug = 'urbanqueens' LIMIT 1)
WHERE agency_id IS NULL;
