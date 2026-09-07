# Tickets de bodega

Servicio Node.js para recibir jobs de tickets desde EscanersGlobal, consultar la ruta completa de picking, generar un PDF de 80 mm de ancho con altura dinámica e imprimirlo en Windows.

La PC de tickets se comunica únicamente con la API. No necesita acceso directo a Supabase ni claves `service_role`.

## Requisitos

- Windows con la impresora térmica instalada y funcionando.
- Node.js 18 o superior.
- Usuario de la API con acceso a la aplicación `etiquetas` y a la tienda correspondiente.
- API de EscanersGlobal disponible y con las migraciones de tickets aplicadas (`068`, `069` y `070`).
- Conectividad permanente entre esta PC y `API_URL`.

## Qué hace el servicio

1. Inicia sesión en la API con `/auth/login` y renueva la sesión con `/auth/refresh`.
2. Escucha `GET /tickets/stream` mediante SSE.
3. Recupera periódicamente `GET /tickets/pending`, incluyendo jobs fallidos y leases vencidos.
4. Reclama cada job con `POST /tickets/jobs/:id/claim` antes de procesarlo.
5. Consulta `GET /picking/ruta/{pedido}`.
6. Genera el PDF con todos los productos recibidos.
7. Imprime el ticket y confirma con `POST /tickets/jobs/:id/printed`.
8. Si ocurre un error antes de imprimir, reporta `POST /tickets/jobs/:id/failed`.

La deduplicación se realiza por `job_id`. Si la PC se desconecta, el API conserva el job y el servicio lo recupera al reconectar o durante el sondeo de pendientes.

## Ningún producto se omite

El PDF imprime todas las categorías de la respuesta de la API:

- `rutas[].items`;
- `rutas[].sin_ruta`;
- `sin_ubicacion`;
- `sin_layout`;
- `cambios`.

No se filtra ningún producto por piso, ubicación, layout o modo de picking. Si la cantidad recibida no coincide con el resumen de la API, el servicio deja una advertencia y conserva todas las líneas recibidas.

## Instalación en Windows

Abre PowerShell en la carpeta del proyecto:

```powershell
cd C:\ruta\tickets_bodega
npm ci
Copy-Item .env.example .env
notepad .env
```

También puedes copiar el archivo desde CMD:

```cmd
copy .env.example .env
```

Configura `.env` antes de iniciar el listener. El archivo `.env` real está ignorado por Git y no debe publicarse.

## Configuración de `.env`

Ejemplo completo:

```env
# Usuario de EscanersGlobal con permiso para la app etiquetas.
STORE_USER_EMAIL=usuario@ejemplo.com
STORE_USER_PASSWORD=tu_contraseña

# URL base de la API, sin barra final.
API_URL=https://api.ejemplo.com

# Identificador exacto de la tienda.
TIENDA=surti

# Producción: false. Consulta y valida sin reclamar ni imprimir.
DRY_RUN=false

# Producción: true. Reclama jobs e imprime tickets.
AUTO_PRINT=true

# Vacío = impresora predeterminada de Windows.
PRINTER_NAME=

# Lease para evitar que dos PCs procesen el mismo job.
LEASE_SECONDS=120

# Cada cuánto se recuperan jobs pendientes o leases vencidos.
PENDING_POLL_MS=30000

# Identificador opcional y único para esta PC.
# Si se omite, se crea tickets/.ticket-client-id automáticamente.
# TICKET_CLIENT_ID=pc-tickets-surti-01

# Timeout de cada llamada normal a la API.
API_TIMEOUT_MS=15000
```

Variables obligatorias:

| Variable | Descripción |
| --- | --- |
| `STORE_USER_EMAIL` | Correo del usuario de la API. |
| `STORE_USER_PASSWORD` | Contraseña del usuario de la API. |
| `API_URL` | URL base de EscanersGlobal. |
| `TIENDA` | Tienda autorizada para esa PC. |

