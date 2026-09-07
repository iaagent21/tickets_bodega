const assert = require('node:assert/strict');
const { test } = require('node:test');
const { renderTicketContent } = require('../ticket-pdf');

function createDocumentDouble() {
  const document = {
    y: 12,
    texts: [],
    images: [],
    lines: 0,
    font() { return this; },
    fontSize() { return this; },
    text(value) {
      this.texts.push(String(value));
      return this;
    },
    moveDown(amount = 1) {
      this.y += Number(amount) * 5;
      return this;
    },
    lineWidth() { return this; },
    moveTo() { return this; },
    lineTo() { return this; },
    stroke() {
      this.lines += 1;
      return this;
    },
    heightOfString(value) {
      return Math.max(10, Math.ceil(String(value).length / 40) * 10);
    },
    addPage() {
      this.y = 12;
      return this;
    },
    image(buffer) {
      this.images.push(buffer);
      return this;
    },
  };
  return document;
}

function emptyRoute(overrides = {}) {
  return {
    vendedora: 'Ana López',
    total_documento: 1234.5,
    resumen: { total_items_surtibles: 0 },
    rutas: [],
    sin_ubicacion: [],
    sin_layout: [],
    cambios: [],
    ...overrides,
  };
}

test('el ticket imprime vendedora arriba del pedido y total antes del código de barras', () => {
  const document = createDocumentDouble();

  renderTicketContent(document, '0013481', 'JAVIER SOLANO', emptyRoute(), Buffer.from('barcode'));

  const sellerIndex = document.texts.indexOf('Vendedora: Ana López');
  const orderIndex = document.texts.indexOf('Pedido: #0013481');
  const totalIndex = document.texts.indexOf('Total: $1,234.50');
  assert.ok(sellerIndex >= 0);
  assert.ok(orderIndex > sellerIndex);
  assert.ok(totalIndex > orderIndex);
  assert.equal(document.images.length, 1);
  assert.ok(document.lines >= 3, 'el encabezado y el total deben conservar sus separadores');
});

test('el ticket conserva compatibilidad cuando el total no viene informado', () => {
  const document = createDocumentDouble();

  renderTicketContent(document, '0013481', '', emptyRoute({ vendedora: null, total_documento: null }), Buffer.from('barcode'));

  assert.equal(document.texts.some((text) => text.startsWith('Vendedora:')), false);
  assert.equal(document.texts.some((text) => text.startsWith('Total:')), false);
  assert.equal(document.images.length, 1);
});
