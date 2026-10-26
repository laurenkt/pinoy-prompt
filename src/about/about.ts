// The About page (about.html): the app's look, its card audio for the phrases on the page, and a drill card that
// turns over. It keeps no progress.
import '@fontsource-variable/bricolage-grotesque';
import '../style.css';
import { play } from '../speech';
import { audioButton } from '../ui';

// Each phrase marked data-say gets the app's own speaker button (and a slow one with data-slow), playing its clips.
for (const phrase of document.querySelectorAll<HTMLElement>('[data-say]')) {
  const card = { tl: phrase.dataset.say! };
  const buttons = [audioButton(() => void play(card), `Hear "${card.tl}"`)];
  if (phrase.dataset.slow !== undefined) buttons.push(audioButton(() => void play(card, true), `Hear "${card.tl}" slowly`, 'slow'));
  phrase.before(...buttons);
}

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Calls `start` the first time `el` is mostly on screen. */
function onceSeen(el: Element, start: () => void): void {
  const seen = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    seen.disconnect();
    start();
  }, { threshold: 0.6 });
  seen.observe(el);
}

// The drill card turns over with a tap, as in Drills. Once on screen it turns over by itself, and back, then rests.
const flip = document.querySelector<HTMLButtonElement>('.about-flip');
if (flip) {
  const turn = (over: boolean) => flip.setAttribute('aria-pressed', String(over));
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (!still) onceSeen(flip, () => timers.push(setTimeout(() => turn(true), 1200), setTimeout(() => turn(false), 13000)));
  flip.addEventListener('click', () => {
    timers.forEach(clearTimeout);
    turn(flip.getAttribute('aria-pressed') !== 'true');
  });
}

// A long screenshot scrolls down and back once inside its phone when it comes on screen.
for (const shot of document.querySelectorAll('.about-scroll')) onceSeen(shot, () => shot.classList.add('moving'));
