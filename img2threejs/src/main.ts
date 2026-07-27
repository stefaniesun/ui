import './styles.css';
import { mountCivicPreview } from './preview/mountCivicPreview';

const host = document.querySelector<HTMLElement>('#app');

if (!host) {
  throw new Error('Missing #app host element');
}

mountCivicPreview(host);
