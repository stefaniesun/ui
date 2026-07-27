import './styles.css';
import { mountCivicPreview } from './preview/mountCivicPreview';

export function bootstrapCivicPreview(host = document.querySelector<HTMLElement>('#app')): () => void {
  if (!host) {
    throw new Error('Missing #app host element');
  }

  return mountCivicPreview(host);
}

bootstrapCivicPreview();
