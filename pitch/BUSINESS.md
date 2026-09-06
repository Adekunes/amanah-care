# Walidayn : modèle d'affaires et tarification

Version 2026-09-06 (jour du pitch). Proposition à valider avec cinq familles pilotes et deux agences. Tous les prix sont en dollars canadiens, taxes en sus. Chaque chiffre sans source est marqué « estimation » avec l'hypothèse qui le produit. Aucune citation inventée.

## 1. Positionnement, en trois phrases

Gratuit pour les familles, sans limite d'aînés ni de membres, parce que le dossier ne doit jamais devenir un péage entre frères et sœurs. Payé par ceux qui en ont un besoin professionnel : agences de soins à domicile, organismes communautaires, CLSC et coopératives, plus un soutien volontaire des familles qui le souhaitent. Hébergé au coût réel, et le serveur ne peut rien lire : il n'y a pas de « honeypot » de données de santé à protéger ni à monnayer.

Nous voulons vendre sans agressivité, au départ comme plus tard. N'importe quelle famille pourrait bricoler son propre système (groupe WhatsApp, tableur, mémoire). Le prix doit donc encourager l'usage, jamais le freiner.

## 2. Grille tarifaire proposée

| Palier | Pour qui | Prix | Ce qui est inclus | Justification |
|---|---|---|---|---|
| **Famille** | Toute famille | **0 $**, toujours, sans limite | Le dossier complet : routine, journal, relève qui s'écrit seule, alertes en direct, écran de l'aîné, dossier hospitalier en un geste, recommandations, export complet à tout moment | Le cœur du produit doit être gratuit pour que la famille l'adopte à la place du groupe WhatsApp. Rien d'essentiel ni de sécurité derrière un paiement. |
| **Soutien** (volontaire) | Familles qui veulent contribuer | **3 à 5 $ par mois** | Extras non essentiels seulement : export PDF illimité du dossier hospitalier, copie de secours de la clé entre deux proches, thèmes en grand format | Un geste, pas un abonnement forcé. Le prix d'un café par mois. Estimation : 5 à 10 % des familles actives y souscrivent (hypothèse à mesurer au pilote). |
| **Agences et organismes de soins** | Agences de soins à domicile, EÉSAD, coopératives, CLSC | **300 $ par aîné suivi et par année**, une seule facture | Comptes intervenants (un identifiant pour toutes les familles servies), tableau de bord intervenant, journal de relève à chaque visite, alertes au coordonnateur, dossier hospitalier, recommandations version professionnelle ; plus tard la clé restreinte par intervenant | L'agence achète un journal de visite et une relève propre, ce qui lui coûte aujourd'hui des appels et des cahiers. Une licence annuelle plutôt qu'un abonnement mensuel : une facture par année passe mieux en comité qu'un prélèvement par tête tous les mois. 300 $ par année, soit 25 $ par mois, reste bien en dessous d'une heure de service (voir §5 pour l'ordre de grandeur des heures EÉSAD). Les rabais de volume seront fixés au pilote. |
| **Organismes communautaires** | Mosquées, centres communautaires, coopératives | **Forfait annuel** : 600 $ pour 50 familles parrainées, 1 500 $ pour 200 (estimation) | Le palier Famille pour les familles qu'ils servent déjà, une seule facture, un tableau anonyme du nombre de familles actives | Environ 1 $ par famille et par mois. Payable en sadaqa ou sur un budget d'aide aux aînés. Aucun accès aux données : l'organisme parraine, il ne lit pas. Ce forfait n'est pas la licence professionnelle : il paie le palier Famille, qui est déjà gratuit, pour des familles que l'organisme parraine. Un organisme qui veut les comptes intervenants et la couche professionnelle achète la licence à 300 $ par aîné et par année, comme une agence. |
| **Auto-hébergement** | Familles techniques, organismes avec leur informatique | **Code ouvert**, gratuit ; support et mises à jour **à partir de 150 $ par mois par organisme** (estimation) | Les six conteneurs (web, api, projecteur, notificateur, Redis, Postgres) s'installent en une commande. Nous vendons le support, les mises à jour et l'aide au déploiement, pas l'accès. | Cohérent avec « la clé appartient à la famille ». Un organisme public préfère souvent héberger lui-même. |

## 3. Capacité et coût d'hébergement

### 3.1 L'objectif de charge : 1 million d'heures CPU par an

Deux lectures possibles :

1. **Heures CPU** : 1 000 000 h ÷ 8 760 h par an ≈ **114 cœurs occupés en continu**. C'est un budget de calcul serveur.
2. **Heures d'utilisation par les familles** : 1 million d'heures d'écrans ouverts par an. À 2 heures par famille et par jour (estimation), cela correspond à environ 1 370 familles actives, et ne coûte qu'une fraction du budget ci-dessus.

