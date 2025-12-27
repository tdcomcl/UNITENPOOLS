"""
Módulo para la gestión de la base de datos SQLite del sistema de mantenimiento de piscinas.
"""
import sqlite3
import os
from datetime import datetime
from typing import List, Dict, Optional, Tuple


class Database:
    """Clase para gestionar la base de datos SQLite."""
    
    def __init__(self, db_path: str = "piscinas.db"):
        """Inicializa la conexión a la base de datos."""
        self.db_path = db_path
        self.init_database()
    
    def get_connection(self):
        """Obtiene una conexión a la base de datos."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def init_database(self):
        """Inicializa las tablas de la base de datos."""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Tabla de responsables
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS responsables (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                activo INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Tabla de clientes
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS clientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                direccion TEXT,
                comuna TEXT,
                celular TEXT,
                responsable_id INTEGER,
                dia_atencion TEXT,
                precio_por_visita REAL DEFAULT 0,
                activo INTEGER DEFAULT 1,
                notas TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (responsable_id) REFERENCES responsables(id)
            )
        """)
        
        # Tabla de visitas (historial de mantenimientos)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS visitas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_id INTEGER NOT NULL,
                fecha_visita TEXT NOT NULL,
                responsable_id INTEGER,
                precio REAL,
                realizada INTEGER DEFAULT 0,
                notas TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cliente_id) REFERENCES clientes(id),
                FOREIGN KEY (responsable_id) REFERENCES responsables(id)
            )
        """)
        
        # Tabla de asignaciones semanales
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS asignaciones_semanales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                semana_inicio TEXT NOT NULL,
                cliente_id INTEGER NOT NULL,
                responsable_id INTEGER,
                dia_atencion TEXT,
                precio REAL,
                asignada INTEGER DEFAULT 1,
                realizada INTEGER DEFAULT 0,
                notas TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cliente_id) REFERENCES clientes(id),
                FOREIGN KEY (responsable_id) REFERENCES responsables(id),
                UNIQUE(semana_inicio, cliente_id)
            )
        """)
        
        # Índices para mejorar el rendimiento
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_clientes_responsable ON clientes(responsable_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_clientes_dia ON clientes(dia_atencion)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_visitas_cliente ON visitas(cliente_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_visitas_fecha ON visitas(fecha_visita)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_asignaciones_semana ON asignaciones_semanales(semana_inicio)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_asignaciones_cliente ON asignaciones_semanales(cliente_id)")
        
        conn.commit()
        conn.close()
    
    # Métodos para responsables
    def agregar_responsable(self, nombre: str) -> int:
        """Agrega un nuevo responsable."""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO responsables (nombre) VALUES (?)",
                (nombre,)
            )
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            # Si ya existe, retornar el ID existente
            cursor.execute("SELECT id FROM responsables WHERE nombre = ?", (nombre,))
            result = cursor.fetchone()
            return result['id'] if result else None
        finally:
            conn.close()
    
    def obtener_responsables(self, activos_only: bool = True) -> List[Dict]:
        """Obtiene todos los responsables."""
        conn = self.get_connection()
        cursor = conn.cursor()
        query = "SELECT * FROM responsables"
        if activos_only:
            query += " WHERE activo = 1"
        query += " ORDER BY nombre"
        cursor.execute(query)
        responsables = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return responsables
    
    # Métodos para clientes
    def agregar_cliente(self, nombre: str, direccion: str = None, comuna: str = None,
                       celular: str = None, responsable_id: int = None,
                       dia_atencion: str = None, precio_por_visita: float = 0) -> int:
        """Agrega un nuevo cliente."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO clientes 
            (nombre, direccion, comuna, celular, responsable_id, dia_atencion, precio_por_visita)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (nombre, direccion, comuna, celular, responsable_id, dia_atencion, precio_por_visita))
        conn.commit()
        cliente_id = cursor.lastrowid
        conn.close()
        return cliente_id
    
    def actualizar_cliente(self, cliente_id: int, **kwargs):
        """Actualiza los datos de un cliente."""
        if not kwargs:
            return
        conn = self.get_connection()
        cursor = conn.cursor()
        kwargs['updated_at'] = datetime.now().isoformat()
        set_clause = ", ".join([f"{k} = ?" for k in kwargs.keys()])
        values = list(kwargs.values()) + [cliente_id]
        cursor.execute(f"UPDATE clientes SET {set_clause} WHERE id = ?", values)
        conn.commit()
        conn.close()
    
    def obtener_clientes(self, activos_only: bool = True) -> List[Dict]:
        """Obtiene todos los clientes."""
        conn = self.get_connection()
        cursor = conn.cursor()
        query = """
            SELECT c.*, r.nombre as responsable_nombre 
            FROM clientes c
            LEFT JOIN responsables r ON c.responsable_id = r.id
        """
        if activos_only:
            query += " WHERE c.activo = 1"
        query += " ORDER BY c.nombre"
        cursor.execute(query)
        clientes = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return clientes
    
    def obtener_cliente_por_id(self, cliente_id: int) -> Optional[Dict]:
        """Obtiene un cliente por su ID."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT c.*, r.nombre as responsable_nombre 
            FROM clientes c
            LEFT JOIN responsables r ON c.responsable_id = r.id
            WHERE c.id = ?
        """, (cliente_id,))
        result = cursor.fetchone()
        conn.close()
        return dict(result) if result else None
    
    # Métodos para asignaciones semanales
    def obtener_semana_actual(self) -> str:
        """Obtiene el inicio de la semana actual (lunes) en formato YYYY-MM-DD."""
        today = datetime.now()
        days_since_monday = today.weekday()
        monday = today.replace(day=today.day - days_since_monday)
        return monday.strftime("%Y-%m-%d")
    
    def crear_asignacion_semanal(self, semana_inicio: str, cliente_id: int,
                                 responsable_id: int = None, dia_atencion: str = None,
                                 precio: float = None) -> int:
        """Crea una asignación semanal."""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Si no se proporciona precio, obtenerlo del cliente
        if precio is None:
            cliente = self.obtener_cliente_por_id(cliente_id)
            precio = cliente['precio_por_visita'] if cliente else 0
        
        cursor.execute("""
            INSERT OR REPLACE INTO asignaciones_semanales
            (semana_inicio, cliente_id, responsable_id, dia_atencion, precio)
            VALUES (?, ?, ?, ?, ?)
        """, (semana_inicio, cliente_id, responsable_id, dia_atencion, precio))
        conn.commit()
        asignacion_id = cursor.lastrowid
        conn.close()
        return asignacion_id
    
    def asignar_clientes_semana(self, semana_inicio: str = None, 
                                solo_activos: bool = True) -> int:
        """Asigna todos los clientes activos a la semana especificada."""
        if semana_inicio is None:
            semana_inicio = self.obtener_semana_actual()
        
        clientes = self.obtener_clientes(activos_only=solo_activos)
        asignados = 0
        
        for cliente in clientes:
            self.crear_asignacion_semanal(
                semana_inicio=semana_inicio,
                cliente_id=cliente['id'],
                responsable_id=cliente['responsable_id'],
                dia_atencion=cliente['dia_atencion'],
                precio=cliente['precio_por_visita']
            )
            asignados += 1
        
        return asignados
    
    def obtener_asignaciones_semana(self, semana_inicio: str = None) -> List[Dict]:
        """Obtiene las asignaciones de una semana."""
        if semana_inicio is None:
            semana_inicio = self.obtener_semana_actual()
        
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT a.*, c.nombre as cliente_nombre, c.direccion, c.comuna, c.celular,
                   r.nombre as responsable_nombre
            FROM asignaciones_semanales a
            LEFT JOIN clientes c ON a.cliente_id = c.id
            LEFT JOIN responsables r ON a.responsable_id = r.id
            WHERE a.semana_inicio = ?
            ORDER BY a.dia_atencion, c.nombre
        """, (semana_inicio,))
        asignaciones = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return asignaciones
    
    # Métodos para visitas
    def registrar_visita(self, cliente_id: int, fecha_visita: str,
                        responsable_id: int = None, precio: float = None,
                        realizada: bool = True) -> int:
        """Registra una visita realizada."""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        if precio is None:
            cliente = self.obtener_cliente_por_id(cliente_id)
            precio = cliente['precio_por_visita'] if cliente else 0
        
        cursor.execute("""
            INSERT INTO visitas
            (cliente_id, fecha_visita, responsable_id, precio, realizada)
            VALUES (?, ?, ?, ?, ?)
        """, (cliente_id, fecha_visita, responsable_id, precio, 1 if realizada else 0))
        conn.commit()
        visita_id = cursor.lastrowid
        conn.close()
        return visita_id
    
    def obtener_visitas_cliente(self, cliente_id: int, 
                               limit: int = 10) -> List[Dict]:
        """Obtiene el historial de visitas de un cliente."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT v.*, c.nombre as cliente_nombre, r.nombre as responsable_nombre
            FROM visitas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            LEFT JOIN responsables r ON v.responsable_id = r.id
            WHERE v.cliente_id = ?
            ORDER BY v.fecha_visita DESC
            LIMIT ?
        """, (cliente_id, limit))
        visitas = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return visitas

