# Get and choose a Gemini API key

**English** | [Русский](GEMINI-KEY.ru.md)

The extension needs **your own Gemini API key**. A Google password, OAuth client ID or service-account JSON file will not work here. The extension selects the model; you do not select a model when creating a key.

## Create a key

1. Open [Google AI Studio → API keys](https://aistudio.google.com/api-keys) and sign in.
2. If this is your first visit, review Google's terms. AI Studio may create a project and key automatically; you can copy an available key.
3. To create a separate key, click **Create API key**.
4. Choose your own project or create one through the dialog. If labels differ, use a project you control whose quotas you intend to use.
5. Give the key a recognizable name, such as **Tab Translator**. The name does not affect translation.
6. Copy the key. Google's documentation describes new AI Studio keys as using the **Auth** type by default.

If an existing project is missing, import it through **Dashboard → Projects → Import projects**, then create a key for it. If you lack permission to create keys, use your own project or contact its administrator.

## Connect it to the extension

1. Open Tab Audio Translator → ⚙.
2. Paste the key into **Gemini API key**.
3. Click **Save key**, then **Check connection**.
4. Once the check succeeds, go back and start translation.

The key stays in your current Chrome profile and is not part of the project files. Do not include it in README files, screenshots, Issues or commits.

## Quotas and errors

Creating a key does not guarantee model access or free usage. Availability depends on your Google project, region, quotas and plan. If billing setup is required, review the terms and limits first.

A subscription to the Gemini consumer app does not automatically provide Gemini API access. Check API pricing and quotas separately in Google AI Studio.

If you get an error, check that the key belongs to the intended project and can access the **Generative Language API / Gemini API**. This version uses `gemini-3.5-live-translate-preview`; if Google changes its availability, the extension may need an update.

References: [Google's API key guide](https://ai.google.dev/gemini-api/docs/api-key), [Gemini Live Translation](https://ai.google.dev/gemini-api/docs/live-api/live-translate), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).
