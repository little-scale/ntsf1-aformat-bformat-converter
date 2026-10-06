# Technical documentation

This document describes the implementation in `index.html`, its numerical behavior and the scope of validation. The C and JavaScript sources are the executable definition of the algorithm; the equations explain their behavior without replacing their intentional floating-point evaluation order.

## Scope and provenance

This project converts the four raw capsule signals from a RØDE NT-SF1 into first-order B-format. It reconstructs the neutral A-to-B path recovered from the installed Intel SoundField by RØDE Audio Unit, version 1.0.0. Recovery used Ghidra, assembly inspection, calls to the original native DSP and comparison with a REAPER-hosted render.

It is a reconstruction of the conversion method, not the manufacturer's original source, a complete plugin recreation or a calibration system for other tetrahedral microphones. Original-plugin binaries, disassembly, decompiler dumps and personal recordings are not distributed. The plugin is not required at runtime.

The recovered method is adaptive. Frequency-band phase alignment precedes a tetrahedral sum/difference matrix: a constant matrix alone does not reproduce the original output.

## Distribution and architecture

The single HTML embeds CSS, application JavaScript, a classic Web Worker, WebAssembly DSP, Omnitone and its binaural filters. Audio handling uses local File, Blob and Web Audio APIs. No server, telemetry or remote filter lookup is needed. Internal strings such as `/api/jobs` are local dispatch keys in `bridge.js`, not HTTP requests.

| Source | Responsibility |
| --- | --- |
| `src/ntsf1_dsp.c` | FFT, adaptive processing, microphone orientation and overlap-add |
| `src/browser/analysis_stats.c` | Streaming levels and cross-products |
| `src/standalone/meter.c` | W-channel loudness, descriptive range and estimated true peak |
| `src/standalone/runtime_worker.js` | File assembly, conversion, rotation, analysis and WAV generation |
| `src/standalone/bridge.js` | Local file/job state, cancellation and ZIP creation |
| `src/standalone/app.js` | Queue, settings, downloads and analysis presentation |
| `src/standalone/sphere.js` | Directional-energy visualization and rotation controls |
| `src/standalone/audio_preview.js` | Headphone playback and offline binaural export |
| `src/standalone/omnitone.min.js` | Unmodified third-party decoder and embedded filters |
| `src/browser/dist/` | HTML template and CSS |
| `tools/build_html.py` | Single-file packaging |

Conversion is sequential inside a worker, keeping the interface responsive. Cancel terminates the worker and initializes a replacement. AudioContext/playback begins after a user action to accommodate autoplay restrictions.

## Input formats and capsule order

Supported containers are RIFF WAV and RF64, including recognized WAVE_FORMAT_EXTENSIBLE PCM/IEEE-float subformats. PCM can be 16, 24 or 32 bits; float can be 32 or 64 bits. Decoded values become float32 for the DSP. Padded PCM with valid bits differing from container width is rejected. Truncated data, invalid alignment and non-finite sample values are rejected.

Sample rates are accepted from 11,025 through 192,000 Hz. Recording layouts are exactly `[4]`, `[2,2]` or `[1,1,1,1]` channels. Split files must have identical frame counts and sample rates. Start alignment is the user's responsibility: the converter does not estimate offsets, trim mismatches, pad them or resample.

The default capsule order is LFU (left front up), RFD (right front down), LBD (left back down), RBU (right back up). Capsule selectors define a permutation in which every source channel is assigned once. Split-file order establishes source channels before that permutation.

Signed PCM values are divided by `2^(bits−1)`, including sign extension for 24-bit values. Float inputs retain their amplitude, including values above ±1, until an optional output clamp is applied.

## Frame construction, FFT and reconstruction

For sample rate `fs`, the core uses:

- Hop `H = int(float32(fs) × 10 × 0.001)`, approximately 10 ms.
- Active span `S = 2H`.
- FFT length N, the smallest power of two at least S.
- Centered zero-padding offset `(N−S)/2`, with integer division.

The half-window is `sin((k+0.5)π/S)`, mirrored over the active span. Analysis and synthesis both use the window, with 50% overlap. At 44.1 kHz, H=441 and N=1024; at 48 kHz, H=480 and N=1024.

The custom real FFT packs DC/Nyquist in its first two float positions and subsequent complex bins as interleaved real/imaginary pairs. Its butterfly grouping, twiddle generation and inverse `1/N` normalization retain the recovered operation order. A different FFT library can be mathematically equivalent while changing reference agreement.

Each recording starts with fresh state. The wrapper discards the first hop of latency, flushes with zeros at the end, and emits exactly the original frame count for B-format files.

