// The "i" icon: a small button that shows an explanation in a popover.
//
// Markup (written in index.html):
//   <span class="info"><button type="button" class="info-btn" aria-label="About X">i</button>
//     <span class="info-pop"> ...text, or elements that main.js fills in... </span></span>
//
// Behaviour: hover (mouse) shows it and leaving hides it; a click pins it open and a second click closes it;
// Escape and a click elsewhere close it; keyboard focus shows it; a tap on a touch screen toggles it.
// The popover is moved to <body> so no panel or stacking context of the page can cover it, and is kept inside the viewport.
// An "i" whose popover has no text is hidden (some texts are filled in only when they apply).

const MARGIN = 8; // least distance from the screen edge
const GAP = 6; // between the button and the popover
const LEAVE_MS = 120; // grace time to move the mouse from the button onto the popover

/** Is the popover shown? pinned: opened by a click; hover and focus: the pointer or the keyboard is on it; suppressed: closed by a click or Escape until the pointer leaves. */
export function infoVisible({ pinned, hover, focus, suppressed }) {
  return !!pinned || (!suppressed && !!(hover || focus));
}

/**
 * Where to put a popover of size `pop` {width, height} next to `anchor` {left, top, right, bottom} on a screen of `vw` x `vh`.
 * Below the anchor if it fits (or if there is more room below than above), else above; centred on the anchor, then kept
 * `MARGIN` inside the screen. `maxHeight` is the room left in that direction, for text longer than that. Pure.
 */
export function placePopover(anchor, pop, vw, vh) {
  const below = vh - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  const placement = pop.height <= below || below >= above ? 'below' : 'above';
  const room = Math.max(40, placement === 'below' ? below : above);
  const height = Math.min(pop.height, room);
  const top = placement === 'below' ? anchor.bottom + GAP : anchor.top - GAP - height;
  const centre = (anchor.left + anchor.right) / 2;
  const left = Math.max(MARGIN, Math.min(centre - pop.width / 2, vw - pop.width - MARGIN));
  return { left, top, maxHeight: room, placement };
}

const infos = new Set();
let counter = 0;
let listening = false;

/** Wire up every `.info` under `root` that is not wired yet. Safe to call again. */
export function initInfo(root = document) {
  for (const wrap of root.querySelectorAll('.info')) {
    if (!wrap.dataset.ready) setup(wrap);
  }
  if (!listening) {
    listening = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      for (const i of infos) if (i.shown) { i.s.pinned = false; i.s.suppressed = true; i.update(); }
    });
    document.addEventListener('pointerdown', (e) => {
      for (const i of infos) {
        if (i.s.pinned && !i.btn.contains(e.target) && !i.pop.contains(e.target)) { i.s.pinned = false; i.update(); }
      }
    });
    const move = () => { for (const i of infos) if (i.shown) i.update(); }; // also hides one whose button went away (a narrow screen)
    window.addEventListener('resize', move);
    window.addEventListener('scroll', move, true);
    // A shown popover whose "i" is folded away or hidden (Advanced closed, a note that no longer applies) goes with it.
    new MutationObserver(() => { for (const i of infos) if (i.shown) i.update(); }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] });
  }
}

function setup(wrap) {
  wrap.dataset.ready = '1';
  const btn = wrap.querySelector('.info-btn');
  const pop = wrap.querySelector('.info-pop');
  if (!pop.id) pop.id = `info-pop-${++counter}`;
  pop.setAttribute('role', 'tooltip');
  btn.setAttribute('aria-describedby', pop.id);
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', pop.id);
  pop.hidden = true;
  document.body.append(pop); // above everything: no panel's stacking context can cover it

  const s = { pinned: false, hover: false, focus: false, suppressed: false };
  const self = { s, btn, pop, shown: false, update, place };
  infos.add(self);
  let timer = null;

  function empty() { return pop.textContent.trim() === ''; }
  function place() {
    const a = btn.getBoundingClientRect();
    pop.style.maxHeight = '';
    const p = placePopover(a, { width: pop.offsetWidth, height: pop.scrollHeight }, document.documentElement.clientWidth, document.documentElement.clientHeight);
    pop.style.left = `${p.left}px`;
    pop.style.top = `${p.top}px`;
    pop.style.maxHeight = `${p.maxHeight}px`;
    pop.dataset.placement = p.placement;
  }
  function update() {
    const gone = empty();
    wrap.hidden = gone;
    const show = !gone && !wrap.closest('[hidden]') && btn.getClientRects().length > 0 && infoVisible(s);
    pop.hidden = !show;
    btn.setAttribute('aria-expanded', String(show));
    self.shown = show;
    if (show) place();
  }
  const leaveSoon = () => { clearTimeout(timer); timer = setTimeout(() => { s.hover = false; s.suppressed = false; update(); }, LEAVE_MS); };
  const enter = (e) => { if (e.pointerType === 'touch') return; clearTimeout(timer); s.hover = true; update(); }; // a tap on a touch screen is a click, handled below
  btn.addEventListener('pointerenter', enter);
  pop.addEventListener('pointerenter', enter);
  btn.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') leaveSoon(); });
  pop.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') leaveSoon(); });
  btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) { s.focus = true; update(); } });
  btn.addEventListener('blur', (e) => {
    s.focus = false;
    if (e.relatedTarget && !pop.contains(e.relatedTarget)) s.pinned = false; // tabbed to something else
    update();
  });
  btn.addEventListener('click', () => {
    if (self.shown && s.pinned) { s.pinned = false; s.suppressed = true; } // second click: close, also while the pointer is still on it
    else { s.pinned = true; s.suppressed = false; }
    update();
  });
  new MutationObserver(update).observe(pop, { childList: true, characterData: true, subtree: true });
  update();
}