Variables importantes:

| Variable | Valor recomendado |
| --- | --- |
| `DRY_RUN` | `false` en producción; `true` para diagnóstico sin reclamar jobs. |
| `AUTO_PRINT` | `true` en producción; `false` genera vista previa sin confirmar jobs. |
| `PRINTER_NAME` | Vacío para usar la predeterminada o el nombre exacto de Windows. |
| `TICKET_CLIENT_ID` | Un valor distinto por cada PC de tickets. |

No configures estas variables en la PC de tickets:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `SUPABASE_KEY`;
- `PEDIDOS_TABLE`.

La API es el único proceso que accede a Supabase con `service_role`.

## Uso normal

Inicia el listener:

```powershell
node listener.js
```

Al iniciar correctamente debe mostrar la tienda, la URL de la API, el identificador del cliente y que la fuente es `/tickets/stream + /tickets/pending`.

Déjalo ejecutándose en la PC de bodega. Para detenerlo, presiona `Ctrl+C`.

## Prueba manual de un pedido

Para consultar y generar un ticket específico:

```powershell
node test-print.js GD12345
```

El comportamiento de `test-print.js` usa `AUTO_PRINT` del `.env`:

- `AUTO_PRINT=false`: genera el PDF sin imprimir.
- `AUTO_PRINT=true`: genera e imprime.

Esta prueba manual no reclama ni confirma un job; se utiliza únicamente para verificar la ruta y la impresora.

## Modos de diagnóstico

Para validar autenticación, consulta de ruta y conteo de productos sin generar PDF ni imprimir:

```env
DRY_RUN=true
AUTO_PRINT=true
```

Para generar PDFs sin imprimir:

```env
DRY_RUN=false
AUTO_PRINT=false
```

En ambos casos los jobs no se marcan como impresos y permanecen recuperables. En producción usa `DRY_RUN=false` y `AUTO_PRINT=true`.

## Impresión y recuperación

- El job se reclama antes de consultar la ruta.
- Si la impresora falla, el job se marca como `failed` y puede reintentarse.
- Si la PC se apaga antes de confirmar, el lease vence y el job vuelve a ser recuperable.
- Si la impresión física terminó pero se corta la conexión antes de `printed`, puede ocurrir una reimpresión; es la limitación inevitable entre imprimir y confirmar.
- Los PDFs y el estado local se guardan en `tickets/`, carpeta excluida de Git.

## Problemas comunes

### `401` o usuario sin acceso

Verifica `STORE_USER_EMAIL`, `STORE_USER_PASSWORD`, `TIENDA` y que el usuario tenga acceso a la app `etiquetas` y a esa tienda.

### No llegan tickets

Verifica que `API_URL` sea correcta, que la API esté disponible y que las migraciones `068`, `069` y `070` estén aplicadas. El servicio también consulta `/tickets/pending`, por lo que un pedido creado durante una desconexión debe recuperarse.

### La impresora no responde

Confirma que Windows pueda imprimir una página de prueba y configura `PRINTER_NAME` con el nombre exacto de la impresora.

### Se necesita cambiar de tienda

Edita `TIENDA` y usa credenciales autorizadas para esa tienda. No reutilices el mismo `TICKET_CLIENT_ID` en dos PCs simultáneamente.

## Archivos principales

| Archivo | Función |
| --- | --- |
| `listener.js` | SSE, recuperación, cola, claim, deduplicación e impresión. |
| `api-client.js` | Login, refresh, stream, jobs y consulta de rutas. |
| `ticket-pdf.js` | Generación del PDF sin omitir categorías. |
| `test-print.js` | Prueba manual de un pedido. |
| `.env.example` | Plantilla segura de configuración. |

## Seguridad

El `.env` real contiene credenciales y nunca debe subirse a GitHub. Sólo se publica `.env.example` con valores de ejemplo. La PC de tickets no debe tener ni necesitar una clave `service_role`.
