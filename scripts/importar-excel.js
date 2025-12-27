const XLSX = require('xlsx');
const db = require('../database');
const path = require('path');
const fs = require('fs');

function importarDesdeExcel(excelPath) {
    console.log(`\nLeyendo archivo Excel: ${excelPath}`);
    
    if (!fs.existsSync(excelPath)) {
        throw new Error(`El archivo ${excelPath} no existe`);
    }

    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log(`Filas encontradas: ${data.length}`);

    // Identificar responsables únicos
    console.log('\nIdentificando responsables...');
    const responsablesSet = new Set();
    
    data.forEach(row => {
        const responsable = row['Responsable'];
        if (responsable && responsable !== 'Responsable' && responsable.trim()) {
            responsablesSet.add(String(responsable).trim());
        }
    });

    console.log(`Responsables encontrados: ${Array.from(responsablesSet).join(', ')}`);

    // Crear responsables en la base de datos
    const responsablesCreados = {};
    responsablesSet.forEach(nombre => {
        const id = db.agregarResponsable(nombre);
        responsablesCreados[nombre] = id;
    });

    console.log(`✓ ${Object.keys(responsablesCreados).length} responsables creados/actualizados`);

    // Importar clientes
    console.log('\nImportando clientes...');
    let clientesImportados = 0;
    let errores = 0;

    data.forEach((row, index) => {
        try {
            const nombre = row['Nombre cliente'];
            if (!nombre || nombre === 'Nombre cliente') {
                return; // Saltar filas vacías o encabezados
            }

            const direccion = row['Dirección'] ? String(row['Dirección']).trim() : null;
            const comuna = row['Comuna'] ? String(row['Comuna']).trim() : null;
            const celular = row['Celular'] ? String(row['Celular']).trim() : null;
            const responsableVal = row['Responsable'];
            const diaAtencion = row['día de atención'] ? String(row['día de atención']).trim() : null;
            const precioVal = row['precio'];

            // Obtener responsable_id
            let responsableId = null;
            if (responsableVal && responsableVal !== 'Responsable') {
                const responsableName = String(responsableVal).trim();
                if (responsablesCreados[responsableName]) {
                    responsableId = responsablesCreados[responsableName];
                }
            }

            // Procesar precio
            let precioPorVisita = 0;
            if (precioVal !== undefined && precioVal !== null) {
                try {
                    if (typeof precioVal === 'number') {
                        precioPorVisita = precioVal;
                    } else {
                        const precioStr = String(precioVal).replace(/[$,\s]/g, '').trim();
                        precioPorVisita = parseFloat(precioStr) || 0;
                    }
                } catch (e) {
                    precioPorVisita = 0;
                }
            }

            // Insertar cliente
            db.agregarCliente(
                String(nombre).trim(),
                direccion,
                comuna,
                celular,
                responsableId,
                diaAtencion,
                precioPorVisita
            );

            clientesImportados++;
            if (clientesImportados % 50 === 0) {
                console.log(`  Importados ${clientesImportados} clientes...`);
            }
        } catch (error) {
            errores++;
            console.error(`  Error en fila ${index + 2}: ${error.message}`);
        }
    });

    console.log(`\n✓ Importación completada!`);
    console.log(`  - Responsables: ${Object.keys(responsablesCreados).length}`);
    console.log(`  - Clientes importados: ${clientesImportados}`);
    if (errores > 0) {
        console.log(`  - Errores: ${errores}`);
    }

    return { clientesImportados, responsables: Object.keys(responsablesCreados).length };
}

// Ejecutar si se llama directamente
if (require.main === module) {
    const excelPath = process.argv[2] || 'Base de Datos United al 28 oct 2025.xlsx';
    
    try {
        importarDesdeExcel(excelPath);
        process.exit(0);
    } catch (error) {
        console.error(`\n❌ Error durante la importación: ${error.message}`);
        process.exit(1);
    }
}

module.exports = importarDesdeExcel;

