import { createPreviewScene } from './createPreviewScene';

export function mountCivicPreview(host: HTMLElement): void {
  host.innerHTML = '<div class="viewport"></div>';
  const viewport = host.querySelector<HTMLElement>('.viewport');

  if (!viewport) {
    throw new Error('Missing preview viewport');
  }

  createPreviewScene(viewport);
}
