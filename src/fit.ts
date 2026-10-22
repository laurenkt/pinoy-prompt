// Whether the screen fits the phone, for style.css: a screen with nothing below
// the fold shouldn't bounce when dragged, but one that runs long (a wrong answer
// with its memory hook, Library) should scroll and bounce as iOS always does.

/** Keeps `fits` on the page while it has nothing below the fold, as `root` and the window change size. */
export function watchFit(root: Element, page: HTMLElement = document.documentElement, win: Window = window): void {
  const check = () => page.classList.toggle('fits', page.scrollHeight <= win.innerHeight);
  new ResizeObserver(check).observe(root);
  win.addEventListener('resize', check);
  check();
}
