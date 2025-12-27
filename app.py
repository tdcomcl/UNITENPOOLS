#!/usr/bin/env python3
"""
Aplicación CLI para gestionar el sistema de mantenimiento de piscinas.
"""
import sys
from datetime import datetime, timedelta
from database import Database
from typing import Optional


class App:
    """Clase principal de la aplicación."""
    
    def __init__(self, db_path: str = "piscinas.db"):
        self.db = Database(db_path)
    
    def mostrar_menu_principal(self):
        """Muestra el menú principal."""
        print("\n" + "="*60)
        print("  SISTEMA DE MANTENIMIENTO DE PISCINAS")
        print("="*60)
        print("1. Ver clientes")
        print("2. Ver responsables")
        print("3. Agregar cliente")
        print("4. Editar cliente")
        print("5. Agregar responsable")
        print("6. Asignar clientes a semana actual")
        print("7. Ver asignaciones semana actual")
        print("8. Ver asignaciones por semana específica")
        print("9. Registrar visita realizada")
        print("10. Ver historial de visitas de un cliente")
        print("0. Salir")
        print("="*60)
    
    def ver_clientes(self):
        """Muestra todos los clientes."""
        clientes = self.db.obtener_clientes()
        if not clientes:
            print("\nNo hay clientes registrados.")
            return
        
        print(f"\n{'ID':<5} {'Nombre':<30} {'Responsable':<20} {'Día':<12} {'Precio':<10}")
        print("-" * 80)
        for cliente in clientes:
            print(f"{cliente['id']:<5} {cliente['nombre']:<30} "
                  f"{(cliente['responsable_nombre'] or 'Sin asignar'):<20} "
                  f"{(cliente['dia_atencion'] or 'Sin asignar'):<12} "
                  f"${cliente['precio_por_visita']:<9.0f}")
    
    def ver_responsables(self):
        """Muestra todos los responsables."""
        responsables = self.db.obtener_responsables()
        if not responsables:
            print("\nNo hay responsables registrados.")
            return
        
        print(f"\n{'ID':<5} {'Nombre':<30}")
        print("-" * 40)
        for resp in responsables:
            print(f"{resp['id']:<5} {resp['nombre']:<30}")
    
    def agregar_cliente(self):
        """Agrega un nuevo cliente."""
        print("\n--- Agregar Nuevo Cliente ---")
        nombre = input("Nombre: ").strip()
        if not nombre:
            print("El nombre es obligatorio.")
            return
        
        direccion = input("Dirección (opcional): ").strip() or None
        comuna = input("Comuna (opcional): ").strip() or None
        celular = input("Celular (opcional): ").strip() or None
        
        # Mostrar responsables disponibles
        responsables = self.db.obtener_responsables()
        if responsables:
            print("\nResponsables disponibles:")
            for resp in responsables:
                print(f"  {resp['id']}. {resp['nombre']}")
            resp_input = input("\nID del responsable (Enter para ninguno): ").strip()
            responsable_id = int(resp_input) if resp_input.isdigit() else None
        else:
            responsable_id = None
        
        dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
        print("\nDías disponibles:")
        for i, dia in enumerate(dias, 1):
            print(f"  {i}. {dia}")
        dia_input = input("\nDía de atención (1-7, Enter para ninguno): ").strip()
        dia_atencion = dias[int(dia_input) - 1] if dia_input.isdigit() and 1 <= int(dia_input) <= 7 else None
        
        precio_input = input("Precio por visita (Enter para 0): ").strip()
        precio = float(precio_input) if precio_input.replace('.', '').isdigit() else 0
        
        cliente_id = self.db.agregar_cliente(
            nombre=nombre,
            direccion=direccion,
            comuna=comuna,
            celular=celular,
            responsable_id=responsable_id,
            dia_atencion=dia_atencion,
            precio_por_visita=precio
        )
        print(f"\n✓ Cliente agregado con ID: {cliente_id}")
    
    def editar_cliente(self):
        """Edita un cliente existente."""
        self.ver_clientes()
        cliente_id_input = input("\nID del cliente a editar: ").strip()
        if not cliente_id_input.isdigit():
            print("ID inválido.")
            return
        
        cliente_id = int(cliente_id_input)
        cliente = self.db.obtener_cliente_por_id(cliente_id)
        if not cliente:
            print("Cliente no encontrado.")
            return
        
        print(f"\nEditando cliente: {cliente['nombre']}")
        print("(Presiona Enter para mantener el valor actual)\n")
        
        nombre = input(f"Nombre [{cliente['nombre']}]: ").strip()
        direccion = input(f"Dirección [{cliente['direccion'] or ''}]: ").strip()
        comuna = input(f"Comuna [{cliente['comuna'] or ''}]: ").strip()
        celular = input(f"Celular [{cliente['celular'] or ''}]: ").strip()
        
        # Responsable
        responsables = self.db.obtener_responsables()
        if responsables:
            print("\nResponsables disponibles:")
            for resp in responsables:
                print(f"  {resp['id']}. {resp['nombre']}")
            resp_input = input(f"\nID del responsable [{cliente['responsable_id'] or 'Ninguno'}]: ").strip()
            responsable_id = int(resp_input) if resp_input.isdigit() else cliente['responsable_id']
        else:
            responsable_id = cliente['responsable_id']
        
        # Día de atención
        dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
        print("\nDías disponibles:")
        for i, dia in enumerate(dias, 1):
            print(f"  {i}. {dia}")
        dia_input = input(f"\nDía de atención [{cliente['dia_atencion'] or 'Ninguno'}]: ").strip()
        dia_atencion = dias[int(dia_input) - 1] if dia_input.isdigit() and 1 <= int(dia_input) <= 7 else cliente['dia_atencion']
        
        precio_input = input(f"Precio por visita [${cliente['precio_por_visita']}]: ").strip()
        precio = float(precio_input) if precio_input.replace('.', '').isdigit() else cliente['precio_por_visita']
        
        # Actualizar solo los campos que cambiaron
        updates = {}
        if nombre:
            updates['nombre'] = nombre
        if direccion or direccion == '':
            updates['direccion'] = direccion if direccion else None
        if comuna or comuna == '':
            updates['comuna'] = comuna if comuna else None
        if celular or celular == '':
            updates['celular'] = celular if celular else None
        if responsable_id != cliente['responsable_id']:
            updates['responsable_id'] = responsable_id
        if dia_atencion != cliente['dia_atencion']:
            updates['dia_atencion'] = dia_atencion
        if precio != cliente['precio_por_visita']:
            updates['precio_por_visita'] = precio
        
        if updates:
            self.db.actualizar_cliente(cliente_id, **updates)
            print("\n✓ Cliente actualizado correctamente")
        else:
            print("\nNo se realizaron cambios.")
    
    def agregar_responsable(self):
        """Agrega un nuevo responsable."""
        print("\n--- Agregar Nuevo Responsable ---")
        nombre = input("Nombre: ").strip()
        if not nombre:
            print("El nombre es obligatorio.")
            return
        
        try:
            resp_id = self.db.agregar_responsable(nombre)
            print(f"\n✓ Responsable agregado con ID: {resp_id}")
        except Exception as e:
            print(f"\nError: {e}")
    
    def asignar_semana_actual(self):
        """Asigna todos los clientes activos a la semana actual."""
        print("\n--- Asignar Clientes a Semana Actual ---")
        confirmar = input("¿Asignar todos los clientes activos a la semana actual? (s/n): ").strip().lower()
        if confirmar != 's':
            return
        
        semana_inicio = self.db.obtener_semana_actual()
        asignados = self.db.asignar_clientes_semana(semana_inicio)
        print(f"\n✓ {asignados} clientes asignados a la semana del {semana_inicio}")
    
    def ver_asignaciones_semana(self, semana_inicio: str = None):
        """Muestra las asignaciones de una semana."""
        if semana_inicio is None:
            semana_inicio = self.db.obtener_semana_actual()
        
        asignaciones = self.db.obtener_asignaciones_semana(semana_inicio)
        if not asignaciones:
            print(f"\nNo hay asignaciones para la semana del {semana_inicio}")
            return
        
        print(f"\nAsignaciones para la semana del {semana_inicio}")
        print("="*100)
        
        # Agrupar por día
        por_dia = {}
        for asignacion in asignaciones:
            dia = asignacion['dia_atencion'] or 'Sin día asignado'
            if dia not in por_dia:
                por_dia[dia] = []
            por_dia[dia].append(asignacion)
        
        for dia in sorted(por_dia.keys()):
            print(f"\n{dia}:")
            print(f"{'ID':<5} {'Cliente':<30} {'Responsable':<20} {'Precio':<10} {'Realizada':<10}")
            print("-" * 80)
            for asignacion in por_dia[dia]:
                realizada = "Sí" if asignacion['realizada'] else "No"
                print(f"{asignacion['id']:<5} {asignacion['cliente_nombre']:<30} "
                      f"{(asignacion['responsable_nombre'] or 'Sin asignar'):<20} "
                      f"${asignacion['precio']:<9.0f} {realizada:<10}")
    
    def ver_asignaciones_semana_especifica(self):
        """Muestra asignaciones de una semana específica."""
        fecha_input = input("\nIngresa la fecha de inicio de semana (YYYY-MM-DD): ").strip()
        try:
            datetime.strptime(fecha_input, "%Y-%m-%d")
            self.ver_asignaciones_semana(fecha_input)
        except ValueError:
            print("Formato de fecha inválido. Usa YYYY-MM-DD")
    
    def registrar_visita(self):
        """Registra una visita realizada."""
        print("\n--- Registrar Visita ---")
        self.ver_clientes()
        cliente_id_input = input("\nID del cliente: ").strip()
        if not cliente_id_input.isdigit():
            print("ID inválido.")
            return
        
        cliente_id = int(cliente_id_input)
        cliente = self.db.obtener_cliente_por_id(cliente_id)
        if not cliente:
            print("Cliente no encontrado.")
            return
        
        fecha_input = input(f"Fecha de visita (YYYY-MM-DD) [hoy: {datetime.now().strftime('%Y-%m-%d')}]: ").strip()
        if not fecha_input:
            fecha_visita = datetime.now().strftime("%Y-%m-%d")
        else:
            try:
                datetime.strptime(fecha_input, "%Y-%m-%d")
                fecha_visita = fecha_input
            except ValueError:
                print("Formato de fecha inválido.")
                return
        
        responsable_id = cliente['responsable_id']
        precio = cliente['precio_por_visita']
        
        visita_id = self.db.registrar_visita(
            cliente_id=cliente_id,
            fecha_visita=fecha_visita,
            responsable_id=responsable_id,
            precio=precio,
            realizada=True
        )
        print(f"\n✓ Visita registrada con ID: {visita_id}")
    
    def ver_historial_cliente(self):
        """Muestra el historial de visitas de un cliente."""
        self.ver_clientes()
        cliente_id_input = input("\nID del cliente: ").strip()
        if not cliente_id_input.isdigit():
            print("ID inválido.")
            return
        
        cliente_id = int(cliente_id_input)
        visitas = self.db.obtener_visitas_cliente(cliente_id, limit=20)
        
        if not visitas:
            print("\nNo hay visitas registradas para este cliente.")
            return
        
        print(f"\nHistorial de visitas (últimas 20):")
        print(f"{'Fecha':<12} {'Responsable':<20} {'Precio':<10} {'Realizada':<10}")
        print("-" * 60)
        for visita in visitas:
            realizada = "Sí" if visita['realizada'] else "No"
            print(f"{visita['fecha_visita']:<12} "
                  f"{(visita['responsable_nombre'] or 'N/A'):<20} "
                  f"${visita['precio']:<9.0f} {realizada:<10}")
    
    def ejecutar(self):
        """Ejecuta la aplicación."""
        while True:
            self.mostrar_menu_principal()
            opcion = input("\nSelecciona una opción: ").strip()
            
            try:
                if opcion == "1":
                    self.ver_clientes()
                elif opcion == "2":
                    self.ver_responsables()
                elif opcion == "3":
                    self.agregar_cliente()
                elif opcion == "4":
                    self.editar_cliente()
                elif opcion == "5":
                    self.agregar_responsable()
                elif opcion == "6":
                    self.asignar_semana_actual()
                elif opcion == "7":
                    self.ver_asignaciones_semana()
                elif opcion == "8":
                    self.ver_asignaciones_semana_especifica()
                elif opcion == "9":
                    self.registrar_visita()
                elif opcion == "10":
                    self.ver_historial_cliente()
                elif opcion == "0":
                    print("\n¡Hasta luego!")
                    break
                else:
                    print("\nOpción inválida.")
            except KeyboardInterrupt:
                print("\n\nOperación cancelada.")
            except Exception as e:
                print(f"\nError: {e}")
                import traceback
                traceback.print_exc()


if __name__ == "__main__":
    app = App()
    app.ejecutar()

