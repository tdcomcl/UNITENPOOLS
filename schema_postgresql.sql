-- Esquema PostgreSQL para UNITENPOOLS
-- Migración desde SQLite

-- Tabla de responsables
CREATE TABLE IF NOT EXISTS responsables (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL UNIQUE,
    activo INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_responsables_activo ON responsables(activo);

-- Tabla de usuarios (para login)
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    responsable_id INTEGER,
    rol VARCHAR(50) DEFAULT 'responsable',
    activo INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (responsable_id) REFERENCES responsables(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username);
CREATE INDEX IF NOT EXISTS idx_usuarios_responsable ON usuarios(responsable_id);

-- Tabla de clientes
CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    rut VARCHAR(50),
    direccion TEXT,
    comuna VARCHAR(255),
    celular VARCHAR(50),
    email VARCHAR(255),
    documento_tipo VARCHAR(50) DEFAULT 'invoice',
    odoo_partner_id INTEGER,
    odoo_last_sync TIMESTAMP,
    factura_razon_social TEXT,
    factura_rut VARCHAR(50),
    factura_giro TEXT,
    factura_direccion TEXT,
    factura_comuna VARCHAR(255),
    factura_email VARCHAR(255),
    invoice_nombre TEXT,
    invoice_tax_id VARCHAR(50),
    invoice_direccion TEXT,
    invoice_comuna VARCHAR(255),
    invoice_email VARCHAR(255),
    invoice_pais VARCHAR(100),
    responsable_id INTEGER,
    dia_atencion VARCHAR(50),
    precio_por_visita DECIMAL(10,2) DEFAULT 0,
    activo INTEGER DEFAULT 1,
    notas TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (responsable_id) REFERENCES responsables(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_clientes_responsable ON clientes(responsable_id);
CREATE INDEX IF NOT EXISTS idx_clientes_dia ON clientes(dia_atencion);
CREATE INDEX IF NOT EXISTS idx_clientes_activo ON clientes(activo);
CREATE INDEX IF NOT EXISTS idx_clientes_created ON clientes(created_at);

-- Tabla de visitas
CREATE TABLE IF NOT EXISTS visitas (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL,
    fecha_visita DATE NOT NULL,
    responsable_id INTEGER,
    precio DECIMAL(10,2),
    realizada INTEGER DEFAULT 0,
    notas TEXT,
    odoo_move_id INTEGER,
    odoo_move_name VARCHAR(255),
    odoo_payment_state VARCHAR(50),
    odoo_last_sync TIMESTAMP,
    odoo_error TEXT,
    odoo_notified_at TIMESTAMP,
    odoo_notify_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    FOREIGN KEY (responsable_id) REFERENCES responsables(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_visitas_cliente ON visitas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_visitas_fecha ON visitas(fecha_visita);
CREATE INDEX IF NOT EXISTS idx_visitas_responsable ON visitas(responsable_id);

-- Tabla de asignaciones semanales
CREATE TABLE IF NOT EXISTS asignaciones_semanales (
    id SERIAL PRIMARY KEY,
    semana_inicio DATE NOT NULL,
    cliente_id INTEGER NOT NULL,
    responsable_id INTEGER,
    dia_atencion VARCHAR(50),
    precio DECIMAL(10,2),
    asignada INTEGER DEFAULT 1,
    realizada INTEGER DEFAULT 0,
    notas TEXT,
    visita_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    FOREIGN KEY (responsable_id) REFERENCES responsables(id) ON DELETE SET NULL,
    FOREIGN KEY (visita_id) REFERENCES visitas(id) ON DELETE SET NULL,
    UNIQUE(semana_inicio, cliente_id)
);

CREATE INDEX IF NOT EXISTS idx_asignaciones_semana ON asignaciones_semanales(semana_inicio);
CREATE INDEX IF NOT EXISTS idx_asignaciones_cliente ON asignaciones_semanales(cliente_id);
CREATE INDEX IF NOT EXISTS idx_asignaciones_responsable ON asignaciones_semanales(responsable_id);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para actualizar updated_at en clientes
CREATE TRIGGER update_clientes_updated_at BEFORE UPDATE ON clientes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
