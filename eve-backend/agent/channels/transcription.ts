import { defineChannel, POST } from 'eve/channels';
import { transcribeAudio } from '../lib/transcription';

export default defineChannel({
  routes: [POST('/workbench/transcribe', request => transcribeAudio(request))],
});
