import { eve } from './eve-client.js';
import { BrowserWatch } from './eve-browser-client.js';
export type { BrowserFrame, BrowserViewState } from './eve-browser-client.js';

export const browserWatch = new BrowserWatch(eve);
