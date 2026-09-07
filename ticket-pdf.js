const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

const PAGE_WIDTH = 227; // 80 mm en puntos PDF.
const PAGE_MARGINS = { top: 12, bottom: 12, left: 10, right: 10 };
const MEASURE_PAGE_HEIGHT = 1_000_000;

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

function createPdfDocument(height) {
  return new PDFDocument({
    // El ancho es fijo a 80 mm; la altura se calcula en dos pasadas según el
    // contenido real del pedido.
    size: [PAGE_WIDTH, height],
    margins: PAGE_MARGINS,
  });
}

function renderTicketContent(doc, pedidoId, clienteNombre, rutaData, barcodeBuffer) {
  // La altura final se calcula después de dibujar todo. No se crean páginas
  // intermedias: el ticket térmico es una sola tira de 80 mm de ancho.
  const pageBottom = Number.POSITIVE_INFINITY;
  let renderedItems = 0;

  const drawDivider = (color = '#94a3b8') => {
    doc.lineWidth(0.5).moveTo(10, doc.y).lineTo(217, doc.y).stroke(color);
    doc.moveDown(0.4);
  };

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
    doc.moveDown(0.3);
    doc.lineWidth(0.25).moveTo(10, doc.y).lineTo(217, doc.y).stroke('#cbd5e1');
    doc.moveDown(0.3);
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
    else drawDivider();
    drawSectionTitle(title);
    list.forEach(renderSimpleItem);
  };

  const now = new Date();
  doc.font('Helvetica').fontSize(7.5).text(
    `Fecha: ${now.toLocaleDateString('es-MX')}   Hora: ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`,
    { align: 'center' },
  );
  doc.moveDown(0.4);
  drawDivider('#000000');
  doc.font('Helvetica-Bold').fontSize(8.5).text(`Pedido: #${pedidoId}`);
  if (clienteNombre) doc.font('Helvetica').fontSize(8).text(`Cliente: ${clienteNombre}`);
  doc.moveDown(0.4);
  drawDivider('#000000');

  const rutas = asItems(rutaData.rutas);
  for (const piso of rutas) {
    const routeItems = asItems(piso?.items);
    const noRouteItems = asItems(piso?.sin_ruta);
    if (routeItems.length === 0 && noRouteItems.length === 0) continue;

    if (doc.y + 48 > pageBottom) doc.addPage();
    else if (doc.y > 35) drawDivider();
    drawSectionTitle(piso?.piso_nombre || 'Bodega');
    drawTableHeader();
    routeItems.forEach(renderRouteItem);

    if (noRouteItems.length > 0) {
      if (doc.y + 30 > pageBottom) doc.addPage();
      else drawDivider('#c2410c');
      doc.font('Helvetica-Bold').fontSize(8).text('SIN RUTA CALCULADA:', { underline: true });
      doc.moveDown(0.3);
      drawTableHeader();
      noRouteItems.forEach(renderRouteItem);
    }
  }

  // Estas tres secciones son obligatorias: ningún producto queda fuera por
  // no tener ubicación, layout o por ser un cambio de cantidad.
  renderSimpleSection('SIN UBICACIÓN REGISTRADA', rutaData.sin_ubicacion);
  renderSimpleSection('SIN LAYOUT REGISTRADO', rutaData.sin_layout);
  renderSimpleSection('CAMBIOS', rutaData.cambios);

  const routeCount = rutas.reduce((total, piso) => (
    total + asItems(piso?.items).length + asItems(piso?.sin_ruta).length
  ), 0);
  const noLocationCount = asItems(rutaData.sin_ubicacion).length;
  const noLayoutCount = asItems(rutaData.sin_layout).length;
  const changesCount = asItems(rutaData.cambios).length;
  const expectedPositive = Number(rutaData.resumen?.total_items_surtibles);
  const expectedTotal = Number.isFinite(expectedPositive) ? expectedPositive + changesCount : null;
  const observedPositive = routeCount + noLocationCount + noLayoutCount;

  if (doc.y + 65 > pageBottom) doc.addPage();
  else drawDivider('#000000');
  doc.font('Helvetica-Bold').fontSize(8).text(
    expectedTotal === null
      ? `Productos incluidos en ticket: ${renderedItems}`
      : `Productos incluidos: ${renderedItems}/${expectedTotal}`,
    { align: 'center' },
  );
  if (expectedTotal !== null && observedPositive !== expectedPositive) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#b91c1c').text(
      `VERIFICAR RESPUESTA API: ${observedPositive} surtibles recibidos; resumen indica ${expectedPositive}.`,
      { align: 'center' },
    ).fillColor('#000000');
  }
  doc.moveDown(0.5);

  if (doc.y + 75 > pageBottom) doc.addPage();
  else drawDivider('#000000');
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
    height: Math.max(100, Math.ceil(doc.y + PAGE_MARGINS.bottom)),
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

  // Primera pasada: medimos el contenido. Segunda pasada: creamos el PDF con
  // exactamente la altura necesaria para el rollo térmico.
  const measureDoc = createPdfDocument(MEASURE_PAGE_HEIGHT);
  const measured = renderTicketContent(measureDoc, pedidoId, clienteNombre, rutaData, barcodeBuffer);
  measureDoc.end();

  const doc = createPdfDocument(measured.height);
  const writeStream = fs.createWriteStream(pdfPath);
  doc.pipe(writeStream);
  const rendered = renderTicketContent(doc, pedidoId, clienteNombre, rutaData, barcodeBuffer);

  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve({
      pdfPath,
      renderedItems: rendered.renderedItems,
      expectedTotal: rendered.expectedTotal,
      pageWidth: PAGE_WIDTH,
      pageHeight: measured.height,
    }));
    writeStream.on('error', reject);
    doc.end();
  });
}

module.exports = { createTicketPdf };
