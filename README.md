# NT-SF1 A-format to B-format Converter

An offline, single-file browser converter for RØDE NT-SF1 recordings, with sound-field rotation, directional visualization and binaural headphone monitoring.

## Use

Download [`index.html`](https://github.com/little-scale/ntsf1-aformat-bformat-converter/raw/refs/heads/main/index.html) and open it in a modern desktop browser. No server, installation or internet connection is required.

1. Choose one 4-channel WAV, two stereo WAVs, or four mono WAVs per recording.
2. Set capsule order and microphone orientation.
3. Choose AmbiX or FuMa, output level and output file layout, then **Convert**.
4. Download the B-format WAVs individually or as a batch ZIP.

After converting, inspect directional energy on the sphere and scrub its timeline. Drag the sphere for yaw/pitch and the outer ring for roll, or enter angles numerically. Headphone playback follows these rotations live. Convert again to update B-format downloads, or use **Export binaural stereo WAV** for a stereo headphone render of the current settings.

## Features

- Input and output layouts: 1 × 4 channels, 2 × stereo, or 4 × mono.
- AmbiX (ACN/SN3D, W/Y/Z/X) and FuMa (W/X/Y/Z).
- Upright, upside-down, horizontal and horizontal inverted orientations.
- Yaw/pitch/roll, output gain and optional plugin-style ±1 limiting.
- Per-channel levels, sample counts above 0 dBFS, correlations, W-channel loudness and directional estimates.
- Offline binaural playback and stereo export using [Omnitone](https://github.com/GoogleChrome/omnitone).

B-format exports are 32-bit float at the original sample rate and length. Split input files must be sample-aligned and have matching rates and lengths. Stereo component-pair exports are not a speaker stereo decode; binaural export is separate.

The browser DSP was compared with an original-plugin/REAPER reference: **−141.9 dB relative RMS error** on the tested recording. It is not bit-identical, and this result is not a guarantee for every input or setting. See [technical documentation](docs/TECHNICAL.md) for the method, validation and limitations.

## Development

```sh
python3 tools/build_html.py
node tests/rotation.cjs
node tests/layouts.cjs
node tests/meter.cjs
node tests/zip.cjs
```

The checked-in WebAssembly binary makes HTML rebuilding possible without Emscripten. To rebuild the DSP too, run `sh tools/build_wasm.sh` with Emscripten installed, then rebuild the HTML.

Omnitone and its filters are embedded; third-party license information is available in the app and in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This is an independent project, not affiliated with the microphone or original-plugin manufacturers.
