const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

const PAGE_WIDTH = 227; // 80 mm en puntos PDF.
const PAGE_HEIGHT = 800; // Largo original por página, aproximadamente 28.2 cm.
const PAGE_MARGINS = { top: 12, bottom: 12, left: 10, right: 10 };

function generateBarcodeBuffer(text) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({
      bcid: 'code128',
      text: String(text),
      scale: 3,
      height: 10,
      includetext: true,
      textalign: 'center',
      textcolor: '000000',
    }, (error, png) => {
      if (error) reject(error);
      else resolve(png);
    });
  });
}

function getPasilloTicketText(item) {
  const numero = item?.pasillo_numero ? String(item.pasillo_numero).trim() : '';
  const nombre = String(item?.pasillo_nombre ?? '').trim();
  const inicial = nombre && !nombre.toLowerCase().startsWith('pasillo')
    ? nombre.charAt(0).toUpperCase()
    : '';
  return inicial && numero ? `${inicial}${numero}` : (numero || inicial);
}

function getDescription(item) {
  return String(item?.producto ?? '').trim() || `SKU ${String(item?.sku ?? '').trim() || 'sin SKU'}`;
}

function getQuantity(item) {
  return String(item?.cantidad_solicitada ?? 0);
}

function getSku(item) {
  return String(item?.sku ?? '').trim();
}

function getSimpleLocation(item) {
  if (item?.tipo_ubicacion === 'cuarto') return item?.cuarto_nombre || 'Cuarto';
  return item?.ubicacion_visible || item?.cajon || '';
}

function safeFilenamePart(value) {
  const safe = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
  return safe || 'sin_pedido';
}

function asItems(value) {
  return Array.isArray(value) ? value : [];
}

function createPdfDocument() {
  return new PDFDocument({
    // Mantener exactamente el formato que ya funcionaba en la impresora:
    // 80 mm de ancho por 800 puntos de largo en cada página.
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    margins: PAGE_MARGINS,
  });
}

