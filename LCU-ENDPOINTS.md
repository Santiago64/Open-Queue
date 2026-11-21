# League Client API (LCU) endpoints used by Open Queue

Open Queue talks only to the League client running on the player's own PC (127.0.0.1). It does not call Riot's public API. Data Dragon is used for names and images.

## Read (GET)
- /lol-gameflow/v1/gameflow-phase, /lol-gameflow/v1/session
- /lol-lobby/v2/lobby, /lol-lobby/v2/lobby/matchmaking/search-state
- /lol-game-queues/v1/queues
- /lol-champ-select/v1/session, pickable-champion-ids, bannable-champion-ids, skin-carousel-skins
- /lol-lobby-team-builder/champ-select/v1/subset-champion-list
- /lol-champions/v1/owned-champions-minimal, /lol-champions/v1/inventories/{summonerId}/champions/{id}/skins
- /lol-game-data/assets/v1/summoner-spells.json
- /lol-perks/v1/pages, currentpage, inventory, styles, perks, recommended-pages/champion/{id}/position/{pos}/map/{map}, quick-play-selections/champion/{id}/position/{pos}
- /lol-summoner/v1/current-summoner, /lol-summoner/v1/summoners/{id}
- /lol-chat/v1/conversations (champ select chat of the lobby)

## Actions on the player's own account (POST / PUT / PATCH / DELETE)
- Ready check: POST /lol-matchmaking/v1/ready-check/accept | decline
- Lobby: POST /lol-lobby/v2/lobby, DELETE /lol-lobby/v2/lobby
- Queue: POST /lol-lobby/v2/lobby/matchmaking/search, DELETE /lol-lobby/v2/lobby/matchmaking/search
- Roles / Swiftplay slots: PUT /lol-lobby/v1|v2/lobby/members/localMember/position-preferences and /player-slots
- Champion select: PATCH /lol-champ-select/v1/session/actions/{id} (pick/ban), PATCH /lol-champ-select/v1/session/my-selection (spells, skin), POST .../my-selection/reroll, POST .../bench/swap/{championId}
- Swap requests with teammates: POST /lol-champ-select/v1/session/{pick-order-swaps|position-swaps|champion-swaps}/{id}/{request|accept|decline|cancel}
- Runes: POST /lol-perks/v1/pages, PUT /lol-perks/v1/pages/{id}, PUT /lol-perks/v1/currentpage, POST /lol-perks/v1/recommended-pages-position/champion/{id}/position/{pos}
- Chat: POST /lol-chat/v1/conversations/{id}/messages
- "Dodge" button (user-triggered, asks confirmation): POST /process-control/v1/process/quit
