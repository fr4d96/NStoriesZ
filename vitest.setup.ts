import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement IntersectionObserver -- components/home/reveal.tsx
// (the scroll-reveal-on-view wrapper used throughout the home page) needs
// one to mount at all. This stub treats every observed element as already
// intersecting, so reveal-wrapped content renders visible immediately in
// tests rather than staying hidden forever.
class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  constructor(
    private callback: IntersectionObserverCallback,
    private options?: IntersectionObserverInit,
  ) {}
  observe(target: Element) {
    this.callback(
      [
        {
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
          rootBounds: null,
          time: 0,
        } as IntersectionObserverEntry,
      ],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

global.IntersectionObserver = MockIntersectionObserver;

// jsdom's <dialog> support is a bare stub (the `open` attribute reflects,
// but showModal()/close() aren't implemented at all) -- components/auth/
// auth-modal.tsx needs both. This polyfill is just enough to exercise real
// open/close behavior in tests: showModal() sets the `open` attribute
// (matching what real browsers do, and what our component's open-state
// guard checks via `dialog.open`), close() clears it and fires the native
// "close" event React's onClose prop listens for.
// Guarded: some test files (e.g. lib/story/image-pipeline.test.ts) run in
// Vitest's plain "node" environment rather than jsdom, where this global
// doesn't exist at all.
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
