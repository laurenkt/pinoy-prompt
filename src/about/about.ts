// The About page (about.html): the app's look, its card audio for the phrases on the page, the two takes the coach
// is shown judging, and a drill card that turns over. It keeps no progress.
import '@fontsource-variable/bricolage-grotesque';
import '../style.css';
import { audioContext, loadClip, playBuffer } from '../audio-engine';
import { clipUrl, play, stop } from '../speech';
import { audioButton } from '../ui';
import plainTake from './salamat-plain.mp3';

// Each phrase marked data-say gets the app's own speaker button (and a slow one with data-slow), playing its clips.
for (const phrase of document.querySelectorAll<HTMLElement>('[data-say]')) {
  const card = { tl: phrase.dataset.say! };
  const buttons = [audioButton(() => void play(card), `Hear "${card.tl}"`)];
  if (phrase.dataset.slow !== undefined) buttons.push(audioButton(() => void play(card, true), `Hear "${card.tl}" slowly`, 'slow'));
  phrase.before(...buttons);
}

/**
 * The two recordings of "Salamat" the coach is shown judging: a plain text-to-speech voice (made once with OpenAI's
 * tts-1, voice alloy, with no instructions) and the app's own first voice, as scripts/screenshots.mjs plays them to it.
 */
const TAKES: Record<string, string> = { plain: plainTake, tuned: clipUrl({ tl: 'Salamat' }, false, 0)! };
for (const slot of document.querySelectorAll<HTMLElement>('[data-take]')) {
  const url = TAKES[slot.dataset.take!];
  slot.replaceWith(
    audioButton(() => {
      stop();
      // Started inside the tap, as iOS needs.
      audioContext();
      void loadClip(url).then((buffer) => playBuffer(buffer));
    }, 'Hear this take'),
  );
}

// The drill card turns over with a tap, as in Drills. Once on screen it turns over by itself, and back, then rests.
const flip = document.querySelector<HTMLButtonElement>('.about-flip');
if (flip) {
  const turn = (over: boolean) => flip.setAttribute('aria-pressed', String(over));
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      timers.push(setTimeout(() => turn(true), 1200), setTimeout(() => turn(false), 13000));
    }, { threshold: 0.6 });
    seen.observe(flip);
  }
  flip.addEventListener('click', () => {
    timers.forEach(clearTimeout);
    turn(flip.getAttribute('aria-pressed') !== 'true');
  });
}
