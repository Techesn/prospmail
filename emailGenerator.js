require('dotenv').config(); // Load environment variables
const { OpenAI } = require('openai');
const Groq = require('groq-sdk');
const fs = require('fs'); // Required for future local prompt loading if needed, but not for embedded
const path = require('path'); // Required for future local prompt loading if needed

// --- PROMPT CONFIGURATION ---
// Directly embed the prompt configuration
const promptConfig = {
  "agent_prompt" : "Tu es un assistant spécialisé en prospection B2B pour Top Profil, une société qui accompagne les entreprises dans le recrutement de freelances tech et produit, avec une approche humaine, transparente, et ultra-qualitative.\n\nTu rédiges des séquences de mails personnalisés à destination de prospects (CTO, Head of Product, Head of Tech, etc.), en te basant sur trois éléments :\n- Le titre du poste du prospect\n- La description du poste\n- Le nom de son entreprise\n\nTa mission est de générer une séquence de 7 mails cohérente et engageante, dans un ton **professionnel, direct, chaleureux, humain, et intelligent**, fidèle à l'image de Top Profil. Il faut absolument **éviter le ton commercial stéréotypé, les phrases toutes faites, le blabla corporate**, ou toute forme de prétention.\n\n**Règles de ton (style \"jumeau numérique\")** :\n- Tu vouvoies systématiquement le destinataire.\n- Tu adoptes un ton calme, confiant et empathique, sans insistance agressive.\n- Tu montres que tu connais les enjeux du prospect sans lui donner de leçon.\n- Tu mets en avant la clarté, la simplicité, et l'alignement humain.\n- Tu écris comme une personne vraiment impliquée qui connaît très bien son sujet, et non comme un commercial.\n- Pas de \"j'espère que vous allez bien\" ou d'intros molles. On respecte le temps du lecteur.\n- Tu valorises la transparence (commission fixe de 15%), la pertinence des profils, et la sélection humaine.\n\n**À propos de Top Profil :**\n- On ne fonctionne pas comme une ESN.\n- Pas de catalogue à rallonge.\n- 9 profils sur 10 proposés démarrent une mission.\n- Freelances en produit, design, et tech (Product Manager, UX, UI, Tech Lead, Dév Front / Back / Fullstack).\n- Process simple, rapide, humain.\n- Tous les freelances sont validés en amont, disponibles immédiatement ou rapidement.\n- Tarification transparente : commission fixe de 15%, connue par le freelance ET par l'entreprise.\n\nTu rédiges chaque mail de la séquence selon une trame pré-définie (voir `messages` plus bas), avec des parties personnalisées en fonction du poste, de la description, et du contexte de l'entreprise.\n\nChaque mail doit pouvoir fonctionner indépendamment, mais aussi avoir une logique dans la séquence.\n\nTu écris pour un humain pressé, intelligent, qui a déjà reçu 20 mails d'ESN dans sa boîte aujourd'hui. Tu fais en sorte qu'il lise le tien.\n\nQuand tu fais référence à des profils ou des problèmes, tu adaptes intelligemment au contexte (par exemple : si le poste est orienté data, proposer des profils Data Engineer ou Product Analyst).\n\nEnfin, tu n'écris jamais un mail que **toi-même tu n'aurais pas envie de lire**.",
  "top_profil_description": "Top Profil est une ESN nouvelle génération spécialisée dans la mise en relation entre freelances IT d'excellence et entreprises ayant des besoins complexes.\n\nFondée par deux experts du recrutement tech — dont un ingénieur diplômé de l'INSA — Top Profil propose un sourcing rigoureux et exigeant, combinant expertise technique et évaluation humaine.\n\nChaque freelance que nous présentons est :\n- Préqualifié sur ses compétences métiers,\n- Testé techniquement par nos équipes,\n- Évalué sur ses soft skills et sa capacité d'adaptation au contexte client.\n\nNotre engagement : proposer des profils ultra pertinents en moins de 48 heures, sans jamais céder à la facilité du \"placement par défaut\". Chez Top Profil, **pas d'intercontrat** : nous n'avons aucun intérêt à \"caser\" des profils inadaptés. Chaque mission est construite sur mesure, en fonction du besoin réel du client.\n\nNous pratiquons une commission **fixe et transparente de 15%**, connue de toutes les parties dès le début. Cette transparence absolue fluidifie la collaboration, renforce la confiance, et aligne tous les intérêts.\n\nLe résultat parle de lui-même : **9 profils sur 10 que nous proposons sont retenus** par nos clients.\nParce que moins de friction = plus d'efficacité = des missions plus longues, plus stables, et mieux réussies.\n\nChez Top Profil, nous croyons qu'une mission réussie, c'est avant tout la rencontre entre le bon freelance, le bon projet, et une approche humaine du recrutement.",
  "core_emails": [
    {
      "sujet": "Top Profil : plus agile qu'une ESN, plus fiable qu'un algorithme",
      "contenu": "Bonjour (Prénom du prospect),\n\nChez Top Profil, on place des consultants **freelances IT** ultra-qualifiés pour des missions techniques exigeantes : Cloud, Data, Dev, SecOps, Produit... On travaille uniquement avec le top 5 % du marché freelance. Pas de base de données aléatoire, pas de pression à recaser des profils.\n\nChaque mission est une recherche sur-mesure. Les profils sont évalués techniquement par un ingénieur INSA (moi, en l'occurrence), briefés à fond, prêts à démarrer vite et longtemps.\n\nOn envoie les premiers profils sous 48h. Et dans 9 cas sur 10, ils sont retenus. Le but ? Vous simplifier le recrutement, pas vous faire jouer au puzzle humain.\n\nSi vous bossez encore avec des ESN sans visibilité sur les marges ou les profils, il est peut-être temps de tester autre chose, qu'en pensez-vous ? Quand seriez-vous disponible pour en parler ?.\n\n"
    },
    {
      "sujet": "On a les bons profils pour vous. Littéralement.",
      "contenu": "Bonjour (Prénom du prospect),\n\nVous avez un challenge technique ? On a les **freelances** pour le résoudre. En fait, on a déjà des consultants qualifiés, testés, qui sont disponibles immédiatement pour intervenir dans vos équipes — avec du savoir-faire ET du savoir-être.\n\nOn ne fait pas dans le volume. On ne vous envoie pas 10 CVs. On vous propose 1 à 2 profils pertinents, évalués techniquement (stack, archi, logique) et humainement (communication, culture projet, autonomie).\n\nNotre offre est simple :\n- Présentation de profils sous 48h\n- Suivi mission structuré (on reste là après la signature)\n- Commission fixe de 15 %, transparente pour vous et le freelance\n\nEnvie de voir à quoi ressemble un vrai freelance prêt à embarquer ?\n\n Si vous avez un besoin à court ou moyen terme, c'est le moment pour tester.\n"
    },
    {
      "sujet": "Trop de CVs tue le recrutement (et votre temps).",
      "contenu": "Bonjour (Prénom du prospect),\n\nChez Top Profil, on pense que le vrai service, c'est de **filtrer intelligemment**, pas d'inonder votre boîte mail. Si vous en êtes à votre 35e CV en 4 jours, c'est que le process est cassé.\n\nNous, on fait le tri avant vous :\n- Evaluation technique par un ingénieur\n- Présentation de profils en 48h\n- 9 profils sur 10 validés par nos clients\n\nNos consultants freelances ne sont pas juste « bons techniquement ». Ils sont aussi fiables, engagés, opérationnels et alignés avec votre culture projet.\n\nEn clair : on vous évite le bruit, on vous livre la solution.\n\n Quand seriez-vous disponible pour en parler ?\n"
    },
    {
        "sujet": "Les à priori sur les profils freelances",
        "contenu": "Bonjour (Prénom du prospect),\n\nQuelques faits concrets sur les freelances proposés par Top Profil :\n\n- **Budget maîtrisé** : Le freelancing n'est pas forcément cher, nous adaptons nos profils à vos contraintes budgétaires.\n- **Missions longues** : Contrairement aux idées reçues, la majorité de nos missions dépassent un an. Nos freelances sont aussi stables, voire plus, que certains CDI actuels.\n- **Expertise réelle** : Nos freelances apportent une expertise pointue dans leur domaine, une connaissance approfondie de votre secteur, une capacité d'intégration rapide, et une vision business qui complète parfaitement leur expertise technique.\n\nC'est exactement ce que Top Profil vous propose : des consultants fiables, durables, immédiatement opérationnels, et en totale adéquation avec votre équipe et vos enjeux.\n\nPrêt à découvrir des profils adaptés ? Partagez nous un besoin sur lequel vous avez de vraies difficultés, et on vous propose des solutions."
    },
    {
      "sujet": "15% de commission. Fixe. Transparente. Oui, c'est possible.",
      "contenu": "Bonjour (Prénom du prospect),\n\nChez Top Profil, notre modèle repose sur un truc révolutionnaire : la transparence. On prend une commission fixe de 15 %, partagée et comprise par tout le monde. Le freelance sait ce qu'il touche, vous savez ce que vous payez. Personne ne découvre des lignes bizarres dans un contrat Word.\n\nEt ce n'est pas qu'un détail. C'est ce qui fait qu'on attire les meilleurs freelances, qu'on les garde motivés, et qu'on évite les départs surprises en plein sprint.\n\nEt comme on ne facture pas de frais cachés, vous ne passez pas votre vie à négocier.\n\nSimple. Efficace. Carré.\n Qu'en pensez-vous ?\n"
    },
    {
      "sujet": "2 profils pour vous — sans que vous ayez à demander",
      "contenu": "Bonjour (Prénom du prospect),\n\nJe sais que vous n'avez pas forcément exprimé un besoin. Mais en lisant la description de votre poste chez..., deux consultants freelances de notre réseau m'ont semblé parfaitement alignés :\n\n- Le premier est un expert en... avec une expérience directe dans des contextes similaires au vôtre\n- Le second a bossé sur des architectures proches et a une forte sensibilité produit et communication\n\nTous deux sont disponibles sous deux semaines. Évalués, briefés, motivés. Pas des profils en chasse d'intercontrat. Juste des gens compétents qui attendent une mission sérieuse.\n\nSi vous êtes curieux de voir ce qu'on propose, je vous envoie leurs profils détaillés ?\n\n"
    },
    {
      "sujet": "On boucle la boucle (et on vous laisse tranquille après)",
      "contenu": "Bonjour (Prénom du prospect),\n\nDernier message, promis. Mais je voulais vous résumer ce qu'on fait, en deux lignes :\n\nChez Top Profil, on place des **freelances IT** top niveau sur des missions complexes. On les sélectionne nous-mêmes, techniquement, humainement, et on vous les propose en moins de 48h.\n\nOn ne fait pas du placement de CV. On fait du recrutement engagé, structuré, et suivi.\n- Commission fixe 15 %\n- Zéro intercontrat = zéro profil \"par défaut\"\n- Taux de renouvellement : 95 %\n\nNos clients testent, approuvent, et... restent.\n\nEt vous ?\n"
    }
  ],
  "personalization_prompts": [
  "Utilise les informations du poste pour reformuler l'introduction de façon percutante. Fais immédiatement un lien clair entre l'offre de Top Profil et les problématiques métier du prospect. Si le poste est très technique (ex : Engineering Manager, CTO, Tech Lead), mets l'accent sur notre capacité à sourcer des freelances ultra-techniques, capables de produire et de challenger les architectures. Si le poste est plus fonctionnel (ex : Product Manager, Product Owner, Business Analyst), insiste sur la sélection de freelances capables d'allier compréhension métier et delivery structuré. Toujours éviter les généralités vagues.",
  "Identifie dans le métier du prospect des profils freelances adaptés et présente-les brièvement selon ce modèle précis : Métier - Expérience - Compétences clés. Exemple :\nLF : Développeur fullstack Java / Angular — 8 ans d'expérience\n→ Missions dans des environnements réglementés (Société Générale, BPCE)\nStack : Java 17, Spring Boot, Kafka, Angular 14, NgRx\nExpertise : refacto d'architectures critiques, mise en place de flux sécurisés OAuth2, monitoring Kibana. Très autonome, moteur dans la squad.\nToujours ajouter une ligne personnalisée qui souligne en quoi ce type de freelance correspond particulièrement aux besoins du poste (ex : forte composante data, sensibilité à la sécurité, méthodologie Agile structurée).",
  "Mets en avant la problématique universelle du tri de CV et de la perte de temps qui en découle. Renforce le message avec une anecdote crédible ou une statistique métier liée au secteur du prospect. Exemple : 'Un CTO passe en moyenne 10h à trier 250 CV pour un seul poste ouvert (source interne clients 2023)'. Ou : 'Dans le secteur bancaire, seules 5% des candidatures sont jugées exploitables sans retri manuel (observé chez nos clients en 2023)'. Objectif : souligner que Top Profil élimine cette perte de temps en envoyant uniquement 2-3 freelances prévalidés par mission.",
  "Détaille un ou deux points spécifiques liés au budget ou à la durée des missions freelances (ex : difficulté à contrôler les coûts dans les missions IT, turnover élevé sur les équipes techniques internes). Explique concrètement comment Top Profil répond à ces enjeux : maîtrise des coûts grâce à une adaptation budgétaire transparente, et stabilité des freelances avec des missions longues (plus d'un an en moyenne). Insiste particulièrement sur l'expérience approfondie des freelances dans le secteur du prospect (ex : 'freelance ayant déjà réalisé deux missions longues de plus de 18 mois dans le secteur bancaire, avec une parfaite maîtrise des contraintes réglementaires')",
  "Reformule de manière impactante le paragraphe sur la transparence tarifaire. Mentionne explicitement une douleur récurrente des prospects vis-à-vis des ESN classiques : commissions variables opaques, consultants imposés pour cause d'intercontrat, CV maquillés. Insiste : Top Profil est différent car\n- Commission unique de 15% (fixe, connue de tous)\n- Pas d'intercontrat : uniquement des freelances indépendants\n- CV sincères, sans embellissement forcé.\nObjectif : créer un contraste fort et crédible.",
  "Invente des profils freelances qui correspondent spécifiquement au poste et à la description de poste du prospect. Présente-les de manière claire : Métier - Années d'expérience - Compétences majeures (techniques ou fonctionnelles). Exemples : INITALES (AR par exemple) \n- PM Senior SaaS B2B — 7 ans d'expérience — Expertise : scaling produit, discovery user-centered, pilotage roadmap OKR\n- Tech Lead Node.js / AWS — 9 ans — Stack : Node 20, GraphQL, AWS Lambda, serverless architecture\nReformule le corps du mail pour intégrer ces propositions concrètes, en montrant que nous avons *déjà* les talents disponibles pour aider.",
  "Conclue la séquence avec une phrase d'humour ou d'ironie légère adaptée au secteur du prospect. Elle doit laisser une impression sympathique, même sans réponse immédiate. Exemple pour un SaaS B2B : 'Promis, on ne vous relancera pas avec un bot si vous ignorez ce message.' Pour une boîte dans la finance : 'Chez nous, transparence ne rime pas avec clause cachée en bas du contrat.' Pour une startup : 'On est rapides, mais pas au point de pivoter entre deux mails.'"
  ]
};

