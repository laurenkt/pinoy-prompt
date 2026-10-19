// The starter deck. Units are learned in order; each unlocks once every card in
// the previous unit has been introduced.
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
  /** Optional recorded clip in public/audio/. */
  audio?: string;
  /** Other spellings to accept when the learner says the card out loud. */
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
      { id: 'kumusta', tl: 'Kumusta?', accept: ['Kamusta?'], en: 'How are you? / Hello', kind: 'phrase', hint: 'koo-moos-TAH', note: 'The everyday "hello". It comes from the Spanish "¿cómo está?".' },
      { id: 'mabuti', tl: 'Mabuti naman.', en: "I'm fine.", kind: 'phrase', hint: 'mah-BOO-tee nah-MAHN', note: 'The usual answer to "Kumusta?". "Naman" softens it, like "fine, thanks".' },
      { id: 'salamat', tl: 'Salamat', en: 'Thank you', kind: 'word', hint: 'sah-LAH-maht' },
      { id: 'maraming-salamat', tl: 'Maraming salamat', en: 'Thank you very much', kind: 'phrase', hint: 'mah-RAH-ming sah-LAH-maht', note: '"Marami" means "many", so literally "many thanks".' },
      { id: 'walang-anuman', tl: 'Walang anuman', en: "You're welcome", kind: 'phrase', hint: 'wah-LAHNG ah-noo-MAHN', note: 'Literally "it\'s nothing".' },
      { id: 'magandang-umaga', tl: 'Magandang umaga', en: 'Good morning', kind: 'phrase', hint: 'mah-gahn-DAHNG oo-MAH-gah', note: '"Maganda" means "beautiful", so it is literally "beautiful morning".' },
      { id: 'magandang-hapon', tl: 'Magandang hapon', en: 'Good afternoon', kind: 'phrase', hint: 'mah-gahn-DAHNG HAH-pon' },
      { id: 'magandang-gabi', tl: 'Magandang gabi', en: 'Good evening', kind: 'phrase', hint: 'mah-gahn-DAHNG gah-BEE' },
      { id: 'paalam', tl: 'Paalam', en: 'Goodbye', kind: 'word', hint: 'pah-AH-lahm', note: 'A little formal. Friends often just say "Ingat!" or "Bye!".' },
      { id: 'ingat', tl: 'Ingat!', en: 'Take care!', kind: 'word', hint: 'EE-ngaht' },
    ],
  },
  {
    id: 'courtesy',
    title: 'Yes, no & politeness',
    tlTitle: 'Paggalang',
    intro: 'Respect is built into Tagalog. Adding "po" to a sentence makes it polite, especially with elders and strangers.',
    cards: [
      { id: 'oo', tl: 'Oo', en: 'Yes', kind: 'word', hint: 'OH-oh' },
      { id: 'opo', tl: 'Opo', en: 'Yes (polite)', kind: 'word', hint: 'OH-po', note: 'Use "opo" instead of "oo" with older people or anyone you want to show respect to.' },
      { id: 'hindi', tl: 'Hindi', en: 'No / not', kind: 'word', hint: 'hin-DEE' },
      { id: 'po', tl: 'po', en: '(word that adds respect)', kind: 'word', hint: 'poh', note: 'Drop it into a sentence to be polite: "Salamat po" means "Thank you, sir/ma\'am".' },
      { id: 'salamat-po', tl: 'Salamat po', en: 'Thank you (polite)', kind: 'phrase', hint: 'sah-LAH-maht poh' },
      { id: 'pasensya-na', tl: 'Pasensya na', en: "Sorry / I'm sorry", kind: 'phrase', hint: 'pah-SEN-shah nah', note: 'Literally "patience, please". Used for small apologies.' },
      { id: 'makikiraan-po', tl: 'Makikiraan po', en: 'Excuse me (to pass by)', kind: 'phrase', hint: 'mah-kee-kee-rah-AHN poh' },
      { id: 'sige', tl: 'Sige', en: 'Okay / Go ahead', kind: 'word', hint: 'SEE-geh', note: 'Very common. "Sige, salamat!" is a friendly way to end a chat.' },
    ],
  },
  {
    id: 'meeting',
    title: 'Meeting people',
    tlTitle: 'Pagpapakilala',
    intro: 'Introduce yourself and get through your first conversation, even if you only understand a little.',
    cards: [
      { id: 'ano-pangalan', tl: 'Ano ang pangalan mo?', en: 'What is your name?', kind: 'phrase', hint: 'ah-NOH ahng pah-NGAH-lahn moh' },
      { id: 'ako-si', tl: 'Ako si Ana.', en: 'I am Ana.', kind: 'phrase', hint: 'ah-KOH see AH-nah', note: 'Put your own name after "si", which marks a person\'s name.' },
      { id: 'ikinagagalak', tl: 'Ikinagagalak kitang makilala.', en: 'Nice to meet you.', kind: 'phrase', hint: 'ee-kee-nah-gah-GAH-lahk kee-TAHNG mah-kee-LAH-lah', note: 'A mouthful! Many people simply say "Nice to meet you" in English.' },
      { id: 'taga-saan', tl: 'Taga-saan ka?', en: 'Where are you from?', kind: 'phrase', hint: 'tah-gah-sah-AHN kah' },
      { id: 'taga-ako', tl: 'Taga-Amerika ako.', en: "I'm from America.", kind: 'phrase', hint: 'tah-gah-ah-MEH-ree-kah ah-KOH', note: 'Swap in your own country after "taga-".' },
      { id: 'ingles', tl: 'Marunong ka bang mag-Ingles?', en: 'Can you speak English?', kind: 'phrase', hint: 'mah-ROO-nong kah bahng mahg-ing-GLES', note: '"Ba" (here "bang") turns a sentence into a yes/no question.' },
      { id: 'kaunti-lang', tl: 'Kaunti lang.', en: 'Just a little.', kind: 'phrase', hint: 'kah-OON-tee lahng' },
      { id: 'hindi-maintindihan', tl: 'Hindi ko maintindihan.', en: "I don't understand.", kind: 'phrase', hint: 'hin-DEE koh mah-in-tin-dee-HAHN' },
      { id: 'pakiulit', tl: 'Pakiulit po.', en: 'Please repeat that.', kind: 'phrase', hint: 'pah-kee-OO-lit poh', note: '"Paki-" at the start of a word means "please".' },
      { id: 'dahan-dahan', tl: 'Dahan-dahan lang po.', en: 'Slowly, please.', kind: 'phrase', hint: 'dah-HAHN dah-HAHN lahng poh' },
    ],
  },
  {
    id: 'numbers',
    title: 'Numbers 1–10',
    tlTitle: 'Mga Numero',
    intro: 'Count from one to ten. In shops and markets you will also hear Spanish numbers (uno, dos, tres) for prices and time.',
    cards: [
      { id: 'isa', tl: 'isa', en: 'one (1)', kind: 'word', hint: 'ee-SAH' },
      { id: 'dalawa', tl: 'dalawa', en: 'two (2)', kind: 'word', hint: 'dah-lah-WAH' },
      { id: 'tatlo', tl: 'tatlo', en: 'three (3)', kind: 'word', hint: 'taht-LOH' },
      { id: 'apat', tl: 'apat', en: 'four (4)', kind: 'word', hint: 'AH-paht' },
      { id: 'lima', tl: 'lima', en: 'five (5)', kind: 'word', hint: 'lee-MAH' },
      { id: 'anim', tl: 'anim', en: 'six (6)', kind: 'word', hint: 'AH-nim' },
      { id: 'pito', tl: 'pito', en: 'seven (7)', kind: 'word', hint: 'pee-TOH' },
      { id: 'walo', tl: 'walo', en: 'eight (8)', kind: 'word', hint: 'wah-LOH' },
      { id: 'siyam', tl: 'siyam', en: 'nine (9)', kind: 'word', hint: 'shahm', note: 'Said quickly as one syllable, "shahm".' },
      { id: 'sampu', tl: 'sampu', en: 'ten (10)', kind: 'word', hint: 'sahm-POO' },
    ],
  },
  {
    id: 'questions',
    title: 'Question words',
    tlTitle: 'Mga Tanong',
    intro: 'Six little words that unlock almost any question.',
    cards: [
      { id: 'ano', tl: 'Ano?', en: 'What?', kind: 'word', hint: 'ah-NOH' },
      { id: 'sino', tl: 'Sino?', en: 'Who?', kind: 'word', hint: 'SEE-noh' },
      { id: 'saan', tl: 'Saan?', en: 'Where?', kind: 'word', hint: 'sah-AHN' },
      { id: 'kailan', tl: 'Kailan?', en: 'When?', kind: 'word', hint: 'kah-EE-lahn' },
      { id: 'bakit', tl: 'Bakit?', en: 'Why?', kind: 'word', hint: 'BAH-kit' },
      { id: 'paano', tl: 'Paano?', en: 'How?', kind: 'word', hint: 'pah-AH-noh' },
      { id: 'ano-ito', tl: 'Ano ito?', en: 'What is this?', kind: 'phrase', hint: 'ah-NOH ee-TOH' },
      { id: 'magkano', tl: 'Magkano ito?', en: 'How much is this?', kind: 'phrase', hint: 'mahg-KAH-noh ee-TOH', note: 'Your most useful phrase at the market.' },
    ],
  },
  {
    id: 'food',
    title: 'Food & eating',
    tlTitle: 'Pagkain',
    intro: 'Food is at the heart of Filipino life. Expect to be invited to eat, often!',
    cards: [
      { id: 'kain-tayo', tl: 'Kain tayo!', en: "Let's eat!", kind: 'phrase', hint: 'kah-EEN tah-YOH', note: 'A friendly invitation you will hear even from people already eating.' },
      { id: 'gutom-na-ako', tl: 'Gutom na ako.', en: "I'm hungry now.", kind: 'phrase', hint: 'goo-TOM nah ah-KOH' },
      { id: 'masarap', tl: 'Masarap!', en: 'Delicious!', kind: 'word', hint: 'mah-SAH-rahp' },
      { id: 'kanin', tl: 'kanin', en: 'cooked rice', kind: 'word', hint: 'KAH-nin', note: 'Uncooked rice is "bigas". Rice is part of nearly every meal.' },
      { id: 'tubig', tl: 'tubig', en: 'water', kind: 'word', hint: 'TOO-big' },
      { id: 'kape', tl: 'kape', en: 'coffee', kind: 'word', hint: 'kah-PEH' },
      { id: 'tinapay', tl: 'tinapay', en: 'bread', kind: 'word', hint: 'tee-NAH-pai' },
      { id: 'manok', tl: 'manok', en: 'chicken', kind: 'word', hint: 'MAH-nok' },
      { id: 'isda', tl: 'isda', en: 'fish', kind: 'word', hint: 'is-DAH' },
      { id: 'busog-na-ako', tl: 'Busog na ako.', en: "I'm full.", kind: 'phrase', hint: 'boo-SOG nah ah-KOH', note: 'Handy when your host keeps refilling your plate.' },
    ],
  },
  {
    id: 'family',
    title: 'Family & friends',
    tlTitle: 'Pamilya',
    intro: 'Family words are also used as friendly titles: you might call any older woman "Ate" or any older man "Kuya".',
    cards: [
      { id: 'nanay', tl: 'nanay', en: 'mother', kind: 'word', hint: 'NAH-nai' },
      { id: 'tatay', tl: 'tatay', en: 'father', kind: 'word', hint: 'TAH-tai' },
      { id: 'ate', tl: 'Ate', en: 'older sister', kind: 'word', hint: 'AH-teh', note: 'Also a polite way to address a young woman older than you, like a shop assistant.' },
      { id: 'kuya', tl: 'Kuya', en: 'older brother', kind: 'word', hint: 'KOO-yah', note: 'Also used for drivers, guards and other men slightly older than you.' },
      { id: 'lola', tl: 'lola', en: 'grandmother', kind: 'word', hint: 'LOH-lah' },
      { id: 'lolo', tl: 'lolo', en: 'grandfather', kind: 'word', hint: 'LOH-loh' },
      { id: 'anak', tl: 'anak', en: 'child (son or daughter)', kind: 'word', hint: 'ah-NAHK' },
      { id: 'kaibigan', tl: 'kaibigan', en: 'friend', kind: 'word', hint: 'kah-ee-BEE-gahn' },
    ],
  },
  {
    id: 'everyday',
    title: 'Everyday phrases',
    tlTitle: 'Pang-araw-araw',
    intro: 'Short phrases you will hear all the time, from the jeepney to the dinner table.',
    cards: [
      { id: 'tara-na', tl: 'Tara na!', en: "Let's go!", kind: 'phrase', hint: 'TAH-rah nah' },
      { id: 'sandali-lang', tl: 'Sandali lang.', en: 'Just a moment.', kind: 'phrase', hint: 'sahn-dah-LEE lahng' },
      { id: 'nasaan-banyo', tl: 'Nasaan ang banyo?', en: 'Where is the bathroom?', kind: 'phrase', hint: 'nah-sah-AHN ahng BAHN-yoh', note: 'You will also hear "CR" (comfort room) for the toilet.' },
      { id: 'gusto-ko-ito', tl: 'Gusto ko ito.', en: 'I want this. / I like this.', kind: 'phrase', hint: 'GOOS-toh koh ee-TOH' },
      { id: 'ayoko', tl: 'Ayoko.', en: "I don't want to.", kind: 'word', hint: 'ah-YOH-koh' },
      { id: 'hindi-ko-alam', tl: 'Hindi ko alam.', en: "I don't know.", kind: 'phrase', hint: 'hin-DEE koh ah-LAHM' },
      { id: 'mahal', tl: 'mahal', en: 'expensive / love', kind: 'word', hint: 'mah-HAHL', note: 'Same word for both. "Mahal kita" means "I love you".' },
      { id: 'mura', tl: 'mura', en: 'cheap', kind: 'word', hint: 'moo-RAH' },
      { id: 'mahal-kita', tl: 'Mahal kita.', en: 'I love you.', kind: 'phrase', hint: 'mah-HAHL kee-TAH' },
      { id: 'anong-balita', tl: 'Anong balita?', en: "What's new?", kind: 'phrase', hint: 'ah-NONG bah-LEE-tah', note: 'A casual way to catch up with a friend.' },
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
