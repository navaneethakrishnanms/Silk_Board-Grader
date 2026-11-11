import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver (used by the region editor to size its canvas)
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
