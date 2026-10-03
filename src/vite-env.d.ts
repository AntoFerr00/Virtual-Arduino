/// <reference types="vite/client" />

declare module 'troika-three-text' {
  export function configureTextBuilder(config: { useWorker?: boolean; defaultFontURL?: string }): void;
}
