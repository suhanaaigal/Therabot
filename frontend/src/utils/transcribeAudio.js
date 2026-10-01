export const transcribeAudioBlob = async (blob, onProgress = () => {}) => {
  const audioContext = new AudioContext();
  let decoded;
  try {
    decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await audioContext.close();
  }

  const monoAudio = decoded.numberOfChannels === 1
    ? decoded.getChannelData(0)
    : Float32Array.from({ length: decoded.length }, (_, index) => {
      let total = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        total += decoded.getChannelData(channel)[index];
      }
      return total / decoded.numberOfChannels;
    });

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcribeAudio.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
      const { type, message, transcript } = event.data || {};
      if (type === 'progress') onProgress(message);
      if (type === 'result') {
        worker.terminate();
        if (!transcript) reject(new Error('No speech was detected in the consultation audio.'));
        else resolve(transcript);
      }
      if (type === 'error') {
        worker.terminate();
        reject(new Error(message || 'Audio transcription failed.'));
      }
    };
    worker.onerror = event => {
      worker.terminate();
      reject(new Error(event.message || 'The transcription worker failed.'));
    };
    worker.postMessage({ audio: monoAudio, sampleRate: decoded.sampleRate }, [monoAudio.buffer]);
  });
};
