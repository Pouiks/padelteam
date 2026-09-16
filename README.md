# Vestiaire

PWA pour organiser des matchs entre collègues avec des équipes équilibrées : chacun
renseigne son prénom et son niveau, s'inscrit à un match, et l'application forme des
équipes de force comparable puis un tableau à élimination directe. Les matchs sont
remis à zéro toutes les 48 h (les anciens restent consultables dans les archives).

Pas de compte, pas de mot de passe. Stack : **Next.js 16** (App Router, routes d'API),
**React 19**, CSS vanilla, **Upstash Redis** pour la persistance sur Vercel (fichiers
JSON en local), **web-push** pour les notifications.

## Lancer en local

```bash
npm install
npm run dev          # http://localhost:3000
```

En local, sans variable d'environnement, les données sont écrites dans `data/` :

| Fichier                  | Contenu                                   |
| ------------------------ | ----------------------------------------- |
| `data/current.json`      | cycle courant, joueurs, matchs            |
| `data/version.json`      | numéro de version (écritures atomiques)   |
| `data/archive/<id>.json` | un fichier par cycle terminé              |
| `data/push.json`         | abonnements aux notifications             |

### Partager sur le réseau local

Le serveur de développement écoute sur toutes les interfaces avec
`npm run dev -- -H 0.0.0.0`. L'adresse à partager est celle de votre machine sur le
réseau, par exemple `http://192.168.1.42:3000` (`ipconfig` sous Windows, `ifconfig`
ou `ip a` ailleurs). En production locale : `npm run build && npm start`.

Les notifications push et l'installation « écran d'accueil » exigent HTTPS (sauf sur
`localhost`) : pour un usage réel, déployez sur Vercel.

## Déployer sur Vercel

1. Poussez le dépôt sur GitHub/GitLab et importez-le dans Vercel (préréglage Next.js,
   rien à changer).
2. **Base de données** : dans le projet Vercel, onglet *Storage* → *Create Database* →
   **Upstash for Redis** (offre gratuite suffisante). Vercel injecte automatiquement
   `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` (ou `KV_REST_API_URL` /
   `KV_REST_API_TOKEN`, les deux sont reconnus). Sans base, l'application démarre mais
   les données sont perdues à chaque réveil de fonction.
3. **Notifications** (facultatif) : générez des clés une fois pour toutes avec

   ```bash
   npm run vapid
   ```

   et ajoutez `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` dans
   *Settings → Environment Variables*. Sans ces clés, le bouton de notifications est
   simplement masqué.
4. Redéployez. Le fichier `vercel.json` déclare un cron quotidien sur
   `/api/cron/rotate` qui archive un cycle expiré même si personne n'ouvre
   l'application (facultatif : la rotation est aussi faite à chaque requête).
   Définissez `CRON_SECRET` pour protéger cette route.

Toutes les variables sont listées dans `.env.example`.

## Installer sur son téléphone

- **iPhone / iPad (Safari)** : ouvrir l'adresse, bouton *Partager* → *Sur l'écran
  d'accueil*. Les notifications ne sont disponibles **qu'après installation** et depuis
  l'icône installée (iOS 16.4 et plus).
- **Android (Chrome)** : menu ⋮ → *Installer l'application* (ou *Ajouter à l'écran
  d'accueil*).

Une fois installée, dans l'onglet *Matchs*, appuyer sur **Activer** dans l'encart
🔔 pour être prévenu à chaque nouveau match (le créateur du match n'est pas notifié).

## Comment ça marche

### Cycle de 48 h

À chaque requête, le serveur vérifie si `now − cycle.startedAt ≥ 48 h`. Si oui, le
cycle et ses matchs sont copiés dans une archive (`vestiaire:archive:<id>` dans
Redis, `data/archive/<id>.json` en local), la liste des matchs est vidée et un nouveau
cycle démarre. Les joueurs ne sont jamais effacés.

### Équilibrage (`lib/balance.ts`)

1. `nTeams = floor(inscrits / taille)` ; il en faut au moins deux.
2. Les `nTeams × taille` premiers inscrits jouent, les suivants sont remplaçants.
3. Tri par niveau décroissant puis draft serpentin.
4. 600 échanges aléatoires, acceptés seulement s'ils réduisent l'écart entre l'équipe
   la plus forte et la plus faible.
5. Ordre des équipes tiré au sort, noms : Rouges, Bleus, Verts, Jaunes, Noirs,
   Blancs, Orange, Violets, Gris, Roses, Cyan, Bruns.

### Tournoi à double élimination (`lib/bracket.ts`)

Personne ne sort sur une seule défaite : l'équipe battue dans le **tableau des
gagnants** bascule dans le **tableau des perdants**, et n'est éliminée qu'à sa
deuxième défaite. Les vainqueurs des deux tableaux se retrouvent en **grande
finale** ; si l'équipe venue des perdants la gagne, chacune compte une défaite et
une **revanche** les départage.

À 8 joueurs en équipes de 2, sur 2 terrains :

```
tour 1   terrain 1 : gagnants A–B      terrain 2 : gagnants C–D
tour 2   terrain 1 : finale gagnants   terrain 2 : perdants (battus du tour 1)
tour 3   finale des perdants
tour 4   grande finale (+ revanche éventuelle)
```

Le tableau est un graphe construit au lancement : chaque rencontre dit où chercher
ses deux équipes (tirage, vainqueur ou perdant d'une autre rencontre, place vide
pour un exempt). Seuls les résultats déclarés sont stockés ; qui joue, qui attend,
qui est éliminé et le classement se recalculent. Fonctionne pour n'importe quel
nombre d'équipes (exempts dispersés, pas de revanche immédiate à l'arrivée chez les
perdants).

**Terrains** : une rencontre prête reçoit le premier terrain libre et le garde
jusqu'à son résultat — personne ne change de terrain parce qu'un autre match s'est
terminé. S'il y a plus de rencontres prêtes que de terrains, elles attendent.

**Ce que voit chacun** : en tête de fiche, son équipe (« À vous ! Terrain 2 contre
les Bleus », « Prochain match contre le vainqueur de Rouges – Jaunes », « Éliminés —
3e place »). Dès que cette situation change — y compris quand c'est une autre équipe
qui a déclaré le résultat — un message le prévient, quel que soit l'écran affiché.
N'importe qui peut déclarer un résultat d'un geste, score facultatif. Égalités
interdites ; corriger un vainqueur efface ce qui en dépendait.

Un match lancé avant ce format (ancien tableau à élimination simple) revient aux
inscriptions, inscrits conservés ; les archives gardent leur format d'origine.

### Identité et session

Pas de compte ni de mot de passe : chaque appareil porte un identifiant de joueur.
Il est conservé à deux endroits, pour qu'en perdre un ne déconnecte personne :

- un **cookie** `vestiaire_pid` posé par le serveur (`HttpOnly`, `SameSite=Lax`,
  400 jours), reposé à chaque appel de `/api/state` ;
- le **localStorage** du navigateur, envoyé en paramètre `device` et utilisé pour
  recréer le cookie s'il a disparu.

Le serveur tranche (`lib/session.ts`) et renvoie `me` dans `/api/state`. Si les deux
ont disparu — Safari purge le stockage écrit par script, les navigateurs intégrés à
WhatsApp ou Instagram ont leur propre bac à sable, la navigation privée repart de
zéro — l'écran d'accueil propose de **reprendre sa place** dans la liste des joueurs
(`POST /api/session`), ce qui récupère le profil *et* les inscriptions en cours plutôt
que de créer un doublon.

### Temps réel

Les fonctions serverless de Vercel ne conviennent pas aux connexions longues (SSE).
Le client interroge donc `GET /api/state?v=<version>` toutes les 5 s quand l'onglet
est visible ; si rien n'a changé, la réponse tient en une ligne. Chaque action renvoie
directement le nouvel état, appliqué sans attendre.

### Écritures concurrentes

L'état est un unique document JSON avec un numéro de version. Chaque modification
est relue, appliquée puis écrite par un *compare-and-set* (script Lua côté Redis,
verrou + fichiers temporaires renommés en local). En cas de conflit, la modification
est rejouée sur l'état à jour.

## API

| Méthode | Route                     | Corps / réponse                                      |
| ------- | ------------------------- | ---------------------------------------------------- |
| GET     | `/api/state?v=&device=`   | `{version, cycle, players, events, me}` ou `{unchanged, me}` |
| POST    | `/api/session`            | `{playerId}` — rattache cet appareil à un joueur existant |
| DELETE  | `/api/session`            | oublie le joueur sur cet appareil                    |
| PUT     | `/api/players/:id`        | `{name, level}` (niveau 0–6, prénom ≤ 30 car.)       |
| POST    | `/api/events`             | `{title?, teamSize, courts?, join, playerId}`        |
| POST    | `/api/events/:id/join`    | `{playerId}` (bascule)                               |
| POST    | `/api/events/:id/launch`  | forme équipes + tableau à double élimination         |
| POST    | `/api/events/:id/result`  | `{match, winner?, sa?, sb?}` (index de rencontre ; vainqueur et/ou score) |
| POST    | `/api/events/:id/reopen`  | rouvre les inscriptions                              |
| DELETE  | `/api/events/:id`         |                                                      |
| GET     | `/api/archive`            | `[{id, startedAt, endedAt, events: [...]}]`          |
| GET     | `/api/push/config`        | `{enabled, publicKey}`                               |
| POST    | `/api/push/subscribe`     | `{playerId, subscription}`                           |
| DELETE  | `/api/push/subscribe`     | `{endpoint}`                                         |
| GET     | `/api/cron/rotate`        | force la rotation du cycle (cron Vercel)             |

Toute entrée invalide renvoie `400 {error: "message en français"}`.

## Tests

```bash
npm test
```

Tests unitaires (`node --test`, Node ≥ 22.18) sur l'équilibrage, le tableau et le
store (versions, rotation, conflits, stockage fichiers).

## Structure

```
app/            layout, page, globals.css, routes d'API (app/api/**)
components/     interface React (App, Identity, Matches, EventDetail, Players, Archive…)
lib/            logique partagée : balance, bracket, cycle, store, kv, push, api
lib/client/     helpers navigateur : appels API, synchronisation, Web Push
public/         manifest.webmanifest, sw.js, icônes
scripts/        vapid.js (clés push), make-icons.js (PNG des icônes)
test/           tests unitaires
```
