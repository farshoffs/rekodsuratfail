# Apps Script backend

This folder is the Gmail automation layer for RekodSurat.

## Install

1. Open the Apps Script project that currently sorts your school email.
2. Add the contents of `Code.gs` (or use it as a separate project if you prefer isolation).
3. If you use the manifest editor, merge the OAuth scopes from `appsscript.json` with your existing manifest instead of blindly replacing it.
4. Run `setupRekodSurat()` once and accept permissions.
5. Run `scanInbox()` once manually as a test.

The script adds two tabs to the spreadsheet without deleting other tabs:

- `Surat Masuk` - transaction/inbox table used by the PWA.
- `Rekod Fail` - 908 file codes extracted from the Rekod Fail master supplied for this project.

## Connect to your existing sorter

By default the query is:

`has:attachment filename:pdf newer_than:30d`

If your existing sorter already applies a Gmail label, narrow the query once, for example:

```javascript
setGmailQuery('label:"PPD-JPN" has:attachment filename:pdf newer_than:30d');
```

The automation adds `RekodSurat/Processed` only after it sees a PDF, preventing duplicate work. Each attachment also has its own unique row key.

## Enable Gemini (optional)

A Google Workspace Gemini licence by itself is not used directly by this script. The AI hook expects a callable Gemini API key. Store it in Script Properties by running:

```javascript
setGeminiConfig('YOUR_API_KEY', 'gemini-2.5-flash');
```

Use any Gemini model currently enabled for your API project. If no key is configured, RekodSurat still works and uses a lightweight keyword candidate ranking instead.

Gemini is only advisory. It can suggest `Tarikh Surat`, `Rujukan Surat`, `Kod Fail`, `Nama Fail` and a short summary. The final file selection and minit are confirmed in the PWA.
