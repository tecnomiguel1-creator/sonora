# Sonora ♪

Tu música, sin anuncios. Sube las canciones desde tu celular o tu PC y escúchalas en todos tus dispositivos.

Sonora es una app web instalable (PWA) con su propio servidor. Tus canciones se guardan en **tu** computadora o servidor, no en la nube de nadie, y no hay anuncios, cuentas ni rastreo.

## Qué incluye

- **Subir música** desde el celular (elegir varias canciones a la vez) o arrastrando archivos en la PC.
- **Reproductor completo**: aleatorio, repetir, cola, barra de progreso, volumen, atajos de teclado.
- **Controles en la pantalla de bloqueo** del celular, auriculares y teclas multimedia de la PC.
- **Biblioteca**: canciones, álbumes (con carátulas leídas del propio archivo), favoritas, listas de reproducción, búsqueda y orden.
- **Detección automática** de título, artista, álbum y carátula; evita subir canciones duplicadas.
- **Instalable** como app en el celular y la PC.
- **Contraseña opcional** para proteger tu biblioteca.
- Formatos: MP3, M4A, AAC, FLAC, OGG, OPUS y WAV.

## Cómo ponerlo en marcha (5 minutos)

Necesitas **Node.js 20 o superior** (gratis): <https://nodejs.org> (versión LTS).

**Windows:** haz doble clic en `iniciar.bat`. Se abre Sonora en el navegador y funciona sin internet ni wifi: las canciones quedan en esta PC. Para que parezca una app, en Chrome/Edge elige *Instalar Sonora* en el menú del navegador. No hace falta el instalador de Windows (queda solo como opción manual).

**Mac / Linux:** abre una terminal en esta carpeta y ejecuta `./iniciar.sh`.

O manualmente:

```bash
npm install
npm start
```

Verás algo así:

```
En esta computadora:  http://localhost:3000
En tu celular (misma red Wi-Fi):  http://192.168.1.25:3000
```

1. Abre la primera dirección en tu PC.
2. En el celular (conectado al **mismo Wi-Fi**), abre la segunda dirección.
3. Toca **+ / Subir música**, elige tus canciones y listo. Aparecerán en todos tus dispositivos.

> En Windows, la primera vez puede salir un aviso del Firewall: permite el acceso en **redes privadas**, o el celular no podrá conectarse.

### Instalarla como app

- **Android (Chrome):** menú ⋮ → *Instalar app* o *Añadir a la pantalla de inicio*.
- **iPhone (Safari):** botón Compartir → *Añadir a pantalla de inicio*.
- **PC (Chrome/Edge):** icono de instalar en la barra de direcciones.

Nota: el navegador solo ofrece "instalar" completo cuando la dirección es `https://` o `localhost`. Con `http://192.168...` funciona igual, pero se añade como acceso directo. Para tener HTTPS fácil, mira la sección siguiente.

## Sonora solo en el celular (sin computadora ni servidor)

En la pantalla de inicio de la app de Android pulsa **Usar solo en este celular**. Eliges las canciones de tu celular (varias a la vez) y quedan guardadas dentro de la app: suenan sin internet y con la computadora apagada. Se leen título, artista, álbum y carátula del archivo (MP3 y M4A); lo demás usa el nombre del archivo. Hay favoritas y listas, y funcionan igual que en el modo con servidor.

- La música vive solo en ese celular: si desinstalas la app o borras sus datos, se pierde.
- Para ver las mismas canciones en la PC hace falta un servidor (la PC con `iniciar.bat` o la nube). Desde **Subir música → Conectar con un servidor** puedes pasar a ese modo cuando quieras. Al conectarte, **las canciones que solo estaban en el celular se envían solas al servidor** (y también cada vez que abras la app, si quedó alguna pendiente). Siguen guardadas en el celular y conservan sus favoritas.
- Sin servidor, las mejoras de la pantalla llegan solas desde GitHub al abrir la app con internet.

## Sonido y funciones extra

Toca el botón de **ajustes de sonido** (el de las rayitas, junto al volumen en la PC, o arriba en la pantalla del reproductor en el celular):

