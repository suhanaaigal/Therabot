let whisperPipelinePromise;

const getWhisperPipeline = async () => {
  whisperPipelinePromise ||= new Function('url', 'return import(url)')(
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2'
  ).then(({ pipeline }) => pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en'));
  return whisperPipelinePromise;
};

export const transcribeAudioBlob = async blob => {
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

  const transcriber = await getWhisperPipeline();
  const result = await transcriber(monoAudio, {
    sampling_rate: decoded.sampleRate,
    chunk_length_s: 30,
    stride_length_s: 5
  });
  const transcript = String(result.text || '').trim();
  if (!transcript) throw new Error('No speech was detected in the consultation audio.');
  return transcript;
};
