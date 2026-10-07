# Completion sound

`completion-marimba.mp3` is a 0.92-second stereo completion cue made from real marimba recordings in **VSCO 2: Community Edition**, by Versilian Studios / Sam Gossner, performed by Justin B. Belanger.

- Source library: https://github.com/sgossner/VSCO-2-CE/tree/master/Percussion/Marimba
- Project: https://github.com/sgossner/VSCO-2-CE
- Source files: `Marimba_hit_Outrigger_G4_loud_01.wav` and `Marimba_hit_Outrigger_C4_loud_01.wav`.
- License: CC0 1.0 Universal; see the included `LICENSE-VSCO.txt` and https://github.com/sgossner/VSCO-2-CE/blob/master/LICENSE.

Processing: lower the first recording by one octave, remove sub-bass room noise, soften the high frequencies, narrow the stereo field, and place the two strikes 105 ms apart. Shortened decay envelopes preserve the recorded mallet attack and room texture, with a smooth fade to silence. Peak level before MP3 encoding is -7 dBFS; playback applies another 0.85 gain. Output is 44.1 kHz stereo MP3 at 160 kbps. No source-library network requests occur at runtime.
