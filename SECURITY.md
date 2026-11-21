# Security & transparency / Seguridad y transparencia

*English first, Español abajo.*

## English

**What Open Queue does**
- It connects ONLY to the League of Legends client running on your own PC (127.0.0.1), like other community apps. It works on any server (LAS, LAN, NA, EUW, ...) because it reads the region from the client itself.
- It starts a small server on your PC so your phone can use it on your home wifi. Pairing requires the QR code or the 6-digit code; the desktop panel only answers from the PC itself.

**What it does NOT do**
- It never asks for or sees your Riot username and password.
- It sends no data to any server of ours: no account, no telemetry, no ads.
- It only goes online to download champion names and icons from Data Dragon (Riot's official CDN for developers).
- It does not touch the game while a match is being played: it only uses the client (lobby, accept, champion select).
- Customization (colors, fonts, background, sounds) is stored only on your phone.

**How to verify it**
- It is open source (MIT): anyone can read what it does. Key files: `src/lcu.js` (talks to the client) and `src/server.js` (what is exposed to the phone).
- Windows Firewall asks once about local network access: allow **Private networks** only.
- `Abrir Open Queue.vbs` starts the app without a console window; `Iniciar Open Queue.bat` shows it, if you want to see what it does.
- The "Dodge" button closes the League client on your PC (asks for confirmation; the game may penalize you).

**Disclaimer**: Open Queue isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

---

## Español

**Qué hace**
- Se conecta SOLO al cliente de LoL que está abierto en tu PC (127.0.0.1), igual que otras apps de la comunidad. Funciona con cualquier servidor (LAS, LAN, NA, EUW, etc.) porque lee la región del propio cliente.
- Abre un servidor chico en tu PC para que el celular lo use dentro de tu wifi. Para emparejar hace falta el QR o el código de 6 dígitos; el panel de la PC solo responde desde la propia PC.

**Qué NO hace**
- No pide ni ve tu usuario y contraseña de Riot.
- No manda datos a ningún servidor nuestro: no hay cuenta, ni telemetría, ni anuncios.
- Solo sale a internet para bajar nombres e íconos de campeones desde Data Dragon (el CDN oficial de Riot para desarrolladores).
- No toca el juego mientras se juega la partida: solo usa el cliente (sala, aceptar, champ select).
- La personalización (colores, tipografía, fondo, sonidos) se guarda solo en tu celular.

**Cómo verificarlo**
- Es código abierto (MIT): cualquiera puede leer lo que hace. Archivos clave: `src/lcu.js` (habla con el cliente) y `src/server.js` (lo que se expone al celular).
- El firewall de Windows pregunta una vez por el acceso a la red local: aceptá solo **Redes privadas**.
- `Abrir Open Queue.vbs` abre la app sin ventana de consola; `Iniciar Open Queue.bat` la muestra, por si querés ver qué hace.
- El botón "Dodgear" cierra el cliente de LoL en tu PC (pide confirmación; el juego puede penalizarte).

**Aviso**: Open Queue no está avalado por Riot Games ni refleja las opiniones de Riot Games ni de nadie involucrado oficialmente en producir o administrar sus propiedades. Riot Games y todas las propiedades asociadas son marcas registradas de Riot Games, Inc.
