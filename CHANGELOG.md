# Changelog

## 2026-11-26 — A-format stereo splitting

- Add an A-format split-only operation for four-channel WAVs, exporting original channels 1–2 and 3–4 as stereo files.
- Preserve source encoding, sample rate, frame count and sample bytes, including 32-bit float input/output and float headroom.
- Bypass conversion, channel remapping, rotation, gain and clipping in split mode.
- Add lossless split tests for integer/float encodings, RIFF/RF64 and extensible input.

## 2026-11-26 — GitHub Pages hosting

- Publish the standalone converter on GitHub Pages from the main branch.
- Link the live converter from the README while retaining offline download instructions.

## 2026-10-07 — Frequency-coloured energy sphere

- Colour sphere pixels by energy-weighted log frequency from eight FFT bands.
- Use brightness for directional energy and saturation for spectral concentration.
- Add a low-to-high frequency colour key and frequency-analysis regression checks.
- Keep the additional spectral analysis read-only; reference comparison remains unchanged.

## 2026-10-07 — Playback synchronization and workflow improvements

- Synchronize sphere energy visuals to the headphone playback clock and selected recording.
- Interpolate between energy windows for smoother visual transitions.
- Keep visuals aligned on pause, seeking, resume and Stop.
- Remove the duplicate sphere-position slider; use the audio playback slider instead.
- Place headphone preview directly beneath the sphere, with output settings in the lower-right section.
- Rename “Output rotation” to “Rotation”.
- Move Convert into the input workflow beside Clear, with matching button height, text size and padding.
- Add playback synchronization regression coverage and update the documentation.

## 2026-10-07 — Initial repository publication

- Publish the self-contained offline NT-SF1 A-format to B-format converter.
- Include AmbiX/FuMa conversion, all three input/output file layouts, capsule ordering and microphone orientation.
- Include sound-field rotation, directional-energy visualization, analysis and Omnitone binaural monitoring/export.
- Include rebuild sources, embedded WebAssembly, third-party notices, validation results and portable tests.
- Add a concise README and detailed technical documentation.
