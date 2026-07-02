const fs = require('fs');
const path = require('path');
const net = require('net');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const fetch = require('node-fetch');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const { print } = require('pdf-to-printer');

// Cargar variables de entorno
require('dotenv').config();

const {
  SUPABASE_URL,
  SUPABASE_KEY,          // Acepta service_role key O anon key
  STORE_USER_EMAIL,
  STORE_USER_PASSWORD,
  API_URL,
  DRY_RUN,
  // Configuración de tienda — cambiar estos valores para adaptar a otra tienda
  PEDIDOS_TABLE,         // Nombre de la tabla en Supabase, ej: pedidos_la4ta
  TIENDA,                // Identificador de tienda para la API, ej: la4ta
  // Configuración de Impresora
  AUTO_PRINT,            // true o false
  PRINTER_NAME,          // Nombre exacto de la impresora en Windows, vacío para predeterminada
} = process.env;

// Validar variables requeridas
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

// Asegurar que exista la carpeta para guardar los PDFs
const ticketsDir = path.join(__dirname, 'tickets');
if (!fs.existsSync(ticketsDir)) {
  fs.mkdirSync(ticketsDir, { recursive: true });
}

// Inicializar cliente de Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  realtime: { websocket: ws }
});

console.log('==================================================');
console.log('   Iniciando Script de Impresión de Tickets');
console.log(`   Tienda: ${TIENDA}`);
console.log(`   Tabla Supabase: ${PEDIDOS_TABLE}`);
console.log(`   Servidor API: ${API_URL}`);
console.log(`   Modo Simulación: ${DRY_RUN === 'true' ? 'ACTIVADO' : 'DESACTIVADO'}`);
console.log(`   Impresión Automática: ${AUTO_PRINT === 'true' ? 'ACTIVADA' : 'DESACTIVADA'}`);
if (AUTO_PRINT === 'true') {
  console.log(`   Impresora Destino: ${PRINTER_NAME || 'Predeterminada del sistema'}`);
}
console.log('==================================================');

// Función para iniciar sesión y obtener token JWT de Supabase
async function getApiAuthToken() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: STORE_USER_EMAIL,
    password: STORE_USER_PASSWORD
  });
  if (error) {
    throw new Error(`Error de autenticación: ${error.message}`);
  }
  return data.session.access_token;
}

// Función para obtener la ruta del pedido desde la API
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

// Función para generar la imagen del código de barras en formato PNG Buffer
function generateBarcodeBuffer(text) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({
      bcid: 'code128',       // Tipo de código de barras
      text: text,            // Texto a codificar
      scale: 3,              // Factor de escala
      height: 10,            // Altura de barras en mm
      includetext: true,     // Incluir texto abajo
      textalign: 'center',   // Centrar texto
      textcolor: '000000',   // Color del texto
    }, (err, png) => {
      if (err) reject(err);
      else resolve(png);
    });
  });
}

// Función para armar el PDF de 80mm
function getPasilloTicketText(item) {
  const numero = item?.pasillo_numero ? String(item.pasillo_numero).trim() : '';
  const nombre = String(item?.pasillo_nombre ?? '').trim();
  const inicial = nombre && !nombre.toLowerCase().startsWith('pasillo') ? nombre.charAt(0).toUpperCase() : '';
  return inicial && numero ? `${inicial}${numero}` : (numero || inicial);
}

