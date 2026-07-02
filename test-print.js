const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const { print } = require('pdf-to-printer');

// Cargar variables de entorno
require('dotenv').config();

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  STORE_USER_EMAIL,
  STORE_USER_PASSWORD,
  API_URL,
  PEDIDOS_TABLE,
  TIENDA,
  AUTO_PRINT,
  PRINTER_NAME,
} = process.env;

// Validar variables
const missingVars = [
  !SUPABASE_URL && 'SUPABASE_URL',
  !SUPABASE_KEY && 'SUPABASE_KEY',
  !STORE_USER_EMAIL && 'STORE_USER_EMAIL',
  !STORE_USER_PASSWORD && 'STORE_USER_PASSWORD',
  !API_URL && 'API_URL',
  !PEDIDOS_TABLE && 'PEDIDOS_TABLE',
  !TIENDA && 'TIENDA',
].filter(Boolean);

if (missingVars.length > 0) {
  console.error(`ERROR: Faltan variables de entorno requeridas en el archivo .env: ${missingVars.join(', ')}`);
  process.exit(1);
}

const pedidoId = process.argv[2];
if (!pedidoId) {
  console.log('Uso: node test-print.js <numero_de_pedido>');
  console.log('Ejemplo: node test-print.js GD12345');
  process.exit(0);
}

const ticketsDir = path.join(__dirname, 'tickets');
if (!fs.existsSync(ticketsDir)) {
  fs.mkdirSync(ticketsDir, { recursive: true });
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// Reusar funciones de listener.js
async function getApiAuthToken() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: STORE_USER_EMAIL,
    password: STORE_USER_PASSWORD
  });
  if (error) throw new Error(`Error de autenticación: ${error.message}`);
  return data.session.access_token;
}

