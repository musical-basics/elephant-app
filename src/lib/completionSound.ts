import completionSoundUrl from "../assets/audio/completion-marimba.mp3";

let completionContext: AudioContext | undefined;
let soundBytes: Promise<ArrayBuffer | null> | undefined;
let decoding: Promise<AudioBuffer | null> | undefined;
let decodedSound: AudioBuffer | undefined;
let latestRequest = 0;
let activeVoice: { source: AudioBufferSourceNode; gain: GainNode } | undefined;

/** Download silently in advance; do not create an audio device or play on load. */
export function preloadCompletionSound(): Promise<ArrayBuffer | null> {
  if (!soundBytes) {
    soundBytes = fetch(completionSoundUrl)
      .then((response) => {
        if (!response.ok) throw new Error("Completion sound unavailable.");
        return response.arrayBuffer();
      })
      .catch(() => {
        soundBytes = undefined;
        return null;
      });
  }
  return soundBytes;
}

function decodeSound(context: AudioContext): Promise<AudioBuffer | null> {
  if (!decoding) {
    decoding = preloadCompletionSound()
      .then((bytes) => (bytes ? context.decodeAudioData(bytes.slice(0)) : null))
      .then((buffer) => {
        if (completionContext === context) {
          decodedSound = buffer ?? undefined;
          if (!buffer) decoding = undefined;
        }
        return buffer;
      })
      .catch(() => {
        if (completionContext === context) {
          decoding = undefined;
          soundBytes = undefined;
        }
        return null;
      });
  }
  return decoding;
}

function playSample(context: AudioContext, buffer: AudioBuffer): boolean {
  let source: AudioBufferSourceNode | undefined;
  let gain: GainNode | undefined;
  try {
    const start = context.currentTime;
    // Fast completions replace the previous tail with a short, click-free fade.
    // They must not accumulate into an increasingly loud chord.
    if (activeVoice) {
      const previous = activeVoice;
      previous.gain.gain.cancelScheduledValues(start);
      previous.gain.gain.setValueAtTime(previous.gain.gain.value, start);
      previous.gain.gain.linearRampToValueAtTime(0, start + 0.025);
      previous.source.stop(start + 0.03);
    }

    source = context.createBufferSource();
    gain = context.createGain();
    const voice = { source, gain };
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.85, start);
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      voice.source.disconnect();
      voice.gain.disconnect();
      if (activeVoice === voice) activeVoice = undefined;
    };
    source.start(start);
    activeVoice = voice;
    return true;
  } catch {
    source?.disconnect();
    gain?.disconnect();
    return false;
  }
}

/** Call from the completion/preview click so browser audio permission is local. */
export async function playCompletionSound(): Promise<boolean> {
  const request = ++latestRequest;
  const requestedAt = performance.now();
  try {
    if (typeof window === "undefined") return false;
    const AudioContextConstructor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) return false;

    if (!completionContext || completionContext.state === "closed") {
      completionContext = new AudioContextConstructor({
        latencyHint: "interactive",
      });
      decoding = undefined;
      decodedSound = undefined;
      activeVoice = undefined;
    }
    const context = completionContext;
    if (context.state === "running" && decodedSound) {
      return playSample(context, decodedSound);
    }

    // Resume during the gesture, before awaiting a download or decoder.
    const resumed =
      context.state === "running" ? Promise.resolve() : context.resume();
    const [buffer] = await Promise.all([decodeSound(context), resumed]);
    if (
      !buffer ||
      context.state !== "running" ||
      request !== latestRequest ||
      performance.now() - requestedAt >= 750
    ) {
      return false;
    }
    return playSample(context, buffer);
  } catch {
    // Optional feedback must never block completion, including on muted devices.
    return false;
  }
}