### Neutral input preprocessing

Even with neutral EQ, the original plugin executes a zero-delay crossfade. Its state starts at zero and updates once per hop:

```
mix = float32(float32(mix × 0.8999999761581421) + 0.10000000149011612)
x'  = float32(float32((1−mix) × x) + float32(mix × x))
```

Both reads refer to the same sample. Algebraically this is unity, but float32 rounding can change the value. Preserving this step improved original API/DAW agreement.

## Adaptive spectral processing

Each capsule is transformed independently. Capsule 1 is the phase reference. ERB-style band boundaries follow:

```
hz(e) = (10^(e / 21.399999618530273) − 1) / 0.004370000213384628
```

Starting at e=1, the algorithm advances bin boundaries until the target frequency is reached. Band widths cannot decrease. Boundaries are capped at Nyquist, with at most 64 bands. Initialization in `rode_create` defines exact endpoints and interpolation steps.

### Temporal coherence

Let `A0(k,t)` be the reference-capsule spectrum. With `β=min(1, hop_duration_ms/30)`, approximately one third:

```
T(k,t) = β A0(k,t−1) conjugate(A0(k,t)) + (1−β) T(k,t−1)
```

Within each band, previous/current frame energies are accumulated and smoothed by the same β. The coherence-like ratio is:

```
q(b,t) = (Σk |T(k,t)| + ε) / (max(Eprevious, Ecurrent) + ε)
ε = 1e−20
```

The implementation does not independently clamp q to [0,1]. Adding such a clamp would change the recovered numerical method.

### Inter-capsule phase alignment

For each other capsule c, accumulate the complex band cross-spectrum:

```
C(c,b,t) = Σk A0(k,t) conjugate(Ac(k,t))
```

Its complex state is smoothed with a magnitude-change-dependent weight. With `cn=|C|` and `on=|Sold|`:

```
α = clamp(|cn−on| / max(on, cn+ε), 0, 1)
Snew = α C + (1−α) Sold
φ = atan2(imag(Snew), real(Snew))
θ = (1−q³) φ
G = cos(θ) + i sin(θ)
```

The reference capsule is unchanged; each other capsule receives its complex gain. Gains are interpolated between band centers in real/imaginary coordinates, not as phase angles. Interpolated gains therefore need not have exactly unit magnitude. DC is handled specially, and the final band extends to Nyquist.

### Recovered matrix

After alignment, the float32 matrix below maps capsule spectra to internal W/X/Y/Z. Columns are LFU/RFD/LBD/RBU:

```
[ 0.454545468   0.454545468   0.454545468   0.454545468 ]
[ 1.11340451    1.11340451   −1.11340451   −1.11340451  ]
[ 1.11340451   −1.11340451    1.11340451   −1.11340451  ]
[ 1.11340451   −1.11340451   −1.11340451    1.11340451  ]
```

DC/Nyquist entries use a different summation grouping from other packed entries. Constants and operation order are intentional for numerical matching.

## Microphone orientation and conventions

Preset orientation runs in the spectral domain after the matrix:

| Preset | Transform |
| --- | --- |
| Upright | Unchanged |
| Horizontal | X'=Z, Z'=−X, Y unchanged |
| Upside down | Y'=−Y, Z'=−Z, X unchanged |
| Horizontal (Inverted) | Horizontal followed by upside-down |

These reproduce the recovered plugin transforms, independently of free output rotation.

FuMa exports W/X/Y/Z. AmbiX exports W/Y/Z/X in ACN order and scales W by float32(sqrt(2)) **before inverse FFT**. Moving that multiplication after reconstruction is algebraically equivalent but changes rounding.

The rotation coordinate system is X front, Y left, Z up.

## Yaw, pitch, roll, gain and clamp

For `v=[X,Y,Z]ᵀ`, the active sound-field rotation is:

```
v' = Rz(yaw) Ry(−pitch) Rx(roll) v
W' = W
```

Positive yaw turns front toward left; positive pitch turns front upward; positive roll turns left upward. The fixed-axis order is roll, pitch, yaw. This is a field rotation rather than a moving-listener/head-tracking convention.

An orthogonal rotation preserves `X²+Y²+Z²` in exact arithmetic. Output values are rounded to float32. Zero-angle rotation bypasses the transform entirely, avoiding redundant rounding.

Gain is float32(10^(dB/20)), from −60 to +24 dB. Rotation precedes gain. Optional plugin-output limiting then clamps each component to [−1,+1]. It is a hard sample clamp, not a look-ahead or true-peak limiter. Rotation can change individual channel peaks while preserving total directional energy.

