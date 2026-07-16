# Ascolto la Musica — versione autonoma

Strumento di training cognitivo con **doppio switch** (Makey Makey), pensato per utenti con disabilità motorie. Applicazione **100% statica** (HTML/CSS/JavaScript): nessun server, nessun database esterno, nessun login.

**Un dispositivo = un utente.** Tutti i dati (brani YouTube e registrazioni MP3) sono salvati nel browser del dispositivo.

## Funzionalità

- **Switch 1 (SPAZIO o FRECCIA SINISTRA)**: riproduce i brani YouTube scelti dall'educatore, con tempi di inizio/fine spezzone opzionali
- **Switch 2 (FRECCIA DESTRA)**: riproduce audio MP3 o voci registrate; la musica va in pausa e riprende alla fine dell'audio
- **Area Educatore** (accesso libero): archivio brani con ricerca YouTube integrata, registrazione voce dal microfono con **taglio automatico del silenzio** e conversione MP3 nel browser (lamejs), caricamento file audio (anche vocali WhatsApp OGG/Opus), scelta successivo/casuale per video e audio
- **Modalità di ascolto**: normale, temporizzata, 🔒 timer persistente (switch ibernato, per cloni motori involontari)
- **PWA installabile**, schermo intero, tap sul video = switch 1

## Architettura dati

| Dato | Dove |
|---|---|
| Brani YouTube, preferenze | `localStorage` |
| Audio MP3 (blob) | `IndexedDB` |

All'avvio l'app richiede `navigator.storage.persist()` per proteggere i dati dall'eliminazione automatica del browser. **Non cancellare i dati di navigazione** sul dispositivo: contengono le registrazioni.

## Struttura del progetto

```
├── index.html              # Entry point
├── css/styles.css          # Stili
├── js/
│   ├── storage.js          # Strato dati (localStorage + IndexedDB)
│   ├── app.js              # Core: educatore, player YouTube, switch 1
│   ├── switch2.js          # Audio switch 2: registrazione, MP3, riproduzione
│   └── lib/lame.min.js     # Encoder MP3 (lamejs)
├── assets/                 # Font icone (Bootstrap Icons) e icone PWA
├── manifest.json           # Manifest PWA
├── service-worker.js       # Cache offline degli asset statici
└── staticwebapp.config.json # Configurazione Azure Static Web Apps
```

## Sviluppo locale

Serve solo un server statico (per permessi microfono e service worker usare `localhost`):

```bash
cd ascolto_la_musica
python3 -m http.server 8080
# oppure: npx serve .
```

Apri `http://localhost:8080`.

## Deploy su Azure Static Web Apps

1. Push del repository su GitHub (organizzazione `tecniciausili`)
2. Portale Azure → **Crea risorsa** → **Static Web App**
3. Collega l'account GitHub, scegli organizzazione/repo/branch
4. Dettagli build: **preset "Custom"**, percorso app `/`, percorso output `/` (nessuna build: file statici puri)
5. Azure crea automaticamente il workflow GitHub Actions: da quel momento ogni push su `main` pubblica in automatico

L'HTTPS (incluso di serie) è necessario per microfono e PWA.

## Note tecniche

- I comandi da tastiera di YouTube sono disabilitati (`disablekb: 1`) e un overlay trasparente impedisce all'iframe di catturare il focus: le frecce restano dedicate agli switch
- La riproduzione YouTube richiede connessione internet; gli audio MP3 funzionano anche offline
- Conversione audio: Web Audio API (decodifica + taglio silenzio RMS) + lamejs (encoding MP3 128 kbps mono)
