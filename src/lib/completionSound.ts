let completionContext: AudioContext | undefined;

function playChime(context: AudioContext): void {
  const voices: { oscillator: OscillatorNode; envelope: GainNode }[] = [];

  try {
    const start = context.currentTime + 0.01;
    // A quiet C-major arpeggio with soft attacks and a short bell-like decay.
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      voices.push({ oscillator, envelope });
      const noteStart = start + index * 0.11;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      envelope.gain.setValueAtTime(0, noteStart);
      envelope.gain.linearRampToValueAtTime(0.055, noteStart + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.46);
      envelope.gain.linearRampToValueAtTime(0, noteStart + 0.48);
      oscillator.connect(envelope);
      envelope.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.49);
    });
  } catch {
    // Sound is optional: an unavailable audio device must never block saving.
    for (const { oscillator, envelope } of voices) {
      try {
        oscillator.stop();
      } catch {
        // A source that has not started cannot be stopped.
      }
      oscillator.disconnect();
      envelope.disconnect();
    }
  }
}

/** Call directly in a completion click handler so the browser can allow audio. */
export function playCompletionSound(): void {
  try {
    if (typeof window === "undefined") return;
    const AudioContextConstructor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) return;

    if (!completionContext || completionContext.state === "closed") {
      completionContext = new AudioContextConstructor();
    }
    const context = completionContext;
    if (context.state === "running") {
      playChime(context);
      return;
    }

    const requestedAt = performance.now();
    void context
      .resume()
      .then(() => {
        // Don't play an old celebration if browser permission was delayed.
        if (
          context.state === "running" &&
          performance.now() - requestedAt < 1000
        ) {
          playChime(context);
        }
      })
      .catch(() => {
        // Muted or blocked audio leaves the visual celebration fully usable.
      });
  } catch {
    // Some browsers reject creating or resuming an audio context entirely.
  }
}
