// Served as a standalone browser script; exercised with injected media APIs in tests.
export const audioScript = String.raw`
(function(global) {
  'use strict';
  class CopilotAudioCapture {
    constructor(callbacks = {}) { this.callbacks = callbacks; this.run = null; }
    static tabSupport(env = global) {
      const ua = env.navigator?.userAgent || '';
      if (/Android|iPhone|iPad|iPod/i.test(ua) || (env.navigator?.platform === 'MacIntel' && env.navigator?.maxTouchPoints > 1)) {
        return { supported: false, reason: 'Direct meeting-tab audio is not available in Android or iOS browsers. Open this app in desktop Chrome 135 or newer to capture both sides; pasted transcripts remain available here.' };
      }
      const version = Number(ua.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1] || 0);
      if (version < 135 || !env.navigator?.mediaDevices?.getDisplayMedia || !(env.SpeechRecognition || env.webkitSpeechRecognition) || !env.AudioContext) {
        return { supported: false, reason: 'Direct tab transcription requires desktop Chrome 135 or newer with screen sharing and speech recognition enabled. It will not silently use your microphone instead.' };
      }
      return { supported: true, reason: 'Choose the meeting tab and enable “Share tab audio” in the browser picker.' };
    }
    state(value) { this.callbacks.onState?.(value); }
    fresh(mode) {
      if (this.run) throw Error('Stop the current audio capture before starting another source.');
      const run = { mode, streams: [], context: null, recognizer: null, track: null, stopping: false, stopPromise: null, restartTimer: null, levelTimer: null, stopTimer: null, draftTimer: null, voicedMs: 0, firstAudioAt: 0, lastResultAt: 0, epoch: 0, captureId: global.crypto.randomUUID(), utterances: new Map() };
      this.run = run;
      this.state({ phase: 'starting', mode });
      return run;
    }
    active(run) { return this.run === run && !run.stopping; }
    retain(run, stream) {
      if (!this.active(run)) { stream.getTracks().forEach(t => t.stop()); return false; }
      run.streams.push(stream); return true;
    }
    async startTab(includeMicrophone) {
      const support = CopilotAudioCapture.tabSupport();
      if (!support.supported) throw Error(support.reason);
      const run = this.fresh(includeMicrophone ? 'tab-and-microphone' : 'tab');
      try {
        // Both calls happen directly in the click handler, before any await.
        run.context = new global.AudioContext();
        const resume = run.context.resume().then(() => null, error => error);
        const displayPromise = global.navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'browser' }, audio: true,
          selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', systemAudio: 'exclude',
        });
        const display = await displayPromise;
        if (!this.retain(run, display)) return;
        display.getTracks().forEach(track => track.addEventListener('ended', () => { if (this.active(run)) this.stop('Sharing ended'); }));
        const sharedAudio = display.getAudioTracks()[0];
        if (!sharedAudio) throw Error('The shared source has no audio. Share the meeting browser tab and tick “Share tab audio”. No microphone-only fallback was started.');
        if (display.getVideoTracks()[0]?.getSettings().displaySurface !== 'browser') throw Error('Choose a browser tab, rather than a window or entire screen, so only the meeting tab audio is captured.');
        const resumeError = await resume;
        if (resumeError) throw resumeError;
        if (!this.active(run)) return;
        const mix = run.context.createGain();
        mix.gain.value = includeMicrophone ? 0.7 : 1;
        const connect = stream => run.context.createMediaStreamSource(new global.MediaStream(stream.getAudioTracks())).connect(mix);
        connect(display);
        if (includeMicrophone) {
          const mic = await global.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
          if (!this.retain(run, mic)) return;
          connect(mic);
          mic.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (this.active(run)) this.fail(run, 'Your microphone disconnected. Restart sharing to include your voice.'); }));
        }
        if (!this.active(run)) return;
        const destination = run.context.createMediaStreamDestination();
        const analyser = run.context.createAnalyser(); analyser.fftSize = 256;
        mix.connect(analyser); analyser.connect(destination);
        this.retain(run, destination.stream);
        run.track = destination.stream.getAudioTracks()[0];
        // No connection to context.destination: don't play the mixed microphone back.
        const samples = new Uint8Array(analyser.fftSize);
        run.levelTimer = global.setInterval(() => {
          if (!this.active(run)) return;
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + Math.pow((value - 128) / 128, 2), 0) / samples.length);
          this.callbacks.onLevel?.(Math.min(1, rms * 4));
          if (rms > 0.025) { run.voicedMs += 150; if (!run.firstAudioAt) run.firstAudioAt = Date.now(); }
          if (run.voicedMs >= 5000 && Date.now() - Math.max(run.firstAudioAt, run.lastResultAt) > 15 * 60 * 1000) {
            this.fail(run, 'Audio reached the copilot, but the browser returned no speech text for 15 minutes. Capture has stopped. Try regular desktop Chrome with speech recognition available, or paste the meeting transcript.');
          }
        }, 150);
        this.recognize(run);
      } catch (e) {
        if (this.run !== run || run.stopping) return;
        const message = e.name === 'NotAllowedError'
          ? 'Sharing or microphone permission was cancelled or denied. Nothing is being captured; click Share meeting audio to try again.'
          : e.message;
        this.fail(run, message);
      }
    }
    startMicrophone() {
      if (!(global.SpeechRecognition || global.webkitSpeechRecognition)) throw Error('Microphone transcription is unavailable in this browser. Use a supported browser or paste a transcript.');
      const run = this.fresh('microphone');
      try { this.recognize(run); } catch (e) { this.fail(run, e.message); }
    }
    recognize(run) {
      const Speech = global.SpeechRecognition || global.webkitSpeechRecognition;
      const recognizer = new Speech(); run.recognizer = recognizer;
      run.draftTimer = global.setInterval(() => {
        if (!this.active(run)) return;
        for (const [utteranceId, utterance] of run.utterances) {
          if (!utterance.final && utterance.text !== utterance.sent && utterance.text.trim().length >= 12) {
            this.emitTranscript(run, utterance.text, { utteranceId, provisional: true });
            utterance.sent = utterance.text;
          }
        }
      }, 2000);
      recognizer.lang = 'en-GB'; recognizer.continuous = true; recognizer.interimResults = true;
      recognizer.onstart = () => { if (this.active(run)) this.state({ phase: 'listening', mode: run.mode }); };
      recognizer.onresult = event => {
        if (this.run !== run) return;
        run.lastResultAt = Date.now(); run.voicedMs = 0; run.firstAudioAt = 0;
        if (!run.stopping) this.state({ phase: 'transcribing', mode: run.mode });
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const utteranceId = run.captureId + '-' + run.epoch + '-' + i;
          const previous = run.utterances.get(utteranceId);
          const value = result[0].transcript;
          if (result.isFinal) {
            if (!previous?.final) this.emitTranscript(run, value, { utteranceId, provisional: false });
            run.utterances.set(utteranceId, { text: value, sent: value, final: true });
          } else {
            run.utterances.set(utteranceId, { text: value, sent: previous?.sent || '', final: false });
            interim += value;
          }
        }
        this.callbacks.onInterim?.(interim);
      };
      recognizer.onerror = event => {
        if (!this.active(run) || event.error === 'no-speech') return;
        this.fail(run, 'Audio transcription stopped: ' + event.error + '. Your transcript is retained. Restart capture or paste a transcript to continue.');
      };
      recognizer.onend = () => {
        if (this.run !== run) return;
        if (run.stopping) { this.finish(run); return; }
        run.restartTimer = global.setTimeout(() => { if (this.active(run)) { try { this.startRecognition(run); } catch (e) { this.fail(run, e.message); } } }, 500);
      };
      this.startRecognition(run);
    }
    startRecognition(run) {
      run.epoch++;
      if (run.mode === 'microphone') run.recognizer.start();
      else {
        if (!run.track || run.track.kind !== 'audio' || run.track.readyState !== 'live') throw Error('Shared audio ended. Select the meeting tab again.');
        // This overload is essential: start() with no track would use the microphone.
        run.recognizer.start(run.track);
      }
    }
    emitTranscript(run, value, metadata) {
      // Bound very long unbroken utterances; retain enough recent speech for live coaching.
      this.callbacks.onFinal?.(value.slice(-12000), run.mode === 'microphone' ? 'microphone' : 'tab-audio', metadata);
    }
    snapshot() {
      const run = this.run;
      if (!run) return;
      for (const [utteranceId, utterance] of run.utterances) {
        if (!utterance.final && utterance.text.trim() && utterance.text !== utterance.sent) {
          this.emitTranscript(run, utterance.text, { utteranceId, provisional: true });
          utterance.sent = utterance.text;
        }
      }
    }
    fail(run, message) {
      if (this.run !== run) return;
      this.finish(run); this.callbacks.onError?.(message);
    }
    stop(reason = 'Audio capture stopped') {
      const run = this.run;
      if (!run) return Promise.resolve();
      if (run.stopPromise) return run.stopPromise;
      run.stopping = true; run.reason = reason;
      global.clearTimeout(run.restartTimer);
      this.state({ phase: 'stopping', mode: run.mode });
      run.stopPromise = new Promise(resolve => { run.resolveStop = resolve; });
      if (run.recognizer) {
        run.stopTimer = global.setTimeout(() => this.finish(run), 2000);
        try { run.recognizer.stop(); } catch { this.finish(run); }
      } else this.finish(run);
      return run.stopPromise;
    }
    finish(run) {
      if (this.run !== run) return;
      this.snapshot();
      this.run = null; run.stopping = true;
      global.clearTimeout(run.restartTimer); global.clearTimeout(run.stopTimer); global.clearInterval(run.levelTimer);
      global.clearInterval(run.draftTimer);
      if (run.recognizer) { run.recognizer.onend = run.recognizer.onerror = run.recognizer.onresult = run.recognizer.onstart = null; try { run.recognizer.abort(); } catch {} }
      run.streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
      if (run.context) run.context.close().catch(() => {});
      this.callbacks.onInterim?.(''); this.callbacks.onLevel?.(0);
      this.state({ phase: 'off', mode: run.mode, reason: run.reason || 'Audio capture stopped' });
      this.callbacks.onStopped?.(); run.resolveStop?.();
    }
  }
  global.CopilotAudioCapture = CopilotAudioCapture;
})(window);
`;