**Lecture retenue : la première** (heures CPU). Elle fixe le plafond de la machine cible et sert au calcul de rentabilité. La seconde décrit l'usage réel, très en dessous de ce plafond pendant des années.

### 3.2 La machine cible

Une machine (ou un petit groupe) capable de tenir cette charge, **budget estimé 1 000 $ par mois tout compris** (hébergement, sauvegardes, surveillance). **Estimation du fondateur, à valider avec deux devis** : un serveur dédié d'environ 128 vCPU chez un hébergeur canadien ou européen, et l'équivalent en nuage. Hypothèse de départ : ce budget achète entre 64 et 128 cœurs dédiés selon l'hébergeur ; à 64 cœurs, la machine fournit environ 560 000 heures CPU par an, et il faut deux machines pour atteindre l'objectif et avoir une redondance.

### 3.3 Charge réelle par famille

L'application est légère par construction : un événement par action, aucun déchiffrement côté serveur, des lectures indexées sur des tables petites, un flux SSE par onglet ouvert (quasiment inactif entre deux événements), et une lecture toutes les 4 secondes par onglet ouvert en secours.

Hypothèses (estimations, à mesurer au pilote) :

| Hypothèse | Fourchette basse (famille active, usage normal) | Fourchette haute (famille très active, onglets toujours ouverts) |
|---|---|---|
| Événements par jour et par famille | 40 | 120 |
| Coût CPU par événement, tous services confondus (api, projecteur, notificateur, annonce) | 5 ms | 10 ms |
| Onglets ouverts en même temps | 2 | 4 |
| Heures par jour où ces onglets sont ouverts | 6 | 12 |
| Requêtes de secours par onglet et par cycle de 4 s | 4 | 4 |
| Coût CPU par requête de lecture | 1,5 ms | 3 ms |

Calcul, fourchette basse :

- Événements : 40 × 5 ms = 0,2 s CPU par jour.
- Lectures de secours : 2 onglets × 6 h × 3 600 s ÷ 4 s × 4 requêtes = 43 200 requêtes × 1,5 ms = 64,8 s CPU par jour.
- Total ≈ 65 s CPU par jour et par famille ≈ 0,00075 cœur en moyenne.
- Familles par 114 cœurs : 114 ÷ 0,00075 ≈ **150 000 familles actives** (haut de la fourchette de capacité).

Calcul, fourchette haute :

- Événements : 120 × 10 ms = 1,2 s CPU par jour.
- Lectures : 4 × 12 × 3 600 ÷ 4 × 4 = 172 800 requêtes × 3 ms = 518 s CPU par jour.
- Total ≈ 520 s CPU par jour et par famille ≈ 0,006 cœur.
- Familles par 114 cœurs : 114 ÷ 0,006 ≈ **19 000 familles actives** (bas de la fourchette).

