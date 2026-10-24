// The starter deck, grouped by topic. New cards are introduced a few a day in
// LEARN_ORDER, most useful first, whatever their topic; a topic's intro is
// shown before the first of its cards a learner meets. Cards that aren't
// vocabulary (sentence patterns, sounds, intonation, know-how) live in
// guides.ts and share the same order and schedule.
//
// Pronunciation hints use CAPS for the stressed syllable, and "gh" for a g
// before e or i ("ghee"), as English reads "gee" like "jee". To add a recorded
// clip for a card, drop the file in public/audio/ and set `audio` to its name;
// it will be played instead of the browser's speech voice.

import { GUIDES } from './guides';

/**
 * What a card teaches. Words and phrases are vocabulary; the rest are guides:
 * a sentence pattern, a sound, how to say something (intonation and tone), or
 * everyday know-how.
 */
export type CardKind = 'word' | 'phrase' | 'pattern' | 'sound' | 'tune' | 'knowhow';

export interface Card {
  id: string;
  /** Tagalog text. For a guide, a short Tagalog example or frame ("___" marks a gap). */
  tl: string;
  /** English meaning. For a guide, its plain-English name. */
  en: string;
  kind: CardKind;
  /** Pronunciation guide. */
  hint?: string;
  /** A short usage tip shown when the card is introduced. For a guide, the plain-English explanation. */
  note?: string;
  /**
   * A memory hook: an etymology, sound-alike, literal breakdown or fun fact
   * that gives the learner something to hang the word on. Shown on
   * introduction, after a miss, and on request in review.
   */
  hook: string;
  /** What the speech voice reads instead of `tl`, when the spelling would mislead it. */
  say?: string;
  /** Other accepted pronunciations, as spelled, for when the learner says the card out loud. */
  accept?: string[];
  /** Guides only: examples, each tappable to hear, built from cards met earlier where possible. */
  examples?: Example[];
  /** Guides only: cards that must be met, and have lasted a day, before this one is introduced. */
  needs?: string[];
  /** Guides only: the questions it is checked with. One is picked each time, so a pattern is practised in fresh sentences. */
  drills?: Drill[];
}

export interface Example {
  tl: string;
  en: string;
}

/**
 * One question for a guide: pick `answer` over `wrong`. With `tl`, the answer
 * fills its "___" gap and the whole sentence can also be built from tiles.
 */
export interface Drill {
  /** What is asked. For a sentence, its English meaning. */
  q: string;
  /** Tagalog with a "___" gap for the answer. */
  tl?: string;
  answer: string;
  wrong: string[];
  /** Cards the drill uses; drills whose cards are all met are preferred. */
  uses?: string[];
}

