# WhatsApp en Duggled Ops

Ops conserva el tablero, las fichas, Google Sheets y la API. El proceso Puppeteer está en el repositorio privado `duggledmedia/duggled-whatsapp-monitor`, vinculado al proyecto Vercel del mismo nombre. El Daemon de Vercel está configurado inicialmente con **cero instancias**; no lee mensajes hasta completar la prueba de vinculación.

## Integración

- `/api/whatsapp?action=contacts` entrega sólo teléfonos asociados de forma única con prospectos. `ingest` valida el secreto del monitor, vuelve a asociar el número exacto y guarda mensajes en Redis. `session` recibe el estado de conexión o un QR temporal (TTL 3 minutos), visible únicamente desde Ops protegido por Vercel Authentication.
- La ficha muestra últimos mensajes, prioridad, presupuesto detectado, respuestas pendientes y seguimiento vencido. Los mensajes nuevos reutilizan las suscripciones Web Push existentes según preferencias.
- El borrador es editable. **Generar con IA** requiere `GEMINI_API_KEY` y envía a Gemini el contexto reciente. **Aprobar y abrir WhatsApp** precarga el texto, pero Diego lo envía manualmente.
- La clasificación de presupuesto usa texto o el nombre visible del archivo; no abre adjuntos. Una solicitud explícita de no contactar bloquea el borrador.

## Activación gradual

1. La imagen Docker y el proyecto Vercel ya existen. Verificar el build y las variables `OPS_URL`, `OPS_WHATSAPP_WORKER_SECRET` en ambos proyectos y `VERCEL_AUTOMATION_BYPASS_SECRET` sólo en el monitor. No publicar secretos en GitHub.
2. La API de Ops sigue en un PR. Validar la versión de preview y su integración con Redis; desplegar Ops sólo después de comprobar que la interfaz y funciones existentes continúan operando.
3. Cambiar el Daemon a una sola instancia; desde la ficha de un prospecto pulsar **Ver conexión del monitor** y escanear el QR con el iPhone. Probar un prospecto con teléfono único: entrada, respuesta, presupuesto, prioridad, borrador y notificación.
4. El almacenamiento del Daemon es temporal. Tras un reinicio o despliegue puede requerir otro QR. Mantener WhatsApp Web abierto en una computadora no conserva la sesión del navegador de Vercel.

No se usa la API de WhatsApp. El perfil y las cookies de Chrome quedan en el contenedor temporal; sólo el QR temporal se guarda en Redis de Ops. Los selectores de WhatsApp Web pueden cambiar y requieren validación real.
