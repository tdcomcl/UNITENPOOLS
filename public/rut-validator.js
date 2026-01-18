/**
 * Validador de RUT chileno para el navegador
 * Basado en el algoritmo estándar de validación de RUT
 */

(function(window) {
    'use strict';

    /**
     * Limpia un RUT removiendo puntos, guiones y espacios
     */
    function clean(rut) {
        if (!rut || typeof rut !== 'string') return '';
        return rut.replace(/[^0-9kK]/g, '').toUpperCase();
    }

    /**
     * Valida un RUT chileno
     */
    function validate(rut) {
        if (!rut || typeof rut !== 'string') return false;
        
        const cleaned = clean(rut);
        if (cleaned.length < 8 || cleaned.length > 9) return false;
        
        const body = cleaned.slice(0, -1);
        const dv = cleaned.slice(-1).toUpperCase();
        
        if (!/^\d+$/.test(body)) return false;
        if (!/^[\dK]$/.test(dv)) return false;
        
        // Calcular dígito verificador
        let sum = 0;
        let multiplier = 2;
        
        for (let i = body.length - 1; i >= 0; i--) {
            sum += parseInt(body[i]) * multiplier;
            multiplier = multiplier === 7 ? 2 : multiplier + 1;
        }
        
        const remainder = sum % 11;
        let calculatedDV = 11 - remainder;
        
        if (calculatedDV === 11) calculatedDV = '0';
        else if (calculatedDV === 10) calculatedDV = 'K';
        else calculatedDV = String(calculatedDV);
        
        return calculatedDV === dv;
    }

    /**
     * Formatea un RUT con puntos y guión
     */
    function format(rut, options = {}) {
        const cleaned = clean(rut);
        if (!cleaned || cleaned.length < 8) return rut;
        
        const body = cleaned.slice(0, -1);
        const dv = cleaned.slice(-1);
        
        if (options.dots === false) {
            return `${body}-${dv}`;
        }
        
        // Agregar puntos cada 3 dígitos desde la derecha
        let formatted = '';
        for (let i = body.length - 1, count = 0; i >= 0; i--) {
            formatted = body[i] + formatted;
            count++;
            if (count % 3 === 0 && i > 0) {
                formatted = '.' + formatted;
            }
        }
        
        return `${formatted}-${dv}`;
    }

    // Exponer funciones globalmente
    window.rutjs = {
        validate: validate,
        clean: clean,
        format: format
    };

})(window);