- **Amplificador:** sube el volumen hasta 300 % por encima del máximo. Con más de 200 % puede distorsionar o dañar las bocinas.
- **Ecualizador** de 5 bandas con modos listos (Más graves, Voces, Rock, Pop, Electrónica…).
- **Velocidad** de reproducción (0,75× a 2×) y **temporizador de apagado** (15 min a 1 hora, o al terminar la canción) con bajada suave de volumen.
- **Limitador** para evitar la distorsión al amplificar.
- **Teclado (PC):** Espacio pausa, flechas ← → saltan 10 s, ↑ ↓ cambian el volumen, M silencia, N siguiente, P anterior.
- **Subida múltiple:** puedes elegir muchas canciones a la vez (o arrastrarlas); se suben 3 al mismo tiempo para ir más rápido, y las repetidas se detectan solas.

## App de escritorio para Windows

Es Sonora en su **propia ventana**, con ícono, sin navegador y sin la ventana negra. Ya incluye el servidor: al abrirla, tu música queda disponible también para el celular.

- **Cerrar la ventana no apaga Sonora**: sigue en la bandeja del sistema (junto al reloj) para que el celular pueda seguir escuchando. Para cerrarla del todo: clic derecho en el ícono de Sonora → **Salir**.
- **Conectar celular…** (menú *Sonora* o clic derecho en el ícono) muestra la dirección que debes escribir en la app del celular, con un botón para copiarla.
- **Iniciar con Windows** (clic derecho en el ícono) la abre sola al encender la PC, escondida en la bandeja.
- Solo se puede abrir **una** Sonora a la vez.

### Probarla ya, sin instalar

Haz doble clic en `abrir-app.bat`. La primera vez descarga unos 100 MB.

### Instalarla como una app de Windows (sin actualizaciones automáticas)

1. Cierra la ventana negra de `iniciar.bat` si la tienes abierta (no pueden funcionar las dos a la vez).
2. Haz doble clic en `crear-instalador.bat`. Tarda varios minutos la primera vez.
3. Se abre la carpeta `dist`: ejecuta `Sonora-Instalador-1.0.0.exe`.
   Windows puede mostrar «Windows protegió su PC» porque el instalador no está firmado: pulsa *Más información → Ejecutar de todas formas*.
4. Se crea el ícono de Sonora en el escritorio y en el menú Inicio.
5. La primera vez, permite el acceso en el Firewall para **redes privadas**, o el celular no podrá conectarse.

Si al crear el instalador aparece un error con «symbolic link» o «privilegio», activa el **Modo de desarrollador** de Windows (Configuración → Sistema → Para programadores) o ejecuta `crear-instalador.bat` como administrador.

Este instalador **no se actualiza solo**: para cada cambio habría que crear e instalar otro. Si quieres que las versiones nuevas lleguen solas, usa la sección siguiente.

### Actualizaciones automáticas (instalas una vez, después se actualiza sola)

Funciona con GitHub (gratis): cada vez que cambian los archivos de la app, GitHub crea el instalador de la versión nueva y lo publica en la página **Releases**. La Sonora instalada busca versiones nuevas al abrirse y cada 6 horas, las descarga en segundo plano y te pregunta si reiniciar. Tus canciones no se tocan. También puedes pulsar *Buscar actualizaciones…* en el menú del ícono de Sonora.

**Configuración (una sola vez)**

1. Crea una cuenta en <https://github.com> e instala **GitHub Desktop** (<https://desktop.github.com>); inicia sesión en él.
2. En GitHub Desktop: *File → Add local repository…* y elige la carpeta de Sonora (por ejemplo `C:\Sonora`). Si dice que no es un repositorio, pulsa **create a repository**, ponle el nombre `sonora` y créalo.
3. Pulsa **Publish repository**. **Desmarca «Keep this code private»**: el repositorio debe ser **público** para que la app pueda leer las versiones. Tu música no se sube (la carpeta `data` está excluida); no guardes contraseñas en estos archivos.
4. En la página del repositorio en github.com abre la pestaña **Actions**. Si pide habilitar los workflows, acéptalo. «Publicar versión» empieza sola y tarda unos 5-10 minutos.
5. Cuando termine, entra a **Releases** (columna derecha del repositorio) y descarga `Sonora-Instalador-1.0.N.exe`. **Instala ese** (no el de `crear-instalador.bat`). Windows puede avisar «Windows protegió su PC»: *Más información → Ejecutar de todas formas*.