const { agent_prompt, top_profil_description, core_emails, personalization_prompts } = promptConfig;

// Initialize Groq
// IMPORTANT: Move this API key to an environment variable like GROQ_API_KEY for security!
const GROQ_API_KEY = process.env.GROQ_API_KEY;
let groq;
try {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set. Please set it before running.");
  }
  groq = new Groq({ apiKey: GROQ_API_KEY });
} catch (err) {
  console.error("Error initializing Groq (check GROQ_API_KEY):", err.message);
  // We'll let functions check if groq is initialized, to avoid crashing if key is temporarily missing
}

const GROQ_MODEL = 'meta-llama/llama-4-maverick-17b-128e-instruct'; // User specified model

async function generateJobDescription(poste, entreprise) {
  if (!groq) {
    console.error("Groq not initialized. Cannot generate job description.");
    return "Description du poste non disponible car Groq n'est pas initialisé.";
  }
  try {
    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: "Tu es un expert RH qui connaît très bien les différents métiers dans le domaine IT et digital." },
        { role: "user", content: `Génère une description professionnelle et réaliste en 5 lignes pour le poste \"${poste}\" dans l'entreprise \"${entreprise}\". Sois précis et technique tout en restant assez généraliste pour que ce soit plausible..\n Donne moi uniquement le texte de la description, sans aucune phrase d'introduction ou de conclusion supplémentaire (par exemple, ne commence pas par "Voici la description du poste :" ou "Voici la description du poste :" ` }
      ]
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error(`Erreur generation description (Groq) pour ${poste} chez ${entreprise}: ${error.message}`);
    return "Description du poste non disponible en raison d'une erreur de génération (Groq).";
  }
}

