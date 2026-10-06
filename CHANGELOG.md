# Changelog

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