**Fourchette retenue : de 19 000 à 150 000 familles actives sur la machine cible.** La lecture de secours toutes les 4 secondes domine le coût ; comme le flux SSE fonctionne, la passer à 20 secondes multiplie la capacité par cinq. Les limites suivantes sont la mémoire des connexions SSE (quelques dizaines de Ko par onglet ouvert) et le nombre de connexions Postgres (un pooler devient nécessaire au-delà de quelques milliers d'onglets simultanés). Pour les premières années, une machine à 200 $ par mois suffit ; le budget de 1 000 $ est un plafond, pas un point de départ.

## 4. Calcul de rentabilité

Coûts fixes mensuels (estimations) :

| Poste | Montant |
|---|---|
| Serveur cible, sauvegardes, surveillance | 1 000 $ |
| Nom de domaine, courriel, outils de support | 100 $ |
| Comptabilité, assurance, conseil en protection des renseignements (lissé) | 500 $ |
| **Total fixe hors salaires** | **1 600 $** |

Le temps du fondateur n'est pas compté au départ. Un premier salaire partiel (estimation 3 400 $ par mois) porte le besoin mensuel à environ 5 000 $.

Formule : **N = C ÷ p**, où C est le coût mensuel à couvrir et p le prix par aîné et par mois payé par les agences. La licence est annuelle : 300 $ par année valent p = 25 $ par mois.

| Coût mensuel à couvrir C | p = 25 $ par mois (licence 300 $ par année) |
|---|---|
| 1 000 $ (le serveur seul) | **40 aînés** |
| 1 600 $ (fixe hors salaires) | 64 aînés |
| 5 000 $ (fixe + premier salaire partiel) | **200 aînés** |

Les autres revenus s'ajoutent sans être nécessaires au calcul : le soutien volontaire (à 4 $ et 5 % de souscription, 1 000 familles actives donnent 200 $ par mois), les forfaits communautaires (un organisme à 600 $ par an vaut 50 $ par mois) et le support d'auto-hébergement (150 $ par mois par organisme).

Ordre de grandeur du marché adressable au Québec, avec source : le Réseau de coopération des EÉSAD regroupe environ 85 entreprises d'économie sociale en aide à domicile, près de 110 000 usagers, environ 8 millions d'heures de service par an et 10 000 préposés (Réseau de coopération des EÉSAD, 2024, eesad.org). Couvrir 5 000 $ par mois demande 200 aînés sous licence à 300 $ par année, soit moins de 0,2 % de ces usagers.

## 5. Leviers de rétention, honnêtes

Une famille peut tout reconstruire ailleurs. Elle reste si le produit lui enlève du travail chaque jour :

- **La relève qui s'écrit toute seule** : « ce qui s'est passé » vient du journal, « ce qui vient » vient de la routine. Personne ne tape de résumé.
- **Les alertes choisies** : chacun reçoit ce qu'il a demandé, en direct, et rien d'autre.
- **L'écran de l'aîné** : sa journée en grands caractères, qui est avec elle, qui peut lire son dossier, un bouton « j'ai besoin d'aide ».
- **Le dossier hospitalier** : quatorze jours sur une page, en un geste, au moment où la famille ne peut plus se souvenir.
- **La clé qui appartient à la famille** : le serveur ne lit rien, et l'export complet est disponible à tout moment. **Aucun enfermement.** La famille reste parce qu'elle le veut, pas parce qu'elle ne peut pas partir.

## 6. Ce que nous ne ferons pas

- Pas de publicité.
- Pas de revente de données : impossible de toute façon, elles sont chiffrées avec une clé que nous n'avons pas.
- Pas de fonction de sécurité ni de fonction essentielle derrière un paiement.
- Pas de relance agressive, pas de compte à rebours, pas de « offre limitée ».

## 7. Risques et inconnues

- Le prix par aîné (300 $ par année) et le taux de soutien volontaire (5 à 10 %) sont des hypothèses. Le pilote avec cinq familles et deux agences doit les confirmer ou les corriger.
- Le budget serveur de 1 000 $ par mois et la capacité de 64 à 128 cœurs sont des estimations du fondateur, à valider avec deux devis.
- Les coûts CPU par événement et par requête sont estimés, pas mesurés. Une mesure sous charge (par exemple 500 familles simulées) est nécessaire avant de promettre une capacité.
- La clé restreinte pour intervenants n'existe pas encore ; les agences achètent aujourd'hui un journal de relève et des comptes, pas une séparation cryptographique.
- La récupération de clé perdue n'existe pas encore ; une famille qui perd sa clé perd son dossier. C'est le premier chantier après le pilote.
- Le cycle de vente aux CLSC et aux programmes publics est long ; il ne figure dans aucun calcul de couverture des coûts.
- Un projet de hackathon n'est pas un produit : il manque l'authentification robuste, les sauvegardes testées, la conformité (Loi 25) documentée, l'accessibilité et le support en français et en anglais.

## Summary in English

Free for families, always, with no limit on elders or members; the record must never be a paywall between siblings. Paid by those with a professional need: home-care agencies and care organisations at $300 per elder per year on one invoice (worker accounts, handoff log per visit, alerts to the coordinator, later a scoped worker key). Community organisations can instead sponsor the free Family tier on a yearly package (about $600 for 50 sponsored families); that package is not the professional licence, and a community organisation that wants worker accounts buys the $300 licence like an agency. Support contracts for self-hosting are separate (open source, from about $150 a month per organisation). A voluntary family support option at $3 to $5 a month unlocks non-essential extras only. No advertising, no data resale (impossible, the data is encrypted with a key we do not hold), no security feature behind a payment.

Capacity target: 1 million CPU-hours a year, read as 114 cores busy around the clock (the alternative reading, 1 million hours of family use, is far below it). Target machine: about $1,000 a month all included, founder's estimate to validate with two quotes. Estimated capacity: 19,000 to 150,000 active families, dominated by the 4-second fallback poll; the numbers are estimates until measured under load. Fixed costs before salaries: about $1,600 a month. Break-even, N = C ÷ p, with the $300 annual licence read as $25 a month: the server alone is covered by 40 elders; $5,000 a month (fixed costs plus a first partial salary) by 200 elders. Quebec's EÉSAD network alone serves about 110,000 clients (Réseau de coopération des EÉSAD, 2024). All prices in Canadian dollars, taxes extra, to be validated with five pilot families and two agencies.
