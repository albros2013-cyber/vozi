import { normalizar } from '../js/tts/normalize-es.js';
const casos = [
 '¿Qué factores explican el crecimiento? En 2025, las ventas aumentaron 32% y el margen llegó a 18,5 %.',
 'El Sr. Pérez pagó $1.500.000 el 3/10/2026 a las 10:30 a. m., según el art. 5 del contrato.',
 'La Dra. Gómez publicó 21 páginas y 1 libro en el siglo XXI, p. ej. el cap. 3.',
 'Asistieron 1.234 personas; 200 mujeres y 21 hombres. US$ 20 millones; 2,5 millones de habitantes.',
 'El 1 de enero de 1999 recorrió 15 km en 2 h. Temperatura: 25 °C. Ver www.ejemplo.com.co/info',
 'Ocupó el 1.º puesto y la 2.ª posición entre 2019-2023. Tel. 601 234 5678. Costo: 3.5 USD',
 'La empresa Pluxee S.A.S. reportó COP 4.250 millones vs. 3.900 del año anterior (EE. UU. & Canadá).',
 'Hay 101 opciones, 500 unidades y 1 000 000 de dudas.',
];
for (const c of casos) console.log('· ' + c + '\n  → ' + normalizar(c) + '\n');
