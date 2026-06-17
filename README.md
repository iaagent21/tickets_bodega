# tickets_bodega

Script en tiempo real que escucha nuevos pedidos en Supabase y genera tickets de picking en PDF de 80mm, listos para imprimir en impresora de tickets térmica.

## Requisitos

- [Node.js](https://nodejs.org/) v18 o superior
- Acceso a un proyecto Supabase con **Realtime habilitado** en la tabla de pedidos
- API de picking activa y accesible desde la red local

---

## Instalación

1. **Clona el repositorio o copia la carpeta:**
   ```bash
   git clone https://github.com/iaagent21/tickets_bodega.git
   cd tickets_bodega
   ```

2. **Instala las dependencias:**
   ```bash
   npm install
   ```

3. **Configura el entorno:**
   ```bash
   # En Windows:
   copy .env.example .env
   # En Mac/Linux:
   cp .env.example .env
   ```
   Luego abre el archivo `.env` y rellena los valores con tus credenciales.

---

## Configuración rápida por tienda

Para apuntar el script a una tienda diferente, **solo cambia estas dos líneas** en tu archivo `.env`:

```env
PEDIDOS_TABLE=pedidos_surti   # Nombre exacto de la tabla en Supabase
TIENDA=surti                  # Identificador corto para la API
```

Después reinicia el script:
```bash
node listener.js
```

### Ejemplos de configuración por tienda

| Tienda | PEDIDOS_TABLE | TIENDA |
|---|---|---|
| La 4ta | `pedidos_la4ta` | `la4ta` |
| Surti | `pedidos_surti` | `surti` |
| Der | `pedidos_der` | `der` |
| H79 | `pedidos_h79` | `h79` |

---

## Supabase: Anon Key vs Service Role Key

El campo `SUPABASE_KEY` acepta **cualquiera** de las dos claves:

| Clave | Dónde encontrarla | Recomendación |
|---|---|---|
| **anon public** | Settings → API → `anon public` | ✅ Recomendada para PCs en bodega |
| **service_role** | Settings → API → `service_role secret` | Solo si tienes problemas de permisos RLS |

### Si usas Anon Key:
Asegúrate de que Realtime esté habilitado para la tabla:
1. Ve a **Supabase → Database → Replication**
2. Busca la publicación `supabase_realtime`
3. Activa la tabla `pedidos_XXXXX` correspondiente a tu tienda

También necesitas una **política RLS** que permita que el usuario de tienda pueda leer la tabla. Si usas Service Role Key, esto no aplica (ya tiene acceso total).

---

## Uso

### Modo producción (escucha automática)
```bash
node listener.js
```
El script se queda en espera. Cada pedido nuevo que llegue a la tabla genera automáticamente un PDF en la carpeta `tickets/`.

### Prueba manual de un pedido
```bash
node test-print.js 0001010
```
Genera el PDF de un pedido específico y lo guarda en `tickets/pedido_0001010.pdf`.

---

## Archivos clave

| Archivo | Descripción |
|---|---|
| `listener.js` | Daemon principal — escucha Supabase Realtime y genera PDFs |
| `test-print.js` | Herramienta manual para probar un pedido específico |
| `.env.example` | Plantilla de configuración (copia y renombra a `.env`) |
| `tickets/` | Carpeta donde se guardan los PDFs generados (**no se sube a Git**) |

---

## Estructura del PDF generado

El ticket de 80mm incluye:
- Número de pedido y nombre de cliente
- Fecha y hora de generación
- Tabla de picking ordenada por **ruta óptima** (Pasillo → Cajón → SKU → Cantidad)
- Descripción del producto debajo de cada fila
- Sección de productos sin ubicación registrada
- Código de barras **Code 128** al pie del ticket