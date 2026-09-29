Music Stage for Android runs the audio of other apps through your Music Stage room: the same virtual speakers, Clarity / Room / Immersive modes, reflections, reverb and headphone correction as the web app.

## Install

1. Download the APK below on your phone and open it. Allow installs from your browser or file manager when Android asks.
2. Open Music Stage. The **System-wide sound** card is at the top of the Stage tab.

## One-time setup

Android lets only the shell user grant access to other apps' audio sessions, so this is done once:

- **On the phone, with Shizuku:** install [Shizuku](https://shizuku.rikka.app/), start it with Wireless debugging, then tap **Grant with Shizuku** in Music Stage.
- **Or from a computer:** enable USB debugging and run the command from **Copy ADB command**:
  `adb shell pm grant io.github.immortaljeetsingh.musicstage android.permission.DUMP && adb shell appops set io.github.immortaljeetsingh.musicstage PROJECT_MEDIA allow`

Then tap **Start**. Android asks for the audio-recording permission (the microphone is never used) and shows a screen-capture notice while processing runs.

## Limits

- Android 10 or newer.
- Apps that block audio capture (for example Spotify, Chrome, SoundCloud and some video apps) keep playing normally without processing.
- If Android incorrectly reports an app as capturable but sends no audio, Music Stage automatically restores that app's direct output.
- If multiple media apps play simultaneously, their direct outputs stay on rather than risking silence from an ambiguous capture stream.
- Processing adds roughly a tenth of a second of delay, so video lip-sync can drift slightly.
- Other equalizer or effect apps can conflict with it.
- On Android 15 and newer, enable **Disable screen share protections** in Developer options if the notification disappears while processing.
