# Changelog / Novedades

##  v0.5
- Rol principal y secundario antes de buscar (Normal, Solo/Dúo, Flex): se aplican a la sala al iniciar la búsqueda.
- El selector de modo ya no se reinicia al tocar el autoaceptar o el pick preparado.
- Pedir cambios a un compañero: orden de pick, rol y campeón (ARAM: solo campeón). Si el juego no ofrece el cambio, no aparece el botón.
- Botón **Dodgear**: cierra el cliente de LoL (con confirmación; el juego puede penalizarte).
- Runas recomendadas: se piden las 3 al juego y "usar" aplica sobre la página temporal del cliente.
- Un solo build para todos los servidores: la app habla con el cliente local, así que detecta tu región sola.

##  v0.5.1
- ARAM / Mayhem: se muestran las 2 opciones iniciales para elegir con un toque.
- Pedidos de cambio de campeón en ARAM (el cliente los llama "trades"): se reciben y se pueden pedir.
- Pedir cambios: botones arriba (orden / rol / campeón) y después tocás al compañero. Se muestra el estado (esperando / rechazado).
- Dodge en rojo.
- Runas: se descartan las runas viejas que el cliente todavía lista y que el juego rechaza.
- Ver SECURITY.md.

##  v0.6
- Personalizar (ajustes): color, tipografía, fondo propio, sonido propio de partida encontrada y orden de los paneles. Se guarda solo en el celular y no trae arte de Riot.
- Cambio de campeón en ARAM: si el cliente responde 404 en una ruta, se prueban las alternativas.
- Diagnóstico: ahora incluye qué rutas de cambio existen y los detalles de las runas recomendadas.

##  v0.6.1
- Cambio de campeón en ARAM: ya usa la ruta correcta (confirmada en tu diagnóstico).
- Runas: el editor ya no se demora (antes esperaba al buscar recomendadas) y las recomendadas se leen aunque el cliente las devuelva con otro formato.
- Personalización: se puede subir tu propia tipografía.
- Chat de champ select: los demás jugadores se muestran como "Aliado N" (política de Riot).
- Ver SECURITY.md.

##  v0.7
- Runas: podés editar tus páginas armadas y elegir en cuál guardar. Se comprueba que el cliente realmente la guardó y, si no, avisa.
- Personalización: rueda de color para elegir cualquier color.
- Chat de champ select: los nombres se ven como en el cliente; solo en ranked se numeran "Aliado N" (el cliente los oculta ahí).
- SECURITY.md ahora está en inglés y español.

##  v0.7.1
- Runas: se puede crear una página nueva con nombre propio (si tenés lugar libre) o sobrescribir una existente.
- ARAM / Mayhem: ya no aparece el botón de elegir campeón; quedan las 2 opciones iniciales y el banco.

##  v0.7.2
- El registro de la app (open-queue.log) ahora se guarda en la carpeta temporal de Windows, no en la carpeta del programa.

##  v0.7.4
- **Modo streamer / Streamer mode** (ventana de la PC): oculta la IP, el QR, el código y la ruta del diagnóstico para grabar o transmitir. Tocás uno para verlo 4 segundos. Se recuerda al reabrir.
- **Pantalla completa** en el celular (ajustes): oculta la barra del navegador y con ella la IP de la dirección.
