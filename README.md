# Roña

Juego de cartas multijugador en línea: ponte cuatro órganos sanos antes que los demás mientras
les pegas la roña. De 2 a 6 jugadores, con salas, chat, bots y reconexión.

```
shared/        motor del juego (JS puro, sin dependencias): reglas, partida, bots. Lo usan el servidor y el cliente
virus-back/    servidor Express + Socket.IO: sesiones, salas, timers de turno y bots
virus-front/   cliente React 18 + Vite 5 + framer-motion + zustand
e2e/           pruebas de punta a punta (Playwright) y de resistencia (por socket)
docs/          RULES.md (reglas exactas) y PROTOCOL.md (API del motor y protocolo Socket.IO)
```

Requisitos: Node 20 o más nuevo (probado con Node 22).

## Instalar

Cada carpeta tiene su propio `package.json`:

```bash
cd virus-back  && npm install
cd ../virus-front && npm install
cd ../e2e && npm install && npx playwright install chromium   # sólo para las pruebas e2e
```

`shared/` no tiene dependencias.

## Correr en desarrollo

En dos terminales:

```bash
# 1. Servidor en http://localhost:3001
cd virus-back
npm run dev            # node --watch; o `npm start` sin recarga automática

# 2. Cliente en http://localhost:5173
cd virus-front
npm run dev
```

Abre http://localhost:5173 en dos navegadores (o una ventana normal y una de incógnito) para jugar
contra ti mismo, o agrega bots desde la sala. En desarrollo el cliente busca el servidor en
`http://<host>:3001`; compilado (producción) usa el mismo origen de la página. Para otra URL, define `VITE_SERVER_URL`. Como vite escucha en todas las interfaces, desde otro equipo
de la red local basta con abrir `http://<ip-de-tu-pc>:5173`.

### Variables del servidor

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `PORT` | `3001` | puerto HTTP / Socket.IO |
| `CLIENT_ORIGIN` | cualquiera | orígenes permitidos por CORS, separados por comas |
| `TURN_MS` | `40000` | duración de un turno |
| `DISCONNECTED_TURN_MS` | `8000` | turno de un jugador desconectado |
| `RECONNECT_TURN_MS` | `15000` | margen mínimo al volver en tu propio turno (una vez por turno, máx. 3 por partida) |
| `GRACE_MS` | `60000` | cuánto se guarda el asiento de un desconectado |
| `BOT_MIN_MS` / `BOT_MAX_MS` | `1800` / `3200` | lo que "piensa" un bot |
| `LOG` | `1` | `LOG=0` apaga los logs |
| `MAX_CONNECTIONS_PER_IP` | `20` | sockets abiertos a la vez por IP (`0` = sin tope) |
| `SESSIONS_PER_IP_PER_MIN` | `20` | sesiones nuevas por minuto por IP (`0` = sin tope) |
| `MAX_ROOMS_PER_IP` | `8` | salas abiertas creadas desde una IP (`0` = sin tope) |
| `TRUST_PROXY` | apagado | número de proxies propios delante (`1` con el nginx de Docker): toma la IP de `X-Forwarded-For`, la N-ésima desde la derecha. Sólo detrás de un proxy propio; sin él, todos cuentan como la IP del proxy |

Los topes por IP suponen que no hay muchos jugadores detrás de la misma IP (una escuela, una red con NAT);
en ese caso súbelos. Ver `docs/PROTOCOL.md` ("Límites contra abusos").

### Modos de demostración del cliente (sólo en desarrollo, sin servidor)

- Lobby: `?demo=lobby`, `?demo=room`, `?demo=room-guest`, `?demo=offline`
- Mesa: `?demo=game` (4 jugadores), `?demo=game2` … `?demo=game6`; añade `&pause` para congelar a los bots y
  `&longnames` para probar nombres largos.
  En la consola, `window.__ronaDemo.run('destroy' | 'contagion' | 'glove' | 'win' | …)` dispara cada animación.