async function createTicketPdf(pedidoId, clienteNombre, rutaData) {
  return new Promise(async (resolve, reject) => {
    try {
      const pdfPath = path.join(ticketsDir, `pedido_${pedidoId}.pdf`);
      
      // 80mm de ancho son aprox. 227 puntos PostScript.
      // Alto auto-paginado, con márgenes de 10 puntos a los lados.
      const doc = new PDFDocument({
        size: [227, 800], // Tamaño base (el alto se puede reajustar si es necesario, o fluye a la sig. página)
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
      
      // Línea divisoria
      doc.lineWidth(0.5).moveTo(10, doc.y).lineTo(217, doc.y).stroke();
      doc.moveDown(0.4);

      // Datos del Pedido
      doc.font('Helvetica-Bold').fontSize(8.5).text(`Pedido: #${pedidoId}`);
      if (clienteNombre) {
        doc.font('Helvetica').fontSize(8).text(`Cliente: ${clienteNombre}`);
      }
      doc.moveDown(0.4);
      
      // Línea divisoria
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

      // --- Productos Ordenados (Ruta Lógica) ---
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

      // --- Código de Barras al Pie ---
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

      // Finalizar PDF
      doc.end();

      writeStream.on('finish', () => resolve(pdfPath));
      writeStream.on('error', (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

// Función principal de procesamiento de pedido
async function procesarPedido(row) {
  const pedidoId = String(row.pedido || '').trim();
  console.log(`[${new Date().toLocaleTimeString()}] Procesando nuevo pedido recibido: #${pedidoId}...`);

  if (!pedidoId) {
    console.warn('Advertencia: El pedido recibido no contiene un identificador de pedido válido.');
    return;
  }

  try {
    // 1. Iniciar sesión en la API y obtener token JWT
    console.log('Autenticando contra Supabase...');
    const token = await getApiAuthToken();

    // 2. Consultar la API para obtener el cálculo de ruta ordenada
    console.log(`Consultando ruta optimizada para pedido #${pedidoId} en API...`);
    const rutaData = await fetchPickingRoute(pedidoId, token);
    
    // Obtener el nombre del cliente de los datos de productos
    let clienteNombre = '';
    try {
      const productosJson = typeof row.productos === 'string' ? JSON.parse(row.productos) : row.productos;
      clienteNombre = productosJson?.nombre || '';
    } catch (e) {
      // Ignorar errores de parseo de JSON
    }

    if (DRY_RUN === 'true') {
      const totalRuta = (rutaData.rutas || []).reduce((acc, piso) => acc + (piso.items || []).length + (piso.sin_ruta || []).length, 0);
      const totalSinRuta = (rutaData.sin_ubicacion || []).length;
      console.log('--- MODO SIMULACIÓN ---');
      console.log(`Pedido ID: ${pedidoId}`);
      console.log(`Cliente: ${clienteNombre}`);
      console.log(`Items en Ruta: ${totalRuta}`);
      console.log(`Items Sin Ruta: ${totalSinRuta}`);
      console.log('-----------------------');
      return;
    }

    // 3. Generar el archivo PDF
    console.log('Generando archivo PDF del ticket...');
    const pdfPath = await createTicketPdf(pedidoId, clienteNombre, rutaData);
    console.log(`✅ ¡Éxito! Ticket PDF generado exitosamente en: ${pdfPath}`);

    // 4. Impresión Automática si está configurada
    if (AUTO_PRINT === 'true') {
      console.log('Enviando ticket a la impresora...');
      const options = PRINTER_NAME ? { printer: PRINTER_NAME } : {};
      await print(pdfPath, options);
      console.log(`🖨️  ¡Éxito! Ticket enviado a la impresora: ${PRINTER_NAME || 'Predeterminada'}`);
    }

    console.log('--------------------------------------------------');

  } catch (error) {
    console.error(`❌ Error al procesar el pedido #${pedidoId}:`, error.message);
    console.log('--------------------------------------------------');
  }
}

// Suscribirse a la base de datos en tiempo real
console.log(`Conectando a Supabase Realtime → tabla: ${PEDIDOS_TABLE}...`);
const channelName = `realtime:${PEDIDOS_TABLE}`;
const channel = supabase
  .channel(channelName)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: PEDIDOS_TABLE
    },
    (payload) => {
      // Un nuevo pedido fue insertado
      void procesarPedido(payload.new);
    }
  )
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`✅ ¡Suscrito con éxito a Supabase Realtime → ${PEDIDOS_TABLE}!`);
      console.log('Esperando nuevos pedidos...');
    } else {
      console.log(`Estado de suscripción: ${status}`);
    }
  });

// Mantener el proceso vivo y manejar salida limpia
process.on('SIGINT', () => {
  console.log('\nCerrando conexión y saliendo...');
  void supabase.channel(channelName).unsubscribe();
  process.exit(0);
});
