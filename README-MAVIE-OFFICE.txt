MISE À JOUR DU SITE — SUITE HORIZON ET HAVRE

Suite Horizon est une première suite bureautique accessible depuis le site :
  https://mavie7620.duckdns.org/office

Elle permet de créer et modifier des documents texte, des présentations et des
tableurs. La barre de rédaction offre titres, polices, tailles, couleurs,
surlignage, listes, alignements, tableaux, images, liens, recherche, comptage
des mots et annulation. L’import/export Word conserve les titres, le gras,
l’italique, le soulignement, le barré et les couleurs de texte et de surlignage.
L’historique conserve jusqu’à 20 versions de chaque
document, avec restauration. Les documents de compte s’enregistrent en ligne.
Les formats bureautiques DOCX, PPTX et XLSX sont importés et exportés. CSV,
HTML et texte simple sont également pris en charge selon le type de document.

HAVRE — ESPACE PERSONNEL DE FICHIERS
  https://mavie7620.duckdns.org/cloud

Les comptes peuvent déposer tout type de fichier, créer des dossiers, télécharger,
renommer et restaurer jusqu’à 10 versions d’un même fichier. Les suppressions
vont d’abord dans la corbeille, puis peuvent être purgées définitivement. Envoi
par flux jusqu’à 10 Go par fichier. Quota par compte : 50 Go. Les sauvegardes
de versions restent sous `data/cloud/accounts` sur le disque du PC serveur et consomment le quota lorsqu’elles
contiennent des données différentes. Elles protègent contre un remplacement ou
une suppression accidentelle; elles ne remplacent pas une copie sur un autre disque.

SÉPARATION DU SERVEUR DU SITE ET DE HARBOR LAUNCHER
Le serveur du launcher reste dédié au catalogue et aux téléchargements de modpacks :
  http://adresse-du-serveur:8787
Le site, les comptes, Havre, Suite Horizon et les outils d’administration tournent
dans un second processus local sur le port 8788. Caddy publie uniquement le site
en HTTPS et redirige vers ce port. Les deux processus utilisent le même dossier
de données afin de garder les comptes, fichiers et modpacks déjà présents.

INSTALLATION SUR LE PC SERVEUR
1. Arrête les fenêtres de serveur Node qui tournent déjà. Pour la première installation, arrête serveur.js; si site-serveur.js existe déjà, arrête aussi sa fenêtre. Ne ferme pas Caddy.
2. Décompresse tout le dossier du paquet sur le PC serveur.
3. Double-clique sur installer-mavie-office.bat. (Ce paquet ajoute le processus du site et sépare ses routes de Harbor Launcher; il ne remplace pas serveur.js.)
4. Saisis le chemin du dossier qui contient serveur.js (et appuie sur Entrée).
5. Une fois la mise à jour installée, relance activer-https.bat. Il démarre les deux processus si nécessaire et met à jour Caddy pour publier le site depuis le port 8788 et les routes du launcher depuis le port 8787. Garde Caddy ouvert.
6. Pour les prochains démarrages, double-clique sur demarrer-services.bat. Il lance séparément Harbor Launcher (8787) et le site (8788), sans ouvrir ni fermer Caddy. Tu peux aussi utiliser lancer-serveur.bat et lancer-site.bat pour gérer chaque service séparément.

Le programme est installé dans runtime/ : certains lecteurs FAT ne permettent pas à Node.js de résoudre les imports entre fichiers lorsqu’ils sont placés directement à la racine. config.json et data/ restent à la racine pour conserver les réglages et les comptes.

Le script crée d'abord une sauvegarde datée dans le dossier du serveur. Il
conserve les autres paramètres de config.json et active la confiance envers
les en-têtes HTTPS reçus uniquement du proxy local Caddy. Il ne copie pas de comptes, mots de passe, sessions,
modpacks ou autres données privées. Les textes enregistrés du site sont
conservés, avec uniquement les informations Algérie et contact MAVIE7620
actualisées. Laisse Caddy démarré.

Si quelque chose se passe mal, les fichiers antérieurs sont dans le dossier
sauvegarde-office-... créé par le script. Ne supprime pas ce dossier avant
d'avoir confirmé que le site fonctionne.

LIMITES DE CETTE PREMIÈRE VERSION
Ce projet est codé séparément et n'est pas Microsoft Office. Les documents
DOCX/PPTX/XLSX courants peuvent être échangés, mais les fonctions complexes,
macros, commentaires, effets avancés et mise en page exacte ne sont pas
garantis. Les brouillons locaux restent sur l'appareil; la sauvegarde en ligne
nécessite une session HTTPS. La récupération par courriel n’est pas configurée.