## B-format files and batch ZIP

Outputs are IEEE float32 WAVs with a `fact` chunk, at the input sample rate and exact frame count. Large files use RF64. Stereo layouts pair consecutive components: AmbiX W/Y and Z/X, FuMa W/X and Y/Z. Mono files use component names. Component pairs are not conventional stereo speaker decodes.

Analysis JSON accompanies completed recordings. ZIP uses stored/uncompressed entries and CRC32. It is ZIP32 with a 4 GB limit; download larger results individually. Separate binaural exports are not part of the batch ZIP. Browser memory and Blob limits impose additional constraints beyond container sizes.

## Levels and spatial analysis

Statistics operate on exported B-format samples after rotation, gain and clamp:

- RMS = sqrt(mean(x²)); dBFS = 20 log10(RMS).
- Peak = max(|x|); peak dBFS = 20 log10(peak).
- Crest factor = peak dBFS − RMS dBFS.
- Samples above 0 dBFS counts `|x|>1`, not events, duration or intersample excursions.

Float files preserve values above full scale. Clamped values exactly at ±1 do not count as above 0 dBFS. Silence/undefined results become JSON null and a nonnumeric display.

Correlation is Pearson correlation from sums, squared sums and cross-products. Zero-variance pairs are undefined. This compares mathematical components rather than speaker feeds.

W is normalized to SN3D for directionality. With `Ew=E[W²]`, `Ed=E[X²+Y²+Z²]`, and intensity-like `I=E[W(X,Y,Z)]`:

```
concentration = clamp(2|I|/(Ew+Ed), 0, 1)
diffuse estimate = 1−concentration
```

Angles use atan2 on I and are hidden below 1% concentration. This is a descriptive whole-recording bias: opposing or moving sources can cancel. It is not a calibrated acoustic-intensity instrument or source-localization system.

## W-channel loudness and true peak

Loudness uses SN3D W as mono; the four components are not treated as loudspeakers. FuMa W is multiplied by sqrt(2) for this meter.

Integrated loudness uses K-weighting, 400 ms windows every 100 ms, −70 LUFS absolute gating and a relative gate 10 LU below the first gated energy mean. Result: `−0.691+10 log10(mean gated energy)`. Biquad coefficients use bilinear equations at the input rate. Short files without a full block have no integrated result.

The range is descriptive: three-second windows every 100 ms, −70 LUFS absolute and −20 LU relative gates, then 95th-minus-10th percentile. It is not independently certified EBU R128 LRA.

True peak uses a four-phase, 12-tap-per-phase FIR derived from ITU-R BS.1770-4 Annex 2, includes the original sample peak and flushes history at the end. It is an estimate. On the validation recording this yielded approximately +0.245 dBTP versus about +0.5 dBTP from the earlier FFmpeg check. Integrated-loudness agreement does not imply identical peak filters.

Reference: [ITU-R BS.1770-4](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-4-201510-S!!PDF-E.pdf).

## Sphere energy display

The worker stores pre-output-rotation SN3D W/X/Y/Z covariance matrices. Windows are normally 0.5 seconds, increasing for long files to cap their count near 2,000.

For unit direction n, a virtual cardioid is proportional to `W+n·v`. With covariance C:

```
a = [1,nx,ny,nz]ᵀ
energy(n) ∝ aᵀ C a
```

For current field rotation R, the display evaluates the original covariance at `Rᵀn`, allowing immediate updates without reconversion. A constant cardioid gain factor is omitted because brightness is normalized per window and mapped through a square root.

The surface shows the front hemisphere; other directions rotate into view. Brightness does not compare absolute energy between windows. First-order patterns are broad and cannot precisely separate individual sources. Covariance precedes output gain/clamp and reflects the microphone configuration of its conversion.

During headphone playback, the sphere follows the AudioContext playback clock and the selected headphone recording. The visualization updates every 100 ms and interpolates covariance matrices between stored windows. Pause freezes the current position, seeking updates both displays, and Stop or natural completion resets them. This interpolates visual energy data only and does not modify the audio or increase its spatial resolution.

Sphere drag controls yaw/pitch; the outer ring controls roll. Numeric angles and Reset enable repeatable values. Texture and grid share a coordinate transform to remain centered.

## Binaural playback and export

