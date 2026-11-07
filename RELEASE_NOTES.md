# Tab Audio Translator · v0.5.0

**English** | [Русский](RELEASE_NOTES.ru.md)

First public release: translated speech and subtitles for a selected tab's audio, using your own Gemini API key.

- Voice, Subtitles and Both output modes.
- Automatic source-language detection; a target language based on Chrome or your manual choice.
- A short list of common languages and search across 78 target options.
- 12 interface languages, with English as the fallback.
- Connection settings and an API key guide inside the popup.
- Local text history for 7 days, with search, copy and deletion.
- A replacement connection and PCM audio engine, distributed under 0BSD.
- English documentation and screenshots, with Russian versions available by link.

## Installation

Download `tab-audio-translator-v0.5.0.zip`, extract it and load the folder containing `manifest.json` through `chrome://extensions` → **Developer mode** → **Load unpacked**.

You need your own Gemini API key and model access. Google API usage is subject to Google's quotas and pricing; free usage is not guaranteed. Audio from the selected tab is sent to Google during translation. Text history is kept locally for 7 days.

If you downloaded the source archive, load its `extension` folder. See the [README](README.md) for details.
