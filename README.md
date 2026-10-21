# Laboratoire dentaire — application web (React + Node.js)

Gestion complète d'un laboratoire dentaire, conforme au cahier des charges : médecins et carnets uniques, fiches de travaux, tarifs A/B/C, demandes avec schéma dentaire 2D (FDI) et copier-coller entre dents, tableau de suivi avec tri / filtres / pagination, notifications (plateforme + téléphone), factures mensuelles, statistiques, utilisateurs et droits, sauvegardes.

## Installation des dépendances

Double-cliquez sur **`installer.bat`** (Windows) ou lancez **`./installer.sh`** (macOS / Linux), ou depuis la racine : `npm run setup`. Le script vérifie Node.js (18 ou plus), installe les dépendances du serveur et de l'interface, et crée `server/.env` à partir du modèle s'il n'existe pas.

**Mettre à jour une installation existante** : décompressez `mise-a-jour.zip` à la racine du projet (il ne contient ni `server/.env` ni `server/data/`, votre configuration et vos données sont conservées), puis relancez l'installation des dépendances et redémarrez le serveur et Vite.

## Base de données MongoDB

L'application enregistre toutes ses données dans une base MongoDB séparée, dont l'adresse est `MONGODB_URI` dans `server/.env`. La base et ses index sont créés automatiquement au premier démarrage.

### Option 1 : MongoDB sur votre Mac (Homebrew)

```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community     # démarre MongoDB maintenant et à chaque ouverture de session
```
Dans `server/.env` : `MONGODB_URI=mongodb://127.0.0.1:27017/labo_dentaire` (valeur par défaut).
Pour consulter les données : MongoDB Compass (application gratuite), connexion `mongodb://127.0.0.1:27017`.

Sans Homebrew, avec Docker : `docker run -d --name mongo -p 27017:27017 -v mongo-data:/data/db mongo:8`.

### Option 2 : MongoDB Atlas (en ligne, accessible depuis plusieurs postes)

1. Créez un cluster sur https://www.mongodb.com/cloud/atlas (une offre gratuite existe).
2. Dans *Database Access*, créez un utilisateur ; dans *Network Access*, autorisez l'adresse IP du serveur de l'application.
3. *Connect → Drivers* donne l'adresse ; ajoutez le nom de la base avant le `?` :
   `MONGODB_URI=mongodb+srv://utilisateur:motdepasse@cluster0.xxxxx.mongodb.net/labo_dentaire?retryWrites=true&w=majority`

### Organisation des données

| Collection | Contenu |
|---|---|
| `users` | Comptes, profils, droits, préférences de notification |
| `doctors`, `carnets` | Médecins et leur carnet unique (index unique sur `carnets.doctor_id`) |
| `designations`, `price_history` | Listes de prix A, B, C et historique des prix |
| `fiches` | Fiches de travaux, **lignes incluses** dans chaque fiche |
| `requests` | Demandes, **travaux par dent et historique des statuts inclus** |
| `invoices` | Factures, **lignes incluses** |
| `notifications`, `notification_deliveries`, `push_subscriptions` | Rappels et traçabilité des envois |
| `password_resets`, `audit_log`, `settings`, `counters` | Liens de réinitialisation, journal, paramètres, numérotation |

Les identifiants restent des nombres (1, 2, 3…) et les numéros (`D-2026-00001`, `F-…`, `FAC-…`) sont attribués par des compteurs atomiques. Aucune transaction multi-documents n'est nécessaire : l'application fonctionne avec un MongoDB local simple comme avec Atlas. Les règles sensibles (une seule facture par fiche, une seule validation, numérotation des factures continue) reposent sur des mises à jour conditionnelles atomiques ; elles ont été testées avec des requêtes simultanées.

### Reprendre les données de l'ancienne version (SQLite)

Si vous utilisiez la version précédente, vos données sont dans `server/data/labo.db`. Pour les copier dans MongoDB (identifiants, numéros, historiques et mots de passe conservés) :

