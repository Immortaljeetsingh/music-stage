# Music Stage

[Open Music Stage](https://immortaljeetsingh.github.io/music-stage/)

A browser-based listening room: arrange virtual speakers and furniture, move a listener, and hear spatialized music through stereo headphones. Built with Canvas 2D and Web Audio; no application backend or build step.

## Quick start

1. Connect stereo headphones and start at low system volume.
2. Pick an audio file in **Source**, then press **Play**. Files are decoded locally, not uploaded to GitHub. The stage opens as a 10 × 10 × 10 m room; change W/L/H any time (numbers or drag, the room clamps your layout).
3. Drag speaker cabinets or the green listener in the room. Click empty floor to reposition the listener. Desktop WASD/arrow keys also move the listener.
4. Select a speaker to change its volume, source channel, frequency band, height, or numerical X/Y position. Volume reaches 4×; master reaches 2.5×. More gain can distort.
5. Add a bed, sofa, or wardrobe/almirah in **Room**. Drag its visible top or side with a mouse or finger. Numeric controls provide precise dimensions, coordinates, and estimated absorption. Objects remain inside the room.
6. Adjust room reflections, absorption, softness, and late reverb — or pick a one-tap **Preset** (Studio, Living Room, Concert Hall, Club, Cathedral, Outdoor). Presets only retune the room; your layout and speakers stay put. Touching any room control afterwards returns the selector to Custom. Furniture movement updates direct-path obstruction while playback continues.

On phones and tablets the app uses an iOS-style tab bar: **Source**, **Room**, **Rig**, **Sound**, plus a separate prominent **Stage** tab (stage, selected speaker, transport, head tracking, appearance). One panel is shown at a time; drag directly on the room canvas and scroll within the panel. Numeric controls remain an alternative to dragging.

## Interface (iOS 27 / Liquid Glass)

The shell follows Apple's iOS 27 design language, built from the WWDC26 material updates and measured iOS 27 UI-kit values rather than a generic dark theme:

- **Liquid Glass material:** translucency with stronger diffusion, a darkened light-grey edge ring (`#a6a6a6` dark / `#dbdbdb` light, 0.5px, zero blur), static specular highlights on the top and bottom edges (inset shadows at ±40px / −40px spread), and 34px regular-glass corner radii.
- **Transparency slider (Stage → Liquid Glass):** the iOS 27 system control, implemented in-page — *ultra clear* → *fully tinted* scales material opacity and diffusion and persists in `localStorage`.
- **Uniform toolbar:** the floating glass header turns opaque with a hairline bottom border once content scrolls beneath it (iOS 27's uniform scroll-edge treatment, hard blur + border).
- **Prominent Tab:** the Stage tab sits in its own trailing capsule, the iOS 27 role that replaced the search-only slot.
- **Controls:** 44pt minimum hit targets, iOS switch toggles (label leading, control trailing), iOS sliders with 28pt thumbs, tinted glass buttons, and a pressed-state scale animation.
- **Appearance (Stage tab):** an iOS segmented control with **System / Light / Dark**. System tracks the device setting; an explicit choice overrides it and persists in `localStorage`. `prefers-reduced-transparency`, `prefers-contrast: more`, and `prefers-reduced-motion` are honored, and safe-area insets are respected on notched devices.

## Sound controls and balance

- **L/R/M:** choose the recording's left channel, right channel, or both. M plays two virtual channels around the cabinet; it is not an automatic loudness matcher.
- **Bands:** Full, Bass (300 Hz low-pass), Tweeter (2.5 kHz high-pass), Vocal (1.2 kHz band-pass), Bright (5 kHz high-pass). Subwoofers are low-passed at 120 Hz. These overlap; this is not a calibrated loudspeaker crossover.
- **Width:** 1 preserves the channel feed, 0 adds mono crossfeed, and values above 1 add opposite-polarity crossfeed. Width changes can change loudness or cause cancellation.
- **Balance / trims:** output adjustment, not automatic acoustic calibration. Start at Balance 0 and both trims 1.
- **Test tone:** choose the same 80 Hz bass, 1 kHz mid, or 6 kHz treble tone and compare Test L with Test R. Quiet diagnostic tones bypass the room, EQ, and trims; they do not measure your hearing or headphones.
- **Classic engine:** equal-power directional panning with manual distance attenuation.
- **Precise imaging:** experimental parametric interaural delay/level and filter model; not a personalized HRTF. Leave off for the simpler default.
- **Time-align rig:** changes direct-path delay for the virtual PA arrangement. Reflections retain separate delays.

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
    -> first-order wall reflections and synthetic late reverb
 -> master -> safety limiter (engaged only on overs) -> balance -> per-ear trims
 -> optional headphone EQ with preamp -> output ceiling (4x oversampled clip) -> stereo output/meters
```

Six mirrored image sources approximate first-order wall reflections. The late reverb uses a synthetic decaying-noise impulse. Softness and estimated furnishing area shorten/darken the tail. A segment/box intersection test detects blocked source-listener paths and applies a heuristic 1.8 kHz low-pass to direct sound, leaving the room send separate.

The 3D-style view is an oblique projection drawn on a 2D canvas, not a scanned 3D room. Furniture picking follows the visible projected faces; dragging preserves the initial grab offset.

## Headphones and tracking

Optional AutoEq starting points are included for AirPods Pro 2 ANC, AirPods 4, AirPods 4 ANC, and EarPods. Sources: crinacle 711 for Pro 2 ANC; RTINGS B&K 5128 for AirPods 4; RTINGS HMS II.3 for EarPods. EarPods connector revision was not verified. Fit, mode, measurement rig, and personal preference affect results. EQ preamp attenuation is intentional headroom, not a fault.

AirPods Pro 3 is explicitly **uncalibrated / bypass**: no numerical correction was verified for this project. The app does not detect your headphone model or control ANC, Adaptive EQ, Bluetooth codecs, or AirPods motion sensors.

Head tracking uses the device running the page's orientation events, where supported and permitted on HTTPS. It does not relay a phone's sensors to a laptop. Manual Turn is available without sensors; experimental rendering has limitations, including non-personalized elevation cues.

## Stems and external services

`stems.html` loads Demucs/ONNX runtime and a large external model, then attempts separation in the browser. It can require substantial RAM and time, especially on mobile; model downloads and browser compatibility can fail. GitHub Pages does not supply cross-origin isolation headers for multithreaded WASM. Saved stems use IndexedDB on the current browser/origin and can be assigned per speaker.

Archive.org, Audius, and direct-link loading depend on third-party availability and CORS. Spotify/YouTube DRM or embedded-player audio is not supported. External catalogs/CDNs receive normal network requests. The Source panel has one-tap **Browse free music** chips (Indian classical, Hindustani, Carnatic, Bhangra, Punjabi, Ghazal, Qawwali, Bollywood, sitar & tabla, devotional, Indian film, jazz, electronic, world) that search Archive.org for you; searches return 12 items ranked by relevance to the query, sorted by popularity, and load the smallest playable file first. Bundled demos stay CC-BY only, so no commercial film soundtracks ship with the app. Check each catalog item's license before using it. Source file selection and room layout are not persisted across reloads; saved stems are the exception. Loading a new mix clears any previously loaded stems and speaker stem assignments, so boxes never silently keep playing old material. Seven credited CC-BY demo excerpts and their four synchronized FLAC stems are bundled, including two Indian-fusion selections chosen because no Bollywood film song could be redistributed: commercial film soundtracks stay copyrighted regardless of style. Choose a Demo in Source and press **Load demo**: only the mix is fetched for playback (~200 ms on a local server) and the four stems download in the background, so Map stems is ready when you want it without slowing the first listen. Map stems switches to the four-box separated rig; All parts / Vocals only / Drums only / Bass only / Other only then isolate the virtual sources (AI separation is lossy, which is why it is opt-in). Demos require HTTP(S), not file://. The Beat is percussion-led with quieter vocal samples; source separation does not isolate every individual instrument.

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

Open `index.html` directly for basic playback, or serve this folder using Python:

```sh
python -m http.server 8000
```

Open `http://localhost:8000`. No npm build is required. HTTPS or localhost may be required for device/browser features.

## Regression checks

Tests require Node.js, Playwright resolvable by Node, and installed Chrome. Install Playwright in a separate tooling directory if desired, and expose it through `NODE_PATH`. Set `BROWSER_PATH` to another compatible Chromium executable if Chrome is not available.

```sh
node --check test.cjs
node --check test-ui.cjs
node test.cjs
node test-ui.cjs
node test-demos.cjs
node test-stems.cjs
node test-quality.cjs
```

The demo test also needs Python on PATH; it serves this folder temporarily on port 8931 and checks all seven bundles, synchronized decoded lengths, stereo output, attribution and solo controls.

`test.cjs` renders actual Web Audio through Chrome's OfflineAudioContext and checks centered bass/treble symmetry with reflections in both engines. `test-quality.cjs` renders the real playback graph and asserts a flat dry passband (±1.5 dB to 14 kHz), level linearity (limiter idle on normal program), and no alias products when the output ceiling clips. `test-ui.cjs` checks the iOS 27 shell: tab-bar reachability for every panel, 44pt hit targets, preset wiring, furniture dragging with mouse and real touch, the Liquid Glass slider, Light and Dark appearances, and overflow at 320/390/768/1280. These tests do not verify perceived realism on a physical headset. No lint/typecheck command is configured.

## Hosting and limitations

GitHub Pages publishes the repository root from `main`. Push changes to trigger deployment; hard-refresh the live site after deployment and check the footer build label.

The app code is MIT licensed (see LICENSE). Bundled demo audio stays under its CC-BY terms with attribution — the licenses are separate.

Loose audio drops (`*.mp3` etc.) are git-ignored by default so personal/copyrighted files in this folder can never be committed by accident; only `demos/` is published.

This is an experimental simulation, **not exact acoustic replication**: no measured room response, room-mode solver, wave diffraction, personal HRTF, or calibrated loudspeaker directivity. Hard furnishings are not fully simulated as reflecting geometry. The output ceiling prevents excessive digital sample values; it is 4x oversampled so hard clips do not add alias products, but clipping distortion itself is still possible at extreme levels. It is not hearing protection.

References: [AutoEq](https://github.com/jaakkopasanen/AutoEq), [ODEON room acoustics](https://odeon.dk/learn/articles/room-acoustics/), [Windows Bluetooth audio](https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/bluetooth-classic-audio).
