<p align="center"><img src="public/icon.png" width="96" alt="Open Queue"></p>

# Open Queue

**English** · [Español](#español)

Free, open-source companion for the League of Legends client. Control your own client from your phone or any browser on your home wifi: accept the match (manual or automatic), queue up, and use a mini champion select with picks, bans, summoner spells, runes, skins and lobby chat. Works on every server (LAS, LAN, NA, EUW...) because it talks to the client running on your PC.

> Open Queue isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## Demo

**Real match / Partida real**

[https://youtu.be/WY_2kIYpCiA](https://youtu.be/WY_2kIYpCiA)

**Practice Tool (all features) / Herramienta de práctica**

[https://youtu.be/uzNA9uWtmXg](https://youtu.be/uzNA9uWtmXg)

## Features
- Pair with a QR code or a 6-digit code. Accept/decline the match from your phone, or **auto-accept with a configurable delay (0-8 s)** that runs on the PC even if the phone disconnects.
- Queue for current modes: Normal Draft/Blind, Ranked Solo/Duo and Flex, ARAM, ARAM Mayhem, Swiftplay, TFT. Primary/secondary role before searching.
- Mini champ select: teams, timer, pick order, bans; pick/ban in two taps; pre-pick; summoner spells; skins; lobby chat.
- Swap requests with teammates (pick order, role, champion) and ARAM bench/rerolls. ARAM Mayhem: choose between your 2 starting options.
- Runes: your pages, the game's recommended pages, and an editor (create new pages or edit existing ones).
- "Dodge" button (closes the client, asks for confirmation).
- Discord: send your voice channel invite to the lobby or champ select chat with one tap (with your own message), and optional Rich Presence showing your lobby, champion and a "Join the voice" button on your profile.
- Customization: color wheel, fonts (including your own), custom background and sound, panel order. Stored only on your phone.
- English and Spanish.

## How to use (Windows)
1. Install [Node.js](https://nodejs.org) (once). LTS is recommended, but any version from 18 on works, including "Current".
2. Double-click **`Abrir Open Queue.vbs`**. The first run installs what it needs (internet required, about a minute). Use **`Iniciar Open Queue.bat`** if you want to see the console.
3. If Windows Firewall asks, allow **Private networks** only.
4. Open the League client.
5. On your phone (same wifi): scan the QR code of the window, or open the shown address and type the 6-digit code.
6. Turn on **Auto-accept** and pick the delay.

## Privacy & security
It only talks to the League client on `127.0.0.1` and to your phone on your local network. No accounts, no telemetry, no ads, no Riot credentials. See [SECURITY.md](SECURITY.md) and [LCU-ENDPOINTS.md](LCU-ENDPOINTS.md).

## Support the project
Open Queue is and will stay free. If it saved you a dodge and you want to say thanks:
- [Ko-fi](https://ko-fi.com/firewrathness) (international, PayPal / cards)
- [Cafecito](https://cafecito.app/firewrathness) (Argentina, Mercado Pago)

Donations are optional and unlock nothing: every feature is free for everyone.

## Development
```
npm install
npm start        # desktop window (Electron)
npm run server   # server only
npm test         # end-to-end tests against a simulated League client
```
MIT License. Changes: see [CHANGELOG.md](CHANGELOG.md).

---

## Español

Companion gratuito y de código abierto para el cliente de League of Legends. Controlá tu propio cliente desde el celu o cualquier navegador de tu wifi: **aceptar la partida (manual o automático)**, buscar partida y un mini champ select con picks, bans, hechizos, runas, skins y chat de la sala. Funciona en todos los servidores porque habla con el cliente que está en tu PC.

> Open Queue no está avalado por Riot Games ni refleja las opiniones de Riot Games ni de nadie involucrado oficialmente en producir o administrar sus propiedades. Riot Games y todas las propiedades asociadas son marcas registradas de Riot Games, Inc.

### Qué incluye
- Vinculación por QR o código de 6 dígitos. Aceptar/rechazar desde el celu o **autoaceptar con retraso configurable (0 a 8 s)**, que corre en la PC aunque el celu se desconecte.
- Buscar partida en los modos vigentes: Normal Draft/a ciegas, Solo/Dúo y Flex, ARAM, ARAM Mayhem, Swiftplay y TFT. Rol principal y secundario antes de buscar.
- Mini champ select: equipos, temporizador, orden de pick, baneos; pick/ban en dos toques; pick preparado; hechizos; skins; chat.
- Pedidos de cambio con compañeros (orden de pick, rol, campeón) y banco/rerolls de ARAM. ARAM Mayhem: elegís entre tus 2 opciones iniciales.
- Runas: tus páginas, las recomendadas por el juego y un editor (crear páginas nuevas o editar las existentes).
- Botón **Dodgear** (cierra el cliente, pide confirmación).
- Discord: mandás el link de tu canal de voz al chat de la sala o del champ select con un toque (con tu mensaje), y opcionalmente Rich Presence: en tu perfil se ve tu sala, tu campeón y un botón "Unirse al voice".
- Personalización: rueda de color, tipografías (también la tuya), fondo y sonido propios, orden de paneles. Se guarda solo en tu celu.
- Español e inglés.

### Cómo usarlo (Windows)
1. Instalá [Node.js](https://nodejs.org) (una sola vez). Recomendamos la LTS, pero sirve cualquier versión desde la 18, incluida la "Current".
2. Doble clic en **`Abrir Open Queue.vbs`**. La primera vez instala lo necesario (necesita internet, tarda un minuto). Si algo falla, usá **`Iniciar Open Queue.bat`**, que muestra la consola.
3. Si el firewall de Windows pregunta, permití solo **Redes privadas**.
4. Abrí el cliente de LoL.
5. En el celu (mismo wifi): escaneá el QR de la ventana o abrí la dirección que aparece y escribí el código de 6 dígitos.
6. Activá **Autoaceptar** y elegí el retraso.

### Privacidad y seguridad
Solo habla con el cliente de LoL en `127.0.0.1` y con tu celu en tu red local. Sin cuentas, telemetría, anuncios ni credenciales de Riot. Ver [SECURITY.md](SECURITY.md) y [LCU-ENDPOINTS.md](LCU-ENDPOINTS.md).

### Apoyar el proyecto
Open Queue es y seguirá siendo gratis. Si te sirvió y querés agradecer:
- [Ko-fi](https://ko-fi.com/firewrathness) (exterior, PayPal / tarjeta)
- [Cafecito](https://cafecito.app/firewrathness) (Argentina, Mercado Pago)

Las donaciones son opcionales y no desbloquean nada: todas las funciones son gratis para todos.

### Limitaciones conocidas
- Con la pantalla del celu apagada, el navegador puede pausar la página y no sonar: probá "Mantener activo en segundo plano" en Ajustes o dejá la pantalla encendida.
- Solo funciona dentro de la misma red local.
- Los íconos de campeones vienen de Data Dragon (CDN oficial de Riot): hace falta internet en el celu.
- Si algo no responde igual en el juego real, usá la tarjeta **Diagnóstico** de la ventana de la PC y compartí el archivo (no incluye contraseñas ni datos de tu cuenta).

Licencia MIT. Cambios: ver [CHANGELOG.md](CHANGELOG.md).
