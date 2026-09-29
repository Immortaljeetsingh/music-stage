# Music Stage

[Open Music Stage](https://immortaljeetsingh.github.io/music-stage/)

A browser-based listening room: arrange virtual speakers and furniture, move a listener, and hear spatialized music through stereo headphones. Built with Canvas 2D and Web Audio; no application backend or production build step.

## Player and project workflow

The Stage now contains a complete Web Audio-backed player rather than a second, bypassing `<audio>` element. It shows ID3 or filename-derived title and artist, generated or embedded artwork, source and format details, elapsed/remaining time, seek, ±10-second skip, play/pause, stop, repeat, mute, master volume, live L/R meters, Media Session controls, and a compact mobile player while another tab is open. Local files remain local.

Room and rig setups can be saved explicitly in the browser, exported/imported as versioned JSON, reset, undone, and redone. Two persistent A/B slots make room and rig comparisons repeatable while preserving playback position. Audio samples are deliberately excluded from project JSON. A one-time, dismissible quick tour explains the three-step workflow. **Simple mode** hides specialist controls; **Advanced mode** exposes the full room, rig, imaging, correction, and project interface.

The code remains browser-native but is separated into cacheable classic-script modules under `assets/`: source/loading and state, DSP, stage rendering, player, projects, accessibility, and UI. The classic loading order intentionally preserves the global API used by the offline Web Audio regression suite.

## Quick start

1. Connect stereo headphones and start at low system volume.
2. Pick an audio file in **Source**, then press **Play**. Files are decoded locally, not uploaded to GitHub. The stage opens as a 10 × 10 × 10 m room; change W/L/H any time (numbers or drag, the room clamps your layout).
3. Drag speaker cabinets or the green listener in the room. Click empty floor to reposition the listener. Desktop WASD/arrow keys also move the listener.
4. Select a speaker to change its volume, source channel, frequency band, height, or numerical X/Y position. Volume reaches 4×; master reaches 2.5×. More gain can distort.
5. Add a bed, sofa, or wardrobe/almirah in **Room**. Drag its visible top or side with a mouse or finger. Numeric controls provide precise dimensions, coordinates, and estimated absorption. Objects remain inside the room.
6. Adjust room reflections, absorption, softness, and late reverb — or pick a one-tap **Preset** (Studio, Living Room, Concert Hall, Club, Cathedral, Outdoor). Presets only retune the room; your layout and speakers stay put. Touching any room control afterwards returns the selector to Custom. Furniture movement updates direct-path obstruction while playback continues.

On phones and tablets the app uses an iOS-style tab bar: **Source**, **Room**, **Rig**, **Sound**, plus a separate prominent **Stage** tab (stage, selected speaker, transport, head tracking, appearance). One panel is shown at a time. Inside each tab, options are grouped into collapsible iOS-style category rows (for example Room → *Room size / Reflections & reverb / Material & preset / Furniture*); every row shows its current value, so nothing is hidden behind a long control wall. Only the obvious entry points (*Your audio*, *Speakers*) start open. Drag directly on the room canvas and scroll within the panel. Numeric controls remain an alternative to dragging.

## Interface (iOS 27 / Liquid Glass)

The shell follows Apple's iOS 27 design language, built from the WWDC26 material updates and measured iOS 27 UI-kit values rather than a generic dark theme:

- **Liquid Glass material:** layered tinted panes with 30–44 px backdrop diffusion on desktop, 190–205% saturation, directional top-edge light, dark lower-edge separation, soft depth shadows, and colored light from a static page light field. Nested groups use a lighter secondary glass layer rather than stacking opaque white cards.
- **Material accessibility:** `prefers-reduced-transparency` replaces diffusion with opaque surfaces, increased contrast strengthens borders, and reduced motion disables transitions and the playing-state cover animation.
- **Transparency slider (Stage → Liquid Glass):** the iOS 27 system control, implemented in-page — *ultra clear* → *fully tinted* scales material opacity and diffusion and persists in `localStorage`.
- **Uniform toolbar:** on desktop the floating glass header turns opaque with a hairline bottom border once content scrolls beneath it (iOS 27's uniform scroll-edge treatment, hard blur + border). On phones it scrolls away with the page.
- **Prominent Tab:** the Stage tab sits in its own trailing capsule, the iOS 27 role that replaced the search-only slot.
- **Controls:** 44pt minimum hit targets, iOS switch toggles (label leading, control trailing), iOS sliders with 28pt thumbs, tinted glass buttons, and a pressed-state scale animation.
- **Appearance (Stage tab):** an iOS segmented control with **System / Light / Dark**. System tracks the device setting; an explicit choice overrides it and persists in `localStorage`. `prefers-reduced-transparency`, `prefers-contrast: more`, and `prefers-reduced-motion` are honored, and safe-area insets are respected on notched devices.

### Mobile performance

Phones get the same design through a cheaper rendering path, tuned against `test-mobile-performance.cjs` (390 × 844 at 3× DPR with 4× CPU throttling in headless Chromium):

- **No first-paint flash:** `assets/theme-init.js` runs in `<head>` and applies the stored appearance, Simple mode, and glass level before the body renders.
- **Overlay-only blur:** cards sit over a static light field, so phones and tablets blur only the floating tab bar and mini player (18 px). Nested groups and controls never blur. The page background is one fixed layer with no animation, grain, blend mode, or `background-attachment: fixed`.
- **Stable scrolling:** browser-toolbar resizes no longer re-run tab navigation, so the page can't jump back to the top. Only a real tab switch starts at the top, and tapping the active tab scrolls up.
- **Stage touch:** vertical swipes over empty floor scroll the page; a touch that lands on a speaker, furniture, or the listener still drags it.
- **Right-sized canvas:** the stage renders straight into a backing store matched to its displayed size: 1× on phones, where 900 logical pixels are already near native, and a true 1.5×/2× render on large HiDPI screens.
- **Bounded playback work:** a 30 Hz transport timer replaces the per-frame loop. The clock text changes once per second, the seek thumb moves 5×/s and never under a finger, meters are compositor transforms, the OS media clock is anchored only on play, pause, seek, stop, or a repeat wrap, and identical DOM or AudioParam writes are skipped. On phones the playing cover shows a static glow ring instead of breathing. The audio context requests `latencyHint: 'playback'` for glitch-free output under load, and the reverb convolver exists only while reverb is audible.

| Phone emulation measurement | Before | After |
|---|---|---|
| Appearance / mode on first body render | unset (flash) | stored Light + Simple |
| Live backdrop-filter surfaces | 21 | 1 |
| Idle infinite animations | 1 | 0 |
| Stage backing store | 1800 × 1200, upscaled | 900 × 600 |
| Scroll after toolbar resize, from 700 px | 0 | 700 |
| Swipe over empty stage floor | 0 px | 123–133 px |
| Media Session position pushes, 3 s playback | 305–345 | 0 |
| DOM mutations per second while playing | ~600 | ~40 |
| Layouts per second while playing | ~103 | ~5 |
| Style recalculations per second while playing | ~103 | ~19 |
| Script time per second while playing | ~95 ms | ~39 ms |
| Main-thread task time per second while playing | ~673 ms | ~188 ms |
| Scroll frame time p95 / max | 10–17 / 10–42 ms | 9–10 / 9–11 ms |

Values are medians or ranges from three interleaved runs of the same test against the previous release and this one. Headless Chromium composites in software, so it does not reproduce a phone GPU's backdrop-blur cost; the surface count is the proxy for that. Frame rates on a physical phone depend on the device and browser.

## Sound controls and balance

- **L/R/M:** choose the recording's left channel, right channel, or both. M plays two virtual channels around the cabinet; it is not an automatic loudness matcher.
- **Bands:** Full, Bass (300 Hz low-pass), Tweeter (2.5 kHz high-pass), Vocal (1.2 kHz band-pass), Bright (5 kHz high-pass). Subwoofers are low-passed at 120 Hz. Every low-pass and high-pass section is Butterworth (maximally flat). These overlap; this is not a calibrated loudspeaker crossover.
- **Width:** 1 preserves the channel feed, 0 adds mono crossfeed, and values above 1 add opposite-polarity crossfeed. Crossfeed is gain-bounded for more useful level comparisons, but correlated material can still cancel or change level.
- **Balance / trims:** output adjustment, not automatic acoustic calibration. Start at Balance 0 and both trims 1.
- **Test tone:** choose the same 80 Hz bass, 1 kHz mid, or 6 kHz treble tone and compare Test L with Test R. Quiet diagnostic tones bypass the room, EQ, and trims; they do not measure your hearing or headphones.
- **Classic engine:** equal-power directional panning with manual distance attenuation.
- **Precise imaging:** experimental parametric interaural delay/level and filter model; not a personalized HRTF. Leave off for the simpler default.
- **Time-align rig:** changes direct-path delay for the virtual PA arrangement. Reflections retain separate delays.

### Clarity-first signal path

**Clarity** is now the default playback mode. It preserves the recording's original left/right channels, disables room copies and late reverb, uses transparent 0 dB peaking filters wherever filtering is bypassed, and keeps experimental pinna/head processing off. **Room** adds restrained spatial panning and low-level reflections. **Immersive** is explicitly opt-in because its parametric head model and stronger room cues intentionally color the signal.

The changes are based on the following DSP principles:

- The [Web Audio specification](https://webaudio.github.io/web-audio-api/#BiquadFilterNode) defines an all-pass biquad as magnitude-preserving but phase-changing, so it is no longer used as the Full-band bypass. The [Audio EQ Cookbook](https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html) shows why a 0 dB peaking EQ reduces to a unity transfer path.
- The same specification defines low-pass and high-pass `Q` in decibels, so the common value 0.707 actually means a linear Q of about 1.085 and a +1.75 dB resonance at the corner. Crossover, air, obstruction, reverb-tone, and head-shadow filters now use −3.01 dB (linear 1/√2, Butterworth), so no filter boosts the band it is supposed to roll off.
- A [WaveShaperNode is a nonlinear distortion processor](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createWaveShaper), so normal audio now sees a linear transfer curve. Clarity uses deterministic gain headroom and bypasses dynamics processing entirely; Room and Immersive retain a post-EQ [DynamicsCompressorNode](https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode) only as emergency protection.
- Multiple delayed copies produce comb-filter-shaped linear distortion; this is documented in [AES research on audible comb filtering](https://www2.ak.tu-berlin.de/~akgroup/ak_pub/2007/Brunner%20Maempel%20Weinzierl%202007_On%20the%20audibility%20of%20comb%20filter%20distortions%20AES.pdf). Clarity therefore disables reflections, while Room and Immersive use reduced mode-dependent reflection gains.
- Room distance still depends on direct versus reverberant energy and interaural coherence, as summarized by the [Acoustical Society of America](https://acoustics.org/pressroom/httpdocs/160th/lavandier.html); those cues remain available in the spatial modes rather than contaminating the clean default.
- The final emergency sample ceiling is −1 dBFS, with conservative coherent-sum headroom motivated by true-peak practice in [ITU-R BS.1770-5](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf). It is a sample ceiling, not a certified BS.1770 true-peak meter.

Measured results for the real graph: normal-path THD is **−131 dB**, synthetic L→R crosstalk in Clarity is below **−275 dB**, and an extreme 4× speaker / 2.5× master test remains at **0.664 peak** with **zero emergency-clamp samples** because master and trim gain are included in automatic headroom. Across all nine local MP3s, Clarity produced zero ceiling plateaus and kept correlation close to the source; representative stereo correlation improved from source→old output **0.34→0.86** to source→Clarity **0.34→0.34**, and **0.46→0.86** to **0.46→0.46**. Run `npm run analyze:local` to repeat this program-material check without publishing local audio.

Content from linked technical references was paraphrased for compliance with licensing restrictions.

### If one side sounds bassier

Use matching speaker gains/bands/heights and a centered listener first. Test with identical-channel or mono content, Balance 0, trims 1, and EQ bypassed. Asymmetric recordings, furniture, speaker positions, or head direction can legitimately produce unequal output. Do not compensate with large gain boosts before checking the configuration.

The synthetic late reverb now uses one repeatable impulse response for both ears, removing random left/right spectral bias. Directional early reflections and speaker positioning remain stereo. Speakers start on one shared audio-clock timestamp. Switching bands resets filter resonance so a previous Vocal setting cannot leave one speaker with different filtering.

The blue/green meters show post-EQ output levels, not separate bass/treble measurements. If matching diagnostic tones still differ, compare another headphone/output path and check OS balance, mono audio, other EQ/spatializers, and earbud fit. The app cannot diagnose hardware or hearing.

## How it works

Each speaker reads the mix or a cached stem:

```text
AudioBuffer source -> band filter -> channel split / width
 -> speaker gain + mute -> air/sub low-pass
    -> obstruction low-pass -> distance gain -> delay -> spatializer
    -> first-order wall reflections (when enabled) and synthetic late reverb (only when audible)
 -> master (volume × automatic headroom) -> output pan -> per-ear trims -> optional headphone EQ with preamp
 -> optional spatial-mode emergency limiter -> linear −1 dBFS sample ceiling -> stereo output/meters
```

Six mirrored image sources approximate first-order wall reflections. The late reverb uses a synthetic decaying-noise impulse. Softness and estimated furnishing area shorten/darken the tail. A segment/box intersection test detects blocked source-listener paths and applies a heuristic 1.8 kHz low-pass to direct sound, leaving the room send separate.

The 3D-style view is an oblique projection drawn on a 2D canvas, not a scanned 3D room. All drawing and hit-testing use a fixed 900 × 600 logical space; a canvas transform renders it directly into a backing store sized to the displayed canvas (1×, 1.5×, or 2×), so large HiDPI screens get a sharp native render and phones avoid wasted pixels. It repaints in Light or Dark with the rest of the app. Speaker cabinets are drawn as their real driver layouts: two-way boxes (dome tweeter over a woofer, reflex port, badge), horn tweeters, and subwoofers (large driver, port slot, feet); the colored ring still identifies the type/band. The listener is drawn as a cartoon person whose green cone and nose point where they face. Cabinets are drawn about 1.3× true size so they stay legible in a 10 m room, and hit-testing shares those dimensions. Furniture picking follows the visible projected faces; dragging preserves the initial grab offset.

## Headphones and tracking

Optional AutoEq starting points are included for AirPods Pro 2 ANC, AirPods 4, AirPods 4 ANC, and EarPods. Sources: crinacle 711 for Pro 2 ANC; RTINGS B&K 5128 for AirPods 4; RTINGS HMS II.3 for EarPods. EarPods connector revision was not verified. Fit, mode, measurement rig, and personal preference affect results. EQ preamp attenuation is intentional headroom, not a fault.

AirPods Pro 3 is explicitly **uncalibrated / bypass**: no numerical correction was verified for this project. The app does not detect your headphone model or control ANC, Adaptive EQ, Bluetooth codecs, or AirPods motion sensors.

Head tracking uses the device running the page's orientation events, where supported and permitted on HTTPS. It does not relay a phone's sensors to a laptop. Manual Turn is available without sensors; experimental rendering has limitations, including non-personalized elevation cues.

## Stems and external services

`stems.html` loads the exactly pinned Demucs Web 1.0.2 and ONNX Runtime Web 1.20.0 browser modules; the ONNX import uses the package-exported `ort.bundle.min.mjs` path. The tool checks file duration, estimates working memory, reports the selected WebGPU/WASM provider and thread count, downloads the model with progress/size/timeout protection, supports segment-boundary cancellation, and checks storage quota before writing four stems. Results/model memory and saved stems can be cleared explicitly. The roughly 172 MB model is externally hosted and browser-cached. GitHub Pages does not supply cross-origin isolation headers, so WebAssembly safely falls back to one thread.

Archive.org, Audius, and direct-link loading depend on third-party availability and CORS. Spotify/YouTube DRM or embedded-player audio is not supported. External catalogs/CDNs receive normal network requests. The Source panel has one-tap **Browse free music** chips (Indian classical, Hindustani, Carnatic, Bhangra, Punjabi, Ghazal, Qawwali, Bollywood, sitar & tabla, devotional, Indian film, jazz, electronic, world) that search Archive.org for you; searches return 12 items ranked by relevance to the query, sorted by popularity, and load the smallest playable file first. Bundled demos stay CC-BY only, so no commercial film soundtracks ship with the app. Check each catalog item's license before using it. Source file selection and room layout are not persisted across reloads; saved stems are the exception. Loading a new mix clears any previously loaded stems and speaker stem assignments, so boxes never silently keep playing old material. Seven credited CC-BY demo excerpts and their four synchronized FLAC stems are bundled, including two Indian-fusion selections chosen because no Bollywood film song could be redistributed: commercial film soundtracks stay copyrighted regardless of style. Choose a Demo in Source and press **Load demo**: only the original mix is fetched for playback. The four synchronized stems download with bounded concurrency only after **Map stems** is selected, avoiding unnecessary mobile bandwidth and peak decode memory. Map stems switches to the four-box separated rig; All parts / Vocals only / Drums only / Bass only / Other only then isolate the virtual sources (AI separation is lossy, which is why it is opt-in). Demos require HTTP(S), not file://. The Beat is percussion-led with quieter vocal samples; source separation does not isolate every individual instrument.

## Bundled demo credits

Source audio and full stems-credit chains: [ccmixter.org](https://ccmixter.org/). Excerpts are 24 seconds, faded, and machine-separated with [Demucs](https://github.com/adefossez/demucs); stems are AI-generated, not the artists' original studio stems. Two unrelated-artist tracks share the title "Come Home"; two later additions are Indian-fusion arrangements, not Bollywood film songs. Two early picks were replaced because their excerpts lacked drums and bass.

- **We are more (59581)** — Reiswerk ft. spinningmerkaba (Starfrosch & Jerry Spoon) — Indian fusion (sitar, tabla, harmonium over electronic pop; English vocals) — [source](https://ccmixter.org/files/Reiswerk/59581) — [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — samples [We Are More pell by spinningmerkaba](https://ccmixter.org/files/jlbrock44/59515) (CC BY 3.0)
- **Cyberbad's Weekend (40166)** — coruscate ft. DonnieOzone & AKFRU — Indian-influenced hip-hop/dubstep — [source](https://ccmixter.org/files/Coruscate/40166) — [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — samples [The Weekend pell by Donnie Ozone](https://ccmixter.org/files/donnieozone/37325) (CC BY 3.0), [Cyberabad samples by AKFRU](https://ccmixter.org/files/AKFRU/38423) (CC BY 3.0)

- **Come Home (71178)** — Gabriel Shellington ft. spinningmerkaba — [source](https://ccmixter.org/files/gabriel_shelligton/71178) — [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — samples [Come Home pell by spinningmerkaba](https://ccmixter.org/files/jlbrock44/46531) (CC BY 3.0)
- **M.U.S.T.A.N.G Beats (71068)** — Gabriel Shellington ft. Ms. Vybe — [source](https://ccmixter.org/files/gabriel_shelligton/71068) — [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/) — samples [M.U.S.T.A.N.G by Ms. Vybe](https://ccmixter.org/files/kendra/3301) (CC BY 2.5)
- **Come Home (46603)** — AlexBeroza ft. spinningmerkaba — [source](https://ccmixter.org/files/AlexBeroza/46603) — [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — samples [Come Home pell by spinningmerkaba](https://ccmixter.org/files/jlbrock44/46531) (CC BY 3.0)
- **A Foolish Game (46258)** — AlexBeroza ft. Snowflake, Admiral Bob, SackJo22, Martijn de Boer (NiGiD) — [source](https://ccmixter.org/files/AlexBeroza/46258) — [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — samples [A Foolish Game pell by Madam Snowflake](https://ccmixter.org/files/snowflake/46165), [Admiral Bob 12-bar blues](https://ccmixter.org/files/admiralbob77/44070) (CC BY 3.0), [second Admiral Bob 12-bar](https://ccmixter.org/files/admiralbob77/44071) (CC BY 3.0), [A Foolish Game by Martijn de Boer (NiGiD)](https://ccmixter.org/files/NiGiD/46175) (CC BY 3.0), [A Foolish Game by SackJo22](https://ccmixter.org/files/SackJo22/46200) (CC BY 3.0)
- **The Beat (Remastered 2026) (70823)** — Gabriel Shellington ft. cdk — [source](https://ccmixter.org/files/gabriel_shelligton/70823) — [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — samples [the beat by cdk](https://ccmixter.org/files/cdk/1667) (CC BY 2.5; original description credits J.Lang vocals)

Licenses permit redistribution and derivative stems with attribution above; do not remove the credits. Audio licenses are separate from any code license. Demo rig: vocal front, drums left, instruments rear-high, bass sub rear — buttons audition each part solo.

## Run locally

Node.js 20+ is required for the safe local server and tests:

```sh
npm install
npm start
```

Open `http://127.0.0.1:8000`. The server binds to loopback and serves only allowlisted app assets, documentation, the demo manifest, and demo FLAC files. It supports byte-range audio requests and sends a restrictive Content Security Policy. Requests for `.git`, test files, `package.json`, and loose personal audio return 404.

Do **not** run a generic static server from the repository root: ignored MP3 files and Git metadata can otherwise become visible to other devices if the server binds to the network. `index.html` still supports basic `file://` playback, but demos, the external stem runtime, catalogs, and some browser APIs require HTTP(S). No production bundling step is required.

## Regression checks

Dependencies are pinned in `package-lock.json`. The complete suite uses Playwright, the safe allowlisted server, dynamically allocated ports, generated in-memory WAV audio, and either installed Chrome or Playwright Chromium:

```sh
npm test
```

Focused commands are also available:

```sh
npm run test:server
npm run test:audio
npm run test:fidelity
npm run analyze:local
npm run test:ui
npm run test:player
npm run test:visual
npm run test:glass
npm run test:demos
npm run test:stems
npm run test:mobile
```

CI installs Playwright Chromium and runs the same suite. Tests cover server isolation/security headers and ranges, centered audio symmetry, dry passband and limiter quality, responsive interaction and accessibility sizing, player metadata/transport/mini-player, project persistence, all seven demo bundles with on-demand stems, legacy IndexedDB stem compatibility, and the corrected stem runtime module path.

`test.cjs` renders actual Web Audio through Chrome's OfflineAudioContext and checks centered bass/treble symmetry with reflections in both Room and Immersive renderers. `test-quality.cjs` renders the real playback graph and asserts a flat dry passband, level linearity, negligible alias energy under extreme gain, and program safety on both Clarity two-box and Immersive nine-box rigs. `test-fidelity.cjs` independently measures THD, L/R crosstalk, automatic coherent-sum headroom, limiter behavior, and the −1 dBFS emergency ceiling. Output level is position-dependent and intentionally leaves headroom; use Master or system volume rather than increasing every speaker gain. `test-ui.cjs` checks the iOS 27 shell: a clean first view (at most two category groups open), tab-bar reachability, opening categories to reach controls, 44pt hit targets, preset wiring, furniture dragging with mouse and real touch, the Liquid Glass slider, Light and Dark appearances, and overflow at 320/390/768/1280. `test-mobile-performance.cjs` emulates a phone with 4× CPU throttling and asserts the first-paint appearance, backdrop-filter count, idle animations, canvas backing size, stage touch scrolling versus dragging, scroll stability across toolbar resizes, artwork stability across play/pause, Media Session update frequency, and DOM mutation and layout rates during playback. These tests do not verify perceived realism on a physical headset. No lint/typecheck command is configured.

## Hosting and limitations

GitHub Pages publishes the repository root from `main`. Push changes to trigger deployment; hard-refresh the live site after deployment and check the footer build label.

The app code is MIT licensed (see LICENSE). Bundled demo audio stays under its CC-BY terms with attribution — the licenses are separate.

Loose audio drops (`*.mp3` etc.) are git-ignored by default so personal/copyrighted files in this folder can never be committed by accident; only `demos/` is published.

This is an experimental simulation, **not exact acoustic replication**: no measured room response, room-mode solver, wave diffraction, personal HRTF, or calibrated loudspeaker directivity. Hard furnishings are not fully simulated as reflecting geometry. Clarity folds master and trim gain into coherent-sum headroom and bypasses dynamics processing; optional spatial modes retain a post-EQ emergency limiter. The linear −1 dBFS sample ceiling is not a certified true-peak implementation or hearing protection.

References: [AutoEq](https://github.com/jaakkopasanen/AutoEq), [ODEON room acoustics](https://odeon.dk/learn/articles/room-acoustics/), [Windows Bluetooth audio](https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/bluetooth-classic-audio).
