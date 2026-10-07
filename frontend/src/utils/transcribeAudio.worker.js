let transcriberPromise;

const getTranscriber = async () => {
  transcriberPromise ||= (async () => {
    self.postMessage({ type: 'progress', message: 'Loading the local speech recognition model (first run may take a few minutes)...' });
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2');
    env.backends.onnx.wasm.numThreads = 1;
    return pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      progress_callback: event => {
        if (event.status === 'progress' && Number.isFinite(event.progress)) {
          self.postMessage({ type: 'progress', message: `Downloading speech model: ${Math.round(event.progress)}%` });
        }
      }
    });
  })();
  return transcriberPromise;
};

const resampleTo16k = (audio, sampleRate) => {
  if (sampleRate === 16000) return audio;
  const outputLength = Math.floor(audio.length * 16000 / sampleRate);
  const output = new Float32Array(outputLength);
  const ratio = sampleRate / 16000;
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const fraction = sourceIndex - left;
    const right = Math.min(left + 1, audio.length - 1);
    output[index] = audio[left] * (1 - fraction) + audio[right] * fraction;
  }
  return output;
};

const cleanTranscript = (value) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const words = text.split(' ');
  const cleaned = [];
  for (const word of words) {
    const previous = cleaned[cleaned.length - 1];
    if (previous && previous.toLowerCase().replace(/[.,!?]/g, '') === word.toLowerCase().replace(/[.,!?]/g, '')) {
      continue;
    }
    cleaned.push(word);
  }

  const result = cleaned.join(' ');
  return result
    .replace(/(?:\bhello\b[\s,.!?]*){3,}/gi, 'Hello. ')
    .replace(/(?:\bhi\b[\s,.!?]*){3,}/gi, 'Hi. ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
};

self.onmessage = async event => {
  try {
    const { audio, sampleRate } = event.data || {};
    if (!(audio instanceof Float32Array) || !audio.length || !sampleRate) {
      throw new Error('The recording did not contain readable audio.');
    }

    self.postMessage({ type: 'progress', message: 'Preparing audio for transcription...' });
    const speechAudio = resampleTo16k(audio, sampleRate);
    self.postMessage({ type: 'progress', message: 'Loading speech recognition and transcribing the conversation...' });
    const transcriber = await getTranscriber();
    const result = await transcriber(speechAudio, {
      sampling_rate: 16000,
      chunk_length_s: 20,
      stride_length_s: 3
    });
    self.postMessage({ type: 'result', transcript: cleanTranscript(result.text) });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'Audio transcription failed.' });
  }
};
