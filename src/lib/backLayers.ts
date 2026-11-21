// Phone Back button layers. A screen, sheet or dialog registers a "go back one step" function while it is open.
// The most recently registered layer is the one that answers Back first.
import { useEffect, useRef } from 'react';

type BackLayer = () => void;

const layers: BackLayer[] = [];

/** Adds a layer on top of the stack. Returns a function that removes it. */
export function registerBackLayer(fn: BackLayer): () => void {
  layers.push(fn);
  return () => {
    const i = layers.lastIndexOf(fn);
    if (i !== -1) layers.splice(i, 1);
  };
}

/** Runs the top layer. Returns true if there was one. */
export function runBackLayer(): boolean {
  const top = layers[layers.length - 1];
  if (!top) return false;
  try { top(); } catch { /* a failing layer must not trap the Back button */ }
  return true;
}

/** Registers a Back layer while `active` is true. The latest onBack is always the one called. */
export function useBackLayer(active: boolean, onBack: () => void): void {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    return registerBackLayer(() => ref.current());
  }, [active]);
}
