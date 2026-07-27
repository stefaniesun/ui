import { createPreviewScene } from './createPreviewScene';

export function mountCivicPreview(host: HTMLElement): () => void {
  host.innerHTML = '<div class="viewport"></div>';
  const viewport = host.querySelector<HTMLElement>('.viewport');

  if (!viewport) {
    throw new Error('Missing preview viewport');
  }

  const disposeScene = createPreviewScene(viewport);
  let disposed = false;

  return () => {
    if (disposed) {
      return;
    }

    disposed = true;
    disposeScene();
    host.replaceChildren();
  };
}
