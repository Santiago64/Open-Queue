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

##  v0.7.5
- **Cambiar el modo con amigos en la sala**: el modo se cambia en la misma sala (nunca se sale ni se crea otra). Si el juego no lo permite, avisa y la sala queda igual; si no sos líder, también avisa. Al elegir otro modo en la lista estando en la sala, se cambia en el momento (sin buscar).
- **Ban preparado**: elegís un campeón y se banea solo cuando llega tu turno de ban.
- **Chat de la sala** (antes del champ select): se ven los mensajes que escribís y los de tus amigos.
- Menos parpadeo de los campeones (sobre todo en Brave): la pantalla ya no se redibuja si no cambió nada y las imágenes no se cargan "perezosas".
- Runas recomendadas: si no hay lugar y tenés que reemplazar una página, ya no sale el mensaje de error de más. Se guarda el detalle en el diagnóstico si falla aplicarlas.

##  v0.7.6
- **Chat de la sala**: ahora se ve el nick de quien escribe (también si el cliente no informa el invocador del mensaje).
- **Aceptar invitaciones a sala**: interruptor nuevo (apagado por defecto). Apagado, te avisa y aparece la invitación con Aceptar / Rechazar; encendido, te une solo.
- **ARAM Mayhem**: se quita el botón de runas porque ese modo no las tiene.

##  v0.7.7
- **Chat**: se ve tu nick y el de los demás también en partidas personalizadas (el cliente identifica a quien escribe por otro dato; ahora se reconoce por varios).
- **ARAM Mayhem personalizada**: se ocultan las runas también en partidas personalizadas (cola 3270).

##  v0.7.8
- Se muestra la versión en Ajustes y se guarda en el diagnóstico, para saber rápido qué versión está corriendo.

##  v0.8.0
- **Emotes y ward**: tarjeta "Emotes y ward" (antes del champ select) y botón en el champ select. Armás la rueda de emotes tocando un lugar y eligiendo entre los emotes que tenés, y elegís el ward. Se verifica que el cambio quede aplicado.
- **Chat en ranked**: los nombres de la gente de tu grupo (party) se ven con su nick; solo se numeran como "Aliado N" los que no están en tu grupo.

##  v0.8.1
- **Invitar amigos a la sala**: botón "+ Invitar amigos" en la sala. Lista de tu gente conectada con su ícono, su estado (fuera de partida, en sala, en partida con el tiempo, móvil) y buscador; tocás y se envía la invitación.

##  v0.8.2
- **Invitar amigos**: el reloj de los que están en partida avanza segundo a segundo y la lista se actualiza sola cada 10 segundos (estados, quién entra o sale de partida).

##  v0.8.3
- **Crear sala sin buscar**: botón "Crear sala (sin buscar)" en la pantalla principal. Entrás a la sala del modo elegido sin empezar la búsqueda, para invitar amigos primero (ya no hay que buscar y cancelar).

##  v0.8.4
- **Chat en ranked**: en vez de "Aliado 1/2…" se muestra el apodo anónimo que ve el cliente (por ejemplo "Escarabajo Rocoso"), en el idioma del juego.
- **Chat**: junto al nombre aparece el ícono del campeón (si ya eligió o tiene intención de pick) y su línea, para saber enseguida quién habla.
- **Cancelar pedidos de cambio**: los pedidos enviados (orden de pick, rol o campeón) quedan visibles con un botón "Cancelar pedido", sin tener que volver a abrir el modo de cambio.
- Diagnóstico: se agrega `chatCells` para ver qué datos manda el cliente en ranked.

##  v0.8.5
- Emotes y wards: se quitó el botón repetido junto a las runas en el champ select; queda solo el de la tarjeta de pick/ban preparados.

##  v0.8.6
- Pick preparado: ya no muestra el aviso falso "baneado" al entrar al champ select. Solo avisa si el campeón figura de verdad en los baneos; si la lista del cliente aún está incompleta, reintenta.

##  v0.8.7
- Ícono propio de la app (ventana, barra de tareas, pestaña del navegador, pantalla de inicio del celu y README). Es provisorio y se puede cambiar reemplazando `public/icon.png` y `public/icon.ico`.

##  v0.8.8
- **Campeones baneados**: en el selector aparecen en blanco y negro con la marca "BAN" y no se pueden elegir (antes te dejaba tocarlo, se cerraba el menú y perdías tiempo). Si el juego rechaza el pick, el menú queda abierto para elegir otro.
- **Campeones favoritos (hasta 3)** en la pantalla principal, con **pick automático en el último segundo**: si el reloj llega a 0 y no elegiste, se confirma lo que tengas marcado o, si no, el mejor favorito disponible (no baneado ni tomado). Se activa con un interruptor.
- **Recomendar según mis partidas** (interruptor): lee tus últimas partidas de la Grieta y tu maestría para ordenar tus favoritos según la línea que te tocó y mostrar en el champ select tus mejores campeones para esa línea (con victorias y derrotas). Tocás uno y se marca.
- **Sonidos propios** en Ajustes > Personalizar para cada aviso: partida encontrada, tu turno, pedido de cambio, mensaje en el chat y pick automático (hasta 3 MB cada uno).
- **Fondo con GIF**: el fondo propio ahora acepta GIFs animados (hasta 8 MB). El fondo y los sonidos se guardan en el celu en IndexedDB; los que ya tenías se pasan solos.
- **Chat en ranked**: se busca el apodo anónimo del cliente (por ejemplo "Dagarraco Rocoso") también en los datos de cada jugador del champ select y en los participantes del chat, en vez de "Aliado N". Junto al nombre se ve solo el ícono del campeón y la línea (sin el nombre del campeón).