/** Vocabulary, as opposed to a guide. */
export function isVocab(card: Card): boolean {
  return card.kind === 'word' || card.kind === 'phrase';
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
      { id: 'kumusta', tl: 'Kumusta?', accept: ['Kamusta?', 'Musta?'], en: 'How are you? / Hello', kind: 'phrase', hint: 'koo-moos-TAH', note: 'Friends shorten it to "Musta?", and after time apart ask "Kumusta ka na?", how have you been? For a quick hello in passing, "Uy!" or just "Hi!" is more usual.', hook: 'From the Spanish "¿cómo está?". Say "como está" fast and it squashes into "kumusta".' },
      { id: 'mabuti', tl: 'Mabuti naman.', en: "I'm fine.", kind: 'phrase', hint: 'mah-BOO-tee nah-MAHN', note: 'A polite answer to "Kumusta?", nice with elders. Between friends, "Okay lang!" or "Ayos lang!" is more usual. "Naman" softens it, like "fine, thanks".', hook: '"Buti" (good) is the root, as in "Buti na lang!", "Good thing!". "Naman" just softens it.' },
      { id: 'salamat', tl: 'Salamat', en: 'Thank you', kind: 'word', hint: 'sah-LAH-maht', hook: 'A cousin of Arabic "salaam" (peace), which reached Tagalog through Malay "selamat". Thanking someone is wishing them well.' },
      { id: 'maraming-salamat', tl: 'Maraming salamat', en: 'Thank you very much', kind: 'phrase', hint: 'mah-RAH-ming sah-LAH-maht', hook: '"Marami" (many) + "salamat": literally "many thanks", just like Spanish "muchas gracias".' },
      { id: 'walang-anuman', tl: 'Walang anuman', en: "You're welcome", kind: 'phrase', hint: 'wah-LAHNG ah-noo-MAHN', note: 'Polite, and right anywhere, like a shop. Between friends, "Wala \'yon!" (it was nothing) is more usual.', hook: '"Wala" (none) + "anuman" (anything): "it\'s nothing at all", like Spanish "de nada".' },
      { id: 'wala-yon', tl: "Wala 'yon.", accept: ['Wala iyon.', 'Wala yun.'], en: 'No worries. / It was nothing.', kind: 'phrase', hint: 'wah-LAH yon', note: 'What friends say back to "Salamat!". Often said "Wala \'yun".', hook: '"Wala" (nothing) + "\'yon", short for "iyon" (that): "that was nothing".' },
      { id: 'magandang-umaga', tl: 'Magandang umaga', en: 'Good morning', kind: 'phrase', hint: 'mah-gahn-DAHNG oo-MAH-gah', note: 'Day to day, most people just say "Good morning!" in English, with "po" for elders: "Good morning po!". "Magandang umaga" is warmer and a bit more formal, for elders, a speech or the radio.', hook: '"Maganda" means "beautiful", so it is literally "beautiful morning". You will also hear "Ang ganda!", "How beautiful!".' },
      { id: 'magandang-hapon', tl: 'Magandang hapon', en: 'Good afternoon', kind: 'phrase', hint: 'mah-gahn-DAHNG HAH-pon', note: 'Like "Magandang umaga", often just said in English: "Good afternoon po!".', hook: 'Fun coincidence: "Hapon" is also the word for Japan, from Spanish "Japón". Picture a sunny afternoon in Japan.' },
      { id: 'magandang-gabi', tl: 'Magandang gabi', en: 'Good evening', kind: 'phrase', hint: 'mah-gahn-DAHNG gah-BEE', note: 'Like "Magandang umaga", often just said in English: "Good evening po!".', hook: 'Stress the end, "gah-BEE", and it means night. Stress the start, "GAH-bee", and it is taro root. Wish people a beautiful night, not a beautiful taro.' },
      { id: 'paalam', tl: 'Paalam', en: 'Goodbye', kind: 'word', hint: 'pah-AH-lahm', note: 'A big, heartfelt goodbye, for when you won\'t meet again for a long time (and in songs). Day to day, people say "Sige!", "Bye!" or "Ingat!".', hook: 'Built on "alam" (to know). Saying goodbye is letting someone know you are leaving. You will meet "alam" again in "Hindi ko alam".' },
      { id: 'ingat', tl: 'Ingat!', en: 'Take care!', kind: 'word', hint: 'EE-ngaht', note: 'The everyday goodbye, often as "Sige, ingat!", okay, take care!', hook: 'Short for "Mag-ingat ka!", "Be careful!". Sounds a bit like "in gut": trust your gut and take care.' },
      { id: 'uy', tl: 'Uy!', accept: ['Oy!'], en: 'Hey! / Hi!', kind: 'word', hint: 'OOY', note: 'How you greet a friend you bump into, often followed by "Musta?". It also catches someone\'s attention: "Uy, tingnan mo!", hey, look!', hook: 'Sounds just like a British "oi!", and works the same way, only friendlier.' },
      { id: 'ikaw-pala', tl: 'Ikaw pala!', en: "Oh, it's you!", kind: 'phrase', hint: 'ee-KAW pah-LAH', note: 'When you spot someone you know. "Pala" adds a little surprise, something you\'ve just realised.', hook: '"Pala" is the light-bulb word: "oh, so it\'s you!". You\'ll hear it all the time: "Ganun pala!", oh, so that\'s how it is!' },
      { id: 'saan-ka-galing', tl: 'Saan ka galing?', accept: ['San ka galing?'], en: 'Where have you been?', kind: 'phrase', hint: 'sah-AHN kah GAH-ling', note: 'A friendly hello as much as a question, so nobody expects a full answer. Said fast, it\'s "San ka galing?".', hook: '"Galing" means "came from". The same "saan ka" as "Saan ka pupunta?", where are you going, which is a greeting too.' },
      { id: 'diyan-lang', tl: 'Diyan lang.', accept: ['Dyan lang.'], en: 'Just over there. / Nowhere special.', kind: 'phrase', hint: 'dyahn lahng', note: 'The easy answer to "Saan ka galing?" or "Saan ka pupunta?" when there\'s nothing to tell.', hook: '"Diyan" (there) + "lang" (just): "just there". Vague on purpose, and that\'s fine.' },
      { id: 'mauna-na-ako', tl: 'Mauna na ako.', accept: ['Una na ako.', "Una na 'ko."], en: "I'll head off first.", kind: 'phrase', hint: 'mah-OO-nah nah ah-KOH', note: 'The polite way to leave before everyone else, at work or with friends. Said fast, it\'s "Una na \'ko!".', hook: '"Una" means first, as in "Ikaw muna", you first. You\'re the first to go.' },
      { id: 'anong-meron', tl: 'Anong meron?', accept: ['Anong mayroon?'], en: "What's going on?", kind: 'phrase', hint: 'ah-NONG MEH-ron', note: 'Asked when something\'s up: a crowd, a party, a friend dressed up. Also a casual "what\'s up?".', hook: '"Ano" (what) + "meron" (there is), the "Meron" that answers "May kape ba?": "what is there?"' },
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
      { id: 'pasensya-na', tl: 'Pasensya na', en: "Sorry / I'm sorry", kind: 'phrase', hint: 'pah-SEN-shah nah', note: 'Used for small apologies, like bumping into someone. A plain "Sorry!" in English is just as common.', hook: 'From Spanish "paciencia", patience. You are asking them to bear with you.' },
      { id: 'makikiraan-po', tl: 'Makikiraan po', en: 'Excuse me (to pass by)', kind: 'phrase', hint: 'mah-kee-kee-rah-AHN poh', hook: 'Built on "daan" (road, path), with the d softened to r. Roughly "may I share your path?"' },
      { id: 'sige', tl: 'Sige', en: 'Okay / Go ahead', kind: 'word', hint: 'SEE-gheh', note: 'Very common. "Sige, salamat!" is a friendly way to end a chat.', hook: 'From Spanish "sigue", "go on, carry on". That is why it means both "okay" and "go ahead".' },
      { id: 'tuloy-po-kayo', tl: 'Tuloy po kayo.', en: 'Come in, please.', kind: 'phrase', hint: 'too-LOY poh kah-YOH', note: 'What a host says at the door, often to answer "Tao po!".', hook: '"Tuloy" means carry on, as in "Tuloy ba tayo?": carry on in, you (polite).' },
      { id: 'tao-po', tl: 'Tao po!', en: 'Hello, anyone home?', kind: 'phrase', hint: 'tah-OH poh', note: 'Called out at someone\'s gate or door, as many homes have no doorbell.', hook: '"Tao" means person: "a person is here, po!". You\'re announcing yourself.' },
    ],
  },
  {
    id: 'meeting',
    title: 'Meeting people',
    tlTitle: 'Pagpapakilala',
    intro: 'Introduce yourself and get through your first conversation, even if you only understand a little.',
    cards: [
      { id: 'ano-pangalan', tl: 'Anong pangalan mo?', accept: ['Ano ang pangalan mo?'], en: 'What is your name?', kind: 'phrase', hint: 'ah-NONG pah-NGAH-lahn moh', hook: '"Anong" is "ano ang" (what the) squeezed together, which is how everyone says it: "what the name your?". "Pangalan" hides an English name inside: pang-ALAN.' },
      { id: 'ako-si', tl: 'Ako si Ana.', en: 'I am Ana.', kind: 'phrase', hint: 'ah-KOH see AH-nah', note: 'Put your own name after "si".', hook: 'Word for word "I, si Ana". Think of "si" as a name tag you pin on: si Ana, si Ben.' },
      { id: 'ikinagagalak', tl: 'Ikinagagalak kitang makilala.', en: 'Nice to meet you. (formal)', kind: 'phrase', hint: 'ee-kee-nah-gah-GAH-lahk kee-TAHNG mah-kee-LAH-lah', note: 'For a speech or a letter. Face to face, Filipinos nearly always just say "Nice to meet you!" in English, so it\'s here to recognise more than to say.', hook: 'Two roots do the work: "galak" (joy) and "kilala" (to know someone). Literally "it gives me joy to get to know you".' },
      { id: 'taga-saan', tl: 'Taga-saan ka?', en: 'Where are you from?', kind: 'phrase', hint: 'tah-gah-sah-AHN kah', hook: '"Taga-" means "from", "saan" means "where": literally "from-where you?"' },
      { id: 'taga-ako', tl: 'Taga-Amerika ako.', en: "I'm from America.", kind: 'phrase', hint: 'tah-gah-ah-MEH-ree-kah ah-KOH', hook: 'The same "taga-" (from) as in "Taga-saan ka?". Answer by swapping "saan" for your country.' },
      { id: 'ingles', tl: 'Marunong ka bang mag-English?', accept: ['Marunong ka bang mag-Ingles?', 'Marunong ka bang mag-Inglis?'], en: 'Can you speak English?', kind: 'phrase', hint: 'mah-ROO-nong kah bahng mahg-ING-glish', note: '"Ba" (here "bang") turns a sentence into a yes/no question. Most people say "English" for the language; "Ingles" is the more formal word.', hook: '"Marunong" means "knows how". "Mag-English" is "to do English": put "mag-" on almost anything and it becomes a verb.' },
      { id: 'kaunti-lang', tl: 'Konti lang.', accept: ['Kaunti lang.'], en: 'Just a little.', kind: 'phrase', hint: 'KON-tee lahng', note: '"Konti" is how everyone says "kaunti" (a little), which you\'ll see written.', hook: '"Lang" means "just" and turns up everywhere: "sandali lang", "dahan-dahan lang".' },
      { id: 'hindi-maintindihan', tl: 'Hindi ko maintindihan.', en: "I don't understand.", kind: 'phrase', hint: 'hin-DEE koh mah-in-tin-dee-HAHN', note: 'Friends also say "Di ko gets", Taglish for "I don\'t get it".', hook: 'The root "intindi" comes from Spanish "entender", to understand. Literally "not I can understand".' },
      { id: 'pakiulit', tl: 'Pakiulit po.', en: 'Please repeat that.', kind: 'phrase', hint: 'pah-kee-OO-lit poh', hook: '"Paki-" (please) + "ulit" (again): literally "please, again". Put "paki-" on any verb to make a polite request.' },
      { id: 'dahan-dahan', tl: 'Dahan-dahan lang po.', en: 'Slowly, please.', kind: 'phrase', hint: 'dah-HAHN dah-HAHN lahng poh', hook: 'Doubling a word stretches it out: "dahan" is slow, "dahan-dahan" is slowly and gently. The word itself takes its time.' },
      { id: 'saan-ka-nakatira', tl: 'Saan ka nakatira?', en: 'Where do you live?', kind: 'phrase', hint: 'sah-AHN kah nah-kah-tee-RAH', hook: '"Tira" means stay or live, and "naka-" means being that way: where, you, living?' },
      { id: 'ano-trabaho-mo', tl: 'Anong trabaho mo?', accept: ['Ano ang trabaho mo?'], en: 'What do you do for work?', kind: 'phrase', hint: 'ah-NONG trah-BAH-hoh moh', hook: 'The same shape as "Anong pangalan mo?", with "trabaho", from Spanish "trabajo", work.' },
      { id: 'ilang-taon-ka-na', tl: 'Ilang taon ka na?', en: 'How old are you?', kind: 'phrase', hint: 'ee-LAHNG tah-ON kah nah', note: 'Not a rude question here: it tells people whether to call you Ate or Kuya.', hook: '"Ilan" (how many) + "taon" (year) + "na" (already): how many years already, you?' },
      { id: 'may-asawa-ka-na-ba', tl: 'May asawa ka na ba?', en: 'Are you married?', kind: 'phrase', hint: 'mai ah-SAH-wah kah nah bah', note: 'A friendly question, often asked soon after meeting. "Wala pa" (not yet) is a fine answer.', hook: '"May" (have) + "asawa" (spouse) + "na ba" (already?): have a spouse already, you?' },
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
      { id: 'nasaan', tl: 'Nasaan?', en: 'Where is it?', kind: 'word', hint: 'nah-sah-AHN', note: '"Saan" asks where to or where from; "nasaan" asks where someone or something is right now. Put the thing after it: "Nasaan ang ...?".', hook: '"Na" (at) + "saan" (where): where-at? Its answers are "dito" (here), "diyan" (there by you) and "doon" (over there).' },
      { id: 'gaano', tl: 'Gaano?', en: 'How (long, far, big)?', kind: 'word', hint: 'gah-AH-noh', note: 'It comes before a describing word with "ka-": "gaano katagal?", how long; "gaano kalayo?", how far.', hook: '"Paano" asks how, by what way; "gaano" asks how much of something. They differ by one letter.' },
      { id: 'ano-ito', tl: 'Ano ito?', en: 'What is this?', kind: 'phrase', hint: 'ah-NOH ee-TOH', hook: '"Ano" (what) + "ito" (this). "Ito" sounds like "it, oh": what is it?' },
      { id: 'magkano', tl: 'Magkano ito?', en: 'How much is this?', kind: 'phrase', hint: 'mahg-KAH-noh ee-TOH', note: 'Your most useful phrase at the market.', hook: 'Fun fact: "Kano" is also slang for an American. Handy to remember when the price suddenly doubles.' },
    ],
  },
  {
    id: 'asking',
    title: 'Asking more',
    tlTitle: 'Pagtatanong',
    intro: 'More questions for getting around: where someone is, where they are going, how many, which one, how long.',
    cards: [
      { id: 'nasaan-ka', tl: 'Nasaan ka?', en: 'Where are you?', kind: 'phrase', hint: 'nah-sah-AHN kah', hook: '"Nasaan" (where is) + "ka" (you): where are you right now? The text you send when someone is late.' },
      { id: 'saan-ka-pupunta', tl: 'Saan ka pupunta?', en: 'Where are you going?', kind: 'phrase', hint: 'sah-AHN kah poo-POON-tah', note: 'Also a friendly greeting in passing. "Diyan lang" ("just over there") is a fine vague answer.', hook: '"Punta" (go to) is from Spanish "punta", a point: the point you are heading for. Doubling the first syllable, pu-punta, makes it "will go".' },
      { id: 'ilan', tl: 'Ilan?', en: 'How many?', kind: 'word', hint: 'ee-LAHN', hook: '"Ilan" counts things; "magkano" counts money. "Ilan kayo?" is what a waiter asks at the door: how many of you?' },
      { id: 'alin', tl: 'Alin?', en: 'Which one?', kind: 'word', hint: 'ah-LIN', hook: 'Sounds like "a line": which one in the line? "Alin dito?" means "which of these?"' },
      { id: 'kanino', tl: 'Kanino ito?', en: 'Whose is this?', kind: 'phrase', hint: 'kah-NEE-noh ee-TOH', hook: '"Sino" is who, and "kanino" is its "whose, to whom" form. The "-no" ending ties the two together.' },
      { id: 'gaano-katagal', tl: 'Gaano katagal?', en: 'How long does it take?', kind: 'phrase', hint: 'gah-AH-noh kah-tah-GAHL', hook: '"Gaano" (how much) + "katagal" (long, from "tagal", a long while): how much long?' },
      { id: 'gaano-kalayo', tl: 'Gaano kalayo?', en: 'How far is it?', kind: 'phrase', hint: 'gah-AH-noh kah-LAH-yoh', hook: '"Layo" is distance, as in "malayo" (far). Same "gaano ka-" pattern as "Gaano katagal?".' },
      { id: 'anong-ginagawa-mo', tl: 'Anong ginagawa mo?', en: 'What are you doing?', kind: 'phrase', hint: 'ah-NONG ghee-nah-GAH-wah moh', hook: '"Gawa" means do or make. In "gi-na-gawa" the doubled "ga" marks it as happening right now.' },
      { id: 'para-saan', tl: 'Para saan ito?', en: 'What is this for?', kind: 'phrase', hint: 'PAH-rah sah-AHN ee-TOH', hook: '"Para" is Spanish for "for", so "para saan" is literally "for where?", meaning "for what purpose?".' },
      { id: 'ano-ibig-sabihin', tl: 'Anong ibig sabihin nito?', accept: ['Ano ang ibig sabihin nito?'], en: 'What does this mean?', kind: 'phrase', hint: 'ah-NONG EE-big sah-bee-HIN nee-TOH', hook: '"Ibig" is want, and "sabihin" (to say) you know: "what does it want to say?", just like French "qu\'est-ce que ça veut dire?".' },
      { id: 'sabihin', tl: 'sabihin', en: 'to say', kind: 'word', hint: 'sah-bee-HIN', note: 'Mostly heard in questions about words: "Paano sabihin ...?", how do you say ...?', hook: '"Sabi" is what someone said: "sabi ko", I said. Add "-hin" and it\'s to say it.' },
      { id: 'paano-sabihin', tl: 'Paano sabihin ito sa Tagalog?', en: 'How do you say this in Tagalog?', kind: 'phrase', hint: 'pah-AH-noh sah-bee-HIN ee-TOH sah tah-GAH-log', hook: '"Paano" (how) + "sabihin" (to say) + "ito" (this) + "sa Tagalog" (in Tagalog). Point at anything and ask: the most useful learning question there is.' },
      { id: 'okay-lang-ba', tl: 'Okay lang ba?', en: 'Is that okay?', kind: 'phrase', hint: 'oh-KAY lahng bah', hook: '"Ba" turns a sentence into a question: "Okay lang" (it\'s fine) becomes "Okay lang ba?" (is it fine?).' },
    ],
  },
  {
    id: 'basics',
    title: 'Building blocks',
    tlTitle: 'Pundasyon',
    intro: 'A handful of words that build hundreds of sentences: I, you, my, your, this, the, already, just. They turn up in almost every phrase, so knowing them makes each new phrase one new word instead of four. Then: there is, there isn\'t, I need, can I.',
    cards: [
      { id: 'ako', tl: 'ako', en: 'I / me', kind: 'word', hint: 'ah-KOH', hook: 'Introduce yourself with "Ako si ___", I am ___. In a sentence it often comes last: "Gutom na ako", hungry already, me.' },
      { id: 'ikaw', tl: 'ikaw', en: 'you', kind: 'word', hint: 'ee-KAOW', note: 'After another word it usually shrinks to "ka": "Taga-saan ka?".', hook: '"Ikaw?" on its own is the bounce-back: "Mabuti naman. Ikaw?", "Fine. And you?"' },
      { id: 'ka', tl: 'ka', en: 'you (after a word)', kind: 'word', hint: 'kah', note: 'The short "ikaw". It never starts a sentence.', hook: '"Ikaw" shrunk to fit after another word: "Taga-saan ka?", from where, you?' },
      { id: 'ko', tl: 'ko', en: 'my', kind: 'word', hint: 'koh', note: 'After a doing word it means "I": "Gusto ko ito", I want this.', hook: 'It comes after what it owns: "bag ko", my bag. Its partner is "mo", your: k for me, m for you.' },
      { id: 'mo', tl: 'mo', en: 'your', kind: 'word', hint: 'moh', note: 'After a doing word it means "you": "Hintayin mo ako", wait for me.', hook: '"Anong pangalan mo?" is "what is the name, yours?". Swap in "ko" and it is "my name".' },
      { id: 'ang', tl: 'ang', en: 'the', kind: 'word', hint: 'ahng', note: 'It points at what the sentence is about, so you will hear it everywhere.', hook: '"Nasaan ang banyo?", where is the bathroom? Where English says "the", Tagalog usually says "ang".' },
      { id: 'ito', tl: 'ito', en: 'this', kind: 'word', hint: 'ee-TOH', hook: 'Point and ask: "Ano ito?", what is this? "Magkano ito?", how much is this?' },
      { id: 'na', tl: 'na', en: 'already / now', kind: 'word', hint: 'nah', hook: 'It marks a change: "Tara na!", let\'s go now; "Gutom na ako", I\'m hungry already.' },
      { id: 'lang', tl: 'lang', en: 'just / only', kind: 'word', hint: 'lahng', hook: '"Sandali lang", just a moment. Adding "lang" makes anything sound smaller and easier, so it softens a lot of requests.' },
      { id: 'sa', tl: 'sa', en: 'to / at / in', kind: 'word', hint: 'sah', hook: 'One little word for to, at and in: "sa bahay", at home; "sa Tagalog", in Tagalog.' },
      { id: 'ba', tl: 'ba', en: '(makes a yes/no question)', kind: 'word', hint: 'bah', hook: 'A spoken question mark: "Puwede?" (it\'s allowed) becomes "Puwede ba?" (is it allowed?).' },
      { id: 'ng', tl: 'ng', en: 'of / some', kind: 'word', hint: 'nahng', say: 'nang', accept: ['nang'], hook: 'Spelled n-g but said "nahng". "Pahingi po ng tubig", some water please; "alas-siyete ng umaga", seven in the morning.' },
      { id: 'siya', tl: 'siya', en: 'he / she', kind: 'word', hint: 'shah', hook: 'One word for he and she: Tagalog doesn\'t mark gender. Said as one quick syllable, "shah", like "siyam".' },
      { id: 'tayo', tl: 'tayo', en: 'we (including you)', kind: 'word', hint: 'tah-YOH', hook: 'The "we" that includes the person you are talking to. "Kain tayo!", let\'s eat, invites everyone at the table.' },
      { id: 'kami', tl: 'kami', en: 'we (not including you)', kind: 'word', hint: 'kah-MEE', hook: '"Kami" leaves the listener out. Tell a waiter "Dalawa kami", "we are two", because the waiter isn\'t eating with you.' },
      { id: 'sila', tl: 'sila', en: 'they', kind: 'word', hint: 'see-LAH', hook: 'Sounds like "see la": see them, over there.' },
      { id: 'may', tl: 'may', en: 'there is / has', kind: 'word', hint: 'mai', note: 'Always with a thing after it: "may tubig", there\'s water. On its own, say "meron".', hook: 'Sounds like English "my", and works like "I\'ve got": "may kape", there\'s coffee, someone has coffee.' },
      { id: 'may-kape-ba', tl: 'May kape ba?', en: 'Is there any coffee?', kind: 'phrase', hint: 'mai kah-PEH bah', hook: '"May" (there is) + "kape" (coffee) + "ba" (the question): coffee, is there? Swap in anything you\'re after.' },
      { id: 'meron', tl: 'Meron.', en: 'There is. / I have some.', kind: 'word', hint: 'MEH-ron', hook: 'The answer to "May ... ba?". It is short for "mayroon", the long form of "may".' },
      { id: 'wala', tl: 'Wala.', en: "There's none. / Nothing.", kind: 'word', hint: 'wah-LAH', hook: 'Nothing, none, not here. With "-ng" it joins the next word: "walang anuman", it\'s nothing (you\'re welcome). "Meron" and "wala" are the yes and no of having.' },
      { id: 'kailangan', tl: 'kailangan', en: 'need / have to', kind: 'word', hint: 'kah-ee-LAH-ngahn', note: 'Whoever needs it comes after: "kailangan ko", I need.', hook: '"Kai-LANG-an": think of longing for something you need.' },
      { id: 'kailangan-ko', tl: 'Kailangan ko ito.', en: 'I need this.', kind: 'phrase', hint: 'kah-ee-LAH-ngahn koh ee-TOH', hook: '"Kailangan" (need) + "ko" (I) + "ito" (this). Swap "kailangan" for "gusto" (want) and you get "I want this".' },
      { id: 'puwede', tl: 'puwede', accept: ['pwede'], en: 'can / allowed', kind: 'word', hint: 'PWEH-deh', hook: 'From Spanish "puede", it can. Said in two beats, "PWEH-deh", and texts spell it "pwede".' },
      { id: 'puwede-ba', tl: 'Puwede ba?', en: 'Can I? / Is it allowed?', kind: 'phrase', hint: 'PWEH-deh bah', hook: '"Puwede" (can) plus the question-maker "ba". Point at an empty chair and ask.' },
      { id: 'dito', tl: 'dito', en: 'here', kind: 'word', hint: 'DEE-toh', hook: 'Three steps of distance: "dito" by me, "diyan" by you, "doon" away from us both.' },
      { id: 'at', tl: 'at', en: 'and', kind: 'word', hint: 'aht', hook: 'Looks like English "at" but means "and": "kape at tinapay", coffee and bread.' },
      { id: 'pero', tl: 'pero', en: 'but', kind: 'word', hint: 'PEH-roh', hook: 'The same as Spanish "pero". "Oo, pero..." is "yes, but...", the start of every polite refusal.' },
      { id: 'kasi', tl: 'kasi', en: 'because', kind: 'word', hint: 'kah-SEE', hook: 'Sounds like "\'cause, see": because, see? It often comes at the end of an excuse: "Trapik kasi."' },
      { id: 'mga', tl: 'mga', en: '(makes a word plural)', kind: 'word', hint: 'mah-NGAH', hook: 'Spelled m-g-a but said "mah-NGAH". It is in the title of the numbers topic: "Mga Numero", numbers.' },
      { id: 'kayo', tl: 'kayo', en: 'you (polite, or more than one)', kind: 'word', hint: 'kah-YOH', note: 'For a group, or politely for one person, often with "po".', hook: '"Ikaw" is one friend; "kayo" is a group, or someone you would say "po" to: "Meron ba kayong ...?" asks a shop what it has.' },
      { id: 'pa', tl: 'pa', en: 'still / yet / more', kind: 'word', hint: 'pah', hook: 'The partner of "na": "na" is already, "pa" is still. "Isa pa", one more; "Malayo pa?", still far?' },
    ],
  },
  {
    id: 'time',
    title: 'Telling time',
    tlTitle: 'Oras',
    intro: 'Ask the time and tell it. Clock times use Spanish numbers: one o\'clock is "ala-una", and every other hour is "alas-" plus the number, alas-dos, alas-tres.',
    cards: [
      { id: 'oras', tl: 'oras', en: 'time / hour', kind: 'word', hint: 'OH-rahs', hook: 'From Spanish "horas", hours. "Isang oras" is one hour.' },
      { id: 'anong-oras-na', tl: 'Anong oras na?', en: 'What time is it?', kind: 'phrase', hint: 'ah-NONG OH-rahs nah', hook: '"Anong" (what) + "oras" (hour) + "na" (already): "what hour already?"' },
      { id: 'ala-una', tl: 'Ala-una', en: "one o'clock", kind: 'word', hint: 'AH-lah OO-nah', hook: 'Spanish "a la una", at one. One is singular, so it is "ala", not "alas".' },
      { id: 'alas-dos', tl: 'Alas-dos', en: "two o'clock", kind: 'word', hint: 'ah-LAHS DOS', hook: 'Spanish "a las dos", at two. Every hour after one takes "alas-".' },
      { id: 'alas-tres', tl: 'Alas-tres', en: "three o'clock", kind: 'word', hint: 'ah-LAHS TRES', hook: '"Tres" is Spanish three, and starts with t like "tatlo".' },
      { id: 'alas-singko', tl: 'Alas-singko', en: "five o'clock", kind: 'word', hint: 'ah-LAHS SING-koh', hook: 'Spanish "cinco", spelled the Tagalog way. Five o\'clock is when offices empty and the traffic starts.' },
      { id: 'alas-sais', tl: 'Alas-sais', en: "six o'clock", kind: 'word', hint: 'ah-LAHS SAH-ees', hook: 'Spanish "seis". Sounds like "sighs": six o\'clock, the sigh at the end of the day.' },
      { id: 'alas-siyete', tl: 'Alas-siyete', en: "seven o'clock", kind: 'word', hint: 'ah-LAHS SHEH-teh', hook: 'Spanish "siete", with "siy" said "sh" as in "siyam".' },
      { id: 'alas-otso', tl: 'Alas-otso', en: "eight o'clock", kind: 'word', hint: 'ah-LAHS OT-choh', hook: 'Spanish "ocho". Tagalog writes the ch sound as "ts", so "otso" is said "OT-cho".' },
      { id: 'alas-diyes', tl: 'Alas-diyes', en: "ten o'clock", kind: 'word', hint: 'ah-LAHS dyes', hook: 'Spanish "diez". Ten could be morning or night, so add "ng umaga" or "ng gabi".' },
      { id: 'alas-dose', tl: 'Alas-dose', en: "twelve o'clock", kind: 'word', hint: 'ah-LAHS DOH-seh', hook: 'Spanish "doce". For noon itself most people say "tanghali".' },
      { id: 'kalahati', tl: 'kalahati', en: 'half', kind: 'word', hint: 'kah-lah-HAH-tee', note: 'On the clock people say "y medya" (Spanish "y media"): "alas-dos y medya" is half past two.', hook: '"Hati" means split or divide. Ka- + la + hati: one of the split pieces.' },
      { id: 'alas-siyete-umaga', tl: 'Alas-siyete ng umaga', en: '7 in the morning', kind: 'phrase', hint: 'ah-LAHS SHEH-teh nahng oo-MAH-gah', hook: '"Ng" here means "of": seven of the morning. You know "umaga" from "Magandang umaga".' },
      { id: 'alas-otso-gabi', tl: 'Alas-otso ng gabi', en: '8 at night', kind: 'phrase', hint: 'ah-LAHS OT-choh nahng gah-BEE', hook: 'Swap "umaga" for "gabi" (night), or "hapon" (afternoon). The same three words from the greetings.' },
      { id: 'tanghali', tl: 'tanghali', en: 'noon / midday', kind: 'word', hint: 'tahng-HAH-lee', hook: '"Tanghalian" is lunch: the meal at tanghali. Learn one and you get the other free.' },
      { id: 'hatinggabi', tl: 'hatinggabi', en: 'midnight', kind: 'word', hint: 'hah-ting-gah-BEE', hook: '"Hati" (half, split) + "ng" + "gabi" (night): the night split down the middle.' },
    ],
  },
  {
    id: 'when',
    title: 'When',
    tlTitle: 'Kailan',
    intro: 'Now, later, earlier, tomorrow: the words that put plans in time. "Mamaya" and "kanina" come up constantly.',
    cards: [
      { id: 'ngayon', tl: 'ngayon', en: 'now / today', kind: 'word', hint: 'ngah-YON', hook: 'It starts with "ng", one sound, like the end of "sing". "Ngayon na!" means "right now!"' },
      { id: 'mamaya', tl: 'mamaya', en: 'later (today)', kind: 'word', hint: 'mah-mah-YAH', note: 'Filipino "mamaya" can stretch: later today, but not necessarily soon.', hook: 'Sounds like "ma, ma, ya": what a child says when asked to tidy up. Later, Ma!' },
      { id: 'kanina', tl: 'kanina', en: 'earlier (today)', kind: 'word', hint: 'kah-NEE-nah', hook: 'The opposite of "mamaya". Kanina looks back, mamaya looks ahead, and both stay within today.' },
      { id: 'bukas', tl: 'bukas', en: 'tomorrow', kind: 'word', hint: 'BOO-kahs', note: 'Stress the end, "boo-KAHS", and it means "open", as on shop signs.', hook: 'Tomorrow and open are nearly the same word: tomorrow is the day that opens next.' },
      { id: 'kahapon', tl: 'kahapon', en: 'yesterday', kind: 'word', hint: 'kah-HAH-pon', hook: '"Hapon" (afternoon) is hiding inside: ka-hapon, the afternoon before. Yesterday.' },
      { id: 'araw', tl: 'araw', en: 'day / sun', kind: 'word', hint: 'AH-raow', hook: 'One word for the sun and the day, since a day is one trip of the sun. Doubled, "araw-araw" is every day.' },
      { id: 'linggo', tl: 'linggo', en: 'week / Sunday', kind: 'word', hint: 'ling-GOH', hook: 'Ultimately from "domingo", Sunday, which reached the region through Portuguese and Malay. A week ran Sunday to Sunday, so the word came to mean both.' },
      { id: 'buwan', tl: 'buwan', en: 'month / moon', kind: 'word', hint: 'boo-WAHN', hook: 'Like "araw" for sun and day, "buwan" is both the moon and a month: one trip of the moon.' },
      { id: 'taon', tl: 'taon', en: 'year', kind: 'word', hint: 'tah-ON', hook: 'You will hear it every January: "Manigong Bagong Taon!", Happy New Year.' },
      { id: 'susunod-na-linggo', tl: 'sa susunod na linggo', en: 'next week', kind: 'phrase', hint: 'sah soo-SOO-nod nah ling-GOH', hook: '"Sunod" means follow, so "susunod" is the following one. The same root gives "Sunod!", "Next!"' },
      { id: 'noong-isang-linggo', tl: 'noong isang linggo', en: 'last week', kind: 'phrase', hint: 'noh-ONG ee-SAHNG ling-GOH', hook: '"Noong" points to the past and "isang" is "one": back in the other week.' },
      { id: 'lagi', tl: 'lagi', en: 'always', kind: 'word', hint: 'LAH-ghee', hook: 'Sounds like "lag": the jeepney is always lagging. "Lagi na lang!" is "every single time!"' },
      { id: 'minsan', tl: 'minsan', en: 'sometimes / once', kind: 'word', hint: 'min-SAHN', hook: '"Isa" (one) is worn down inside it: minsan is "one time", once, and so sometimes.' },
      { id: 'kaagad', tl: 'kaagad', en: 'right away / immediately', kind: 'word', hint: 'kah-AH-gahd', hook: '"Agad" means at once, and "ka-" adds emphasis. "Agad-agad" is in a big hurry, no waiting.' },
      { id: 'lunes', tl: 'Lunes', en: 'Monday', kind: 'word', hint: 'LOO-nes', hook: 'Spanish "lunes", the moon\'s day, just as English Monday is moon-day.' },
      { id: 'biyernes', tl: 'Biyernes', en: 'Friday', kind: 'word', hint: 'bee-YER-nes', hook: 'Spanish "viernes", with v turned to b. "Biyernes Santo" is Good Friday.' },
      { id: 'sabado', tl: 'Sabado', en: 'Saturday', kind: 'word', hint: 'SAH-bah-doh', hook: 'Spanish "sábado", from the Sabbath, the day of rest.' },
      { id: 'martes', tl: 'Martes', en: 'Tuesday', kind: 'word', hint: 'MAHR-tes', hook: 'Spanish "martes", the day of Mars.' },
      { id: 'miyerkoles', tl: 'Miyerkoles', en: 'Wednesday', kind: 'word', hint: 'mee-YER-koh-les', hook: 'Spanish "miércoles", the day of Mercury, spelled the Tagalog way.' },
      { id: 'huwebes', tl: 'Huwebes', en: 'Thursday', kind: 'word', hint: 'hoo-WEH-bes', hook: 'Spanish "jueves", the day of Jupiter. The Spanish j sounds like an h, so Tagalog writes an h.' },
    ],
  },
  {
    id: 'on-the-way',
    title: 'On the way',
    tlTitle: 'Papunta',
    intro: 'Texting a friend where you are, or telling a driver where to stop: the phrases for getting from A to B.',
    cards: [
      { id: 'papunta-na-ako', tl: 'Papunta na ako.', en: "I'm on my way.", kind: 'phrase', hint: 'pah-POON-tah nah ah-KOH', hook: 'The "punta" (go to) from "Saan ka pupunta?", with "pa-" for heading towards: "heading there already, me".' },
      { id: 'malapit-na-ako', tl: 'Malapit na ako.', en: "I'm almost there.", kind: 'phrase', hint: 'mah-LAH-pit nah ah-KOH', hook: '"Lapit" means near: "near already, me". In Manila traffic it can mean anything up to an hour.' },
      { id: 'nandito-na-ako', tl: 'Nandito na ako.', en: "I'm here.", kind: 'phrase', hint: 'nahn-DEE-toh nah ah-KOH', hook: '"Dito" means here, and "nandito" means "is here". Swap "dito" for "diyan" or "doon" to say you are there.' },
      { id: 'nasaan-ka-na', tl: 'Nasaan ka na?', en: 'Where are you now?', kind: 'phrase', hint: 'nah-sah-AHN kah nah', hook: 'Add "na" (already) to "Nasaan ka?" and you get the impatient text: where are you by now?' },
      { id: 'aalis-na-ako', tl: 'Aalis na ako.', en: "I'm leaving now.", kind: 'phrase', hint: 'ah-AH-lis nah ah-KOH', hook: '"Alis" is leave. Doubling the first sound, a-alis, makes it "about to leave".' },
      { id: 'pauwi-na-ako', tl: 'Pauwi na ako.', en: "I'm heading home.", kind: 'phrase', hint: 'pah-OO-wee nah ah-KOH', hook: '"Uwi" means go home, and "pa-" points the way, just like in "papunta": home-bound already.' },
      { id: 'trapik', tl: 'Trapik!', en: 'Traffic!', kind: 'word', hint: 'TRAH-pik', hook: 'English "traffic" spelled the Tagalog way, with f turned to p. The all-purpose reason for being late.' },
      { id: 'mahuhuli-ako', tl: 'Mahuhuli ako.', en: "I'll be late.", kind: 'phrase', hint: 'mah-hoo-hoo-LEE ah-KOH', note: 'In everyday Taglish you will also hear "Male-late ako".', hook: '"Huli" means late or last. Doubling the "hu" makes it future: will be late.' },
      { id: 'hintayin-mo-ako', tl: 'Hintayin mo ako.', en: 'Wait for me.', kind: 'phrase', hint: 'hin-tah-YIN moh ah-KOH', hook: '"Hintay" is wait. Picture holding up a hand: "HIN-tay!", stay there.' },
      { id: 'para-po', tl: 'Para po!', en: 'Stop here, please! (to a driver)', kind: 'phrase', hint: 'PAH-rah poh', note: 'Call it out on a jeepney or bus when you want to get off.', hook: 'From Spanish "parar", to stop. A different word from the "para" that means "for".' },
      { id: 'bayad-po', tl: 'Bayad po.', en: "Here's my fare.", kind: 'phrase', hint: 'BAH-yahd poh', note: 'On a jeepney, pass your fare forward with "Bayad po" and it gets handed along to the driver.', hook: '"Bayad" is payment. It travels hand to hand to the driver, and the change comes back the same way.' },
      { id: 'sa-tabi-lang', tl: 'Sa tabi lang po.', en: 'Just pull over here, please.', kind: 'phrase', hint: 'sah tah-BEE lahng poh', hook: '"Tabi" means side, so it is "just at the side". "Tabi!" on its own means "move aside!"' },
      { id: 'sumakay', tl: 'sumakay', en: 'to get on / ride', kind: 'word', hint: 'soo-mah-KAI', hook: '"Sakay" is ride. "-um-" slots inside to make a verb: s-um-akay. A driver calling "Sakay na!" means "get on!"' },
      { id: 'bumaba', tl: 'bumaba', en: 'to get off / go down', kind: 'word', hint: 'boo-mah-BAH', hook: '"Baba" means down, low. The same "-um-" trick: b-um-aba. "Bababa po ako" is "I\'m getting off".' },
      { id: 'dyip', tl: 'dyip', say: 'jip', accept: ['jip'], en: 'jeepney', kind: 'word', hint: 'jeep', hook: 'From the US Army jeeps left after World War Two, stretched and painted into the "king of the road".' },
    ],
  },
  {
    id: 'places',
    title: 'Places',
    tlTitle: 'Mga Lugar',
    intro: '"Sa" marks a place: "sa bahay" is at home, "sa palengke" at the market. Most of town is one "sa" away.',
    cards: [
      { id: 'bahay', tl: 'bahay', en: 'house / home', kind: 'word', hint: 'BAH-hai', hook: '"Bahay kubo" is the bamboo hut from the best-known Filipino folk song. Sounds like "bye, hi": the door you say both through.' },
      { id: 'nasa-bahay-ako', tl: 'Nasa bahay ako.', en: "I'm at home.", kind: 'phrase', hint: 'NAH-sah BAH-hai ah-KOH', hook: '"Nasa" means "at, in": the "na" of "nasaan" plus the place word "sa". Swap in any place: "Nasa opisina ako".' },
      { id: 'palengke', tl: 'palengke', en: 'market', kind: 'word', hint: 'pah-LENG-keh', hook: 'From Spanish "palenque", a fenced enclosure where markets were held. Fresh fish, haggling and noise: the palengke.' },
      { id: 'tindahan', tl: 'tindahan', en: 'shop / store', kind: 'word', hint: 'tin-DAH-hahn', note: 'A "sari-sari store" is the tiny corner shop on almost every street.', hook: 'Spanish "tienda" (shop) + "-han" (place). "Sari-sari" means "assorted": it sells a bit of everything.' },
      { id: 'simbahan', tl: 'simbahan', en: 'church', kind: 'word', hint: 'sim-BAH-hahn', hook: '"Simba" means to go to Mass, and "-han" makes a place: where you go to Mass.' },
      { id: 'ospital', tl: 'ospital', en: 'hospital', kind: 'word', hint: 'os-pee-TAHL', hook: 'Spanish "hospital", minus the silent h, with the stress at the end.' },
      { id: 'botika', tl: 'botika', en: 'pharmacy', kind: 'word', hint: 'boh-TEE-kah', hook: 'Spanish "botica". Think "boutique" for medicine.' },
      { id: 'paaralan', tl: 'paaralan', en: 'school', kind: 'word', hint: 'pah-ah-RAH-lahn', hook: '"Aral" means study. Pa- + aral + -an: the place where you study.' },
      { id: 'opisina', tl: 'opisina', en: 'office', kind: 'word', hint: 'oh-pee-SEE-nah', hook: 'Spanish "oficina", with the f turned to p as usual.' },
      { id: 'kainan', tl: 'kainan', en: 'eatery / place to eat', kind: 'word', hint: 'kah-ee-NAHN', hook: '"Kain" (eat) + "-an" (place): an eating place. The same pattern as "paaralan".' },
      { id: 'bangko', tl: 'bangko', en: 'bank', kind: 'word', hint: 'BAHNG-koh', hook: 'Spanish "banco", which also meant bench: the first bankers did business at benches. In Tagalog "bangko" is still a bench too.' },
      { id: 'kanto', tl: 'kanto', en: 'street corner', kind: 'word', hint: 'KAHN-toh', hook: 'Spanish "canto", an edge. "Sa kanto lang" (just at the corner) is how many directions start.' },
      { id: 'kalye', tl: 'kalye', en: 'street', kind: 'word', hint: 'KAHL-yeh', hook: 'Spanish "calle". Kids playing in the street are playing "sa kalye".' },
      { id: 'paliparan', tl: 'paliparan', en: 'airport', kind: 'word', hint: 'pah-lee-PAH-rahn', note: 'Most people just say "airport".', hook: '"Lipad" means fly. Pa- + lipad + -an, with the d softened to r: the flying place.' },
    ],
  },
  {
    id: 'directions',
    title: 'Directions',
    tlTitle: 'Direksyon',
    intro: 'Ask the way and follow the answer. Watch the lips: a quick pout towards a place is a very Filipino way to point.',
    cards: [
      { id: 'paano-pumunta', tl: 'Paano pumunta sa palengke?', en: 'How do I get to the market?', kind: 'phrase', hint: 'pah-AH-noh poo-MOON-tah sah pah-LENG-keh', hook: '"Paano" (how) + "pumunta" (to go) + "sa palengke". Swap in any place you know.' },
      { id: 'kaliwa', tl: 'kaliwa', en: 'left', kind: 'word', hint: 'kah-lee-WAH', hook: 'Starts with "Cali": California is on the left of a map of the US.' },
      { id: 'kanan', tl: 'kanan', en: 'right (direction)', kind: 'word', hint: 'KAH-nahn', hook: 'Think "Canon": you hold a camera and press the shutter with your right hand.' },
      { id: 'diretso', tl: 'diretso', en: 'straight ahead', kind: 'word', hint: 'dee-RET-choh', hook: 'Spanish "derecho", straight, with the ch written "ts". "Diretso lang" is "just keep going".' },
      { id: 'kumaliwa-ka', tl: 'Kumaliwa ka.', en: 'Turn left.', kind: 'phrase', hint: 'koo-mah-lee-WAH kah', hook: 'The "-um-" trick from "sumakay": slot it into "kaliwa" and left becomes a verb, go left.' },
      { id: 'kumanan-ka', tl: 'Kumanan ka.', en: 'Turn right.', kind: 'phrase', hint: 'koo-MAH-nahn kah', hook: 'The same trick on "kanan": k-um-anan, go right.' },
      { id: 'diyan', tl: 'diyan', accept: ['dyan'], en: 'there (near you)', kind: 'word', hint: 'dyahn', hook: 'The middle of the three: dito (by me), diyan (by you), doon (over there).' },
      { id: 'doon', tl: 'doon', en: 'over there', kind: 'word', hint: 'doh-ON', hook: 'The farthest of the three. Stretch out the "do-on" as if pointing far away.' },
      { id: 'malapit', tl: 'malapit', en: 'near', kind: 'word', hint: 'mah-LAH-pit', hook: '"Lapit" is closeness. Ma- turns it into a describing word, like ma-ganda and ma-buti.' },
      { id: 'malayo', tl: 'malayo', en: 'far', kind: 'word', hint: 'mah-LAH-yoh', hook: '"Layo" is distance. "Malayo pa?" (still far?) is the backseat question of every road trip.' },
      { id: 'katabi', tl: 'katabi', en: 'next to', kind: 'word', hint: 'kah-tah-BEE', hook: '"Tabi" is side, so "katabi" is the one at your side: the person beside you, the shop next door.' },
      { id: 'sa-harap', tl: 'sa harap', en: 'in front', kind: 'phrase', hint: 'sah HAH-rahp', hook: '"Harap" is the face, the front of you. In front is where your face points.' },
      { id: 'sa-likod', tl: 'sa likod', en: 'behind', kind: 'phrase', hint: 'sah lee-KOD', hook: '"Likod" is also your back. Behind is where your back is.' },
    ],
  },
  {
    id: 'plans',
    title: 'Making plans',
    tlTitle: 'Mga Plano',
    intro: 'Set a time, pick a place, and say yes or "maybe later". Plans are flexible here, so "mamaya" does a lot of work.',
    cards: [
      { id: 'libre-ka-ba', tl: 'Libre ka ba?', en: 'Are you free?', kind: 'phrase', hint: 'LEE-breh kah bah', note: '"Libre" also means free of charge: "Libre ko!" is "my treat!".', hook: 'Spanish "libre", free. One word for free time and a free meal.' },
      { id: 'ano-ang-plano', tl: 'Anong plano?', accept: ['Ano ang plano?'], en: "What's the plan?", kind: 'phrase', hint: 'ah-NONG PLAH-noh', hook: '"Plano" is Spanish for plan. A freebie.' },
      { id: 'saan-tayo-magkikita', tl: 'Saan tayo magkikita?', en: 'Where shall we meet?', kind: 'phrase', hint: 'sah-AHN tah-YOH mahg-kee-KEE-tah', hook: '"Kita" is see, "mag-" makes it each other, and the doubled "ki" makes it future: where will we see each other?' },
      { id: 'anong-oras-magkikita', tl: 'Anong oras tayo magkikita?', en: 'What time shall we meet?', kind: 'phrase', hint: 'ah-NONG OH-rahs tah-YOH mahg-kee-KEE-tah', hook: 'Swap "saan" for "anong oras" in "Saan tayo magkikita?". The same sentence, now asking the time.' },
      { id: 'kita-tayo-bukas', tl: 'Kita tayo bukas.', en: 'See you tomorrow.', kind: 'phrase', hint: 'KEE-tah tah-YOH BOO-kahs', hook: '"Kita" (see) + "tayo" (we) + "bukas" (tomorrow): we see each other tomorrow.' },
      { id: 'puwede-ako', tl: 'Puwede ako.', en: 'I can make it.', kind: 'phrase', hint: 'PWEH-deh ah-KOH', hook: 'The "puwede" (can) from "Puwede ba?", answered with "ako": I can.' },
      { id: 'hindi-ako-puwede', tl: 'Hindi ako puwede.', en: "I can't make it.", kind: 'phrase', hint: 'hin-DEE ah-KOH PWEH-deh', hook: '"Hindi" (not) in front of "ako puwede". Kinder with "pasensya na" in front.' },
      { id: 'mamaya-na-lang', tl: 'Mamaya na lang.', en: "Later, then.", kind: 'phrase', hint: 'mah-mah-YAH nah lahng', hook: '"Mamaya" (later) + "na lang" (just, instead): "just later instead". A soft way to put something off.' },
      { id: 'teka', tl: 'Teka.', en: 'Wait a sec.', kind: 'word', hint: 'TEH-kah', hook: 'Usually explained as "hintay ka" (you wait) worn down to "teka". "Teka lang" is "hang on a moment".' },
      { id: 'tuloy-ba-tayo', tl: 'Tuloy ba tayo?', en: 'Are we still on?', kind: 'phrase', hint: 'too-LOY bah tah-YOH', hook: '"Tuloy" means carry on, go ahead. "Tuloy po kayo!" is also how a host says "come on in!"' },
      { id: 'sasama-ako', tl: 'Sasama ako.', en: "I'll come along.", kind: 'phrase', hint: 'sah-SAH-mah ah-KOH', hook: '"Sama" is go with. The doubled "sa" makes it future. Ask a friend "Sama ka?", coming along?' },
      { id: 'baka', tl: 'baka', en: 'maybe / might', kind: 'word', hint: 'bah-KAH', note: '"BAH-kah", stressed at the start, is a cow, from Spanish "vaca".', hook: 'Maybe the cow will come, maybe it won\'t. "Baka mamaya" is "maybe later".' },
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
      { id: 'almusal', tl: 'almusal', en: 'breakfast', kind: 'word', hint: 'ahl-moo-SAHL', hook: 'From Spanish "almuerzo", a mid-morning meal, which settled on breakfast here.' },
      { id: 'tanghalian', tl: 'tanghalian', en: 'lunch', kind: 'word', hint: 'tahng-hah-LEE-ahn', hook: 'The meal at "tanghali", noon: the one that came free with "tanghali".' },
      { id: 'hapunan', tl: 'hapunan', en: 'dinner', kind: 'word', hint: 'hah-POO-nahn', hook: '"Hapon" (afternoon) + "-an": the meal as the afternoon ends.' },
      { id: 'itlog', tl: 'itlog', en: 'egg', kind: 'word', hint: 'it-LOG', hook: 'The "-log" of every "silog" breakfast plate: "sinangag" (garlic fried rice) + "itlog".' },
      { id: 'baboy', tl: 'baboy', en: 'pig / pork', kind: 'word', hint: 'BAH-boy', hook: 'The animal and the meat. A whole roast "baboy", "lechon", is the star of every big party.' },
      { id: 'karne-ng-baka', tl: 'karne ng baka', en: 'beef', kind: 'phrase', hint: 'KAHR-neh nahng BAH-kah', hook: '"Karne" (meat, Spanish "carne") + "ng" (of) + "baka", the cow that "baka" also means: meat of cow.' },
      { id: 'gulay', tl: 'gulay', en: 'vegetables', kind: 'word', hint: 'GOO-lai', hook: '"Bahay kubo", the folk song about the bamboo hut, is one long list of the "gulay" growing round it.' },
      { id: 'prutas', tl: 'prutas', en: 'fruit', kind: 'word', hint: 'PROO-tahs', hook: 'Spanish "frutas", with the f turned to p, as in "pamilya".' },
      { id: 'saging', tl: 'saging', en: 'banana', kind: 'word', hint: 'SAH-ghing', hook: '"Banana cue" is a "saging" fried in brown sugar on a stick, sold on every corner.' },
      { id: 'mangga', tl: 'mangga', en: 'mango', kind: 'word', hint: 'mahng-GAH', hook: 'Sounds like "mango", and comes from the same South Indian word. Philippine mangoes are famously sweet.' },
      { id: 'gatas', tl: 'gatas', en: 'milk', kind: 'word', hint: 'GAH-tahs', hook: 'Sounds like "got us": the baby got us up at night for "gatas".' },
      { id: 'asukal', tl: 'asukal', en: 'sugar', kind: 'word', hint: 'ah-SOO-kahl', hook: 'Spanish "azúcar". Filipino cooking loves it: even spaghetti here is sweet.' },
      { id: 'asin', tl: 'asin', en: 'salt', kind: 'word', hint: 'ah-SIN', hook: 'Sounds like "a sin": too much "asin" is a sin.' },
    ],
  },
  {
    id: 'eating-out',
    title: 'Eating out',
    tlTitle: 'Sa Kainan',
    intro: 'Order, ask for water and get the bill. Staff often answer in English, but trying Tagalog gets smiles.',
    cards: [
      { id: 'isa-pong-adobo', tl: 'Isa pong adobo.', en: 'One adobo, please.', kind: 'phrase', hint: 'ee-SAH pong ah-DOH-boh', hook: '"Isa" (one) + "po" (respect), joined by "-ng". Swap in any dish: "Isa pong sinigang".' },
      { id: 'pahingi-tubig', tl: 'Pahingi po ng tubig.', en: 'Some water, please.', kind: 'phrase', hint: 'pah-HEE-ngee poh nahng TOO-big', hook: '"Hingi" means ask for, and "pa-" makes it a polite request. The little "ng" is said "nang".' },
      { id: 'ano-masarap-dito', tl: 'Anong masarap dito?', accept: ['Ano ang masarap dito?'], en: "What's good here?", kind: 'phrase', hint: 'ah-NONG mah-SAH-rahp DEE-toh', hook: '"Masarap" (delicious) + "dito" (here): what is delicious here? Staff love this question.' },
      { id: 'maanghang', tl: 'maanghang', en: 'spicy', kind: 'word', hint: 'mah-AHNG-hahng', hook: '"Anghang" is the heat in food, and "ma-" makes it a describing word, as in "masarap".' },
      { id: 'huwag-maanghang', tl: 'Huwag pong maanghang.', en: 'Not spicy, please.', kind: 'phrase', hint: 'hoo-WAG pong mah-AHNG-hahng', hook: '"Huwag" means don\'t, and "po" joins on with "-ng": "don\'t make it spicy, please".' },
      { id: 'ulam', tl: 'ulam', en: 'dish eaten with rice', kind: 'word', hint: 'OO-lahm', hook: 'Anything you eat with rice is "ulam". "Anong ulam?" (what\'s for dinner?) is asked in every Filipino home.' },
      { id: 'kutsara', tl: 'kutsara', en: 'spoon', kind: 'word', hint: 'koot-CHAH-rah', note: 'Filipinos eat with a spoon in the right hand and a fork in the left.', hook: 'Spanish "cuchara", with the ch written "ts".' },
      { id: 'tinidor', tl: 'tinidor', en: 'fork', kind: 'word', hint: 'tee-nee-DOR', hook: 'Spanish "tenedor". Here the fork just pushes food onto the spoon.' },
      { id: 'baso', tl: 'baso', en: 'glass (for drinking)', kind: 'word', hint: 'BAH-soh', hook: 'Spanish "vaso", with the v turned to b. Tagalog swaps Spanish v for b all the time.' },
      { id: 'bill-po', tl: 'Bill po.', en: 'The bill, please.', kind: 'phrase', hint: 'bil poh', note: 'You will also hear "Bill out po", or see people draw a rectangle in the air.', hook: 'English "bill" with "po" for politeness. Taglish at its most practical.' },
    ],
  },
  {
    id: 'money',
    title: 'Money & big numbers',
    tlTitle: 'Pera',
    intro: 'Prices are often said in English or Spanish numbers, but Tagalog ones are on signs and in the market. The currency is the peso, "piso".',
    cards: [
      { id: 'pera', tl: 'pera', en: 'money', kind: 'word', hint: 'PEH-rah', hook: 'From Spanish "perra", old slang for a small coin. Not the Spanish "pera", a pear.' },
      { id: 'piso', tl: 'piso', en: 'peso', kind: 'word', hint: 'PEE-soh', hook: 'Spanish "peso" means weight: coins were once worth their weight in silver.' },
      { id: 'dalawampu', tl: 'dalawampu', en: 'twenty (20)', kind: 'word', hint: 'dah-lah-wahm-POO', hook: '"Dalawa" (two) + "pu" (ten): two tens. The same "pu" as in "sampu".' },
      { id: 'limampu', tl: 'limampu', en: 'fifty (50)', kind: 'word', hint: 'lee-mahm-POO', hook: '"Lima" (five) + "pu" (ten): five tens.' },
      { id: 'isang-daan', tl: 'isang daan', en: 'one hundred (100)', kind: 'phrase', hint: 'ee-SAHNG dah-AHN', hook: '"Isa" (one) + "daan" (hundred). "Daan" is also a road: picture a road a hundred steps long.' },
      { id: 'limang-daan', tl: 'limang daan', en: 'five hundred (500)', kind: 'phrase', hint: 'lee-MAHNG dah-AHN', hook: '"Lima" (five) + "daan" (hundred), joined by "-ng". Every hundred works the same way.' },
      { id: 'isang-libo', tl: 'isang libo', en: 'one thousand (1,000)', kind: 'phrase', hint: 'ee-SAHNG LEE-boh', hook: 'Like "libro" (book) without the r: picture a book a thousand pages thick.' },
      { id: 'sukli', tl: 'sukli', en: 'change (money back)', kind: 'word', hint: 'sook-LEE', hook: '"May sukli po ba kayo?" (do you have change?) is the question before you hand over a big note.' },
      { id: 'barya', tl: 'barya', en: 'coins', kind: 'word', hint: 'bahr-YAH', note: 'Drivers and small shops prefer it. "Wala po akong barya" is "I have no coins".', hook: 'Sounds like "bury a": bury a jar of coins.' },
      { id: 'magkano-lahat', tl: 'Magkano lahat?', en: 'How much for everything?', kind: 'phrase', hint: 'mahg-KAH-noh lah-HAHT', hook: '"Lahat" means all. Add it to "Magkano" and you get the total.' },
      { id: 'labing-isa', tl: 'labing-isa', en: 'eleven (11)', kind: 'word', hint: 'lah-bing-ee-SAH', hook: '"Labing-" means ten and more: ten and one. Every number up to nineteen works the same way.' },
      { id: 'labindalawa', tl: 'labindalawa', en: 'twelve (12)', kind: 'word', hint: 'lah-bin-dah-lah-WAH', hook: '"Labing-" + "dalawa", with the ng turned to n before the d: ten and two.' },
      { id: 'labinlima', tl: 'labinlima', en: 'fifteen (15)', kind: 'word', hint: 'lah-bin-lee-MAH', hook: '"Labing-" + "lima", ng turned to n again before the l: ten and five.' },
      { id: 'tatlumpu', tl: 'tatlumpu', en: 'thirty (30)', kind: 'word', hint: 'taht-loom-POO', hook: '"Tatlo" (three) + "pu" (ten), squashed together like "dalawampu": three tens.' },
      { id: 'apatnapu', tl: 'apatnapu', en: 'forty (40)', kind: 'word', hint: 'ah-paht-nah-POO', hook: '"Apat" (four) + "na" + "pu" (ten). A number ending in a consonant joins on with "na" instead of "-ng".' },
      { id: 'dalawang-daan', tl: 'dalawang daan', en: 'two hundred (200)', kind: 'phrase', hint: 'dah-lah-WAHNG dah-AHN', hook: '"Dalawa" (two) + "-ng" + "daan" (hundred), just like "limang daan".' },
    ],
  },
  {
    id: 'shopping',
    title: 'Shopping',
    tlTitle: 'Pamimili',
    intro: 'From the sari-sari store window to the market stall. Pointing plus "ito" or "iyan" gets you most things.',
    cards: [
      { id: 'pabili-po', tl: 'Pabili po.', en: "I'd like to buy, please.", kind: 'phrase', hint: 'pah-bee-LEE poh', note: 'Called out at a sari-sari store window to get someone\'s attention.', hook: '"Bili" means buy, and "pa-" asks for it: "let me buy, please".' },
      { id: 'meron-ba-kayong', tl: 'Meron ba kayong tinapay?', en: 'Do you have bread?', kind: 'phrase', hint: 'MEH-ron bah kah-YONG tee-NAH-pai', hook: '"Meron ba" asks if there is, "kayo" is the polite you, and the "-ng" links it to the thing.' },
      { id: 'iyan', tl: 'iyan', en: 'that (near you)', kind: 'word', hint: 'ee-YAHN', hook: '"Ito" (this, by me), "iyan" (that, by you), "iyon" (that, over there): the same three steps as dito, diyan, doon.' },
      { id: 'iyon', tl: 'iyon', en: 'that (over there)', kind: 'word', hint: 'ee-YON', hook: 'The farthest of ito, iyan, iyon. Often shortened to "yon", as in "Yon na!", "That\'s it!"' },
      { id: 'isa-pa', tl: 'Isa pa.', en: 'One more.', kind: 'phrase', hint: 'ee-SAH pah', hook: '"Isa" (one) + "pa" (still, more). "Isa pa po" orders another round.' },
      { id: 'ito-na-lang', tl: 'Ito na lang.', en: "I'll just take this.", kind: 'phrase', hint: 'ee-TOH nah lahng', hook: '"Na lang" (just, instead) again: "this one instead". The phrase that ends the browsing.' },
      { id: 'tumawad', tl: 'Puwede bang tumawad?', en: 'Can I get a discount?', kind: 'phrase', hint: 'PWEH-deh bahng too-mah-WAHD', note: 'Haggling is normal at markets, not in malls.', hook: '"Tawad" is a discount, and the same root gives "patawad", forgiveness. You are asking the price to forgive you a little.' },
      { id: 'wala-na', tl: 'Wala na.', en: 'All gone. / Sold out.', kind: 'phrase', hint: 'wah-LAH nah', hook: '"Wala" (none) + "na" (already): none left already. You will hear it when you ask for the last fish.' },
      { id: 'tumitingin-lang', tl: 'Tumitingin lang po.', en: 'Just looking.', kind: 'phrase', hint: 'too-mee-TEE-ngin lahng poh', hook: '"Tingin" means look. "Ti-ti-ngin" with the doubled "ti" means looking right now.' },
      { id: 'malaki', tl: 'malaki', en: 'big', kind: 'word', hint: 'mah-lah-KEE', hook: '"Laki" is size. "Ang laki!" means "so big!"' },
      { id: 'maliit', tl: 'maliit', en: 'small', kind: 'word', hint: 'mah-lee-EET', hook: '"Liit" is smallness. The long "lee-EET" is a little squeak of a word.' },
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
      { id: 'tita', tl: 'Tita', en: 'aunt', kind: 'word', hint: 'TEE-tah', note: 'Also what you call your parents\' friends and other women their age, by name: "Tita Rose". You may hear the older word "tiya" in the provinces.', hook: 'From Spanish "tita", the pet form of "tía" (aunt). Tita and tito, like lola and lolo: -a for her, -o for him.' },
      { id: 'tito', tl: 'Tito', en: 'uncle', kind: 'word', hint: 'TEE-toh', note: 'Also what you call your parents\' friends and other men their age, by name: "Tito Boy". You may hear the older word "tiyo" in the provinces.', hook: 'From Spanish "tito", the pet form of "tío" (uncle). Ends in -o for him, like "lolo".' },
      { id: 'anak', tl: 'anak', en: 'child (son or daughter)', kind: 'word', hint: 'ah-NAHK', hook: '"Anak" is also the title of Freddie Aguilar\'s 1978 hit, a song about a parent and child that became famous around the world.' },
      { id: 'kaibigan', tl: 'kaibigan', en: 'friend', kind: 'word', hint: 'kah-ee-BEE-gahn', hook: 'The root is "ibig" (love, want). Ka- + ibig + -an: someone you share fondness with.' },
      { id: 'asawa', tl: 'asawa', en: 'husband / wife', kind: 'word', hint: 'ah-SAH-wah', hook: 'One word for husband and wife, as "siya" is one word for he and she.' },
      { id: 'pamilya', tl: 'pamilya', en: 'family', kind: 'word', hint: 'pah-MEEL-yah', hook: 'Spanish "familia", with the f turned to p, as in "opisina".' },
      { id: 'lalaki', tl: 'lalaki', en: 'man / male', kind: 'word', hint: 'lah-LAH-kee', hook: 'One letter from "malaki" (big). On toilet doors you will see "Lalaki" for men.' },
      { id: 'babae', tl: 'babae', en: 'woman / female', kind: 'word', hint: 'bah-BAH-eh', hook: 'The other toilet door. Three syllables, "ba-BA-eh", with the a and e said apart.' },
      { id: 'kapatid', tl: 'kapatid', en: 'brother / sister', kind: 'word', hint: 'kah-pah-TID', note: 'Older ones are usually called Ate and Kuya instead.', hook: 'One word for brother or sister, like "asawa" for husband or wife. Add "na lalaki" or "na babae" only if it matters.' },
      { id: 'pinsan', tl: 'pinsan', en: 'cousin', kind: 'word', hint: 'PEEN-sahn', note: 'Cousins are often as close as brothers and sisters. Between them it\'s shortened to "insan".', hook: 'Drop the p and you have "insan", what cousins call each other.' },
      { id: 'magulang', tl: 'magulang', en: 'parent', kind: 'word', hint: 'mah-GOO-lahng', note: 'Your parents are "mga magulang ko".', hook: 'The root is "gulang" (age). Ma- + gulang: the ones with the years.' },
      { id: 'apo', tl: 'apo', en: 'grandchild', kind: 'word', hint: 'ah-POH', hook: 'What lola and lolo call you. "Apo ko!", my grandchild!' },
      { id: 'pamangkin', tl: 'pamangkin', en: 'niece / nephew', kind: 'word', hint: 'pah-mahng-KIN', hook: 'One word for niece or nephew, like "kapatid" for brother or sister. Your tita\'s pamangkin is you.' },
      { id: 'panganay', tl: 'panganay', en: 'eldest child', kind: 'word', hint: 'pah-ngah-NAI', note: 'The eldest is expected to look after the younger ones, and is their Ate or Kuya.', hook: 'The "ng" starts a syllable here, "pa-nga-NAY", as it does in "ngayon". The first child, and the first of a pair: panganay, then bunso.' },
      { id: 'bunso', tl: 'bunso', en: 'youngest child', kind: 'word', hint: 'boon-SOH', note: 'Also a pet name: the family keeps calling the youngest "Bunso" long after they\'ve grown up.', hook: 'The last child, and the other half of "panganay", the first.' },
      { id: 'ninang', tl: 'Ninang', en: 'godmother', kind: 'word', hint: 'NEE-nahng', note: 'Children often have several, and visit them for gifts at Christmas. The sponsors at a wedding are ninang and ninong too.', hook: 'Ends in -ang for her and -ong for him: Ninang, Ninong. Together they are your "mga ninong at ninang".' },
      { id: 'ninong', tl: 'Ninong', en: 'godfather', kind: 'word', hint: 'NEE-nohng', note: 'Expect to be asked "Ninong, pamasko ko po?" (my Christmas gift, please?) if you are one.', hook: 'Ninang\'s pair: -ang for her, -ong for him.' },
      { id: 'bata', tl: 'bata', en: 'kid / young', kind: 'word', hint: 'BAH-tah', hook: 'Any child is a "bata"; your own child is your "anak". "Bata pa ako" is "I\'m still young".' },
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
      { id: 'gusto', tl: 'gusto', en: 'want / like', kind: 'word', hint: 'GOOS-toh', note: 'Whoever wants it comes after: "gusto ko", I want.', hook: '"Gusto" is Spanish for liking, as in "con mucho gusto".' },
      { id: 'gusto-ko-ito', tl: 'Gusto ko ito.', en: 'I want this. / I like this.', kind: 'phrase', hint: 'GOOS-toh koh ee-TOH', hook: '"Gusto" (want) + "ko" (I) + "ito" (this): "my liking, this".' },
      { id: 'ayoko', tl: 'Ayoko.', en: "I don't want to.", kind: 'word', hint: 'ah-YOH-koh', hook: '"Ayaw ko" (I don\'t like) squashed into one word.' },
      { id: 'hindi-ko-alam', tl: 'Hindi ko alam.', en: "I don't know.", kind: 'phrase', hint: 'hin-DEE koh ah-LAHM', hook: '"Hindi" (not) + "ko" (I) + "alam" (know). The same "alam" is inside "paalam".' },
      { id: 'mahal', tl: 'mahal', en: 'expensive / love', kind: 'word', hint: 'mah-HAHL', note: 'Same word for both. "Mahal kita" means "I love you".', hook: 'Works like English "dear": something dear to you, and something dear in price.' },
      { id: 'mura', tl: 'mura', en: 'cheap', kind: 'word', hint: 'moo-RAH', hook: 'Think "moo, rah!": a cow cheering at the bargain bin.' },
      { id: 'mahal-kita', tl: 'Mahal kita.', en: 'I love you.', kind: 'phrase', hint: 'mah-HAHL kee-TAH', hook: '"Mahal" is dear, and "kita" packs "I" and "you" into one tiny word.' },
      { id: 'anong-balita', tl: 'Anong balita?', en: "What's new?", kind: 'phrase', hint: 'ah-NONG bah-LEE-tah', note: 'A casual way to catch up with a friend.', hook: '"Balita" means "news". You will hear it on every Filipino news show.' },
      { id: 'kumain-ka-na-ba', tl: 'Kumain ka na ba?', en: 'Have you eaten?', kind: 'phrase', hint: 'koo-mah-EEN kah nah bah', note: 'Often a greeting, the way English asks "How are you?".', hook: '"Kain" (eat) from "Kain tayo!" + "ka" + "na" (already) + "ba": eaten, you, already? Care, shown through food.' },
      { id: 'kumain-na-ako', tl: 'Kumain na ako.', en: "I've already eaten.", kind: 'phrase', hint: 'koo-mah-EEN nah ah-KOH', hook: 'The answer to "Kumain ka na ba?": drop "ba", and "ako" goes last, as in "Gutom na ako".' },
      { id: 'matutulog-na-ako', tl: 'Matutulog na ako.', en: "I'm off to bed.", kind: 'phrase', hint: 'mah-too-TOO-log nah ah-KOH', hook: '"Tulog" is sleep. Doubling "tu" makes it "about to", as in "Mahuhuli ako": about to sleep already, me.' },
      { id: 'gising-ka-na-ba', tl: 'Gising ka na ba?', en: 'Are you awake?', kind: 'phrase', hint: 'ghee-SING kah nah bah', hook: '"Gising" means awake. "Gising na!" is how every mother says "wake up!"' },
    ],
  },
  {
    id: 'chat',
    title: 'Keeping a chat going',
    tlTitle: 'Kuwentuhan',
    intro: 'Little reactions that keep a conversation moving, even when you only follow half of it.',
    cards: [
      { id: 'talaga', tl: 'Talaga?', en: 'Really?', kind: 'word', hint: 'tah-LAH-gah', hook: 'Rising tone, "Talaga?", asks "really?". Falling tone, "Talaga!", says "really!". One word, two moods.' },
      { id: 'oo-nga', tl: 'Oo nga.', en: "That's true. / Yes, indeed.", kind: 'phrase', hint: 'OH-oh ngah', hook: '"Oo" (yes) + "nga" (indeed): the nodding-along phrase.' },
      { id: 'ako-rin', tl: 'Ako rin.', en: 'Me too.', kind: 'phrase', hint: 'ah-KOH rin', hook: '"Rin" means also. After a vowel it is "rin", after a consonant "din": "Gusto ko rin", "Pagod din ako".' },
      { id: 'tama', tl: 'Tama.', en: "That's right.", kind: 'word', hint: 'TAH-mah', hook: '"Tama" means correct. It is what a teacher says, and "Tama na!" (that\'s enough!) builds on it.' },
      { id: 'siguro', tl: 'Siguro.', en: 'Probably. / I guess.', kind: 'word', hint: 'see-GOO-roh', hook: 'From Spanish "seguro", sure. In Tagalog it lost its certainty and became "probably".' },
      { id: 'ewan-ko', tl: 'Ewan ko.', en: 'Dunno.', kind: 'phrase', hint: 'eh-WAHN koh', hook: 'The shrug version of "Hindi ko alam". Casual: maybe not with your boss.' },
      { id: 'ganoon-ba', tl: 'Ganun ba?', accept: ['Ganoon ba?'], en: 'Is that so?', kind: 'phrase', hint: 'gah-NOON bah', note: 'Written "Ganoon ba?" in books, but said, and texted, "Ganun ba?".', hook: '"Ganun" means "like that": "like that, is it?"' },
      { id: 'grabe', tl: 'Grabe!', en: "Wow! / That's intense!", kind: 'word', hint: 'GRAH-beh', hook: 'From Spanish "grave", serious. Used for anything extreme: the heat, the traffic, a great meal.' },
      { id: 'ayos-lang', tl: 'Ayos lang.', en: "It's all good.", kind: 'phrase', hint: 'AH-yos lahng', hook: '"Ayos" means in order, arranged. Everything is in order, just fine.' },
      { id: 'hindi-naman', tl: 'Hindi naman.', en: 'Not really.', kind: 'phrase', hint: 'hin-DEE nah-MAHN', hook: '"Naman" softens again, as in "Mabuti naman". A gentle no.' },
      { id: 'ano-ulit', tl: 'Ano ulit?', en: 'Come again?', kind: 'phrase', hint: 'ah-NOH OO-lit', hook: '"Ano" (what) + "ulit" (again), the "ulit" from "Pakiulit po". The quick, casual version.' },
      { id: 'sayang', tl: 'Sayang!', en: 'What a waste! / Too bad!', kind: 'word', hint: 'sah-YAHNG', hook: 'For a missed chance: the bus just leaving, food left on the plate. Say it with a sigh, "sigh-yang".' },
      { id: 'naku', tl: 'Naku!', en: 'Oh no! / Oh my!', kind: 'word', hint: 'nah-KOO', hook: 'Short for "Ina ko!", "my mother!". The Filipino "oh my goodness".' },
      { id: 'bahala-na', tl: 'Bahala na.', en: 'Come what may.', kind: 'phrase', hint: 'bah-HAH-lah nah', hook: 'Often traced to "Bathala", the old Tagalog supreme god: "leave it to God". A whole attitude in two words.' },
      { id: 'hindi-pa', tl: 'Hindi pa.', en: 'Not yet.', kind: 'phrase', hint: 'hin-DEE pah', hook: '"Hindi" (not) + "pa" (still): still not. Answer "Kumain ka na ba?" with it and expect to be fed.' },
      { id: 'walang-problema', tl: 'Walang problema.', en: 'No problem.', kind: 'phrase', hint: 'wah-LAHNG proh-BLEH-mah', hook: '"Wala" (none) + "-ng" + Spanish "problema", built just like "Walang anuman".' },
      { id: 'ikaw-ang-bahala', tl: 'Ikaw ang bahala.', en: "It's up to you.", kind: 'phrase', hint: 'ee-KAOW ahng bah-HAH-lah', hook: 'The "bahala" of "Bahala na": you are the one in charge. Handy when asked where to eat.' },
      { id: 'sigurado-ka-ba', tl: 'Sigurado ka ba?', en: 'Are you sure?', kind: 'phrase', hint: 'see-goo-RAH-doh kah bah', hook: 'From Spanish "asegurado", assured, the same root as "siguro". "Siguro" became probably; "sigurado" kept the sure.' },
      { id: 'sana', tl: 'sana', en: 'hopefully / I hope', kind: 'word', hint: 'SAH-nah', hook: 'Tack it on to wish for something: "Sana bukas", hopefully tomorrow. "Sana all" is Taglish for "I wish that were me too".' },
    ],
  },
  {
    id: 'feelings',
    title: 'How you feel',
    tlTitle: 'Pakiramdam',
    intro: 'Say how you are beyond "mabuti". Most follow the pattern you know from "Gutom na ako": a feeling, then "ako".',
    cards: [
      { id: 'pagod-na-ako', tl: 'Pagod na ako.', en: "I'm tired.", kind: 'phrase', hint: 'PAH-god nah ah-KOH', hook: 'The same shape as "Gutom na ako" and "Busog na ako": a feeling + "na ako".' },
      { id: 'inaantok-ako', tl: 'Inaantok ako.', en: "I'm sleepy.", kind: 'phrase', hint: 'ee-nah-AHN-tok ah-KOH', hook: '"Antok" is sleepiness. The doubled "a" makes it happening now: drifting off.' },
      { id: 'nauuhaw-ako', tl: 'Nauuhaw ako.', en: "I'm thirsty.", kind: 'phrase', hint: 'nah-oo-OO-haow ah-KOH', hook: '"Uhaw" is thirst. Picture panting "oo-haow" in the midday heat.' },
      { id: 'mainit', tl: 'Mainit!', en: "It's hot!", kind: 'word', hint: 'mah-EE-nit', hook: '"Init" is heat, and you will need it daily. "Ang init!" means "so hot!"' },
      { id: 'malamig', tl: 'Malamig.', en: "It's cold.", kind: 'word', hint: 'mah-LAH-mig', note: 'Also "cool" for drinks: "malamig na tubig" is cold water.', hook: '"Lamig" is coldness. Filipino malls are famously "malamig": bring a jacket.' },
      { id: 'masaya', tl: 'masaya', en: 'happy / fun', kind: 'word', hint: 'mah-sah-YAH', hook: '"Saya" is joy. "Masaya!" is also how you say a party was fun.' },
      { id: 'malungkot', tl: 'malungkot', en: 'sad', kind: 'word', hint: 'mah-loong-KOT', hook: 'The long "loong" drags the word down, like a sad face.' },
      { id: 'masakit', tl: 'Masakit.', en: 'It hurts.', kind: 'word', hint: 'mah-sah-KIT', hook: '"Sakit" means pain or illness. Point to where: "Masakit dito", it hurts here.' },
      { id: 'may-sakit-ako', tl: 'May sakit ako.', en: "I'm sick.", kind: 'phrase', hint: 'mai sah-KIT ah-KOH', hook: '"May" (have) + "sakit" (illness): I have an illness. The same "may" as in "May kape ba?".' },
      { id: 'okay-lang-ako', tl: 'Okay lang ako.', en: "I'm okay.", kind: 'phrase', hint: 'oh-KAY lahng ah-KOH', hook: 'English "okay" + "lang" (just): just okay, me. The answer when someone fusses over you.' },
      { id: 'gusto-ko-umuwi', tl: 'Gusto ko nang umuwi.', en: 'I want to go home now.', kind: 'phrase', hint: 'GOOS-toh koh nahng oo-MOO-wee', hook: '"Uwi" (go home) from "Pauwi na ako", made a verb with "-um-": umuwi. "Nang" links it to "gusto ko".' },
    ],
  },
  {
    id: 'actions',
    title: 'Doing things',
    tlTitle: 'Mga Gawain',
    intro: 'Doing words for an ordinary day. Most are a root with "-um-" slotted in (kain, kumain) or "mag-" in front (luto, magluto): the tricks you know from "sumakay" and "kumaliwa".',
    cards: [
      { id: 'kumain', tl: 'kumain', en: 'to eat', kind: 'word', hint: 'koo-mah-EEN', hook: '"Kain" (eat) from "Kain tayo!", with "-um-" slotted in: k-um-ain, the trick from "sumakay".' },
      { id: 'uminom', tl: 'uminom', en: 'to drink', kind: 'word', hint: 'oo-mee-NOM', hook: '"Inom" is drink. Before a vowel "-um-" goes at the front: um-inom. "Inuman" is a night of drinks with friends.' },
      { id: 'matulog', tl: 'matulog', en: 'to sleep', kind: 'word', hint: 'mah-TOO-log', hook: '"Tulog" is sleep, and "ma-" makes it a doing word. "Tulog na!" is "go to sleep!"' },
      { id: 'maligo', tl: 'maligo', en: 'to take a bath / shower', kind: 'word', hint: 'mah-LEE-goh', hook: '"Ligo" is a wash. In the heat many Filipinos "maligo" twice a day, and "maligo sa dagat" is a swim in the sea.' },
      { id: 'pumunta', tl: 'pumunta', en: 'to go (somewhere)', kind: 'word', hint: 'poo-MOON-tah', hook: 'The "punta" of "Papunta na ako", with "-um-": p-um-unta.' },
      { id: 'dumating', tl: 'dumating', en: 'to arrive', kind: 'word', hint: 'doo-mah-TING', hook: '"Dating" is arrival, with "-um-": d-um-ating. "Dumating na!" is "it\'s here!", for a delivery or a late jeepney.' },
      { id: 'maghintay', tl: 'maghintay', en: 'to wait', kind: 'word', hint: 'mahg-hin-TAI', hook: '"Hintay" from "Hintayin mo ako", with "mag-" in front: to wait. "Maghintay ka lang" is "just wait".' },
      { id: 'bumili', tl: 'bumili', en: 'to buy', kind: 'word', hint: 'boo-mee-LEE', hook: '"Bili" (buy) from "Pabili po", with the "-um-" trick: b-um-ili.' },
      { id: 'magbayad', tl: 'magbayad', en: 'to pay', kind: 'word', hint: 'mahg-BAH-yahd', hook: '"Bayad" (payment) from "Bayad po", with "mag-" to make it a doing word.' },
      { id: 'magluto', tl: 'magluto', en: 'to cook', kind: 'word', hint: 'mahg-LOO-toh', hook: '"Luto" is cooking. A sign saying "lutong bahay" promises home cooking.' },
      { id: 'magtrabaho', tl: 'magtrabaho', en: 'to work', kind: 'word', hint: 'mahg-trah-BAH-hoh', hook: '"Mag-" + Spanish "trabajo" (work). "Mag-" turns plenty of borrowed words into doing words, as in "mag-English".' },
      { id: 'maglakad', tl: 'maglakad', en: 'to walk', kind: 'word', hint: 'mahg-LAH-kahd', hook: '"Lakad" is a walk, and also an errand: "May lakad ako" is "I have somewhere to be".' },
      { id: 'magsalita', tl: 'magsalita', en: 'to speak', kind: 'word', hint: 'mahg-sah-lee-TAH', hook: '"Salita" is a word. "Mag-" + "salita": to make words, to speak.' },
      { id: 'makinig', tl: 'makinig', en: 'to listen', kind: 'word', hint: 'mah-kee-NIG', hook: '"Makinig ka!" is "Listen!", heard from every teacher and every lola.' },
      { id: 'tumulong', tl: 'tumulong', en: 'to help', kind: 'word', hint: 'too-MOO-long', hook: '"Tulong" (help) from "Tulong!", with "-um-": t-um-ulong. The shout becomes the doing word.' },
      { id: 'umupo', tl: 'umupo', en: 'to sit down', kind: 'word', hint: 'oo-moo-POH', hook: '"Upo" is sit, with "-um-" at the front like "uminom". "Upo ka" is "have a seat".' },
      { id: 'magpahinga', tl: 'magpahinga', en: 'to rest', kind: 'word', hint: 'mahg-pah-hee-NGAH', hook: '"Hinga" is breath, so "pahinga" is a breather. "Magpahinga ka" is "get some rest".' },
      { id: 'maglaro', tl: 'maglaro', en: 'to play', kind: 'word', hint: 'mahg-lah-ROH', hook: '"Laro" is a game. Kids out in the "kalye" after school are "naglalaro", playing.' },
    ],
  },
  {
    id: 'describing',
    title: 'Describing things',
    tlTitle: 'Paglalarawan',
    intro: 'Most describing words are "ma-" and a root, like masarap and malaki. Put "ang" before the root instead and it becomes "how ...!": "Ang ganda!", how beautiful!',
    cards: [
      { id: 'maganda', tl: 'maganda', en: 'beautiful', kind: 'word', hint: 'mah-gahn-DAH', hook: '"Ang ganda!" is "How beautiful!". With "-ng" it joins the next word: "Magandang umaga", a beautiful morning, is good morning.' },
      { id: 'pangit', tl: 'pangit', en: 'ugly', kind: 'word', hint: 'PAH-ngit', hook: 'The opposite of "maganda". "Ang pangit!" is "so ugly!", for a bad haircut or bad weather.' },
      { id: 'mabait', tl: 'mabait', en: 'kind (person)', kind: 'word', hint: 'mah-bah-EET', hook: '"Bait" is goodness of heart. "Mabait siya" is about the best thing anyone can say of you.' },
      { id: 'marami', tl: 'marami', en: 'many / a lot', kind: 'word', hint: 'mah-RAH-mee', hook: '"Dami" is an amount, so "ma-rami" is a lot of it. With "-ng" it joins the next word: "Maraming salamat", many thanks.' },
      { id: 'bago', tl: 'bago', en: 'new', kind: 'word', hint: 'BAH-goh', hook: 'The "bago" in "Bagong Taon", New Year. It also means "before": "bago kumain", before eating.' },
      { id: 'luma', tl: 'luma', en: 'old (for things)', kind: 'word', hint: 'LOO-mah', hook: 'For things, unlike "matanda": "lumang bahay", an old house.' },
      { id: 'matanda', tl: 'matanda', en: 'old (for people)', kind: 'word', hint: 'mah-tahn-DAH', hook: '"Tanda" is age. Respect for "matatanda", the elders, is why Tagalog has "po".' },
      { id: 'mabilis', tl: 'mabilis', en: 'fast', kind: 'word', hint: 'mah-bee-LIS', hook: '"Bilis" is speed. "Bilisan mo!" is "hurry up!"' },
      { id: 'mabagal', tl: 'mabagal', en: 'slow', kind: 'word', hint: 'mah-BAH-gahl', hook: '"Bagal" is slowness: the opposite of "mabilis", and what traffic always is. Asking someone to slow down is still "Dahan-dahan lang".' },
      { id: 'madali', tl: 'madali', en: 'easy', kind: 'word', hint: 'mah-dah-LEE', hook: '"Dali" is ease and quickness. "Dali!" on its own means "quick!"' },
      { id: 'mahirap', tl: 'mahirap', en: 'hard / poor', kind: 'word', hint: 'mah-HEE-rahp', hook: '"Hirap" is hardship, so one word covers difficult and poor. "Mahirap ba ang Tagalog?" Not so much.' },
      { id: 'malinis', tl: 'malinis', en: 'clean', kind: 'word', hint: 'mah-LEE-nis', hook: '"Linis" is cleaning. "Maglinis tayo!" is "let\'s tidy up!"' },
      { id: 'marumi', tl: 'marumi', accept: ['madumi'], en: 'dirty', kind: 'word', hint: 'mah-roo-MEE', note: 'You will also hear "madumi".', hook: '"Dumi" is dirt, with the d softened to r between vowels, as in "makikiraan". The opposite of "malinis".' },
      { id: 'mabango', tl: 'mabango', en: 'nice-smelling', kind: 'word', hint: 'mah-bah-NGOH', hook: '"Bango" is a good smell: fresh laundry, rice cooking, sampaguita flowers. Compliment someone\'s perfume with it.' },
      { id: 'mabaho', tl: 'mabaho', en: 'smelly', kind: 'word', hint: 'mah-BAH-hoh', hook: 'One sound from "mabango", and the nose tells them apart. "Baho" is a stink.' },
    ],
  },
  {
    id: 'colours',
    title: 'Colours',
    tlTitle: 'Mga Kulay',
    intro: 'Point and name it at a stall. Red, white, black and yellow are Tagalog words; blue and green come from Spanish.',
    cards: [
      { id: 'kulay', tl: 'kulay', en: 'colour', kind: 'word', hint: 'KOO-lai', hook: '"Anong kulay?" asks what colour. "Makulay", colourful, describes every jeepney.' },
      { id: 'pula', tl: 'pula', en: 'red', kind: 'word', hint: 'poo-LAH', hook: 'The red on the flag. Going red in the face is "namumula".' },
      { id: 'puti', tl: 'puti', en: 'white', kind: 'word', hint: 'poo-TEE', hook: 'The white triangle on the flag, and the colour of a plate of "kanin".' },
      { id: 'itim', tl: 'itim', en: 'black', kind: 'word', hint: 'ee-TIM', hook: 'Sounds like "item": a little black item, like a phone left on the table.' },
      { id: 'asul', tl: 'asul', en: 'blue', kind: 'word', hint: 'ah-SOOL', hook: 'Spanish "azul". The blue stripe on the flag.' },
      { id: 'berde', tl: 'berde', en: 'green', kind: 'word', hint: 'BER-deh', hook: 'Spanish "verde", with the v turned to b, as in "baso" and "Biyernes".' },
      { id: 'dilaw', tl: 'dilaw', en: 'yellow', kind: 'word', hint: 'dee-LAOW', hook: 'The yellow of the sun and stars on the flag, and of a ripe "mangga".' },
    ],
  },
  {
    id: 'weather',
    title: 'Weather',
    tlTitle: 'Panahon',
    intro: 'Two seasons, hot and rainy, and plenty of small talk about both. You already know "Mainit!".',
    cards: [
      { id: 'panahon', tl: 'panahon', en: 'weather', kind: 'word', hint: 'pah-nah-HON', hook: 'It also means time or era: "noong panahon ng Kastila" is "back in Spanish times".' },
      { id: 'maaraw', tl: 'Maaraw.', en: "It's sunny. / Sunny", kind: 'word', hint: 'mah-AH-raow', hook: '"Araw" (sun, day) with "ma-": sunny. The same trick as "mainit".' },
      { id: 'umuulan', tl: 'Umuulan.', en: "It's raining. / Raining", kind: 'word', hint: 'oo-moo-oo-LAHN', hook: '"Ulan" is rain. "-um-" and the doubled "u" make it happening right now.' },
      { id: 'payong', tl: 'payong', en: 'umbrella', kind: 'word', hint: 'PAH-yong', hook: 'For rain and for sun alike: at noon you will see plenty of "payong" open under a clear sky.' },
      { id: 'mahangin', tl: 'Mahangin.', en: "It's windy. / Windy", kind: 'word', hint: 'mah-HAH-ngin', hook: '"Hangin" is wind and air. Said of a show-off, "mahangin" means full of hot air.' },
      { id: 'bagyo', tl: 'bagyo', en: 'typhoon', kind: 'word', hint: 'bahg-YOH', note: 'A strong one closes schools and offices: "Walang pasok", no school or work today.', hook: 'About twenty a year pass near the Philippines, so "May bagyo" (there\'s a typhoon) is everyday news.' },
      { id: 'tag-init', tl: 'tag-init', en: 'hot season / summer', kind: 'word', hint: 'tahg-EE-nit', hook: '"Tag-" means the season of, and "init" is heat, from "Mainit!". March to May: beach time.' },
      { id: 'tag-ulan', tl: 'tag-ulan', en: 'rainy season', kind: 'word', hint: 'tahg-oo-LAHN', hook: 'The season of "ulan", rain, from "Umuulan". Roughly June to October.' },
    ],
  },
  {
    id: 'phone',
    title: 'Phone & messages',
    tlTitle: 'Sa Telepono',
    intro: 'Plans happen by text. Taglish is at home here: "I-text mo ako" is perfectly normal.',
    cards: [
      { id: 'selpon', tl: 'selpon', en: 'mobile phone', kind: 'word', hint: 'SEL-pon', hook: 'English "cellphone", said the Tagalog way. Often just "CP".' },
      { id: 'i-text-mo-ako', tl: 'I-text mo ako.', en: 'Text me.', kind: 'phrase', hint: 'ee-TEKST moh ah-KOH', hook: 'English "text" with "i-" to make it a Tagalog doing word, then "mo ako": you, me.' },
      { id: 'tawagan-mo-ako', tl: 'Tawagan mo ako.', en: 'Call me.', kind: 'phrase', hint: 'tah-WAH-gahn moh ah-KOH', hook: '"Tawag" (call), from "Tumawag ka ng pulis!", with "-an": call me up.' },
      { id: 'sino-ito', tl: 'Sino ito?', en: 'Who is this?', kind: 'phrase', hint: 'SEE-noh ee-TOH', hook: '"Sino" (who) + "ito" (this): the reply to a text from a number you don\'t know.' },
      { id: 'ano-numero-mo', tl: 'Anong number mo?', accept: ['Ano ang numero mo?', 'Anong numero mo?', 'Anong namber mo?', 'Ano ang namber mo?'], en: "What's your number?", kind: 'phrase', hint: 'ah-NONG NUM-ber moh', note: 'Phone numbers are nearly always said in English, so the word is too.', hook: 'English "number" in the shape of "Anong pangalan mo?". Taglish at work.' },
      { id: 'walang-signal', tl: 'Walang signal.', en: "There's no signal.", kind: 'phrase', hint: 'wah-LAHNG SIG-nahl', hook: '"Wala" (none) + "-ng" + English "signal". The excuse for every missed call.' },
    ],
  },
  {
    id: 'help',
    title: 'Help & emergencies',
    tlTitle: 'Tulong',
    intro: 'Hopefully you won\'t need these, but they are worth having ready.',
    cards: [
      { id: 'tulong', tl: 'Tulong!', en: 'Help!', kind: 'word', hint: 'TOO-long', hook: 'Sounds like "too long": you have waited too long, shout for help.' },
      { id: 'pakitulungan', tl: 'Pakitulungan mo ako.', en: 'Please help me.', kind: 'phrase', hint: 'pah-kee-too-LOO-ngahn moh ah-KOH', hook: '"Paki-" (please) from "Pakiulit" + "tulong" (help). Politeness works even in a hurry.' },
      { id: 'naliligaw-ako', tl: 'Naliligaw ako.', en: "I'm lost.", kind: 'phrase', hint: 'nah-lee-LEE-gaow ah-KOH', hook: '"Ligaw" means astray, wild: a stray dog is an "asong ligaw". Right now, you are the stray.' },
      { id: 'nawala-bag', tl: 'Nawala ang bag ko.', en: 'I lost my bag.', kind: 'phrase', hint: 'nah-WAH-lah ahng bahg koh', hook: '"Nawala" means went missing, from "wala" (none). Your bag became "wala".' },
      { id: 'tumawag-pulis', tl: 'Tumawag ka ng pulis!', en: 'Call the police!', kind: 'phrase', hint: 'too-mah-WAHG kah nahng poo-LEES', hook: '"Tawag" is call, with the "-um-" verb trick: t-um-awag. "Pulis" is police, spelled the Tagalog way.' },
      { id: 'kailangan-doktor', tl: 'Kailangan ko ng doktor.', en: 'I need a doctor.', kind: 'phrase', hint: 'kah-ee-LAH-ngahn koh nahng dok-TOR', hook: '"Kailangan ko" (I need) + "ng" + the thing. Swap in anything you need.' },
      { id: 'nasaan-ospital', tl: 'Nasaan ang ospital?', en: 'Where is the hospital?', kind: 'phrase', hint: 'nah-sah-AHN ahng os-pee-TAHL', hook: 'The "Nasaan ang banyo?" pattern again, with "ospital". It works for any place.' },
      { id: 'gamot', tl: 'gamot', en: 'medicine', kind: 'word', hint: 'gah-MOT', hook: 'Buy it at the botika. "Magpagamot" is to get yourself treated, built on the same root.' },
      { id: 'delikado', tl: 'Delikado!', en: 'Dangerous!', kind: 'word', hint: 'deh-lee-KAH-doh', hook: 'Spanish "delicado", delicate. In Tagalog delicate turned into dangerous.' },
      { id: 'tama-na', tl: 'Tama na!', en: "Stop it! / That's enough!", kind: 'phrase', hint: 'TAH-mah nah', hook: '"Tama" (right, correct) + "na" (already): it\'s right already, that\'s enough.' },
      { id: 'sunog', tl: 'Sunog!', en: 'Fire!', kind: 'word', hint: 'SOO-nog', hook: '"Sunog" is a fire, and also burnt: "sunog na kanin" is rice burnt to the bottom of the pot.' },
      { id: 'magnanakaw', tl: 'Magnanakaw!', en: 'Thief!', kind: 'word', hint: 'mahg-nah-NAH-kaow', hook: '"Nakaw" means steal. "Mag-" and the doubled "na" make it the one who steals.' },
    ],
  },
];

