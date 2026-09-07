const fs = require('fs');
const path = require('path');
const { print } = require('pdf-to-printer');
const { createApiClient } = require('./api-client');
const { createTicketPdf } = require('./ticket-pdf');

require('dotenv').config();

const pedidoId = String(process.argv[2] ?? '').trim();
if (!pedidoId) {
  console.log('Uso: node test-print.js <numero_de_pedido>');
  console.log('Ejemplo: node test-print.js GD12345');
  process.exit(0);
}

const {
  API_URL,
  STORE_USER_EMAIL,
  STORE_USER_PASSWORD,
  TIENDA,
  AUTO_PRINT = 'false',
  PRINTER_NAME = '',
} = process.env;

if (!API_URL || !STORE_USER_EMAIL || !STORE_USER_PASSWORD || !TIENDA) {
  console.error('ERROR: API_URL, STORE_USER_EMAIL, STORE_USER_PASSWORD y TIENDA son obligatorios.');
  process.exit(1);
}

const shouldPrint = String(AUTO_PRINT).trim().toLowerCase() === 'true';
const ticketsDir = path.join(__dirname, 'tickets');
fs.mkdirSync(ticketsDir, { recursive: true });

async function main() {
  const apiClient = createApiClient({
    apiUrl: API_URL,
    tienda: TIENDA,
    email: STORE_USER_EMAIL,
    password: STORE_USER_PASSWORD,
    timeoutMs: Number(process.env.API_TIMEOUT_MS ?? 15_000),
  });

  console.log(`Probando generación de ticket para #${pedidoId}...`);
  const rutaData = await apiClient.fetchPickingRoute(pedidoId);
  console.log('Ruta obtenida de la API.');
  const result = await createTicketPdf(pedidoId, rutaData.nombre ?? '', rutaData, ticketsDir);
  console.log(`PDF generado: ${result.pdfPath}`);

  if (shouldPrint) {
    await print(result.pdfPath, PRINTER_NAME ? { printer: PRINTER_NAME } : {});
    console.log(`Ticket enviado a ${PRINTER_NAME || 'la impresora predeterminada'}.`);
  }
}

main().catch((error) => {
  console.error('Error durante la prueba:', error.message);
  process.exitCode = 1;
});
