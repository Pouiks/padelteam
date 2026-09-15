'use strict';
/**
 * Génère une paire de clés VAPID pour les notifications push.
 * Usage : npm run vapid  → copier les lignes dans .env.local (ou dans les
 * variables d'environnement du projet Vercel).
 */
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log('# À copier dans .env.local ou dans les variables du projet Vercel :');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:vous@exemple.fr');