/** Every vocabulary card, by topic. */
export const VOCAB: Card[] = UNITS.flatMap((u) => u.cards);

export const ALL_CARDS: Card[] = [...VOCAB, ...GUIDES];

/**
 * The little words that hold phrases together: I, you, we, my, your, the, this,
 * already, just, to, of, the question "ba", polite "po" and "not". Each has its
 * own card, as do the other words several phrases share (how, to say, there is,
 * want, need, can), met before any phrase that uses it (see buildsOn), so a new
 * phrase is never several unknowns at once. A word used in only one phrase can
 * be learned in it, one per phrase (deck.test.ts checks both).
 */
export const CORE_WORDS: readonly string[] = [
  'ako', 'ikaw', 'ka', 'ko', 'mo', 'tayo', 'ang', 'ito', 'na', 'lang', 'sa', 'ba', 'ng', 'po', 'hindi',
];

/**
 * Cards close enough in meaning that one is never offered as a wrong answer
 * for another: "ko" can mean "I", "mo" and "kayo" can mean "you", "na" can mean
 * "now", a "bata" may be someone's "anak", "panganay" or "bunso" (though those
 * two are opposites, so each is offered for the other), "luma" and "matanda"
 * are both "old", a "magulang" is a "nanay" or "tatay", Ate and Kuya are each a "kapatid", "No problem" and "No worries" are ways to say "You're welcome",
 * a word and the phrase that teaches it in use ("puwede" and "Puwede ba?") mean much the same, "nasaan" and
 * "saan" are both "where", "gaano" and "paano" both "how", "may" and "meron" both "there is", "sabihin" (to say)
 * is close to "magsalita" (to speak), and a hello, a goodbye or a "what's up?" can each be said several ways.
 */
