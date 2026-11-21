// Mic button logic shared by the chat boxes.
// - On Android (Capacitor native), it uses the on-device speech plugin, so words appear while you talk.
// - In the browser / Electron, it records from the microphone, shows a live level meter, and every few
//   seconds transcribes what has been said so far (live partial text). When you stop, the full recording
//   is transcribed with Whisper (see lib/speech.ts). Audio never leaves the app.
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';
import { transcribe } from '../lib/speech.ts';

const LEVEL_COUNT = 32;
const LIVE_EVERY_MS = 4000;
const LIVE_MIN_MS = 3000;

export function useVoiceInput(onText: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [partial, setPartial] = useState('');
  const [levels, setLevels] = useState<number[]>([]);

  // Read at the moment the transcript arrives, so a re-render in between does not drop it.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // Browser / desktop state
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const liveTimerRef = useRef<number | null>(null);
  // Bumped on every start and stop, so a late live result from an old session is discarded.
  const sessionRef = useRef(0);

  // Native (Android) state
  const nativeActiveRef = useRef(false);
  const nativeTextRef = useRef('');

  const stopMeters = () => {
    sessionRef.current++;
    if (liveTimerRef.current !== null) { window.clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx) ctx.close().catch(() => {});
  };

  const clearNativeListeners = async () => {
    try { await SpeechRecognition.removeAllListeners(); } catch { /* ignore */ }
  };

  // Ends a native session once: delivers the final text (if any) and resets state.
  const finishNative = async (errorMessage?: string) => {
    if (!nativeActiveRef.current) return;
    nativeActiveRef.current = false;
    const text = nativeTextRef.current.trim();
    nativeTextRef.current = '';
    await clearNativeListeners();
    setRecording(false);
    setPartial('');
    setLevels([]);
    if (text) {
      onTextRef.current(text);
      setStatus(errorMessage ?? null);
    } else {
      setStatus(errorMessage ?? 'Nothing was heard. Try again.');
    }
  };

  const startNative = async () => {
    try {
      const availability = await SpeechRecognition.available();
      if (!availability.available) {
        setStatus('Microphone or speech service is not available.');
        return;
      }
      let permission = await SpeechRecognition.checkPermissions();
      if (permission.speechRecognition !== 'granted') {
        permission = await SpeechRecognition.requestPermissions();
      }
      if (permission.speechRecognition !== 'granted') {
        setStatus('Microphone or speech permission was denied.');
        return;
      }

      nativeTextRef.current = '';
      nativeActiveRef.current = true;
      setPartial('');
      setLevels([]);

      // Listeners are registered before start, so no early event is missed.
      await SpeechRecognition.addListener('partialResults', (e) => {
        const text = (e.accumulatedText ?? [e.accumulated, e.matches?.[0]].filter(Boolean).join(' ')).trim();
        nativeTextRef.current = text;
        setPartial(text);
      });
      await SpeechRecognition.addListener('audioLevel', (e) => {
        const level = Math.max(0, Math.min(1, e.level));
        setLevels((prev) => [...prev, level].slice(-LEVEL_COUNT));
      });
      await SpeechRecognition.addListener('error', () => {
        void finishNative('Microphone or speech service is not available.');
      });
      await SpeechRecognition.addListener('listeningState', (e) => {
        if (e.state === 'stopped' || e.status === 'stopped') void finishNative();
      });

      setRecording(true);
      setStatus('Listening… tap the mic again to stop.');
      try {
        await SpeechRecognition.start({ language: 'en-IN', partialResults: true, popup: false, keepListeningMs: 8000 });
      } catch {
        // Some plugin builds reject keepListeningMs; retry without it.
        await SpeechRecognition.start({ language: 'en-IN', partialResults: true, popup: false });
      }
    } catch {
      nativeActiveRef.current = false;
      await clearNativeListeners();
      setRecording(false);
      setPartial('');
      setLevels([]);
      setStatus('Microphone or speech service is not available.');
    }
  };

  const stopNative = async () => {
    setStatus('Finishing…');
    try { await SpeechRecognition.stop(); } catch { /* ignore */ }
    // Fallback in case the 'stopped' event never arrives.
    window.setTimeout(() => { void finishNative(); }, 1500);
  };

  const toggle = async () => {
    if (Capacitor.isNativePlatform()) {
      if (nativeActiveRef.current) { await stopNative(); return; }
      await startNative();
      return;
    }

    if (recording) { recorderRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('Voice input needs microphone access, which this window does not have.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus('Microphone permission was denied, or no microphone was found.');
      return;
    }
    chunksRef.current = [];
    streamRef.current = stream;
    const session = ++sessionRef.current;
    const startedAt = Date.now();

    // Level meter, using the same stream. Failure here must not stop recording.
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let last = 0;
      const tick = (t: number) => {
        rafRef.current = requestAnimationFrame(tick);
        if (t - last < 50) return; // about 20 updates per second
        last = t;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const x = (buf[i] - 128) / 128;
          sum += x * x;
        }
        const rms = Math.sqrt(sum / buf.length);
        const level = Math.min(1, rms * 3);
        setLevels((prev) => [...prev, level].slice(-LEVEL_COUNT));
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* no waveform; recording still works */
    }

    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      stopMeters();
      recorderRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setRecording(false);
      setPartial('');
      setLevels([]);
      setStatus('Transcribing…');
      try {
        const text = await transcribe(new Blob(chunksRef.current, { type: recorder.mimeType }), (m) => setStatus(m));
        if (text) onTextRef.current(text);
        setStatus(text ? null : 'Nothing was heard. Try again.');
      } catch (err: any) {
        setStatus(`Voice input failed: ${err?.message || err}`);
      }
    };

    // Live partial text: every few seconds, transcribe everything so far (one request at a time).
    let liveBusy = false;
    liveTimerRef.current = window.setInterval(async () => {
      if (liveBusy || session !== sessionRef.current) return;
      if (Date.now() - startedAt < LIVE_MIN_MS) return;
      if (!chunksRef.current.length) return;
      liveBusy = true;
      try {
        const text = await transcribe(new Blob(chunksRef.current, { type: recorder.mimeType }), () => {});
        if (session === sessionRef.current && text) setPartial(text);
      } catch {
        /* live text is optional */
      } finally {
        liveBusy = false;
      }
    }, LIVE_EVERY_MS);

    recorderRef.current = recorder;
    recorder.start(1000); // data every second, so live text can read the audio so far
    setRecording(true);
    setStatus('Listening… click the mic again to stop.');
  };

  // Release the mic, meters and native session if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      stopMeters();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        try { recorder.stop(); } catch { /* ignore */ }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (nativeActiveRef.current) {
        nativeActiveRef.current = false;
        SpeechRecognition.stop().catch(() => {});
        clearNativeListeners();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { recording, status, partial, levels, toggle };
}
