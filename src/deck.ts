// The starter deck, grouped by topic. New cards are introduced in this order,
// a few a day; a topic's intro is shown before its first card.
//
// Pronunciation hints use CAPS for the stressed syllable. To add a recorded
// clip for a card, drop the file in public/audio/ and set `audio` to its name;
// it will be played instead of the browser's speech voice.

export interface Card {
  id: string;
  /** Tagalog text. */
  tl: string;
  /** English meaning. */
  en: string;
  kind: 'word' | 'phrase';
  /** Pronunciation guide. */
  hint?: string;
  /** A short usage tip shown when the card is introduced. */
  note?: string;
  /**
   * A memory hook: an etymology, sound-alike, literal breakdown or fun fact
   * that gives the learner something to hang the word on. Shown on
   * introduction, after a miss, and on request in review.
   */
  hook: string;
  /** Optional recorded clip in public/audio/. */
  audio?: string;
  /** Other accepted pronunciations, as spelled, for when the learner says the card out loud. */
  accept?: string[];
}

export interface Unit {
  id: string;
  title: string;
  /** Tagalog name for the unit. */
  tlTitle: string;
  /** One or two sentences shown before the unit's first card. */
  intro: string;
  cards: Card[];
}

export const UNITS: Unit[] = [
  {
    id: 'greetings',
    title: 'Greetings',
    tlTitle: 'Pagbati',
    intro: 'Start with the words you will use every single day. Filipinos greet warmly, so these go a long way.',
    cards: [
      { id: 'kumusta', tl: 'Kumusta?', accept: ['Kamusta?'], en: 'How are you? / Hello', kind: 'phrase', hint: 'koo-moos-TAH', note: 'The everyday "hello".', hook: 'From the Spanish "¿cómo está?". Say "como está" fast and it squashes into "kumusta".' },
      { id: 'mabuti', tl: 'Mabuti naman.', en: "I'm fine.", kind: 'phrase', hint: 'mah-BOO-tee nah-MAHN', note: 'The usual answer to "Kumusta?". "Naman" softens it, like "fine, thanks".', hook: '"Buti" (good) is the root, as in "Buti na lang!", "Good thing!". "Naman" just softens it.' },
      { id: 'salamat', tl: 'Salamat', en: 'Thank you', kind: 'word', hint: 'sah-LAH-maht', hook: 'A cousin of Arabic "salaam" (peace), which reached Tagalog through Malay "selamat". Thanking someone is wishing them well.' },
      { id: 'maraming-salamat', tl: 'Maraming salamat', en: 'Thank you very much', kind: 'phrase', hint: 'mah-RAH-ming sah-LAH-maht', hook: '"Marami" (many) + "salamat": literally "many thanks", just like Spanish "muchas gracias".' },
      { id: 'walang-anuman', tl: 'Walang anuman', en: "You're welcome", kind: 'phrase', hint: 'wah-LAHNG ah-noo-MAHN', hook: '"Wala" (none) + "anuman" (anything): "it\'s nothing at all", like Spanish "de nada".' },
      { id: 'magandang-umaga', tl: 'Magandang umaga', en: 'Good morning', kind: 'phrase', hint: 'mah-gahn-DAHNG oo-MAH-gah', hook: '"Maganda" means "beautiful", so it is literally "beautiful morning". You will also hear "Ang ganda!", "How beautiful!".' },
      { id: 'magandang-hapon', tl: 'Magandang hapon', en: 'Good afternoon', kind: 'phrase', hint: 'mah-gahn-DAHNG HAH-pon', hook: 'Fun coincidence: "Hapon" is also the word for Japan, from Spanish "Japón". Picture a sunny afternoon in Japan.' },
      { id: 'magandang-gabi', tl: 'Magandang gabi', en: 'Good evening', kind: 'phrase', hint: 'mah-gahn-DAHNG gah-BEE', hook: 'Stress the end, "gah-BEE", and it means night. Stress the start, "GAH-bee", and it is taro root. Wish people a beautiful night, not a beautiful taro.' },
      { id: 'paalam', tl: 'Paalam', en: 'Goodbye', kind: 'word', hint: 'pah-AH-lahm', note: 'A little formal. Friends often just say "Ingat!" or "Bye!".', hook: 'Built on "alam" (to know). Saying goodbye is letting someone know you are leaving. You will meet "alam" again in "Hindi ko alam".' },
      { id: 'ingat', tl: 'Ingat!', en: 'Take care!', kind: 'word', hint: 'EE-ngaht', hook: 'Short for "Mag-ingat ka!", "Be careful!". Sounds a bit like "in gut": trust your gut and take care.' },
    ],
  },
  {
    id: 'courtesy',
    title: 'Yes, no & politeness',
    tlTitle: 'Paggalang',
    intro: 'Respect is built into Tagalog. Adding "po" to a sentence makes it polite, especially with elders and strangers.',
    cards: [
      { id: 'oo', tl: 'Oo', en: 'Yes', kind: 'word', hint: 'OH-oh', hook: 'Two round O\'s, like a head nodding twice. Not "uh-oh": this one is a happy yes.' },
      { id: 'opo', tl: 'Opo', en: 'Yes (polite)', kind: 'word', hint: 'OH-po', note: 'Use "opo" instead of "oo" with older people or anyone you want to show respect to.', hook: '"Oo" (yes) and "po" (respect) squeezed into one word: o-po.' },
      { id: 'hindi', tl: 'Hindi', en: 'No / not', kind: 'word', hint: 'hin-DEE', hook: 'Spelled like the language of India. Picture shaking your head: "No, not Hindi!"' },
      { id: 'po', tl: 'po', en: '(word that adds respect)', kind: 'word', hint: 'poh', note: 'Drop it into a sentence to be polite: "Salamat po" means "Thank you, sir/ma\'am".', hook: '"Po" is the start of "polite". Tuck it in and you sound respectful.' },
      { id: 'salamat-po', tl: 'Salamat po', en: 'Thank you (polite)', kind: 'phrase', hint: 'sah-LAH-maht poh', hook: '"Salamat" plus "po": the respect word just slots in after, like adding "sir" or "ma\'am".' },
      { id: 'pasensya-na', tl: 'Pasensya na', en: "Sorry / I'm sorry", kind: 'phrase', hint: 'pah-SEN-shah nah', note: 'Used for small apologies, like bumping into someone.', hook: 'From Spanish "paciencia", patience. You are asking them to bear with you.' },
      { id: 'makikiraan-po', tl: 'Makikiraan po', en: 'Excuse me (to pass by)', kind: 'phrase', hint: 'mah-kee-kee-rah-AHN poh', hook: 'Built on "daan" (road, path), with the d softened to r. Roughly "may I share your path?"' },
      { id: 'sige', tl: 'Sige', en: 'Okay / Go ahead', kind: 'word', hint: 'SEE-geh', note: 'Very common. "Sige, salamat!" is a friendly way to end a chat.', hook: 'From Spanish "sigue", "go on, carry on". That is why it means both "okay" and "go ahead".' },
    ],
  },
  {
    id: 'meeting',
    title: 'Meeting people',
    tlTitle: 'Pagpapakilala',
    intro: 'Introduce yourself and get through your first conversation, even if you only understand a little.',
    cards: [
      { id: 'ano-pangalan', tl: 'Ano ang pangalan mo?', en: 'What is your name?', kind: 'phrase', hint: 'ah-NOH ahng pah-NGAH-lahn moh', hook: 'Word for word "what the name your?". "Pangalan" hides an English name inside: pang-ALAN.' },
      { id: 'ako-si', tl: 'Ako si Ana.', en: 'I am Ana.', kind: 'phrase', hint: 'ah-KOH see AH-nah', note: 'Put your own name after "si".', hook: 'Word for word "I, si Ana". Think of "si" as a name tag you pin on: si Ana, si Ben.' },
      { id: 'ikinagagalak', tl: 'Ikinagagalak kitang makilala.', en: 'Nice to meet you.', kind: 'phrase', hint: 'ee-kee-nah-gah-GAH-lahk kee-TAHNG mah-kee-LAH-lah', note: 'A mouthful! Many people simply say "Nice to meet you" in English.', hook: 'Two roots do the work: "galak" (joy) and "kilala" (to know someone). Literally "it gives me joy to get to know you".' },
      { id: 'taga-saan', tl: 'Taga-saan ka?', en: 'Where are you from?', kind: 'phrase', hint: 'tah-gah-sah-AHN kah', hook: '"Taga-" means "from", "saan" means "where": literally "from-where you?"' },
      { id: 'taga-ako', tl: 'Taga-Amerika ako.', en: "I'm from America.", kind: 'phrase', hint: 'tah-gah-ah-MEH-ree-kah ah-KOH', hook: 'The same "taga-" (from) as in "Taga-saan ka?". Answer by swapping "saan" for your country.' },
      { id: 'ingles', tl: 'Marunong ka bang mag-Ingles?', en: 'Can you speak English?', kind: 'phrase', hint: 'mah-ROO-nong kah bahng mahg-ing-GLES', note: '"Ba" (here "bang") turns a sentence into a yes/no question.', hook: '"Marunong" means "knows how". "Mag-Ingles" is "to do English", from Spanish "inglés".' },
      { id: 'kaunti-lang', tl: 'Kaunti lang.', en: 'Just a little.', kind: 'phrase', hint: 'kah-OON-tee lahng', hook: '"Lang" means "just" and turns up everywhere: "sandali lang", "dahan-dahan lang". People often shorten "kaunti" to "konti".' },
      { id: 'hindi-maintindihan', tl: 'Hindi ko maintindihan.', en: "I don't understand.", kind: 'phrase', hint: 'hin-DEE koh mah-in-tin-dee-HAHN', hook: 'The root "intindi" comes from Spanish "entender", to understand. Literally "not I can understand".' },
      { id: 'pakiulit', tl: 'Pakiulit po.', en: 'Please repeat that.', kind: 'phrase', hint: 'pah-kee-OO-lit poh', hook: '"Paki-" (please) + "ulit" (again): literally "please, again". Put "paki-" on any verb to make a polite request.' },
      { id: 'dahan-dahan', tl: 'Dahan-dahan lang po.', en: 'Slowly, please.', kind: 'phrase', hint: 'dah-HAHN dah-HAHN lahng poh', hook: 'Doubling a word stretches it out: "dahan" is slow, "dahan-dahan" is slowly and gently. The word itself takes its time.' },
    ],
  },
  {
    id: 'numbers',
    title: 'Numbers 1–10',
    tlTitle: 'Mga Numero',
    intro: 'Count from one to ten. In shops and markets you will also hear Spanish numbers (uno, dos, tres) for prices and time.',
    cards: [
      { id: 'isa', tl: 'isa', en: 'one (1)', kind: 'word', hint: 'ee-SAH', hook: 'Sounds like "is a": there is a single one.' },
      { id: 'dalawa', tl: 'dalawa', en: 'two (2)', kind: 'word', hint: 'dah-lah-WAH', hook: 'Starts with "d", like duo, dos and deux. Two is a "d" word in many languages.' },
      { id: 'tatlo', tl: 'tatlo', en: 'three (3)', kind: 'word', hint: 'taht-LOH', hook: 'Starts with "t", like three, tres and trois.' },
      { id: 'apat', tl: 'apat', en: 'four (4)', kind: 'word', hint: 'AH-paht', hook: '"A pat, a pat, a pat, a pat": four pats on a dog\'s head.' },
      { id: 'lima', tl: 'lima', en: 'five (5)', kind: 'word', hint: 'lee-MAH', hook: 'Like Lima, the capital of Peru. In the old Austronesian parent language "lima" also meant "hand": five fingers.' },
      { id: 'anim', tl: 'anim', en: 'six (6)', kind: 'word', hint: 'AH-nim', hook: 'Think "anim-al" with six legs: an insect.' },
      { id: 'pito', tl: 'pito', en: 'seven (7)', kind: 'word', hint: 'pee-TOH', hook: '"Pito" is also the Tagalog word for a whistle. Blow the whistle seven times.' },
      { id: 'walo', tl: 'walo', en: 'eight (8)', kind: 'word', hint: 'wah-LOH', hook: 'Rhymes with "halo". An 8 looks like two halos stacked up.' },
      { id: 'siyam', tl: 'siyam', en: 'nine (9)', kind: 'word', hint: 'shahm', note: 'Said quickly as one syllable, "shahm".', hook: 'Sounds like "sham". A 9 is just an upside-down 6, a sham six.' },
      { id: 'sampu', tl: 'sampu', en: 'ten (10)', kind: 'word', hint: 'sahm-POO', hook: 'Sounds like "sum-pu": the sum of all ten fingers.' },
    ],
  },
  {
    id: 'questions',
    title: 'Question words',
    tlTitle: 'Mga Tanong',
    intro: 'Six little words that unlock almost any question.',
    cards: [
      { id: 'ano', tl: 'Ano?', en: 'What?', kind: 'word', hint: 'ah-NOH', hook: '"Ano" is everywhere. Filipinos even use it as a filler word, like "um" or "whatchamacallit".' },
      { id: 'sino', tl: 'Sino?', en: 'Who?', kind: 'word', hint: 'SEE-noh', hook: '"Si" is the name tag from "Ako si Ana", so "si-no" asks for a person: who?' },
      { id: 'saan', tl: 'Saan?', en: 'Where?', kind: 'word', hint: 'sah-AHN', hook: '"Sa" points to a place ("sa bahay", at home), so "sa-an" asks for a place: where? You met it in "Taga-saan ka?".' },
      { id: 'kailan', tl: 'Kailan?', en: 'When?', kind: 'word', hint: 'kah-EE-lahn', hook: 'Think "Kay, land?": when does Kay\'s plane land? It is the time question.' },
      { id: 'bakit', tl: 'Bakit?', en: 'Why?', kind: 'word', hint: 'BAH-kit', hook: 'Sounds like "bucket". Why is there a bucket on your head?' },
      { id: 'paano', tl: 'Paano?', en: 'How?', kind: 'word', hint: 'pah-AH-noh', hook: '"Ano" (what) is hiding inside "pa-ano": by what way? How?' },
      { id: 'ano-ito', tl: 'Ano ito?', en: 'What is this?', kind: 'phrase', hint: 'ah-NOH ee-TOH', hook: '"Ano" (what) + "ito" (this). "Ito" sounds like "it, oh": what is it?' },
      { id: 'magkano', tl: 'Magkano ito?', en: 'How much is this?', kind: 'phrase', hint: 'mahg-KAH-noh ee-TOH', note: 'Your most useful phrase at the market.', hook: 'Fun fact: "Kano" is also slang for an American. Handy to remember when the price suddenly doubles.' },
    ],
  },
  {
    id: 'food',
    title: 'Food & eating',
    tlTitle: 'Pagkain',
    intro: 'Food is at the heart of Filipino life. Expect to be invited to eat, often!',
    cards: [
      { id: 'kain-tayo', tl: 'Kain tayo!', en: "Let's eat!", kind: 'phrase', hint: 'kah-EEN tah-YOH', note: 'A friendly invitation you will hear even from people already eating.', hook: '"Kain" is eat and "tayo" is "all of us". "Tayo" sounds almost like "tayô", to stand: everybody up to the table.' },
      { id: 'gutom-na-ako', tl: 'Gutom na ako.', en: "I'm hungry now.", kind: 'phrase', hint: 'goo-TOM nah ah-KOH', hook: '"Gutom" sounds like "gut \'em": your gut is empty. "Na" means "now, already".' },
      { id: 'masarap', tl: 'Masarap!', en: 'Delicious!', kind: 'word', hint: 'mah-SAH-rahp', hook: '"Sarap" is the root. On its own, "Sarap!" is the happy sigh for anything good, from food to a massage.' },
      { id: 'kanin', tl: 'kanin', en: 'cooked rice', kind: 'word', hint: 'KAH-nin', note: 'Uncooked rice is "bigas". Rice is part of nearly every meal.', hook: 'From "kain" (eat) + "-in": literally "the thing that is eaten". In the Philippines, rice is the food.' },
      { id: 'tubig', tl: 'tubig', en: 'water', kind: 'word', hint: 'TOO-big', hook: 'Sounds like "too big": a glass of water too big to finish.' },
      { id: 'kape', tl: 'kape', en: 'coffee', kind: 'word', hint: 'kah-PEH', hook: 'From Spanish "café". The famously strong local coffee is "kapeng barako".' },
      { id: 'tinapay', tl: 'tinapay', en: 'bread', kind: 'word', hint: 'tee-NAH-pai', hook: 'Think "tin of pie": a loaf baked in a tin.' },
      { id: 'manok', tl: 'manok', en: 'chicken', kind: 'word', hint: 'MAH-nok', hook: 'Sounds like "man, OK". Picture a rooster at dawn yelling "Man, OK, wake up!"' },
      { id: 'isda', tl: 'isda', en: 'fish', kind: 'word', hint: 'is-DAH', hook: 'Sounds like "is da": "Is da fish fresh?"' },
      { id: 'busog-na-ako', tl: 'Busog na ako.', en: "I'm full.", kind: 'phrase', hint: 'boo-SOG nah ah-KOH', note: 'Handy when your host keeps refilling your plate.', hook: '"Busog" sounds like "bus full": no more room on the bus.' },
    ],
  },
  {
    id: 'family',
    title: 'Family & friends',
    tlTitle: 'Pamilya',
    intro: 'Family words are also used as friendly titles: you might call any older woman "Ate" or any older man "Kuya".',
    cards: [
      { id: 'nanay', tl: 'nanay', en: 'mother', kind: 'word', hint: 'NAH-nai', hook: 'Baby-talk word like "mama". Kids shout the short form, "Nay!", and it pairs with "tatay": nanay and tatay.' },
      { id: 'tatay', tl: 'tatay', en: 'father', kind: 'word', hint: 'TAH-tai', hook: 'Rhymes with "nanay". Dad says "ta-ta" as he leaves for work. Kids call him "Tay!".' },
      { id: 'ate', tl: 'Ate', en: 'older sister', kind: 'word', hint: 'AH-teh', note: 'Also a polite way to address a young woman older than you, like a shop assistant.', hook: 'Spelled like English "ate" but said "AH-teh". It comes from Hokkien Chinese "a-chí", older sister.' },
      { id: 'kuya', tl: 'Kuya', en: 'older brother', kind: 'word', hint: 'KOO-yah', note: 'Also used for drivers, guards and other men slightly older than you.', hook: 'From Hokkien Chinese "ko-á", older brother. Chinese traders brought family words that stuck.' },
      { id: 'lola', tl: 'lola', en: 'grandmother', kind: 'word', hint: 'LOH-lah', hook: 'Usually traced to Spanish "abuela". Ends in -a for the woman, like Spanish.' },
      { id: 'lolo', tl: 'lolo', en: 'grandfather', kind: 'word', hint: 'LOH-loh', hook: 'Lola ends in -a like "abuela" (grandma), lolo ends in -o like "abuelo" (grandpa). Same rule as Spanish.' },
      { id: 'anak', tl: 'anak', en: 'child (son or daughter)', kind: 'word', hint: 'ah-NAHK', hook: '"Anak" is also the title of Freddie Aguilar\'s 1978 hit, a song about a parent and child that became famous around the world.' },
      { id: 'kaibigan', tl: 'kaibigan', en: 'friend', kind: 'word', hint: 'kah-ee-BEE-gahn', hook: 'The root is "ibig" (love, want). Ka- + ibig + -an: someone you share fondness with.' },
    ],
  },
  {
    id: 'everyday',
    title: 'Everyday phrases',
    tlTitle: 'Pang-araw-araw',
    intro: 'Short phrases you will hear all the time, from the jeepney to the dinner table.',
    cards: [
      { id: 'tara-na', tl: 'Tara na!', en: "Let's go!", kind: 'phrase', hint: 'TAH-rah nah', hook: 'Often said to be "tayo na" (let\'s go now) squashed together. Or hear it as "ta-ra!", the fanfare as you head out.' },
      { id: 'sandali-lang', tl: 'Sandali lang.', en: 'Just a moment.', kind: 'phrase', hint: 'sahn-dah-LEE lahng', hook: '"Sandali" is a moment, "lang" is just. Think "sand, dally": dallying while the sand runs through the hourglass.' },
      { id: 'nasaan-banyo', tl: 'Nasaan ang banyo?', en: 'Where is the bathroom?', kind: 'phrase', hint: 'nah-sah-AHN ahng BAHN-yoh', note: 'You will also hear "CR" (comfort room) for the toilet.', hook: '"Banyo" comes from Spanish "baño" (bath), and "nasaan" has "saan" (where) inside it.' },
      { id: 'gusto-ko-ito', tl: 'Gusto ko ito.', en: 'I want this. / I like this.', kind: 'phrase', hint: 'GOOS-toh koh ee-TOH', hook: '"Gusto" is Spanish for liking, as in "con mucho gusto". "Gusto ko" is "my liking".' },
      { id: 'ayoko', tl: 'Ayoko.', en: "I don't want to.", kind: 'word', hint: 'ah-YOH-koh', hook: '"Ayaw ko" (I don\'t like) squashed into one word.' },
      { id: 'hindi-ko-alam', tl: 'Hindi ko alam.', en: "I don't know.", kind: 'phrase', hint: 'hin-DEE koh ah-LAHM', hook: '"Hindi" (not) + "ko" (I) + "alam" (know). The same "alam" is inside "paalam".' },
      { id: 'mahal', tl: 'mahal', en: 'expensive / love', kind: 'word', hint: 'mah-HAHL', note: 'Same word for both. "Mahal kita" means "I love you".', hook: 'Works like English "dear": something dear to you, and something dear in price.' },
      { id: 'mura', tl: 'mura', en: 'cheap', kind: 'word', hint: 'moo-RAH', hook: 'Think "moo, rah!": a cow cheering at the bargain bin.' },
      { id: 'mahal-kita', tl: 'Mahal kita.', en: 'I love you.', kind: 'phrase', hint: 'mah-HAHL kee-TAH', hook: '"Mahal" is dear, and "kita" packs "I" and "you" into one tiny word.' },
      { id: 'anong-balita', tl: 'Anong balita?', en: "What's new?", kind: 'phrase', hint: 'ah-NONG bah-LEE-tah', note: 'A casual way to catch up with a friend.', hook: '"Balita" means "news". You will hear it on every Filipino news show.' },
    ],
  },
];

export const ALL_CARDS: Card[] = UNITS.flatMap((u) => u.cards);

const byId = new Map(ALL_CARDS.map((c) => [c.id, c]));

export function getCard(id: string): Card | undefined {
  return byId.get(id);
}

export function unitOf(cardId: string): Unit | undefined {
  return UNITS.find((u) => u.cards.some((c) => c.id === cardId));
}