## Producción

```bash
cd virus-front && npm run build      # genera virus-front/dist (estático)
cd ../virus-back && npm start        # PORT=3001
```

Sirve `virus-front/dist` con cualquier servidor estático que además reenvíe `/socket.io/` (con upgrade
de websockets) al servidor: el cliente compilado se conecta al mismo origen. Si el servidor vive en otro
dominio, compila el cliente con `VITE_SERVER_URL=https://tu-servidor npm run build`, y en el servidor
define `CLIENT_ORIGIN` con el dominio del cliente. La forma armada de todo esto está en la sección siguiente.

## Despliegue con Docker + Cloudflare Tunnel

```
docker-compose.yml        rona-server + rona-web + cloudflared en la red `rona`
virus-back/Dockerfile     node:22-alpine, sólo dependencias de producción, usuario `node`, HEALTHCHECK a /health
virus-front/Dockerfile    build con vite (node:22-alpine) → nginx:alpine
virus-front/nginx/default.conf   estáticos, fallback SPA, gzip, caché de /assets/, proxy de /socket.io/ y /health
.env.example              TUNNEL_TOKEN y variables del servidor (copiar a .env, que no se versiona)
```

Los dos Dockerfile se construyen con la **raíz del repo** como contexto (el servidor importa `../../shared`
y vite resuelve `@shared` → `../shared`); `docker compose` ya lo hace así.

Cómo fluye una petición: Cloudflare → `cloudflared` (túnel saliente, no abre puertos) → `http://rona-web:80`
(nginx) → `/socket.io/` y `/health` van a `rona-server:3001`; lo demás es el cliente estático. Ningún servicio
publica puertos salvo `rona-web` en `127.0.0.1:8090`, sólo para probar desde el propio host.

**IP real de cada jugador.** Cloudflare la manda en `CF-Connecting-IP`; nginx la copia a `X-Real-IP` y
**reemplaza** `X-Forwarded-For` con ella (así un cliente no puede colar otra), y el servidor, con
`TRUST_PROXY=1`, la usa para los topes por IP. Sin `TRUST_PROXY=1` todos los jugadores contarían como la IP del
contenedor nginx y el tope de 20 conexiones se agotaría con 20 jugadores en total.

### Primera vez en el servidor

1. En Cloudflare Zero Trust → Networks → Tunnels, crea un túnel (tipo *Cloudflared*), copia el token (la cadena
   tras `--token`) y en *Public Hostname* agrega tu dominio con servicio `HTTP` y URL `rona-web:80`.
   En la zona, deja activado WebSockets (Network → WebSockets; viene activado por defecto).
2. En el servidor:

   ```bash
   git clone -b remake <repo> /home/server1/rona && cd /home/server1/rona
   cp .env.example .env && nano .env          # pega TUNNEL_TOKEN; TRUST_PROXY=1 se queda
   docker compose up -d --build
   docker compose ps                           # los tres en (healthy)
   curl -s http://127.0.0.1:8090/health        # {"ok":true}
   ```

Si Docker viene de snap, el proyecto debe vivir dentro de `/home` (snap no ve otras rutas al construir).
`cloudflared` se queda en `(health: starting)` hasta que el túnel conecta; su healthcheck usa
`cloudflared tunnel ready` contra las métricas en el puerto 2000 interno.

### Actualizar, logs y pruebas

```bash
git pull && docker compose up -d --build      # reconstruye y recrea sólo lo que cambió
docker compose logs -f rona-server rona-web    # nginx registra la IP real del jugador
docker compose down                            # para todo (no hay datos persistentes: salas y sesiones viven en memoria)
```

Reiniciar `rona-server` corta las partidas en curso (el estado vive en memoria); los clientes se reconectan
solos pero vuelven al inicio.

Sin token (en tu PC), levanta sólo el juego y pruébalo contra nginx:

```bash
SESSIONS_PER_IP_PER_MIN=0 MAX_ROOMS_PER_IP=0 BOT_MIN_MS=50 BOT_MAX_MS=150   docker compose up -d --build rona-server rona-web
SOAK_URL=http://127.0.0.1:8090 GAMES=3 node e2e/soak.mjs
node e2e/shot.mjs http://127.0.0.1:8090 e2e/shots/docker.png 1600 900 3000
docker compose down
```

(Las variables de la primera línea quitan los topes por IP y aceleran los bots sólo para esa prueba, porque el
soak abre todas sus sesiones desde la misma IP; en el servidor salen de `.env`.)

## Pruebas

```bash
cd shared      && npm test     # motor: 85 tests (reglas, tratamientos, fuzz de 300 partidas)
cd virus-back  && npm test     # servidor: 28 tests de integración por Socket.IO (puertos aleatorios), incl. endurecimiento
cd virus-front && npm test && npm run lint && npm run build   # 4 tests del acomodo de la mesa
```

### Resistencia por socket (sin navegador)

```bash
cd e2e
npm run soak                                        # levanta su propio servidor rápido en un puerto libre
SOAK_URL=http://localhost:3001 GAMES=3 npm run soak # o contra un servidor ya corriendo (ver abajo)
```

Juega 20 partidas (`GAMES`) de 2 humanos-script + 1 a 4 bots, con reconexiones y abandonos a media
partida y acciones ilegales a propósito. En cada `game:state` comprueba que haya 68 cartas en total
(visibles + ocultas), que `handCount` coincida con la mano, que el turno avance y nunca sea de alguien
que salió, y que el `seq` de los lotes sea consecutivo. Falla si una partida se atora o no termina.

Todas las sesiones del soak salen de la misma IP: su servidor propio arranca sin topes por IP, y si lo
corres contra uno ya levantado, arráncalo con `SESSIONS_PER_IP_PER_MIN=0 MAX_ROOMS_PER_IP=0`.

### Punta a punta con Playwright

Con el servidor y vite corriendo (los bots rápidos acortan la prueba):

```bash
cd virus-back  && BOT_MIN_MS=350 BOT_MAX_MS=650 npm start
cd virus-front && npm run dev
cd e2e         && npm run play          # HEADED=1 para ver los navegadores
```

Dos jugadores en contextos de navegador aislados: el anfitrión crea la sala, el otro se une, se
mandan un mensaje por el chat, el anfitrión agrega 2 bots y empieza. Los dos humanos juegan haciendo
clic en la mesa (eligen una carta, hacen clic en un destino resaltado o descartan) hasta que hay
ganador o pasan `MAX_TURNS` (120) turnos. A media partida el invitado recarga la página y debe
volver a su asiento; al final se pide la revancha y se abre la misma sesión en otra pestaña.
Falla si aparece cualquier error en la consola o una excepción en la página.
Las capturas quedan en `e2e/shots/e2e-*.png` (la carpeta no se sube al repo).

### Otras pruebas y capturas

- `node e2e/front-check.mjs` (con vite corriendo; `E2E_URL`, por defecto `http://localhost:5174`): 45
  comprobaciones visuales y de accesibilidad de la mesa (nombres que caben, celular en horizontal, aviso de
  girar el teléfono, contraste, teclado, silencio compartido lobby/mesa…). Casi todo usa el modo demo; la prueba
  del silencio necesita el servidor. Capturas en `e2e/shots/fix-*.png`.
- `node e2e/final-shots.mjs` (servidor recién arrancado con `BOT_MIN_MS=350 BOT_MAX_MS=650` y vite en el 5173):
  el set de capturas `e2e/shots/final-*.png` (home, lobby, sala con chat, mesa al inicio y a media partida, carta
  seleccionada con sus destinos, victoria). Dos humanos con una heurística sencilla contra 2 bots fáciles; repite
  con revancha hasta tener todas.
- `node e2e/shot.mjs <url> <png> [ancho] [alto] [esperaMs]` saca una captura suelta.