async function fetchPickingRoute(pedido, token) {
  const url = `${API_URL}/picking/ruta/${encodeURIComponent(pedido)}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-app-id': 'etiquetas',
      'x-tienda': TIENDA
    }
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.message ?? `La API retornó código ${response.status}`);
  }

  return response.json();
}

function generateBarcodeBuffer(text) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({
      bcid: 'code128',
      text: text,
      scale: 3,
      height: 10,
      includetext: true,
      textalign: 'center',
      textcolor: '000000',
    }, (err, png) => {
      if (err) reject(err);
      else resolve(png);
    });
  });
}

function getPasilloTicketText(item) {
  const numero = item?.pasillo_numero ? String(item.pasillo_numero).trim() : '';
  const nombre = String(item?.pasillo_nombre ?? '').trim();
  const inicial = nombre && nombre.toLowerCase() !== 'pasillo' ? nombre.charAt(0).toUpperCase() : '';
  return inicial && numero ? `${inicial}${numero}` : (numero || inicial);
}

async function createTicketPdf(pedidoId, clienteNombre, rutaData) {
  return new Promise(async (resolve, reject) => {
    try {
      const pdfPath = path.join(ticketsDir, `pedido_${pedidoId}.pdf`);
      
      const doc = new PDFDocument({
        size: [227, 800],
        margins: { top: 12, bottom: 12, left: 10, right: 10 }
      });

      const writeStream = fs.createWriteStream(pdfPath);
      doc.pipe(writeStream);

      // --- Encabezado ---
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX');
      const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      
      doc.font('Helvetica').fontSize(7.5).text(`Fecha: ${dateStr}   Hora: ${timeStr}`, { align: 'center' });
      doc.moveDown(0.4);
      
      doc.lineWidth(0.5).moveTo(10, doc.y).lineTo(217, doc.y).stroke();
      doc.moveDown(0.4);

      // Datos del Pedido
      doc.font('Helvetica-Bold').fontSize(8.5).text(`Pedido: #${pedidoId}`);
      if (clienteNombre) {
        doc.font('Helvetica').fontSize(8).text(`Cliente: ${clienteNombre}`);
      }
      doc.moveDown(0.4);
      
      doc.lineWidth(0.5).moveTo(10, doc.y).lineTo(217, doc.y).stroke();
      doc.moveDown(0.4);

      // Helper to draw table header
      const drawTableHeader = () => {
        const startY = doc.y;
        doc.font('Helvetica-Bold').fontSize(8);
        doc.text('Pasillo', 10, startY, { width: 32 });
        doc.text('Cajón', 45, startY, { width: 42 });
        doc.text('SKU', 90, startY, { width: 62 });
        doc.text('Cant', 152, startY, { width: 35, align: 'right' });
        
        doc.y = startY + 10;
        doc.lineWidth(0.5).moveTo(10, doc.y).lineTo(217, doc.y).stroke('#475569');
        doc.moveDown(0.3);
      };

      // --- Productos Ordenados ---
      const rutas = rutaData.rutas || [];
      if (rutas.length === 0) {
        doc.font('Helvetica-Oblique').fontSize(8).text('No hay productos en la ruta lógica.');
        doc.moveDown(0.5);
      } else {
        rutas.forEach((piso, index) => {
          const items = [...(piso.items || []), ...(piso.sin_ruta || [])];
          
          // Calcular la altura requerida para el encabezado del piso y el primer elemento
          const firstItem = items[0];
          const firstItemHeight = firstItem ? (18 + doc.heightOfString(firstItem.producto || 'Sin descripción', { width: 202 })) : 0;
          const requiredFloorHeaderHeight = (index > 0 ? 21 : 15) + 12 + firstItemHeight;

          if (doc.y + requiredFloorHeaderHeight > 788) {
            doc.addPage();
          } else if (index > 0) {
            // Si es el segundo piso en adelante y cupo, dibujamos una línea divisoria antes
            doc.moveDown(0.4);
            doc.lineWidth(0.5).moveTo(10, doc.y).lineTo(217, doc.y).stroke('#94a3b8');
            doc.moveDown(0.4);
          }

          // Nombre del Piso (e.g. Bodega 1)
          doc.font('Helvetica-Bold').fontSize(9).text(`${piso.piso_nombre || 'Bodega'}:`, { underline: true });
          doc.moveDown(0.3);

          drawTableHeader();

          items.forEach((item) => {
            let pasilloText = getPasilloTicketText(item);
            let cajonText = item.tipo_ubicacion === 'cuarto' ? (item.cuarto_nombre || 'Cuarto') : (item.ubicacion_visible || item.cajon || 'Cajón');

            // Abreviar Tapanco para ahorrar espacio y evitar truncamiento
            if (cajonText.startsWith('Tapanco ')) {
              cajonText = cajonText.replace('Tapanco ', 'Tpc ');
            }

            // Truncar cajonText si es muy largo para evitar encimar texto
            if (cajonText.length > 8) {
              cajonText = cajonText.substring(0, 7) + '.';
            }

            // Verificar si el elemento cabe en el espacio restante de la página
            const neededHeight = 18 + doc.heightOfString(item.producto || 'Sin descripción', { width: 202 });
            if (doc.y + neededHeight > 788) {
              doc.addPage();
              drawTableHeader();
            }

            const startY = doc.y;
            doc.font('Helvetica-Bold').fontSize(8);
            doc.text(pasilloText, 10, startY, { width: 32, lineBreak: false });
            doc.text(cajonText, 45, startY, { width: 42, lineBreak: false });
            doc.text(item.sku || '', 90, startY, { width: 62, lineBreak: false });
            doc.text(String(item.cantidad_solicitada || 0), 152, startY, { width: 35, align: 'right', lineBreak: false });

            doc.y = startY + 13;
            doc.font('Helvetica').fontSize(7.5).text(item.producto || 'Sin descripción', 15, doc.y, { width: 202 });
            doc.moveDown(0.3);
            
            doc.lineWidth(0.25).moveTo(10, doc.y).lineTo(217, doc.y).stroke('#cbd5e1');
            doc.moveDown(0.3);
          });
          doc.moveDown(0.2);
        });
      }

      // --- Productos Sin Ubicación ---
      const itemsSinUbicacion = rutaData.sin_ubicacion || [];
      if (itemsSinUbicacion.length > 0) {
        const firstItem = itemsSinUbicacion[0];
        const firstItemHeight = 18 + doc.heightOfString(firstItem.producto || 'Sin descripción', { width: 202 });
        
        // El divisor y el encabezado de sección toman aproximadamente 21pt
        if (doc.y + 21 + firstItemHeight > 788) {
          doc.addPage();
        } else {
          doc.moveDown(0.4);
          doc.lineWidth(0.5).moveTo(10, doc.y).lineTo(217, doc.y).stroke('#94a3b8');
          doc.moveDown(0.4);
        }

        doc.font('Helvetica-Bold').fontSize(9).text('SIN UBICACIÓN REGISTRADA:', { underline: true });
        doc.moveDown(0.3);

        itemsSinUbicacion.forEach((item) => {
          const neededHeight = 18 + doc.heightOfString(item.producto || 'Sin descripción', { width: 202 });
          if (doc.y + neededHeight > 788) {
            doc.addPage();
            doc.font('Helvetica-Bold').fontSize(9).text('SIN UBICACIÓN REGISTRADA (Cont.):', { underline: true });
            doc.moveDown(0.3);
          }

          const startY = doc.y;
          doc.font('Helvetica-Bold').fontSize(8);
          doc.text(`SKU: ${item.sku || ''}`, 10, startY, { width: 100, lineBreak: false });
          doc.text(`Cant: ${item.cantidad_solicitada || 0}`, 120, startY, { width: 50, lineBreak: false });

          doc.y = startY + 13;
          doc.font('Helvetica').fontSize(7.5).text(item.producto || 'Sin descripción', 15, doc.y, { width: 202 });
          doc.moveDown(0.3);
          
          doc.lineWidth(0.25).moveTo(10, doc.y).lineTo(217, doc.y).stroke('#cbd5e1');
          doc.moveDown(0.3);
        });
      }

      // --- Cambios (Cantidades Negativas) ---
      const itemsCambios = rutaData.cambios || [];
      if (itemsCambios.length > 0) {
        const firstItem = itemsCambios[0];
        const firstItemHeight = 18 + doc.heightOfString(firstItem.producto || 'Sin descripción', { width: 202 });
        
        // El divisor y el encabezado de sección toman aproximadamente 21pt
        if (doc.y + 21 + firstItemHeight > 788) {
          doc.addPage();
        } else {
          doc.moveDown(0.4);
          doc.lineWidth(0.5).moveTo(10, doc.y).lineTo(217, doc.y).stroke('#94a3b8');
          doc.moveDown(0.4);
        }

        doc.font('Helvetica-Bold').fontSize(9).text('CAMBIOS:', { underline: true });
        doc.moveDown(0.3);

        itemsCambios.forEach((item) => {
          const neededHeight = 18 + doc.heightOfString(item.producto || 'Sin descripción', { width: 202 });
          if (doc.y + neededHeight > 788) {
            doc.addPage();
            doc.font('Helvetica-Bold').fontSize(9).text('CAMBIOS (Cont.):', { underline: true });
            doc.moveDown(0.3);
          }

          const startY = doc.y;
          doc.font('Helvetica-Bold').fontSize(8);
          doc.text(`SKU: ${item.sku || ''}`, 10, startY, { width: 100, lineBreak: false });
          doc.text(`Cant: ${item.cantidad_solicitada || 0}`, 120, startY, { width: 50, lineBreak: false });

          doc.y = startY + 13;
          doc.font('Helvetica').fontSize(7.5).text(item.producto || 'Sin descripción', 15, doc.y, { width: 202 });
          doc.moveDown(0.3);
          
          doc.lineWidth(0.25).moveTo(10, doc.y).lineTo(217, doc.y).stroke('#cbd5e1');
          doc.moveDown(0.3);
        });
      }

      // Verificar si cabe el código de barras (aproximadamente 70pt)
      if (doc.y + 70 > 788) {
        doc.addPage();
      } else {
        doc.moveDown(0.6);
        doc.lineWidth(0.5).moveTo(10, doc.y).lineTo(217, doc.y).stroke('#000000');
        doc.moveDown(0.6);
      }

      // --- Código de Barras ---
      try {
        const barcodeBuffer = await generateBarcodeBuffer(pedidoId);
        // Hacer un ~30% más chico: 150 * 0.7 = 105 de ancho
        const barcodeWidth = 105;
        const xPos = (227 - barcodeWidth) / 2;
        doc.image(barcodeBuffer, xPos, doc.y, { width: barcodeWidth });
      } catch (barcodeErr) {
        console.error('Error al generar código de barras para PDF:', barcodeErr);
        doc.font('Helvetica').fontSize(8).text(`Error de Código de Barras. ID: ${pedidoId}`, { align: 'center' });
      }

      doc.end();

      writeStream.on('finish', () => resolve(pdfPath));
      writeStream.on('error', (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

// Ejecutar prueba manual
async function main() {
  console.log(`Iniciando prueba de generación de ticket para pedido: #${pedidoId}`);
  try {
    // 1. Obtener datos de la base de datos para el cliente (opcional)
    console.log('Autenticando contra Supabase...');
    const token = await getApiAuthToken();
    
    // Obtener detalles generales del pedido para extraer el nombre del cliente
    console.log('Buscando detalles del cliente en la base de datos...');
    const { data: orderRow, error: orderErr } = await supabase
      .from(PEDIDOS_TABLE)
      .select('productos')
      .eq('pedido', pedidoId)
      .maybeSingle();

    let clienteNombre = '';
    if (orderRow) {
      try {
        const productosJson = typeof orderRow.productos === 'string' ? JSON.parse(orderRow.productos) : orderRow.productos;
        clienteNombre = productosJson?.nombre || '';
      } catch (e) {}
    }

    // 2. Obtener ruta
    console.log('Consultando ruta de picking en API...');
    const rutaData = await fetchPickingRoute(pedidoId, token);
    console.log('API Response:', JSON.stringify(rutaData, null, 2));

    // 3. Crear PDF
    console.log('Generando PDF...');
    const pdfPath = await createTicketPdf(pedidoId, clienteNombre, rutaData);
    console.log(`\n✅ ¡Prueba exitosa! Archivo PDF guardado en: ${pdfPath}`);

    // 4. Impresión Automática si está configurada
    if (AUTO_PRINT === 'true') {
      console.log('Enviando ticket a la impresora...');
      const options = PRINTER_NAME ? { printer: PRINTER_NAME } : {};
      await print(pdfPath, options);
      console.log(`🖨️  ¡Éxito! Ticket enviado a la impresora: ${PRINTER_NAME || 'Predeterminada'}`);
    }
  } catch (err) {
    console.error('❌ Error durante la prueba:', err.message);
  }
}

main();