[Omnitone](https://github.com/GoogleChrome/omnitone) supplies FOA binaural decoding through native Web Audio convolution. Its unmodified bundle and built-in filters are embedded with retained notices and full Apache 2.0 license. The generic HRTF is not personalized; localization and front/back discrimination vary between listeners.

The worker retains a separate pre-output-rotation AmbiX float buffer. FuMa is remapped and W-normalized for this preview. This enables live rotation without repeating A-to-B conversion or undoing clipped samples.

Playback deinterleaves the WAV into a four-channel AudioBuffer. A discrete-channel gain network applies rotation and gain; an optional WaveShaper clamps components before decoding. Omnitone receives W/Y/Z/X with an identity channel map and identity internal rotation. Parameter transitions are smoothed over about 20 ms.

Monitor level is linear amplitude percentage, 0–100%, applied after decoding and affecting playback only. The audio device/context may resample playback. Native Web Audio arithmetic and WaveShaper behavior are not promised bit-equivalent to the worker's float32 export path.

Stereo export uses OfflineAudioContext at the recording rate, current output rotation/gain/clamp and unity monitor gain. It produces float32 stereo WAV and adds 512 frames for the filter tail. Output is not hard-clamped after convolution; its sample peak is reported. The export is static, not a recording of interactive sphere movements.

Rotation updates listening immediately. Capsule-order or microphone-orientation changes require reconversion. Existing B-format downloads and analysis remain snapshots; reconvert to update them.

## Numerical fidelity and evidence

Build with `-ffp-contract=off`. On ARM/WebAssembly, sin/cos/atan2/hypot evaluate in double precision and round to float because this was measurably closer to the original Intel plugin. Other arithmetic retains recovered float behavior.

During development, a reconstructed Intel renderer reproduced tested original-plugin API output exactly. The user's 44.1 kHz REAPER render matched that reference byte-for-byte. This contextual result is not a browser exactness claim, and the Intel renderer is not distributed here.

The shipped WASM was compared against that matched reference on a 44.5-second recording: 1,962,450 four-channel frames, or 7,849,800 sample values. Settings: upright, default capsule order, AmbiX, zero rotation, 0 dB gain, clamp enabled.

| Measure | Result |
| --- | --- |
| Maximum absolute error | 1.7881393432617188 × 10⁻⁷ |
| RMS error | 1.7493086064858223 × 10⁻⁹ |
| Relative RMS error | −141.8974043937031 dB |
| Unequal sample values | 5,066,647 of 7,849,800 |

Relative RMS error is `10 log10(Σerror²/Σreference²)`, not a level relative to full scale, an effective-bit-depth certification or worst-case peak error. The browser is not bit-identical; many differences are small float-rounding discrepancies.

These figures cover that recording, version, platform and settings, not all microphone calibrations, rates, orientations or inputs. Scalar results are in `accuracy.json`; the private reference audio is not published.

## Tests and builds

Tests use Node.js with synthetic audio:

| Test | Checks |
| --- | --- |
| `rotation.cjs` | Cardinal rotations in both formats, unchanged W, directional energy |
| `layouts.cjs` | All three input/output layouts recombine to identical payloads |
| `meter.cjs` | 997 Hz, −20 dBFS sine loudness/range/estimated peak at 44.1 and 48 kHz |
| `zip.cjs` | WAV metadata, ZIP structure and exact stored payload |
| `playback_sync.cjs` | Playback-clock synchronization, recording selection, fractional windows, pause/seek/resume/stop and bounds |

Browser validation converted and monitored a two-second recording with external network connections disabled, then downloaded a yaw +90° binaural render. It contained 88,712 stereo frames at 44.1 kHz, including the 512-frame tail, finite samples, distinct ears and approximately −5.0 dBFS peak. Monitor level zero did not mute the export. Scalar results are in `binaural_validation.json`.

The testing browser blocked automated file-URL navigation, so QA used a temporary localhost preview of the same HTML. Direct file opening depends on browser policy; the application itself makes no server calls. No exhaustive browser-support matrix has been tested.

`python3 tools/build_html.py` packages the checked-in WASM. `sh tools/build_wasm.sh` rebuilds the DSP with Emscripten. Development used Emscripten 6.0.6, `-O2`, disabled contraction, standalone WASM, 16 MiB initial memory and memory growth. Different compilers/libc versions may change binary bytes and numerical output: rerun tests and the reference comparison when available.

## Practical limits

Input reads are chunked, but output Blobs, pre-rotation previews, playback buffers and offline render buffers consume memory. Large files/batches can exhaust browser memory before format limits; reloading between large batches releases state.

There is no inverse B-to-A conversion, SOFA HRTF import, head tracking, higher-order conversion, resampling or recreation of non-neutral plugin EQ. Binaural audio and spatial meters interpret the converted field separately from the fidelity claim for A-to-B conversion.
