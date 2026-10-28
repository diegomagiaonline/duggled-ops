# Duggled Ops — Conectar Gmail comercial

La conexión de Gmail hecha dentro de ChatGPT **no sirve como credencial OAuth de una web en Vercel**. Duggled Ops utiliza su propia autorización de Google para `infoduggled@gmail.com`.

## 1. Crear credenciales Google OAuth

1. Abrir https://console.cloud.google.com/ y seleccionar/crear un proyecto.
2. Habilitar **Gmail API** en APIs y servicios.
3. Configurar **OAuth consent screen**. Para pruebas: External / Testing y agregar `infoduggled@gmail.com` como usuario de prueba.
4. Crear credencial **OAuth Client ID** de tipo **Web application**.
5. Agregar la URI de redirección autorizada, **exactamente**:
   `https://duggled-ops.vercel.app/api/gmail?action=callback`
6. Agregar como origen JavaScript `https://duggled-ops.vercel.app`, si Google lo solicita.

### Permisos solicitados
- `gmail.readonly`: obtener conversaciones y detectar respuestas
- `gmail.send`: enviar mensajes **solo tras confirmar cada envío**
- `userinfo.email`: verificar que la cuenta autenticada es precisamente `infoduggled@gmail.com`.

Los permisos de Gmail son sensibles/restringidos; Google puede requerir un proceso adicional si la app se distribuye ampliamente. Para uso privado, mantener la app en modo Testing con cuenta autorizada puede ser adecuado, sujeto a las limitaciones de los refresh tokens de prueba.

## 2. Configurar Vercel

En **Project Settings → Environment Variables** del proyecto `duggled-ops`, crear variables protegidas para Production:

- `GOOGLE_CLIENT_ID`: Client ID provisto por Google
- `GOOGLE_CLIENT_SECRET`: Client Secret provisto por Google
- `GMAIL_SESSION_SECRET`: secreto aleatorio de al menos 32 caracteres (mejor 64+)

**Nunca pegar secretos en GitHub, en Google Sheets ni en el frontend**.

Hacer un nuevo deploy en Vercel después de agregar variables.

## 3. Autorizar desde Ops

1. Abrir https://duggled-ops.vercel.app/.
2. Abrir un prospecto con **email cargado**.
3. Presionar **Conectar Gmail**.
4. Seleccionar únicamente `infoduggled@gmail.com` y aceptar los permisos.
5. Regresar a la ficha: aparecen los hilos Gmail con ese email, su estado de respuesta y el editor de seguimiento.

## 4. Notificaciones

El botón de sonido debe activarse manualmente porque el navegador bloquea reproducción automática. Ops consulta el **prospecto abierto** cada 60 segundos mientras el panel permanezca abierto, y reproduce sonido cuando detecta respuestas nuevas. El navegador puede pedir permiso para mostrar notificaciones.

**Este módulo aún no ofrece push en segundo plano con la pestaña cerrada.** Para eso hacen falta service worker, suscripciones y backend de notificaciones.

## Seguridad y límites

- No se envía ningún mensaje de forma automática.
- El acceso OAuth solo acepta `infoduggled@gmail.com`; los tokens de larga duración se almacenan cifrados en una cookie `HttpOnly; Secure; SameSite=Lax`.
- El mensaje inicial respeta el HTML actual `WEB-01`.
- Gmail permite filtrar hilos solo si el prospecto tiene un email conocido.
- No se deben usar hilos ajenos al prospecto para contestarle.
- Se recomienda mantener la protección de acceso de Vercel hasta tener un control de acceso propio equivalente.