##  v0.8.9
- **Pick automático: cuándo se elige**. Nueva opción "En el segundo 0" (como antes) o "Apenas me toca" (se confirma al empezar tu turno).
- **Pick automático respeta tu pick preparado**: el orden es lo que tengas marcado, tu pick preparado y después tus favoritos. Antes, si el cliente no mostraba la marca a tiempo, podía elegir un favorito en su lugar.
- Partidas personalizadas: si el cliente manda vacía la lista de campeones disponibles, el pick automático ya no se queda sin elegir. Si el confirmado directo falla, prueba marcar y confirmar por separado.
- Herramienta de práctica (sin reloj): con "En el segundo 0" no se elige nada porque no hay 0; con "Apenas me toca" sí.
- Diagnóstico: guarda cada decisión del pick automático (`autoPick`) y los datos de apodos en ranked (`cellSummoners`).

##  v0.8.10
- **Runas automáticas con el pick automático** (interruptor nuevo, apagado por defecto): cuando el pick lo hace la app, se aplica la primera página de runas que recomienda el propio cliente de LoL para ese campeón y tu línea. No tiene en cuenta el enfrentamiento. Usa la página temporal del cliente (no gasta tus páginas). Te avisa si se pusieron o si tenés que elegirlas a mano.

##  v0.8.11
- **Runas automáticas con las páginas llenas**: en la prueba no se pusieron porque tenías tus 3 páginas ocupadas y el cliente no tenía página temporal. Ahora se le pide al cliente que cree su página temporal recomendada y se usa esa (no toca tus páginas).
- Si aun así no hay lugar, se puede elegir en la tarjeta de favoritos **qué página puede usar la app** ("Si no hay lugar, usar esta página"). Si no elegís ninguna, avisa que no se pusieron en vez de fallar callado.
- Diagnóstico: el pick automático guarda cada paso de las runas (`runesSteps`).

##  v0.8.12
- **Reglas del pick automático** (tarjeta de favoritos > "Reglas del pick automático" > Editar). Cada regla dice: "si el rival tiene alguno de estos campeones" (o vacío = contra cualquiera), "si yo juego tal línea" (opcional) y "elegí en este orden" hasta 5 opciones. Cada opción puede tener "saltear si tienen…" (por ejemplo, Malphite salvo que tengan a Kindred). Podés crear las reglas que quieras (hasta 30), ordenarlas, apagarlas o borrarlas.
- Orden del pick automático: lo que marcaste a mano, tus reglas (de arriba hacia abajo), tu pick preparado, tus favoritos y tus mejores según tus partidas.
- En el champ select se muestra qué elegiría el pick automático en ese momento y por qué regla ("Si no elegís: Malphite · Regla 1").
- Límite: solo se ven los rivales que el cliente ya muestra (en draft, los confirmados) y el cliente no dice en qué línea va cada rival.

##  v0.8.13
- **Reglas con más condiciones** (todas tienen que cumplirse): "mi equipo tiene a…" (sinergias; cuenta también lo que tus aliados tienen marcado), "cantidad en mi equipo / en el rival" de una clase (tanque, luchador, mago, asesino, tirador, soporte), cuerpo a cuerpo, a distancia, daño mágico o físico (≥, ≤ o =), y "mi turno de pick" (1º a 5º o último de tu equipo).
- **Reglas de bloqueo** ("No elegir"): por ejemplo, "si mi equipo tiene 2 o más magos, no elegir magos". Bloquean una clase o una lista de campeones para el pick automático, salvo que los hayas marcado vos.
- **Opción "Mi mejor de una clase"** dentro de una regla: por ejemplo, "si falta tanque, mi mejor tanque" (de tus favoritos, tus mejores según tus partidas y tu maestría).
- Datos de clases, distancia y tipo de daño: Data Dragon (datos públicos de Riot). Sin internet se usan las clases del cliente. El tipo de daño es aproximado.

##  v0.8.14
- **Hechizos por regla**: cada regla puede decir con qué hechizos de invocador ir. En jungla Aplastar va siempre (el juego no deja sacarlo), así que solo se elige el otro. Cada hechizo queda en la tecla donde ya lo tenías (por ejemplo, Destello en la F).
- **Runas por regla**: cada regla puede poner una de tus páginas o las recomendadas del cliente.
- **Hechizos recomendados** (interruptor nuevo): si la regla no dice nada, se ponen los que más usaste vos con ese campeón en esa línea en tus últimas partidas; si no hay datos, unos típicos de la línea.
- Arreglo: con "Poner runas recomendadas", la lista para elegir qué página usar se cerraba sola al segundo. Ahora la pantalla no se redibuja mientras la lista está abierta.
- README: vuelven los videos de demo y `npm test` falla si alguna vez se pierden.