**Cada vez que haya cambios**

1. Copia los archivos nuevos sobre la carpeta de Sonora (o pídele a quien los haga que los suba directamente).
2. En GitHub Desktop aparecen los cambios: escribe un título corto, pulsa **Commit to main** y luego **Push origin**.
3. En 5-10 minutos aparece la versión nueva en Releases y las apps instaladas se actualizan solas.

**App de Android:** también se actualiza sola, sin reinstalar. Al abrirse con conexión baja la pantalla más reciente de tu servidor (`/ui-bundle.json`); sin conexión usa la última que bajó, y si nunca bajó ninguna, la copia que trae el APK. Cadena completa: subes el cambio a GitHub → se publica en el servidor (instalador de Windows, o *Manual Deploy* en Render) → el celular lo recibe al abrir la app. Solo los cambios propios de Android (ícono, permisos, nombre de la app) necesitan un APK nuevo, que el workflow «Compilar APK» genera solo.

**Límites:** el instalador no está firmado (por eso el aviso de Windows). Cada cambio crea una versión nueva (1.0.1, 1.0.2…). La detección y descarga de versiones se probaron con un servidor de pruebas; el reinicio e instalación en Windows y la publicación en GitHub no pude probarlos desde mi entorno.

**Tus canciones:** la app de escritorio las guarda en `%APPDATA%\Sonora\data`. Es una biblioteca distinta de la carpeta `data` que usa `iniciar.bat`. Elige una de las dos formas de usar Sonora y quédate con ella.

## Sonora en la nube (funciona con la PC apagada y en cualquier Wi-Fi)

Si la música vive en tu PC, solo suena cuando la PC está encendida y el celular está en la misma red. Para escucharla siempre, en cualquier Wi-Fi o con datos, pon Sonora en un servidor que esté siempre encendido. El proyecto ya viene preparado para **Render** (`render.yaml`).

1. Sube estos archivos a tu repositorio de GitHub (GitHub Desktop → *Commit to main* → *Push origin*).
2. En <https://render.com> inicia sesión → **New + → Blueprint** → pega la dirección de tu repositorio (por ejemplo `https://github.com/tu-usuario/sonora`) → **Connect**.
3. Render lee `render.yaml` y te pide la **contraseña** (`SONORA_PASSWORD`). Escribe una que no uses en otro sitio. Pulsa **Apply**.
4. Espera unos minutos. Al terminar, Render te da una dirección como `https://sonora-abcd.onrender.com`.
5. Ábrela en el navegador, inicia sesión con tu contraseña y sube música.

**Celular:** en la app, escribe esa dirección (con `https://`) y toca Conectar. Se queda guardada y funciona en cualquier red. Pedirá la contraseña una vez.

**PC:** abre la misma dirección en Chrome/Edge/Brave y elige *Instalar Sonora* en el menú del navegador: queda como app con su ícono. O, con el instalador de escritorio, usa el menú de Sonora → **Servidor en la nube…** y pega la dirección (para volver al modo anterior, «Usar esta PC»).

Notas:
- Los discos permanentes de Render requieren un plan de pago; revisa el precio actual en <https://render.com/pricing> antes de confirmar. La música se guarda en el disco (`/data`) y no se pierde al actualizar.
- La contraseña es obligatoria en la nube (el servidor no arranca sin ella).
- Si conectaste el repositorio por su dirección pública, los cambios futuros se publican con **Manual Deploy** en Render; conectando tu cuenta de GitHub a Render se publican solos.
- Para escuchar canciones que **no** guardaste en el celular hace falta internet (Wi-Fi o datos). Las guardadas suenan sin conexión (ver «Escuchar sin conexión»).
- No probado en un Render real: lo verifiqué con el servidor detrás de un proxy https simulado.

