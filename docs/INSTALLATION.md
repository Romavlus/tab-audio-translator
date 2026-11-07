# Installation and updates

**English** | [Русский](INSTALLATION.ru.md)

## Install the extension ZIP

1. Open the repository's Releases section and download `tab-audio-translator-v0.5.0.zip`.
2. Extract it to a permanent folder, such as Documents / Tab Audio Translator.
3. Open `chrome://extensions` in Google Chrome.
4. Enable **Developer mode** and click **Load unpacked**.
5. Select the extracted folder. It must contain `manifest.json`, `popup.html` and the other extension files directly inside it.
6. Optionally pin Tab Audio Translator using Chrome's puzzle-piece Extensions menu. Chrome may display a localized extension name.

## Install from source

1. Select **Code → Download ZIP** on the repository page and extract the archive, or clone it using GitHub Desktop.
2. Open `chrome://extensions`, enable **Developer mode** and click **Load unpacked**.
3. Select the **`extension` folder inside the project**. Do not select the project root containing README, LICENSE and package.json.

Neither method requires Node.js or terminal commands.

## Connect and start

1. Get a [Gemini API key](GEMINI-KEY.md).
2. Open a tab with a video, then open the extension → ⚙.
3. Paste your key, save it and check the connection.
4. Go back to the main screen and choose a language and output mode.
5. Click **Start translation** and play the video.

The target language initially follows Chrome's language settings, with English as the fallback. Selecting a supported target also changes the interface language; choose Russian to use the Russian interface. Manual choices are remembered.

The key is stored in the current Chrome profile. A separate installed copy or another profile needs its own setup.

## Update without losing settings

1. Stop the current translation.
2. Replace the files in **the same folder** used for installation. Keep the folder path and do not remove the extension from Chrome.
3. In `chrome://extensions`, click ⟳ on the extension's card.
4. Reopen the extension and try a short video.

Removing the extension from Chrome removes its local data. You can install an independent copy from another folder, but it will have separate settings and history. Avoid running two copies on the same video simultaneously.

## Installation checklist

- Chrome shows the extension at version 0.5.0 without a load error.
- The popup opens and the language selector fits within its field.
- The key saves in Settings and the connection check succeeds for your Google project.
- A short video produces translated speech and/or subtitles in the selected mode.
- Pausing or seeking does not continue playing an old segment.
- After stopping, the text is available through **History ↗**.