async function generateSingleEmail(prospectData, coreEmail, personalizationPrompt) {
  if (!groq) {
    console.error("Groq not initialized. Cannot generate email.");
    return { sujet: coreEmail.sujet, contenu: "Contenu de l'email non disponible car Groq n'est pas initialisé." };
  }
  try {
    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: `${agent_prompt} Voici la description de Top Profil : ${top_profil_description}.` },
        {
          role: "user",
          content: `Tu dois générer un email personnalisé pour le prospect suivant. BASE-TOI STRICTEMENT sur les informations fournies ci-dessous et sur le contenu du 'mail core'. N'ajoute AUCUNE information qui n'est pas explicitement mentionnée. L'email généré doit être purement factuel et directement lié au prospect.\n\nInformations prospect :\nPrénom: ${prospectData.prenom}\nNom: ${prospectData.nom}\nPoste: ${prospectData.poste}\nEntreprise: ${prospectData.entreprise}\nDescription du poste: ${prospectData.descriptionPoste}\nEnvironnement Technique & fonctionnel: ${prospectData.technicalSkills && prospectData.technicalSkills.length > 0 ? prospectData.technicalSkills.join(', ') : 'Non spécifié'}\n\nMail core (structure et ton à conserver) :\n${coreEmail.contenu}\n\nConsigne de personnalisation (applique-la en utilisant UNIQUEMENT les informations prospect fournies) :\n${personalizationPrompt}\n\nConsigne : NE METS PAS DE SIGNATURE (pas de Hugo, ou Hugo B Top Profil)\nGénère UNIQUEMENT le contenu final de l'email, sans aucune phrase d'introduction ou de conclusion supplémentaire (par exemple, ne commence pas par "Voici l'email :" \n Consigne : Fait bien attention à la mise en page, l'email doit pouvoir être envoyé directement au prospect. Consigne : Lorsque tu utilise la descritpion du poste du prospect, utilise les formulation : "Je vois que...", "Je pense que...", "Vous devez surement..."`
        }
      ]
    });
    return {
      sujet: coreEmail.sujet,
      contenu: response.choices[0].message.content
    };
  } catch (error) {
    console.error(`Erreur generation email (Groq) pour ${prospectData.prenom} ${prospectData.nom}: ${error.message}`);
    return { sujet: coreEmail.sujet, contenu: "Erreur de génération de l'email (Groq)." };
  }
}

module.exports = {
  generateJobDescription,
  generateSingleEmail,
  core_emails, // Exporting for use in the main script
  personalization_prompts // Exporting for use in the main script
}; 