```bash
cd server
npm run migrate:sqlite                              # lit server/data/labo.db
npm run migrate:sqlite -- /chemin/vers/labo.db      # autre emplacement
npm run migrate:sqlite -- --force                   # remplace des données déjà présentes dans MongoDB
```
Le script refuse d'écraser une base MongoDB qui contient déjà des données, sauf avec `--force`. Le fichier `labo.db` n'est jamais modifié.

### Sauvegardes

Paramètres → Sauvegardes : copie complète de la base au format `.json.gz`, automatique chaque nuit et manuelle à la demande, restaurable depuis l'application (une sauvegarde de sécurité est faite avant chaque restauration). En production, vous pouvez aussi utiliser `mongodump` / `mongorestore` ou les sauvegardes d'Atlas.

## Démarrage rapide

Prérequis : **Node.js 18 ou plus récent** et une base **MongoDB** (6.0 ou plus récente), installée sur votre ordinateur ou hébergée (MongoDB Atlas). Voir « Base de données MongoDB » ci-dessous.

```bash
npm run setup           # installe server/ et client/ (ou installer.bat / installer.sh)
# MongoDB doit être démarré (voir ci-dessous) et MONGODB_URI renseigné dans server/.env
npm run seed            # (facultatif) données de démonstration
npm run build           # compile l'interface React
npm start               # http://localhost:4000
```

Comptes créés :

| Compte | Mot de passe | Profil |
|---|---|---|
| admin@labo.local | admin1234 | Administrateur (créé au premier démarrage ; mot de passe provisoire, un nouveau est demandé à la première connexion) |
| production@labo.local | demo12345 | Personnel de production (démo) |
| admin2@labo.local | demo12345 | Personnel administratif (démo) |