##  v0.8.15
- **Set de runas por campeón**: desde la regla, en cada campeón, "Armar" abre el editor de runas para ese campeón. Lo armás una vez (desde cero o partiendo de una recomendada) y se usa en todas las reglas donde aparezca ese campeón.
- Cuando el pick automático elige ese campeón, la app escribe tu set en la página temporal del cliente. No ocupa ninguna de tus páginas, así que podés tener sets para todos los campeones que quieras.
- Si la regla dice "recomendadas" o una página tuya, eso gana sobre el set.
- Si el cliente no deja crear la página temporal, se usa la página de repuesto de Ajustes (si elegiste una) o te avisa.

##  v0.8.16
- **Ban automático**: el ban preparado ahora se marca al empezar tu turno de ban (tu equipo lo ve) y se confirma en el segundo 0 si no baneaste otro vos. Si marcaste otro campeón, se banea el tuyo.
- **Campeones que odiás** (hasta 5, en la tarjeta de Ban preparado) con interruptor de **ban automático**: si no hay ban preparado o no está disponible, se banea el primero de la lista que se pueda. Nunca uno ya baneado, uno que un compañero marcó para banear o uno que quiere jugar alguien de tu equipo.
- **Pick preparado visible**: se marca en la planificación (antes de los baneos) para que tu equipo vea lo que querés jugar.
- **Hechizos con íconos** en las reglas (se tocan, máximo 2; en jungla Aplastar fijo).
- **Hechizos por campeón**: en cada campeón de una regla podés fijar sus 2 hechizos. Valen en todas las reglas y ganan sobre los de la regla.
- Reglas y lista de odiados: un campeón que ya está en esa lista aparece en gris ("YA ESTÁ") y no se puede volver a elegir.
- Runas del set: primero se intenta la página temporal del cliente (pidiéndole que la cree si no hay). Solo si el cliente no la da se usa tu página "Open Queue". En tu prueba se había usado directo esa página.

##  v0.8.17
- **Chat de la sala antes de buscar**: en clientes nuevos el chat de la sala no aparece con un tipo conocido, así que ahora se busca por el id de la sala. Así podés hablar con tus amigos desde el celular antes de buscar partida.
- El diagnóstico ya no incluye la clave ni el token del chat de la sala.

##  v0.8.18
- **Link del voice de Discord**: en Ajustes > Discord pegás la invitación a tu canal de voz y elegís el mensaje (3 bases o el tuyo, con {link} donde va el link). En el chat de la sala y del champ select aparece el botón 🎧 para mandarlo, así van comunicados aunque en tu región no haya chat de voz.
- **Discord Rich Presence** (opcional): en tu perfil de Discord se ve "Open Queue", si estás en sala, buscando o eligiendo, el ícono de tu campeón, tu nick (se puede ocultar) y un botón "Unirse al voice" con tu link. Habla con Discord abierto en la PC, sin bots. Necesita el Application ID de una aplicación de Discord.

##  v0.8.19
- **Discord desde la PC**: la ventana de escritorio ahora tiene la tarjeta de Discord. Ahí pegás el link del voice, elegís el mensaje (bases o propio) y activás el Rich Presence con su Application ID. El botón "Mandar link del voice" lo manda al chat de la sala o del champ select sin necesitar el celular. En modo streamer el link se oculta.

##  v0.8.20
- Arreglo: en Flex el ban preparado y el ban automático no hacían nada. La lista de campeones baneables venía vacía por la ruta que usaba la app; ahora se toma de la otra ruta del cliente y, si sigue vacía, se intenta igual.
- Invitar amigos: los que ya están en tu sala aparecen al final como "En tu sala" y no se pueden invitar. Los que tienen invitación pendiente se ven como "Enviada".
- Diagnóstico: anota qué decidió el ban preparado en cada turno, y oculta todas las claves y tokens (también los del chat del champ select).

##  v0.8.21
- Arreglo del ban automático en Flex: el cliente mandaba una lista de baneables con un solo campeón y la app descartaba todos tus odiados y tu ban preparado. Ahora una lista tan corta no se toma en cuenta y el ban se hace igual (si no se puede, el cliente lo rechaza).
- Orden de pick: si ya pickeaste, o el compañero ya pickeó, no se ofrece pedir el cambio (el cliente lo seguía mostrando).
- Invitar amigos: los que están en partida, en cola o eligiendo campeón aparecen como "Ocupado" y no se pueden invitar.

##  v0.8.22
- Chat en soloq/flex: de los jugadores que no son de tu grupo no se muestra ningún nombre ni apodo, solo su línea y el ícono de su campeón (se lee más limpio).