function renderTicketContent(doc, pedidoId, clienteNombre, rutaData, barcodeBuffer) {
  // Cada página conserva el tamaño original. Los pedidos largos continúan en
  // otra página del mismo formato para no cortar ni omitir productos.
  const pageBottom = PAGE_HEIGHT - PAGE_MARGINS.bottom;
  let renderedItems = 0;

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

  const drawSectionTitle = (title, continuation = false) => {
    doc.font('Helvetica-Bold').fontSize(9).text(`${title}${continuation ? ' (Cont.)' : ''}:`, { underline: true });
    doc.moveDown(0.3);
  };

  const routeItemHeight = (item) => {
    doc.font('Helvetica').fontSize(7.5);
    return 18 + doc.heightOfString(getDescription(item), { width: 202 }) + 8;
  };

  const simpleItemHeight = (item) => routeItemHeight(item);

  const renderRouteItem = (item) => {
    const neededHeight = routeItemHeight(item);
    if (doc.y + neededHeight > pageBottom) {
      doc.addPage();
      drawTableHeader();
    }

    let cajonText = String(getSimpleLocation(item) || 'Sin ubicación');
    if (cajonText.startsWith('Tapanco ')) cajonText = cajonText.replace('Tapanco ', 'Tpc ');
    if (cajonText.length > 8) cajonText = `${cajonText.substring(0, 7)}.`;

    const startY = doc.y;
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text(getPasilloTicketText(item), 10, startY, { width: 32, lineBreak: false });
    doc.text(cajonText, 45, startY, { width: 42, lineBreak: false });
    doc.text(getSku(item), 90, startY, { width: 62, lineBreak: false });
    doc.text(getQuantity(item), 152, startY, { width: 35, align: 'right', lineBreak: false });
    doc.y = startY + 13;
    doc.font('Helvetica').fontSize(7.5).text(getDescription(item), 15, doc.y, { width: 202 });
    doc.moveDown(0.6);
    renderedItems += 1;
  };

  const renderSimpleItem = (item) => {
    const neededHeight = simpleItemHeight(item);
    if (doc.y + neededHeight > pageBottom) {
      doc.addPage();
      drawSectionTitle('CONTINUACIÓN');
    }

    const startY = doc.y;
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text(`SKU: ${getSku(item)}`, 10, startY, { width: 100, lineBreak: false });
    doc.text(`Cant: ${getQuantity(item)}`, 120, startY, { width: 70, lineBreak: false });
    doc.y = startY + 13;
    doc.font('Helvetica').fontSize(7.5).text(getDescription(item), 15, doc.y, { width: 202 });
    doc.moveDown(0.3);
    doc.lineWidth(0.25).moveTo(10, doc.y).lineTo(217, doc.y).stroke('#cbd5e1');
    doc.moveDown(0.3);
    renderedItems += 1;
  };

  const renderSimpleSection = (title, items) => {
    const list = asItems(items);
    if (list.length === 0) return;
    if (doc.y + 45 > pageBottom) doc.addPage();
    else doc.moveDown(0.5);
    drawSectionTitle(title);
    list.forEach(renderSimpleItem);
  };

  const now = new Date();
  doc.font('Helvetica').fontSize(7.5).text(
    `Fecha: ${now.toLocaleDateString('es-MX')}   Hora: ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`,
    { align: 'center' },
  );
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(8.5).text(`Pedido: #${pedidoId}`);
  if (clienteNombre) doc.font('Helvetica').fontSize(8).text(`Cliente: ${clienteNombre}`);
  doc.moveDown(0.4);

  const rutas = asItems(rutaData.rutas);
  const sinRutaItems = [];
  for (const piso of rutas) {
    const routeItems = asItems(piso?.items);
    const noRouteItems = asItems(piso?.sin_ruta);
    sinRutaItems.push(...noRouteItems);
    if (routeItems.length === 0) continue;

    if (doc.y + 48 > pageBottom) doc.addPage();
    else if (doc.y > 35) doc.moveDown(0.5);
    drawSectionTitle(piso?.piso_nombre || 'Bodega');
    drawTableHeader();
    routeItems.forEach(renderRouteItem);
  }

  // Se combinan al final porque ambos grupos requieren búsqueda o atención
  // manual: uno tiene ubicación pero no recorrido calculable y el otro no
  // tiene ubicación registrada.
  const sinRutaYSinUbicacion = [...sinRutaItems, ...asItems(rutaData.sin_ubicacion)];
  if (sinRutaYSinUbicacion.length > 0) {
    if (doc.y + 45 > pageBottom) doc.addPage();
    else doc.moveDown(0.5);
    drawSectionTitle('SIN RUTA O UBICACIÓN REGISTRADA');
    drawTableHeader();
    sinRutaYSinUbicacion.forEach(renderRouteItem);
  }

  // Estas secciones también son obligatorias: ningún producto queda fuera por
  // no tener layout o por ser un cambio de cantidad.
  renderSimpleSection('SIN LAYOUT REGISTRADO', rutaData.sin_layout);
  renderSimpleSection('CAMBIOS', rutaData.cambios);

  const changesCount = asItems(rutaData.cambios).length;
  const expectedPositive = Number(rutaData.resumen?.total_items_surtibles);
  const expectedTotal = Number.isFinite(expectedPositive) ? expectedPositive + changesCount : null;
  if (doc.y + 75 > pageBottom) doc.addPage();
  else doc.moveDown(0.5);
  if (barcodeBuffer) {
    const barcodeWidth = 105;
    const barcodeTop = doc.y;
    doc.image(barcodeBuffer, (PAGE_WIDTH - barcodeWidth) / 2, barcodeTop, { width: barcodeWidth });
    // image() con coordenadas explícitas no siempre actualiza doc.y.
    doc.y = barcodeTop + 68;
  } else {
    doc.font('Helvetica').fontSize(8).text(`Código de barras no disponible. ID: ${pedidoId}`, { align: 'center' });
  }

  return {
    renderedItems,
    expectedTotal,
  };
}

async function createTicketPdf(pedidoId, clienteNombre, rutaData, ticketsDir) {
  if (!rutaData || typeof rutaData !== 'object') {
    throw new Error('La API devolvió una ruta de picking vacía o inválida.');
  }

  fs.mkdirSync(ticketsDir, { recursive: true });
  const pdfPath = path.join(ticketsDir, `pedido_${safeFilenamePart(pedidoId)}.pdf`);
  let barcodeBuffer = null;
  try {
    barcodeBuffer = await generateBarcodeBuffer(pedidoId);
  } catch (error) {
    console.error('No se pudo generar el código de barras:', error.message);
  }

  const doc = createPdfDocument();
  const writeStream = fs.createWriteStream(pdfPath);
  doc.pipe(writeStream);
  const rendered = renderTicketContent(doc, pedidoId, clienteNombre, rutaData, barcodeBuffer);

  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve({
      pdfPath,
      renderedItems: rendered.renderedItems,
      expectedTotal: rendered.expectedTotal,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
    }));
    writeStream.on('error', reject);
    doc.end();
  });
}

module.exports = { createTicketPdf };
