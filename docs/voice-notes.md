# Voice notes (client report by audio)

## What the client sees
In the new-case wizard, step "Fatos", the button **Gravar relato em áudio** records up to 3 minutes. While recording, the browser's speech recognition (pt-BR) transcribes what is said; on **Parar e usar** the transcript is appended to the report text (editable) and the audio appears as a player, like a WhatsApp voice message, that can be replayed or removed before sending. When the case is submitted, the audio is saved as an attachment. In the case detail the owner replays it with **Ouvir**.

## Privacy design
- The transcript is plain report text: it goes through the same redaction as typed text, and the client approves the anonymised version before any judge or lawyer sees it.
- The audio itself is an attachment: stored encrypted (Fernet, like every evidence file), counted in the 5-file limit, downloadable only by the owner, erased with the original report (on request or after the retention period). Judges and lawyers see only a count, never the file.
- Permissions-Policy now allows the microphone for the app itself (`microphone=(self)`); the CSP gained `media-src 'self' blob:` for playback.

## Limits and decisions to review
- **Transcription engine:** the browser's Web Speech API. In Chrome and Edge the audio is processed by the browser vendor's cloud service (a third party); Firefox has no support, so the audio is saved and the client types the text. Server-side transcription (for example a Whisper API) would give uniform quality but needs a provider account, an API key and a legal basis for sending the audio abroad; it is not implemented.
- **Consent text:** it does not mention audio or the browser's speech service. Update it with the legal review before launch (the screen shows a notice next to the record button meanwhile).
- **Formats:** WebM/Opus (Chrome, Edge, Firefox), Ogg, MP4/M4A (Safari, iOS); 2.5 MB per file, about 7 minutes of Opus, capped at 3 minutes in the recorder.