export const CLOSE_MEANINGS: readonly (readonly string[])[] = [
  ['ako', 'ko'], ['ikaw', 'ka', 'mo', 'kayo'], ['na', 'ngayon'], ['anak', 'bata', 'panganay'], ['anak', 'bata', 'bunso'], ['luma', 'matanda'],
  ['magulang', 'nanay', 'tatay'],
  ['kapatid', 'ate', 'kuya'], ['walang-problema', 'walang-anuman', 'wala-yon', 'ayos-lang'],
  ['saan', 'nasaan'], ['paano', 'gaano'], ['may', 'meron'], ['puwede', 'puwede-ba'], ['kailangan', 'kailangan-ko'], ['gusto', 'gusto-ko-ito'],
  ['sabihin', 'magsalita'], ['mauna-na-ako', 'aalis-na-ako'], ['uy', 'kumusta', 'ikaw-pala'], ['anong-meron', 'anong-balita'],
  ['maghintay', 'teka'], ['tumulong', 'tulong'],
];

/**
 * The order new cards are introduced in, most useful first, across topics. Topics
 * only group cards for display. Each tier is roughly what a learner needs next to
 * get by in conversation; within a tier, cards a hook builds on come first, and
 * a phrase comes after every word in it that has a card of its own (buildsOn). A
 * phrase also waits for those words to settle (upcomingNewCards in session.ts),
 * so a phrase placed right after its words comes a day or so after them. Every
 * card appears exactly once (deck.test.ts checks both).
 */
