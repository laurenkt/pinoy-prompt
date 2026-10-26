// The About page (about.html): the app's look, its card audio for the phrases on the page, and a drill card that
// turns over. It shares nothing else with the app, and keeps no progress.
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

// The drill card turns over with a tap, as in Drills, and by itself every few seconds until it's tapped.
const flip = document.querySelector<HTMLButtonElement>('.about-flip');
if (flip) {
  const turn = (over: boolean) => flip.setAttribute('aria-pressed', String(over));
  let timer: ReturnType<typeof setInterval> | undefined;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    timer = setInterval(() => turn(flip.getAttribute('aria-pressed') !== 'true'), 4000);
  }
  flip.addEventListener('click', () => {
    clearInterval(timer);
    turn(flip.getAttribute('aria-pressed') !== 'true');
  });
}
