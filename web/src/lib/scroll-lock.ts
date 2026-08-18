/**
 * One owner of `body.overflow`, because there is more than one thing that wants it:
 * the mobile navigation and every overlay. When two of them each saved and restored
 * the value themselves, whichever unmounted last wrote back whatever it happened to
 * read on the way in — so opening the nav, then an overlay, then closing both left
 * the page locked and unscrollable until a reload.
 *
 * Counting instead means the page is locked while anything holds it and released
 * exactly once, when the last holder lets go.
 */
let holders = 0;
let restore = '';

/** Locks page scroll. Returns the release for this holder; call it once. */
export function lockScroll() {
  if (holders === 0) {
    restore = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  holders += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) document.body.style.overflow = restore;
  };
}