## App de Android (APK)

La carpeta `android-app/` es una app nativa de Android: ícono propio, pantalla de carga y pantalla completa, sin barra del navegador. Se conecta a tu servidor Sonora, así que celular y PC comparten la misma biblioteca, y puede **guardar canciones en el celular** para oírlas sin conexión (ver más abajo).

La primera vez que la abres te pide la dirección de tu servidor (la que muestra Sonora en la PC, por ejemplo `192.168.1.25:3000`) y la recuerda. Se cambia después desde *Subir música → Cambiar servidor*.

### Opción A: compilar con Android Studio (en tu PC)

1. Instala **Android Studio** (gratis, <https://developer.android.com/studio>) y ábrelo una vez para que descargue sus componentes.
2. Haz doble clic en `android-app/preparar-apk.bat` (Mac/Linux: `./preparar-apk.sh`).
3. En Android Studio: **File → Open** y elige la carpeta `android-app/android`. Espera a que termine de cargar (la primera vez descarga cosas y tarda unos minutos).
4. Menú **Build → Build Bundle(s) / APK(s) → Build APK(s)**. Al terminar pulsa **locate**: ahí está `app-debug.apk`.
5. Pasa ese archivo al celular (cable, Drive, WhatsApp…) y ábrelo. Android pedirá permitir *instalar apps de esta fuente*.

### Opción B: compilar en la nube, sin instalar nada

1. Sube esta carpeta completa a un repositorio de GitHub (privado sirve).
2. En GitHub: pestaña **Actions → Compilar APK → Run workflow**.
3. A los 5-8 minutos, entra a la ejecución y descarga **sonora-apk** (contiene `app-debug.apk`).

### Si la app no conecta

- El celular debe estar en el **mismo Wi-Fi** que la PC (o conectado por Tailscale) y Sonora debe estar encendida.
- Escribe la dirección completa con el puerto, por ejemplo `192.168.1.25:3000`.
- En Windows, permite Sonora en el Firewall para **redes privadas**.

### Qué no está probado

El proyecto se generó y verificó, pero **no pude compilar el APK ni probarlo en un celular físico** en el entorno donde lo preparé. La primera compilación puede pedirte aceptar licencias o descargar el SDK de Android que Android Studio indique. El audio con la pantalla apagada debería seguir sonando, pero conviene comprobarlo en tu equipo. Si algo falla, copia el mensaje de error y se corrige.

## Escuchar sin conexión (con la PC o el servidor apagado)

La app del celular lleva la pantalla de Sonora dentro, así que abre aunque no haya servidor. Para que además suene la música, guárdala en el celular:

- **Una canción:** toca los tres puntos de la canción → **Guardar en el celular**. Aparece un ✓ junto a las guardadas.
- **Toda la biblioteca:** *Subir música* → sección **Sin conexión** → **Guardar toda la biblioteca**.
- **Automático:** en esa misma sección, **Guardar las nuevas solas: Sí**. Al abrir la app guarda las canciones que falten (no usa datos móviles si Android informa que la conexión es móvil).
- **Quitar:** **Quitar del celular** en el menú de la canción, o **Borrar las guardadas** para todas. Tu biblioteca del servidor no se toca.

Si abres la app sin conexión con el servidor, muestra un aviso y **solo las canciones guardadas**, con sus carátulas. Las canciones y listas se actualizan cuando vuelves a conectar. Subir música o editar necesita conexión.

**Cómo se actualiza la pantalla:** al abrir la app con conexión baja la pantalla más nueva del servidor (`app/start.html` es el cargador). Para volver a la copia del APK, abre `app/start.html?copia=1`. La pantalla viene del servidor que elegiste: úsalo solo con servidores tuyos y, si es posible, con `https://`.

Se necesita un **APK nuevo** (instálalo encima del anterior) y, para guardar, abrir la app con conexión al menos una vez.

Probado con el servidor y una pantalla en orígenes distintos, apagando el servidor y recargando; no probado en un celular real ni con audio M4A/AAC.

## Escuchar tu música fuera de casa

Mientras el servidor esté encendido, puedes acceder desde cualquier lugar. Opciones, de más fácil a más completa:

1. **Tailscale (gratis, recomendado):** instálalo en la PC del servidor y en tu celular, e inicia sesión en ambos. Accedes con la dirección Tailscale de tu PC (por ejemplo `http://mi-pc:3000`), de forma privada y sin abrir puertos. Con `tailscale serve` obtienes además HTTPS.
2. **Cloudflare Tunnel:** te da una dirección `https://` pública hacia tu PC. **Activa la contraseña** (abajo) si lo usas.
3. **Servidor propio 24/7:** súbelo a un VPS barato o una Raspberry Pi y ponle HTTPS con Caddy o Nginx. Tu música queda siempre disponible sin dejar la PC encendida. Hay un `Dockerfile` incluido.

## Proteger con contraseña

Si la app va a ser accesible fuera de tu casa, define una contraseña:

```bash
# Windows (PowerShell)
$env:SONORA_PASSWORD="mi-clave-segura"; npm start

# Mac / Linux
SONORA_PASSWORD="mi-clave-segura" npm start
```

En `iniciar.bat` / `iniciar.sh` hay una línea lista para editar. Los dispositivos recuerdan la sesión (cierra sesión con el icono de la barra lateral).

## Configuración

Se controla con variables de entorno:

| Variable | Qué hace | Por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `HOST` | Dirección de escucha (`127.0.0.1` = solo esta PC) | `0.0.0.0` |
| `SONORA_PASSWORD` | Contraseña de acceso (vacío = sin contraseña) | vacío |
| `SONORA_DATA` | Carpeta donde se guarda todo | `./data` |
| `SONORA_MAX_MB` | Tamaño máximo por archivo (MB) | `300` |
| `SONORA_TRUST_PROXY` | Pon `1` si usas un proxy inverso con HTTPS | vacío |

## Dónde se guardan tus datos

Todo está en la carpeta `data/`:

- `data/music/` → tus canciones
- `data/covers/` → carátulas
- `data/library.json` → favoritas, listas y datos de cada canción

**Para hacer una copia de seguridad, copia esa carpeta.** Para mover Sonora a otra computadora, copia la app y la carpeta `data/`.

## Estructura del proyecto

```
sonora/
├─ server.js          Servidor (API, subida, streaming, contraseña)
├─ public/
│  ├─ index.html      Estructura de la app
│  ├─ styles.css      Diseño
│  ├─ app.js          Lógica: reproductor, biblioteca, subida
│  ├─ sw.js           Service worker (instalación y carga rápida)
│  └─ manifest.webmanifest, icons/
├─ electron/          App de escritorio (Windows) + abrir-app.bat / crear-instalador.bat
├─ android-app/       App de Android (APK) + preparar-apk.bat / .sh
├─ .github/workflows/ Compilar el APK y publicar versiones de Windows en la nube
├─ iniciar.bat / iniciar.sh   Arranque con un clic
├─ Dockerfile
└─ data/              (se crea sola) tu música
```

## Limitaciones a tener en cuenta

- Hay **app de Android (APK)**, **app de escritorio para Windows** y versión web instalable. No hay app para iPhone (ahí se usa la versión web desde Safari). Para publicar en Play Store habría que firmarla y subirla aparte.
- La app de escritorio y el instalador de Windows **no están firmados**, por eso Windows muestra un aviso la primera vez. La app se verificó funcionando en un entorno de pruebas (servidor, ventana, reproducción, segunda instancia y cierre a la bandeja), pero no pude generar ni probar el instalador `.exe` en Windows.
- Para escuchar sin servidor hay que **guardar antes** las canciones en el celular (ver «Escuchar sin conexión»). Lo guardado ocupa espacio del celular.
- En iPhone, la reproducción en segundo plano funciona, pero iOS puede pausarla si la app lleva mucho tiempo inactiva.
- La biblioteca se guarda en un archivo JSON: ideal para colecciones personales (miles de canciones), no pensada para millones.
- No incluye cuentas de varios usuarios: es una biblioteca personal compartida entre tus dispositivos.
