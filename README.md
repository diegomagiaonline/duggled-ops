# Duggled Ops

Panel operativo privado para la prospección de Duggled. Google Sheets conserva el histórico y esta interfaz lo consulta desde una API de servidor.

## Puesta en marcha

1. Crear una service account de Google Cloud y compartir la planilla con su email como **Lector**.
2. En Vercel, cargar estas variables de entorno:
   - `GOOGLE_SHEET_ID=1rMOf9CPZS4KdTobETIQpE_sH1JmPqUZrIOB5e2ot6wU`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL=...`
   - `GOOGLE_PRIVATE_KEY=...`
3. Conectar el repositorio y desplegar. La interfaz consulta `/api/prospects` cada 15 segundos.

La API expone únicamente datos a la interfaz autenticada. Antes de usar datos reales, activar Vercel Authentication/Protection en el proyecto.

## Alcance inicial

- vista de operaciones, métricas y embudo;
- filtros por estado y rubro;
- detalle de evidencia y mensaje sugerido;
- lectura en vivo de la planilla sin exponer credenciales en el navegador.

La aprobación y el envío se agregan después de conectar el correo corporativo.

## Seguridad

Las credenciales de Google se cargan únicamente como variables de entorno en Vercel. No se suben al repositorio ni se entregan al navegador.
