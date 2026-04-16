import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { Studio, StudioState } from './studio';
import type { UiState, UiStore } from './uiStore';
import type { OrbitRig } from '../components/stage/orbitRig';

export interface AppServices {
  readonly studio: Studio;
  readonly ui: UiStore;
  readonly rig: OrbitRig;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('CUBELAB services are not available.');
  return services;
}

/** Subscribe to a slice of studio state. Selectors must return stable references. */
export function useStudio<T>(selector: (state: StudioState) => T): T {
  return useStore(useServices().studio.store, selector);
}

export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(useServices().ui, selector);
}
