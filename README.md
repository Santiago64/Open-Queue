# Open Queue

Controlá League of Legends desde tu celu: **aceptar la partida (manual o automático)**, buscar partida, y un mini champ select con picks, bans, hechizos, runas y el chat de la sala. Gratis y de código abierto.

Control League of Legends from your phone: **accept the match (manual or automatic)**, queue up, and a mini champ select with picks, bans, summoner spells, runes and lobby chat. Free and open source.

## Cómo usarlo (Windows)

1. Instalá [Node.js LTS](https://nodejs.org) (una sola vez).
2. Doble clic en **`Abrir Open Queue.vbs`**. La primera vez instala lo necesario en una ventana negra que se cierra sola (necesita internet, tarda un minuto). Después abre solo la ventana de Open Queue, **sin dejar ninguna consola abierta**.
   - Si algo falla, usá **`Iniciar Open Queue.bat`**, que muestra la consola con los mensajes. También queda un registro en `open-queue.log`.
3. Si Windows pregunta por el firewall, permití el acceso en **redes privadas**.
4. Abrí el cliente de LoL.
5. En el celu (mismo wifi que la PC): escaneá el QR de la ventana con la cámara, o abrí la dirección que aparece y escribí el código de 6 dígitos.
6. Activá **Autoaceptar** y elegí el retraso (de instantáneo a lo más tarde posible, 8 s).

El autoaceptar corre en la PC: funciona aunque el celu esté desconectado. Cerrar la ventana de Open Queue cierra la app.

## Qué incluye

- Vinculación por QR o código de 6 dígitos. El celu queda recordado hasta que generes un código nuevo.
- Aceptar / rechazar la partida desde el celu y **autoaceptar con retraso configurable (0 a 8 s)**.
- Buscar partida con los modos vigentes: Normal Draft, Normal a ciegas, Clasificatoria Solo/Dúo y Flex, ARAM, ARAM Mayhem, Swiftplay y TFT. Sin Clash, URF, tutoriales ni partidas contra bots.
- Mini champ select: tu equipo, el rival, temporizador, orden de pick, baneos.
- Pickear y banear con dos toques (elegir + confirmar), con buscador y filtro por clase. En un ban solo se apagan los ya baneados y nunca arranca con un campeón marcado.
- **Pedidos de cambio** de orden de pick, de rol o de campeón: aparecen en el celu con aviso y botones Aceptar / Rechazar.
- **ARAM**: banco de campeones disponibles (tocás uno para cambiarlo por el tuyo) y rerolls.
- **Skins**: elegís entre las que tenés.
- **Runas**: tus páginas guardadas, las **recomendadas por el juego** para tu campeón y línea, y un **editor** para armar las tuyas. Se guardan en una página llamada "Open Queue" (no pisa tus otras páginas).
- Pick preparado antes de buscar partida: se marca solo cuando terminan los baneos (nunca durante ellos, para que no se banee solo).
- Hechizos de invocador y chat de la sala.
- Avisos con sonido y vibración: partida encontrada, tu turno y pedidos de cambio.
- Español e inglés.

## Aún no incluido

- **Swiftplay**: en la sala podés armar los 2 slots (rol, campeón, hechizos, runas y skin) desde el celu. El comando para escribirlos al cliente se dedujo del diagnóstico; si no responde, mandá un diagnóstico nuevo.
- Personalización (temas, fondos propios, sonidos propios, fuentes): pensada como función futura.
- Filtro por **línea** (top/jungla/mid…): hoy filtra por clase de campeón.
- Reordenar paneles.

## Diagnóstico (para sumar modos nuevos)

En la ventana de la PC hay una tarjeta **Diagnóstico**. Para ayudar a soportar un modo nuevo, por ejemplo Swiftplay:

1. Tocá **Grabar diagnóstico**.
2. En el juego, entrá a la sala del modo y hacé lo que querés automatizar (elegir roles, campeones, runas, skins) y buscá partida.
3. Tocá **Detener y guardar** y compartí el archivo `diagnostico-….json` que aparece indicado en la tarjeta.

El archivo no incluye contraseñas ni datos de tu cuenta.

## Limitaciones conocidas

- Con la pantalla del celu apagada, el navegador puede pausar la página y no sonar. Probá "Mantener activo en segundo plano" en Ajustes (experimental) o dejá la pantalla encendida.
- Solo funciona dentro de la misma red local (sin servidor en internet).
- Los íconos de campeones vienen del CDN oficial de Riot (Data Dragon): hace falta internet en el celu. Los de runas y skins los sirve tu propio cliente de LoL.
- Las runas recomendadas, el editor, los cambios de pick, el banco de ARAM y las skins se programaron según la API del cliente y se probaron con un cliente simulado. Si alguna no responde igual en el juego real, usá el Diagnóstico y se ajusta.

## Desarrollo

```
npm install
npm start        # ventana de escritorio (Electron)
npm run server   # solo el servidor, sin ventana
npm test         # pruebas de punta a punta con un cliente de LoL simulado (node test/e2e.js y test/e2e2.js)
```

El servidor escucha en el puerto 4747 (o el siguiente libre). Los ajustes se guardan en la carpeta de datos del usuario.

## Privacidad y seguridad

- Open Queue solo habla con el cliente de LoL en `127.0.0.1` y con tu celu en tu red local. No envía datos a ningún servidor.
- Los comandos del celu requieren el código o el token de vinculación. Hay límite de intentos.
- La pantalla de escritorio y el QR solo se pueden abrir desde la propia PC.

## Aviso legal

Open Queue isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

Antes de publicar o cobrar por funciones, registrá el producto en el [Riot Developer Portal](https://developer.riotgames.com) y leé sus políticas.

## Licencia

MIT. Ver `LICENSE`.

## Novedades v0.5
- Rol principal y secundario antes de buscar (Normal, Solo/Dúo, Flex): se aplican a la sala al iniciar la búsqueda.
- El selector de modo ya no se reinicia al tocar el autoaceptar o el pick preparado.
- Pedir cambios a un compañero: orden de pick, rol y campeón (ARAM: solo campeón). Si el juego no ofrece el cambio, no aparece el botón.
- Botón **Dodgear**: cierra el cliente de LoL (con confirmación; el juego puede penalizarte).
- Runas recomendadas: se piden las 3 al juego y "usar" aplica sobre la página temporal del cliente.
- Un solo build para todos los servidores: la app habla con el cliente local, así que detecta tu región sola.

## Novedades v0.5.1
- ARAM / Mayhem: se muestran las 2 opciones iniciales para elegir con un toque.
- Pedidos de cambio de campeón en ARAM (el cliente los llama "trades"): se reciben y se pueden pedir.
- Pedir cambios: botones arriba (orden / rol / campeón) y después tocás al compañero. Se muestra el estado (esperando / rechazado).
- Dodge en rojo.
- Runas: se descartan las runas viejas que el cliente todavía lista y que el juego rechaza.
- Ver SECURITY.md.

## Novedades v0.6
- Personalizar (ajustes): color, tipografía, fondo propio, sonido propio de partida encontrada y orden de los paneles. Se guarda solo en el celular y no trae arte de Riot.
- Cambio de campeón en ARAM: si el cliente responde 404 en una ruta, se prueban las alternativas.
- Diagnóstico: ahora incluye qué rutas de cambio existen y los detalles de las runas recomendadas.

## Novedades v0.6.1
- Cambio de campeón en ARAM: ya usa la ruta correcta (confirmada en tu diagnóstico).
- Runas: el editor ya no se demora (antes esperaba al buscar recomendadas) y las recomendadas se leen aunque el cliente las devuelva con otro formato.
- Personalización: se puede subir tu propia tipografía.
- Chat de champ select: los demás jugadores se muestran como "Aliado N" (política de Riot).
- Ver SECURITY.md y RIOT-REGISTRO.md.

## Novedades v0.7
- Runas: podés editar tus páginas armadas y elegir en cuál guardar. Se comprueba que el cliente realmente la guardó y, si no, avisa.
- Personalización: rueda de color para elegir cualquier color.
- Chat de champ select: los nombres se ven como en el cliente; solo en ranked se numeran "Aliado N" (el cliente los oculta ahí).
- SECURITY.md ahora está en inglés y español.

## Novedades v0.7.1
- Runas: se puede crear una página nueva con nombre propio (si tenés lugar libre) o sobrescribir una existente.
- ARAM / Mayhem: ya no aparece el botón de elegir campeón; quedan las 2 opciones iniciales y el banco.