export const LEARN_ORDER: readonly string[] = [
  // Hello, thanks, yes, no, and getting through a conversation you barely follow. The words a phrase is
  // built from (I, you, my, the, already, how, to say) come before it, so each phrase brings one new thing.
  'kumusta', 'uy', 'mabuti', 'salamat', 'oo', 'hindi', 'po', 'opo', 'salamat-po', 'wala', 'walang-anuman',
  'wala-yon',
  'ano', 'sige', 'ako', 'ikaw', 'ako-si', 'taga-ako', 'ka', 'taga-saan', 'mo', 'ang', 'ano-pangalan', 'paalam',
  'ingat', 'na', 'mauna-na-ako', 'pasensya-na', 'ko', 'hindi-ko-alam', 'hindi-maintindihan', 'pakiulit', 'ito',
  'sa', 'paano', 'sabihin', 'paano-sabihin', 'ano-ibig-sabihin', 'lang', 'dahan-dahan', 'kaunti-lang', 'ba',
  'ingles',
  // Guides (guides.ts) wait for the cards they build on and come in slowly (session.ts), so they sit
  // roughly where they would first be useful.
  'k-psst', 's-letters', 'p-po', 't-ha',
  // Asking for things: where, what, how much, I want, I need, can I.
  'saan', 'nasaan', 'nasaan-banyo', 'ano-ito', 'magkano', 'gusto', 'gusto-ko-ito', 'ayoko', 'kape', 'may',
  'may-kape-ba',
  'meron', 'puwede', 'puwede-ba', 'kailangan', 'kailangan-ko', 'dito', 'isa', 'dalawa', 'tatlo', 'apat', 'lima',
  'anim', 'pito',
  'walo', 'siyam', 'sampu', 'tara-na', 'sandali-lang',
  'p-ba', 'p-hindi', 'p-may', 'k-eyebrows',
  // Where you are and when: on my way, here, almost there, now, later, tomorrow.
  'nasaan-ka', 'saan-ka-pupunta', 'saan-ka-galing', 'diyan', 'diyan-lang', 'papunta-na-ako', 'nandito-na-ako',
  'malapit', 'malapit-na-ako', 'kailan', 'ngayon',
  'mamaya', 'kanina', 'mamaya-na-lang', 'bukas', 'oras', 'anong-oras-na', 'sino', 'bakit',
  'p-si', 's-ng',
  // Thanks and greetings, eating together, and the small replies that keep a chat going.
  'marami', 'maraming-salamat', 'maganda', 'magandang-umaga', 'magandang-hapon', 'magandang-gabi', 'tayo',
  'kain-tayo', 'tubig',
  'masarap', 'busog-na-ako', 'gutom-na-ako', 'okay-lang-ba', 'okay-lang-ako', 'ayos-lang', 'talaga', 'oo-nga',
  'ako-rin', 'tama', 'ikaw-pala', 'anong-meron',
  'k-taglish', 'p-first', 't-rise', 't-soft', 's-stress', 'k-kain', 's-r',
  // Directions and getting a ride, and running late.
  'kaliwa', 'kanan', 'diretso', 'doon', 'malayo', 'pumunta', 'palengke', 'paano-pumunta', 'ate', 'kuya',
  'para-po', 'bayad-po', 'aalis-na-ako', 'pauwi-na-ako', 'nasaan-ka-na', 'mahuhuli-ako', 'hintayin-mo-ako',
  'teka',
  'k-kuya',
  // More people words and joiners, ordering a drink, and buying things.
  'siya', 'kami', 'sila', 'at', 'pero', 'kasi', 'naku', 'grabe', 'siguro', 'kanin', 'ng',
  'pahingi-tubig', 'bill-po', 'pa', 'isa-pa', 'ito-na-lang', 'iyan', 'iyon', 'mahal', 'mura', 'magkano-lahat',
  'ilan',
  'pabili-po', 'kayo', 'tinapay', 'meron-ba-kayong',
  'p-gusto', 's-sh', 't-react',
  // Clock times, and the parts of the day.
  'ala-una', 'alas-dos', 'alas-tres', 'kalahati', 'alas-singko', 'alas-sais', 'alas-siyete', 'alas-otso',
  'alas-diyes', 'alas-dose', 'kahapon', 'alas-siyete-umaga', 'alas-otso-gabi',
  // Making plans, and hedging.
  'libre-ka-ba', 'ano-ang-plano', 'saan-tayo-magkikita', 'anong-oras-magkikita', 'kita-tayo-bukas',
  'puwede-ako', 'hindi-ako-puwede', 'baka', 'ewan-ko', 'hindi-naman', 'ano-ulit', 'ganoon-ba',
  'p-paki',
  // How you feel, getting help, home and family.
  'pagod-na-ako', 'mainit', 'masakit', 'may-sakit-ako', 'tulong', 'pakitulungan', 'naliligaw-ako', 'bahay',
  'nasa-bahay-ako', 'kaibigan', 'nanay', 'tatay', 'anak', 'mahal-kita', 'anong-balita',
  'p-glue', 'p-ang',
  // More questions and reactions.
  'alin', 'gaano', 'gaano-katagal', 'gaano-kalayo', 'anong-ginagawa-mo', 'trapik', 'sayang', 'tama-na',
  'makikiraan-po',
  // Days and weeks, riding, and where things are.
  'araw', 'linggo', 'tanghali', 'susunod-na-linggo', 'noong-isang-linggo', 'lagi', 'minsan', 'kaagad',
  'sumakay', 'bumaba', 'dyip', 'sa-tabi-lang', 'kumaliwa-ka', 'kumanan-ka', 'katabi', 'sa-harap', 'sa-likod',
  'kanto', 'kalye',
  'p-sa',
  // Places in town, and eating out.
  'tindahan', 'paaralan', 'kainan', 'ospital', 'botika', 'nasaan-ospital', 'kailangan-doktor',
  'gamot', 'ano-masarap-dito', 'maanghang', 'huwag-maanghang', 'ulam', 'manok', 'isda', 'baso', 'kutsara',
  'tinidor', 'isa-pong-adobo',
  // Money and shopping.
  'pera', 'piso', 'sukli', 'barya', 'dalawampu', 'limampu', 'isang-daan', 'limang-daan', 'isang-libo',
  'tumawad', 'tumitingin-lang', 'wala-na', 'malaki', 'maliit',
  'p-when',
  // Less everyday feelings, plans and family.
  'nauuhaw-ako', 'inaantok-ako', 'malamig', 'masaya', 'malungkot', 'gusto-ko-umuwi', 'sasama-ako',
  'tuloy-ba-tayo', 'mga', 'p-mga', 'para-saan', 'kanino', 'lola', 'lolo', 'tita', 'tito',
  // Rarer places, dates and emergencies.
  'simbahan', 'opisina', 'bangko', 'paliparan', 'buwan', 'taon', 'lunes', 'biyernes', 'sabado', 'hatinggabi',
  'nawala-bag', 'tumawag-pulis', 'delikado', 'bahala-na',
  // The formal "nice to meet you", there to recognise: people say it in English.
  'ikinagagalak',
  // Have you eaten? Small talk about home, work and family, and the replies that go with it.
  'kumain', 'kumain-ka-na-ba', 'kumain-na-ako', 'hindi-pa', 'tao-po', 'tuloy-po-kayo', 'saan-ka-nakatira',
  'ano-trabaho-mo',
  'ilang-taon-ka-na', 'asawa', 'may-asawa-ka-na-ba', 'pamilya', 'lalaki', 'babae', 'kapatid', 'bata',
  'magulang', 'pinsan', 'apo', 'pamangkin', 'panganay', 'bunso', 'ninang', 'ninong',
  'walang-problema', 'ikaw-ang-bahala', 'sigurado-ka-ba', 'sana',
  // Doing words for an ordinary day.
  'uminom', 'matulog', 'matutulog-na-ako', 'gising-ka-na-ba', 'maligo', 'dumating',
  'maghintay', 'bumili', 'magbayad', 'magluto', 'magtrabaho', 'maglakad', 'magsalita', 'makinig', 'tumulong',
  'umupo', 'magpahinga', 'maglaro',
  // Describing things and people.
  'pangit', 'mabait', 'bago', 'matanda', 'luma', 'mabilis', 'mabagal', 'madali',
  'mahirap', 'malinis', 'marumi', 'mabango', 'mabaho',
  // Meals and the market, and colours to point with.
  'almusal', 'tanghalian', 'hapunan', 'itlog', 'baboy', 'karne-ng-baka', 'gulay', 'prutas', 'saging', 'mangga',
  'gatas', 'asukal', 'asin', 'kulay', 'pula', 'puti', 'itim', 'asul', 'berde', 'dilaw',
  // Phones, and the weather.
  'selpon', 'i-text-mo-ako', 'tawagan-mo-ako', 'sino-ito', 'ano-numero-mo', 'walang-signal',
  'panahon', 'maaraw', 'umuulan', 'payong', 'mahangin', 'bagyo', 'tag-init', 'tag-ulan',
  // Bigger numbers, the rest of the week, and emergencies.
  'labing-isa', 'labindalawa', 'labinlima', 'tatlumpu', 'apatnapu', 'dalawang-daan', 'martes', 'miyerkoles',
  'huwebes', 'sunog', 'magnanakaw',
];

