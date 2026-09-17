# RekodSurat

PWA + Google Apps Script automation for incoming school letters received by Gmail.

**Live target:** `https://farshoffs.github.io/rekodsuratfail/`

## What it does

- Gmail PDF attachments are automatically detected by Apps Script.
- Each PDF is saved privately in Google Drive.
- A row is added to the supplied Google Sheet with `Tarikh Terima`, `Nama Surat` (email subject), sender, PDF/Gmail links and review status.
- Optional Gemini extraction proposes `Tarikh Surat`, `Rujukan Surat`, a short summary and the most relevant file code.
- The PWA shows the PDF inside the verification screen.
- The human verifies the document, selects `Nombor Fail` from the 908-file master list and fills `Di Minit Kepada`.
- Confirming the record writes the final data back to the Google Sheet.
- PWA shell and file master are available offline; Google data sync/PDF viewing require an internet connection.

The file master used by the UI was generated from the supplied `REKOD FAIL DAN SURAT MENYURAT` document and includes both `Buka` and `Belum buka` statuses.

## Architecture

`Gmail -> Apps Script trigger -> Drive PDF + Google Sheet -> GitHub Pages PWA -> human verification`

The GitHub PWA does **not** contain Gmail credentials, Drive credentials, API keys or a shared backend secret. It uses Google OAuth in the browser for the signed-in user and only requests Sheets read/write + Drive read + basic user email scopes.

## 1. Install Apps Script automation

See [`apps-script/README.md`](./apps-script/README.md). Run `setupRekodSurat()` once. The script adds/uses these tabs inside spreadsheet ID:

`1oQ-12HmR1AfWTMhKYF0jbFFIPKx-Gz1-oHPETopEDXg`

- `Surat Masuk`
- `Rekod Fail`

It does not clear other existing tabs.

## 2. Create a Google OAuth Web Client for the PWA

In Google Cloud Console for the Workspace project:

1. Enable **Google Sheets API** and **Google Drive API**.
2. Configure the OAuth consent screen for your Workspace users.
3. Create OAuth Client ID -> **Web application**.
4. Add authorized JavaScript origin: `https://farshoffs.github.io`
5. Open the deployed PWA -> **Tetapan** -> paste the Client ID -> **Simpan Tetapan**.
6. Press **Sambung Google** and approve access.

The Client ID is public by design; do not put a client secret in the PWA.

## 3. Existing Gmail sorter integration

Your existing Apps Script sorter can remain unchanged. Narrow RekodSurat to its output label, for example:

```javascript
setGmailQuery('label:"PPD-JPN" has:attachment filename:pdf newer_than:30d');
```

Use whatever label your current sorter already applies.

## 4. Gemini

Gemini is optional and advisory. The script first creates a short candidate list from the Rekod Fail master, then sends only those candidates plus the PDF to Gemini. This reduces noise and forces the model to select only a known file code. Final confirmation remains manual.

Configure from Apps Script using a key stored in Script Properties:

```javascript
setGeminiConfig('YOUR_API_KEY', 'gemini-2.5-flash');
```

If the model name changes in your Google project, pass the model available to that project.

## Spreadsheet columns created in `Surat Masuk`

`ID`, `Tarikh Terima`, `Nama Surat`, `Pengirim`, `Tarikh Surat`, `Rujukan Surat`, `Kod Fail`, `Nama Fail`, `Di Minit Kepada`, `Status`, `AI Cadangan Kod`, `AI Cadangan Nama`, `AI Keyakinan`, `Ringkasan`, `Gmail Message ID`, `Gmail Thread ID`, `Drive File ID`, `Nama PDF`, `Drive URL`, `Gmail URL`, `Disahkan Oleh`, `Tarikh Disahkan`, `Dicipta Pada`, `Last Update`.

## Pages deployment

`.github/workflows/pages.yml` deploys only the `web/` directory. If this is the first GitHub Pages deployment for the repository, open **Settings -> Pages -> Source -> GitHub Actions** once, then rerun the workflow.
