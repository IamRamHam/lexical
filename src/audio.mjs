export class WordAudio {
  #context;
  #source;
  #run = 0;
  #cache = new Map();

  unlock() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      this.#context ??= new Audio();
      if (this.#context.state !== 'running') this.#context.resume().catch(() => {});
    } catch { /* Manual playback can use a local device voice instead. */ }
  }

  stop() {
    this.#run++;
    if (this.#source) {
      this.#source.onended = null;
      try { this.#source.stop(); } catch { /* Already stopped. */ }
      this.#source.disconnect();
      this.#source = null;
    }
    window.speechSynthesis?.cancel();
  }

  async play(text, message) {
    this.stop();
    const run = this.#run;
    message('音声を準備中…');
    try {
      if (!this.#context || this.#context.state === 'suspended' || this.#context.state === 'interrupted') {
        throw new Error('Audio requires an interaction');
      }
      let job = this.#cache.get(text);
      if (!job) {
        job = window.PhoneticFallback.synthesize(text, 1)
          .then(async blob => this.#context.decodeAudioData(await blob.arrayBuffer()))
          .catch(error => { this.#cache.delete(text); throw error; });
        this.#cache.set(text, job);
        if (this.#cache.size > 20) this.#cache.delete(this.#cache.keys().next().value);
      }
      const buffer = await job;
      if (run !== this.#run) return;
      const source = this.#context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.#context.destination);
      this.#source = source;
      source.onended = () => {
        if (run !== this.#run) return;
        source.disconnect();
        this.#source = null;
        message('');
      };
      source.start();
      message('米語音声を再生中');
    } catch {
      if (run !== this.#run) return;
      const synth = window.speechSynthesis;
      const voice = synth?.getVoices().find(v => /^en[-_]US$/i.test(v.lang) && v.localService);
      if (!voice || !window.SpeechSynthesisUtterance) {
        message('再生ボタンを押して米語音声をお試しください。');
        return;
      }
      const speech = new SpeechSynthesisUtterance(text);
      speech.voice = voice;
      speech.lang = 'en-US';
      speech.onend = () => { if (run === this.#run) message(''); };
      speech.onerror = () => { if (run === this.#run) message('音声を再生できませんでした。'); };
      synth.speak(speech);
      message('端末の米語音声を再生中');
    }
  }
}