const byId = new Map(ALL_CARDS.map((c) => [c.id, c]));

export function getCard(id: string): Card | undefined {
  return byId.get(id);
}

/** The words of some Tagalog, lower case, without punctuation. */
export function tagalogWords(tl: string): string[] {
  return tl.toLowerCase().split(/[^a-z'-]+/).filter((w) => /[a-z]/.test(w));
}

/** Words with a card of their own: a one-word card, or the card named after the word ("magkano" is "Magkano ito?"). */
const wordCards = new Map<string, string>();
for (const c of VOCAB) {
  const words = tagalogWords(c.tl);
  if (words.length === 1) wordCards.set(words[0], c.id);
}
for (const c of VOCAB) if (!wordCards.has(c.id)) wordCards.set(c.id, c.id);

/**
 * The card that teaches a word of a phrase, if one does: the word's own card, or
 * the one it joins the next word with by adding "-ng" ("walang", "anong", "pong",
 * "ilang"); "nito" is "of this", "ito".
 */
export function cardForWord(word: string): string | undefined {
  if (word === 'nito') return 'ito';
  return wordCards.get(word) ?? (word.endsWith('ng') ? wordCards.get(word.slice(0, -2)) ?? wordCards.get(word.slice(0, -1)) : undefined);
}

const foundations = new Map<string, string[]>();

/**
 * The cards a card builds on, which have to settle before it's introduced (see
 * upcomingNewCards in session.ts): a guide's `needs`, and for a phrase, the cards
 * of the words it is made of, so it never asks for words the learner hasn't met.
 */
export function buildsOn(card: Card): string[] {
  if (!isVocab(card)) return card.needs ?? [];
  let ids = foundations.get(card.id);
  if (!ids) {
    ids = [...new Set(tagalogWords(card.tl).map(cardForWord))].filter((id): id is string => !!id && id !== card.id);
    foundations.set(card.id, ids);
  }
  return ids;
}

/** Whether two cards are close enough in meaning to both be right answers (see CLOSE_MEANINGS). */
export function closeInMeaning(a: string, b: string): boolean {
  return CLOSE_MEANINGS.some((group) => group.includes(a) && group.includes(b));
}

export function unitOf(cardId: string): Unit | undefined {
  return UNITS.find((u) => u.cards.some((c) => c.id === cardId));
}