Sans `npm run seed`, la base démarre vide avec seulement le compte administrateur (configurable via `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

### Mode développement

```bash
npm run dev:server      # API sur :4000 (redémarre à chaque modification)
npm run dev:client      # interface sur http://localhost:5173 (proxy /api → :4000)
```

## Configuration (`server/.env`)

Le serveur lit `server/.env` au démarrage ; les variables d'environnement du système ont priorité. `server/.env.example` est le modèle commenté (sans secrets) ; `server/.env` contient des secrets et ne doit pas être publié (il est dans `.gitignore`).

| Variable | Rôle |
|---|---|
| `NODE_ENV`, `PORT` | Mode (`development` / `production`) et port HTTP (4000) |
| `APP_URL` | Adresse du serveur API : l'interface React envoie toutes ses requêtes à `APP_URL/api` (injectée par `client/vite.config.js` sous `import.meta.env.APP_URL`). En production, l'adresse publique |
| `CLIENT_URL` | Adresse de l'interface quand elle tourne ailleurs (dev : `http://localhost:5173`) ; utilisée pour les liens de réinitialisation et autorisée en CORS |
| `CORS_ORIGINS` | Autres origines autorisées à appeler l'API (séparées par des virgules) |
| `FORCE_HTTPS` | `1` pour rediriger HTTP vers HTTPS derrière un proxy |
| `JWT_SECRET` | Clé de signature des sessions (64+ caractères aléatoires) ; la changer déconnecte tout le monde |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Premier administrateur, créé seulement si la base est vide |
| `MONGODB_URI` | Adresse de la base MongoDB (locale ou Atlas) ; le nom de la base est la fin de l'adresse |
| `MONGODB_DB` | Facultatif : nom de la base, s'il n'est pas dans l'adresse |
| `DATA_DIR` | Dossier des sauvegardes (relatif à `server/`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Serveur d'e-mail (mot de passe oublié, rappels). L'écran Paramètres → Notifications est prioritaire s'il est rempli |
| `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Notifications push ; clés générées automatiquement si vides |

## Dépannage

**`socket hang up` / `ECONNRESET` / `ECONNREFUSED` / « Le serveur est injoignable »** : l'interface n'obtient pas de réponse du serveur API (`APP_URL`).

1. Regardez le terminal du serveur (`npm run dev:server`). S'il affiche **« Le port 4000 est déjà utilisé par un autre programme »**, un autre logiciel (ou une ancienne instance du serveur restée ouverte dans un autre terminal) occupe le port. Arrêtez-le, ou changez `PORT` dans `server/.env` : Vite lit ce fichier et suit automatiquement le nouveau port.
   - Trouver le programme : Windows `netstat -ano | findstr :4000` puis `taskkill /PID <pid> /F` ; macOS / Linux `lsof -i :4000` puis `kill <pid>`.
2. S'il affiche **« Connexion à MongoDB impossible »**, MongoDB n'est pas démarré (`brew services start mongodb-community`) ou `MONGODB_URI` est incorrect.
3. Si le terminal affiche **« [plantage du serveur] »**, l'erreur détaillée suit ; relancez avec `npm run dev:server`.
3. Au démarrage, Vite affiche `API: <APP_URL> (connectée)` quand tout va bien, ou un avertissement explicite sinon.
5. **Requêtes bloquées « CORS » dans la console du navigateur** : l'adresse de l'interface doit figurer dans `CLIENT_URL` ou `CORS_ORIGINS` (server/.env), puis redémarrez le serveur. Après toute modification d'`APP_URL`, redémarrez aussi Vite (ou refaites `npm run build`) : la valeur est intégrée au code client.
4. Vérification directe : http://localhost:4000/api/health doit répondre `{"ok":true,"app":"labo-dentaire",…}`.

## Architecture

```
server/                 Node.js + Express 5 + MongoDB (pilote officiel « mongodb »)
  src/db.js             schéma, paramètres, compteurs de numérotation
  src/auth.js           JWT, profils et droits (rôles + exceptions par utilisateur)
  src/routes/           auth/utilisateurs, médecins, désignations (tarifs), fiches & carnets,
                        demandes & tableau de bord, notifications, factures, admin (stats, sauvegardes, journal)
  src/services/         notifier.js (rappels, push, SMS, WhatsApp, e-mail), pdf.js (factures PDF)
  data/backups/         sauvegardes .json.gz (créé automatiquement)
client/                 React 18 + Vite + React Router + Recharts
  src/components/DentalChart.jsx   schéma dentaire SVG (permanentes, temporaires, mixte)
  src/pages/            Suivi, Demande, Médecins, Carnets/Fiches, Tarifs, Factures, Statistiques, Compte, Admin
  public/sw.js          service worker (notifications push même application fermée)
```

## Règles métier implémentées

- **Un carnet par médecin** : créé automatiquement avec le médecin, contrainte d'unicité en base. Doublons de médecins bloqués (nom normalisé, sans accents ni casse) avec suggestion des noms proches.
- **Prix figés** : chaque ligne de fiche, de demande et de facture conserve le prix appliqué ; modifier une liste de prix n'affecte jamais l'existant. Historique des changements de tarif.
- **Modification ponctuelle des prix** réservée au droit « Modifier les prix appliqués » (vérifié côté serveur).
- **Tri par priorité** : essayages proches → travaux en cours (prochaine échéance) → prêts à livrer (livraison prévue) → livrées (plus récentes). Tri et filtres appliqués avant la pagination ; filtres conservés dans l'URL.
- **Copier-coller** : sélection d'une dent, Ctrl+C, sélection d'une ou plusieurs dents (Ctrl+clic), Ctrl+V. Choix « Ajouter » ou « Remplacer » si la destination a déjà des travaux. Boutons équivalents pour tablette/téléphone.
- **Notifications** : rappels la veille, le jour même et délais personnalisés ; alertes de retard ; récapitulatif quotidien. Aucun doublon (clé de déduplication par échéance), rappels recalculés automatiquement quand une date change, arrêtés quand le statut change. Chaque envoi est tracé (Paramètres → Journal des envois). Initiales du patient seulement sur téléphone (paramétrable).
- **Factures** : mois courant par défaut, fiches validées uniquement, une fiche ne peut être facturée qu'une fois (réservée dès le brouillon). Brouillon modifiable → validation (numéro définitif `FAC-AAAA-NNNN`) → verrouillage. Correction via **rectification** tracée (la facture d'origine passe « rectifiée »). Export PDF, impression, réédition.
- **Sécurité** : mots de passe bcrypt, JWT 12 h, limitation des tentatives de connexion, contrôle des droits sur chaque route API, journal d'activité, suppressions protégées (archivage des médecins, suppression logique des demandes).
- **Sauvegardes** : automatique chaque jour (heure et rétention paramétrables), manuelle, téléchargement, restauration depuis la liste ou un fichier (vérification d'intégrité + sauvegarde préalable automatique).

## Connexion et mot de passe oublié

- **Page de connexion** (`/connexion`) : après connexion, retour automatique à la page demandée. Verrouillage de 5 minutes après 5 échecs.
- **Mot de passe oublié** (`/mot-de-passe-oublie`) : l'utilisateur saisit son e-mail et reçoit un lien **à usage unique valable 1 heure**. La réponse est identique que le compte existe ou non (aucune fuite d'information), et les demandes sont limitées (5 par 15 minutes).
- **Lien de réinitialisation** (`/reinitialiser/<jeton>`) : choix du nouveau mot de passe avec confirmation. Le jeton n'est jamais stocké en clair (empreinte SHA-256). Une fois le mot de passe changé, toutes les sessions ouvertes du compte sont déconnectées et un e-mail de confirmation est envoyé.
- **Sans e-mail configuré** : les administrateurs reçoivent une notification dans l'application et peuvent générer un lien (valable 24 h) depuis **Utilisateurs → Modifier → Réinitialisation du mot de passe**, à transmettre par SMS ou WhatsApp. L'administrateur ne voit jamais le mot de passe choisi. En développement, le lien est aussi affiché dans la console du serveur.
- **Mot de passe provisoire** : un mot de passe défini par un administrateur (création de compte, réinitialisation manuelle) doit être remplacé à la connexion suivante ; l'API refuse toute autre action d'ici là.
- **Règles** : 8 caractères minimum, au moins une lettre et un chiffre, différent de l'e-mail et des mots de passe trop courants.
- **Configuration requise en production** : renseignez l'adresse publique de l'application (Paramètres → Laboratoire, ou variable `APP_URL`) et le serveur SMTP (Paramètres → Notifications → E-mail). Les liens envoyés par e-mail utilisent uniquement cette adresse, jamais l'en-tête de la requête.

## Notifications sur téléphone

- **Push (gratuit, recommandé)** : Mon compte → « Activer sur cet appareil ». Fonctionne sur Android, ordinateur, et iPhone (iOS 16.4+) après « Ajouter à l'écran d'accueil ». Nécessite **HTTPS** en production (localhost est accepté pour les tests). Les clés VAPID sont générées automatiquement.
- **SMS / WhatsApp** : Paramètres → Notifications → Canaux. Twilio (Account SID, token, numéro) ou votre propre passerelle via webhook (`POST { channel, to, message }`).
- **E-mail** : serveur SMTP dans le même écran.

## Mise en production

```bash
NODE_ENV=production PORT=4000 JWT_SECRET="une-longue-chaine-aleatoire" FORCE_HTTPS=1 npm start
```

Placez l'application derrière un proxy HTTPS (Nginx, Caddy…) qui transmet `X-Forwarded-Proto`. Variables utiles : `APP_URL` (adresse publique, pour les liens de réinitialisation), `DATA_DIR` (emplacement de la base et des sauvegardes), `VAPID_SUBJECT` (`mailto:` du laboratoire). Pensez à copier régulièrement `data/backups/` hors du serveur.

## Points ouverts du cahier des charges (§15) et choix retenus

| Point | Choix par défaut, modifiable |
|---|---|
| Numérotation | Demandes `D-AAAA-00001`, fiches `F-AAAA-00001`, carnets `C-0001`, factures `FAC-AAAA-0001` à la validation |
| Paramètres techniques | Définis par désignation dans Tarifs (liste, texte ou nombre), ex. teinte, alliage, système d'implant |
| Statuts | Les 4 statuts du cahier des charges + cases « essayage 1/2 effectué » |
| Facturation | Fiches **validées** datées du mois ; regroupement par fiche ou par désignation |
| Devise | TND à 3 décimales (modifiable dans Paramètres → Laboratoire) |
| Export | PDF ; Excel non inclus |
