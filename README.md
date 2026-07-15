# A Cappella Video Creator

A lightweight desktop app for producing multi-voice a cappella videos as a solo singer. It owns
the entire video pipeline — project creation, count-in generation, per-voice webcam capture,
shared cropping, and 2×2 grid export — so making a new four-part video (tenor / lead / baritone
/ bass) is a short, repeatable in-app workflow instead of a manual editing session.

Audio preparation and mixing happen outside the app; you import one final mixed track.

## Workflow

1. **Project** — create a project (a dedicated folder on disk) and import the mixed track.
2. **Count-in** — pick tempo and number of clicks, preview it against the track, accept. The app
   renders `audio/pickup.wav` = count-in + track for capture; the clean original stays untouched.
3. **Capture** — select a voice part, watch the live webcam preview, hit record. Recording and
   guide playback start together; review each take and accept or re-record. Repeat for all four
   parts. **Wear headphones** so the guide doesn't bleed into your microphone.
4. **Crop** — position one square crop (drag to move, corner handle or scroll wheel to resize);
   it is applied identically to all four takes.
5. **Export** — choose the voice-to-quadrant layout and export. The app aligns all four takes,
   builds a 1080×1080 2×2 grid, mutes all camera audio, and lays in the clean mixed track.

## How synchronization works

Sync is the hard part of combining independently recorded takes, and it is solved by
construction rather than by trusting timers:

1. **During capture**, the recorded stream contains the webcam video plus a synthetic stereo
   audio track: the **left channel carries the guide playback** (count-in + track — the exact
   digital signal the singer hears) and the right channel carries the microphone. Because
   MediaRecorder muxes this audio against the video frames itself, the guide audio inside each
   take file is locked to that take's video by the recorder — regardless of hardware latency or
   recorder start-up jitter.
2. **At export**, the app decodes each take's guide channel and finds the exact position of the
   pickup track inside it by zero-mean normalized cross-correlation (FFT-based, ±1-sample
   accuracy at 8 kHz analysis rate, i.e. ~0.1 ms). Each take is then trimmed at
   `guide position + count-in duration`, so all four quadrants and the clean soundtrack start at
   exactly the same musical instant. A low correlation peak aborts the export with a clear
   message instead of producing an out-of-sync video.

The per-take offsets and confidences are displayed after each export.

## Project folder layout

```
<project>/
  project.json          # settings, takes metadata, crop, quadrant layout
  audio/original.*      # imported mixed track (untouched)
  audio/countin.wav     # rendered count-in
  audio/pickup.wav      # count-in + track, used during capture
  takes/{tenor,lead,baritone,bass}.webm
  export/final.mp4
```

## Tech stack

- **Electron + React + TypeScript** (electron-vite), packaged with electron-builder
- **Web Audio API** for count-in synthesis, sample-accurate preview, and playback scheduling
- **MediaRecorder** for capture (WebM/VP9 + Opus)
- **ffmpeg** (bundled via `@ffmpeg-installer/ffmpeg`) for audio concat, PCM decode, crop,
  `xstack` grid compose, and the final H.264/AAC encode

## Development

```sh
npm install
npm run dev          # run the app with hot reload
npm run typecheck    # typecheck main + renderer
npm test             # unit tests (offset detection)
npm run test:e2e     # full pipeline test in Chromium with fake camera/mic (no hardware needed)
```

The e2e test drives the real UI through project → import → count-in → four captures → crop →
export and verifies the output with ffprobe. Set `ACAPELLA_FAKE_MEDIA=1` when launching the app
itself to use Chromium's fake camera/microphone.

## Building the Windows installer

```sh
npm install          # on Windows, so the win32 ffmpeg/ffprobe binaries are fetched
npm run dist:win     # produces an NSIS installer in dist/
```

`@ffmpeg-installer` ships platform-specific binaries as npm packages, so the installer build
must run `npm install` on (or targeting) Windows. The ffmpeg binaries are unpacked from the app
archive at install time (`asarUnpack`).
