// ==================== SWITCH 2 (FRECCIA DESTRA): AUDIO MP3 / VOCE REGISTRATA ====================
// Versione autonoma: gli audio sono salvati in IndexedDB su questo dispositivo
// (vedi js/storage.js). Nessun server.
//
// - Area Educatore: registra voce dal microfono o carica un file audio
//   (MP3, OGG/Opus di WhatsApp, M4A, WAV...): conversione in MP3 e taglio
//   automatico del silenzio iniziale/finale, tutto nel browser (lamejs).
// - Area Utente: FRECCIA DESTRA riproduce gli audio "nel gioco", in ordine
//   o casuale secondo la scelta dell'educatore; la musica YouTube va in
//   pausa e riprende alla fine dell'audio.

const switch2State = {
  // Area utente
  pool: [],                 // Audio "nel gioco" [{id, nome_audio, blob, ...}]
  advanceMode: 'successivo',// Scelta educatore: 'successivo' | 'random'
  sequentialIndex: -1,      // Indice corrente per la modalità 'successivo'
  shuffleQueue: [],         // Indici ancora da riprodurre nel giro shuffle corrente
  currentAudio: null,       // Record in riproduzione
  audioElement: null,       // Elemento Audio in riproduzione
  currentObjectURL: null,   // Object URL del blob in riproduzione (da revocare)
  isPlaying: false,
  keyPressed: false,
  resumeMusicAfter: false,  // True se la musica YouTube va ripresa a fine audio
  endHandler: null,
  // Area educatore
  mediaRecorder: null,
  recordedChunks: [],
  isRecording: false,
  recordStream: null,
  recordTimerInterval: null,
  recordSeconds: 0,
  processedBlob: null,      // MP3 già tagliato e codificato, pronto per il salvataggio
  processedDuration: 0,
  processedOrigine: 'upload',
};

// ==================== GESTIONE TASTI (AREA UTENTE) ====================

document.addEventListener('keydown', (event) => {
  if (typeof appState === 'undefined' || appState.mode !== 'user') {
    return;
  }
  if (event.code === 'ArrowRight') {
    event.preventDefault();
    if (switch2State.keyPressed) {
      return;
    }
    switch2State.keyPressed = true;
    playSwitch2Audio();
  }
});

document.addEventListener('keyup', (event) => {
  if (event.code === 'ArrowRight') {
    switch2State.keyPressed = false;
  }
});

// ==================== AREA UTENTE: POOL E RIPRODUZIONE ====================

// Imposta la modalità scelta dall'educatore ('successivo' | 'random')
function setSwitch2AdvanceMode(modo) {
  const nuovo = (modo === 'random') ? 'random' : 'successivo';
  if (nuovo !== switch2State.advanceMode) {
    switch2State.shuffleQueue = [];
    switch2State.sequentialIndex = -1;
  }
  switch2State.advanceMode = nuovo;
  updateSwitch2Indicator();
}

// Carica dal database locale gli audio "nel gioco"
async function loadSwitch2Pool() {
  try {
    const tutti = await audioLista();
    switch2State.pool = tutti.filter((a) => parseInt(a.attivo) === 1);
    switch2State.shuffleQueue = [];
    switch2State.sequentialIndex = -1;
    console.log(`🎙️ Switch 2: pool caricato con ${switch2State.pool.length} audio (su ${tutti.length} totali)`);
  } catch (error) {
    console.warn('⚠️ Switch 2: impossibile caricare il pool audio:', error.message);
    switch2State.pool = [];
  }
  updateSwitch2Indicator();
}

// Mostra nell'area utente quanti audio sono collegati alla freccia destra
function updateSwitch2Indicator() {
  if (typeof appState === 'undefined' || appState.mode !== 'user') {
    return;
  }

  let indicator = document.getElementById('switch2Indicator');

  if (!indicator) {
    const currentSong = document.getElementById('userCurrentSong');
    if (!currentSong || !currentSong.parentElement) {
      return;
    }
    indicator = document.createElement('p');
    indicator.id = 'switch2Indicator';
    indicator.style.cssText = 'font-size: 0.85rem; margin: 0.35rem 0 0 0; text-align: right; color: #666;';
    currentSong.parentElement.appendChild(indicator);
  }

  const n = switch2State.pool.length;
  if (n > 0) {
    const modo = switch2State.advanceMode === 'random' ? 'casuale' : 'in ordine';
    indicator.innerHTML = `<i class="bi bi-mic-fill" style="color: var(--primary-color);"></i> Freccia DESTRA: <strong>${n} audio</strong> (riproduzione ${modo})`;
  } else {
    indicator.innerHTML = '<i class="bi bi-mic-mute"></i> Freccia DESTRA: nessun audio impostato';
  }
}

// Rimescola gli indici (Fisher-Yates), evitando di ripetere subito l'ultimo suonato
function switch2RigeneraCoda(ultimoIndice) {
  const indici = switch2State.pool.map((_, i) => i);
  for (let i = indici.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indici[i], indici[j]] = [indici[j], indici[i]];
  }
  if (indici.length > 1 && indici[0] === ultimoIndice) {
    [indici[0], indici[1]] = [indici[1], indici[0]];
  }
  switch2State.shuffleQueue = indici;
}

// Sceglie il prossimo indice secondo la modalità
function switch2ProssimoIndice() {
  if (switch2State.advanceMode === 'random') {
    if (switch2State.shuffleQueue.length === 0) {
      const ultimoIndice = switch2State.currentAudio
        ? switch2State.pool.findIndex((a) => a.id === switch2State.currentAudio.id)
        : -1;
      switch2RigeneraCoda(ultimoIndice);
    }
    return switch2State.shuffleQueue.shift();
  }
  switch2State.sequentialIndex = (switch2State.sequentialIndex + 1) % switch2State.pool.length;
  return switch2State.sequentialIndex;
}

// Riproduce il prossimo audio: pausa la musica YouTube e la riprende alla fine
function playSwitch2Audio() {
  if (!switch2State.pool || switch2State.pool.length === 0) {
    console.log('🎙️ Switch 2 premuto, ma nessun audio impostato');
    return;
  }
  if (switch2State.isPlaying) {
    return;
  }

  const indice = switch2ProssimoIndice();
  const record = switch2State.pool[indice];
  if (!record || !record.blob) {
    console.warn('⚠️ Switch 2: audio non valido all\'indice', indice);
    return;
  }
  switch2State.currentAudio = record;

  // Se la musica YouTube sta suonando, pausa e segno di riprenderla
  switch2State.resumeMusicAfter = false;
  const player = appState.youtubePlayer;
  if (player && typeof player.getPlayerState === 'function') {
    try {
      const stato = player.getPlayerState();
      if (stato === 1 || stato === 3) {
        player.pauseVideo();
        switch2State.resumeMusicAfter = true;
      }
    } catch (e) { /* ignora */ }
  }

  switch2State.isPlaying = true;

  // Revoco l'eventuale object URL precedente e ne creo uno nuovo dal blob
  if (switch2State.currentObjectURL) {
    URL.revokeObjectURL(switch2State.currentObjectURL);
  }
  switch2State.currentObjectURL = URL.createObjectURL(record.blob);

  const audio = new Audio(switch2State.currentObjectURL);
  switch2State.audioElement = audio;

  const fineRiproduzione = () => {
    switch2State.isPlaying = false;
    audio.removeEventListener('ended', fineRiproduzione);
    audio.removeEventListener('error', fineRiproduzione);
    switch2State.endHandler = null;

    if (switch2State.resumeMusicAfter && appState.youtubePlayer && typeof appState.youtubePlayer.playVideo === 'function') {
      try {
        appState.youtubePlayer.playVideo();
      } catch (e) { /* ignora */ }
    }
    switch2State.resumeMusicAfter = false;
  };

  switch2State.endHandler = fineRiproduzione;
  audio.addEventListener('ended', fineRiproduzione);
  audio.addEventListener('error', fineRiproduzione);

  audio.play()
    .then(() => console.log(`🔊 Switch 2: riproduco "${record.nome_audio}"`))
    .catch((error) => {
      console.error('❌ Switch 2: errore riproduzione:', error);
      fineRiproduzione();
    });
}

// Ferma l'audio switch 2 (chiamato dallo switch 1). Ritorna true se ha
// ripreso la musica in pausa (in quel caso lo switch 1 non fa altro).
function interruptSwitch2Audio() {
  if (!switch2State.isPlaying || !switch2State.audioElement) {
    return false;
  }

  const audio = switch2State.audioElement;
  audio.pause();
  audio.currentTime = 0;

  if (switch2State.endHandler) {
    audio.removeEventListener('ended', switch2State.endHandler);
    audio.removeEventListener('error', switch2State.endHandler);
    switch2State.endHandler = null;
  }
  switch2State.isPlaying = false;

  const riprendiMusica = switch2State.resumeMusicAfter;
  switch2State.resumeMusicAfter = false;

  if (riprendiMusica && appState.youtubePlayer && typeof appState.youtubePlayer.playVideo === 'function') {
    try {
      appState.youtubePlayer.playVideo();
      return true;
    } catch (e) { /* ignora */ }
  }
  return false;
}

// ==================== ELABORAZIONE AUDIO: TAGLIO SILENZIO + ENCODING MP3 ====================

// Decodifica un blob audio, taglia il silenzio iniziale/finale e restituisce {blob mp3, duration}
async function switch2ProcessAudioBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();

  let audioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    if (audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
    }
  }

  // Converto in mono (media dei canali)
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] / channels;
    }
  }

  // Taglio silenzio: analisi RMS a finestre di 20ms, soglia 0.02, margine 80ms
  const sampleRate = audioBuffer.sampleRate;
  const soglia = 0.02;
  const finestra = Math.floor(sampleRate * 0.02);
  const padding = Math.floor(sampleRate * 0.08);

  let inizio = 0;
  let fine = length;

  for (let i = 0; i < length; i += finestra) {
    let somma = 0;
    const stop = Math.min(i + finestra, length);
    for (let j = i; j < stop; j++) {
      somma += mono[j] * mono[j];
    }
    if (Math.sqrt(somma / (stop - i)) > soglia) {
      inizio = Math.max(0, i - padding);
      break;
    }
  }

  for (let i = length; i > 0; i -= finestra) {
    let somma = 0;
    const start = Math.max(i - finestra, 0);
    for (let j = start; j < i; j++) {
      somma += mono[j] * mono[j];
    }
    if (Math.sqrt(somma / (i - start)) > soglia) {
      fine = Math.min(length, i + padding);
      break;
    }
  }

  if (fine <= inizio) {
    inizio = 0;
    fine = length;
  }

  const trimmed = mono.subarray(inizio, fine);
  const durataSecondi = trimmed.length / sampleRate;

  // Encoding MP3 con lamejs (mono, 128 kbps)
  if (typeof lamejs === 'undefined') {
    throw new Error('Libreria lamejs non caricata: impossibile creare l\'MP3.');
  }

  const int16 = new Int16Array(trimmed.length);
  for (let i = 0; i < trimmed.length; i++) {
    const s = Math.max(-1, Math.min(1, trimmed[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  const encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
  const blockSize = 1152;
  const mp3Parts = [];

  for (let i = 0; i < int16.length; i += blockSize) {
    const encoded = encoder.encodeBuffer(int16.subarray(i, i + blockSize));
    if (encoded.length > 0) {
      mp3Parts.push(encoded);
    }
  }
  const finale = encoder.flush();
  if (finale.length > 0) {
    mp3Parts.push(finale);
  }

  return {
    blob: new Blob(mp3Parts, { type: 'audio/mpeg' }),
    duration: durataSecondi,
  };
}

// ==================== AREA EDUCATORE: INTERFACCIA ====================

function initSwitch2Educator() {
  const layout = document.querySelector('.educator-layout-full');
  if (!layout || document.getElementById('switch2Panel')) {
    return;
  }

  const section = document.createElement('section');
  section.className = 'panel form-panel-full';
  section.id = 'switch2Panel';
  section.style.marginTop = '1.5rem';
  section.setAttribute('aria-label', 'Gestione audio switch 2');

  section.innerHTML = `
    <h3 style="margin: 0 0 0.5rem 0;">
      <i class="bi bi-mic-fill"></i> Audio Switch 2 <span style="font-size: 0.85rem; color: #666;">(freccia DESTRA)</span>
    </h3>
    <p class="helper-text">
      Registra una voce dal microfono oppure carica un file audio
      (MP3, ma anche vocali di <strong>WhatsApp</strong>, M4A, WAV… convertiti in MP3 automaticamente).
      Il silenzio all'inizio e alla fine viene <strong>tagliato automaticamente</strong>.
      Gli audio con la spunta <strong>"Nel gioco"</strong> sono quelli riprodotti con la freccia destra.
    </p>

    <div id="switch2Controls" style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; margin: 1rem 0;">
      <button type="button" class="btn-primary" id="switch2RecordBtn">
        <i class="bi bi-record-circle"></i> Registra voce
      </button>
      <span id="switch2RecordTimer" style="display: none; font-weight: 700; color: #d32f2f; font-size: 1.1rem;">
        <i class="bi bi-record-fill" style="animation: blink 1s infinite;"></i> <span id="switch2RecordSeconds">0</span>s
      </span>
      <label class="btn-secondary" style="margin: 0; cursor: pointer;">
        <i class="bi bi-file-earmark-music"></i> Carica audio / MP3
        <input type="file" id="switch2FileInput" accept="audio/*,.mp3,.ogg,.oga,.opus,.m4a,.aac,.wav,.webm,.mp4,.amr" style="display: none;" />
      </label>
    </div>

    <!-- Anteprima audio elaborato -->
    <div id="switch2Preview" style="display: none; background: #f5f0fb; border: 2px solid var(--primary-color, #673AB7); border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
      <p style="margin: 0 0 0.75rem 0; font-weight: 600; color: var(--primary-color, #673AB7);">
        <i class="bi bi-soundwave"></i> Anteprima (silenzio già tagliato — durata: <span id="switch2PreviewDuration">-</span>s)
      </p>
      <audio id="switch2PreviewAudio" controls style="width: 100%; margin-bottom: 0.75rem;"></audio>
      <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: flex-end;">
        <div class="form-group" style="flex: 1; min-width: 200px; margin: 0;">
          <label for="switch2NameInput">Nome audio *</label>
          <input id="switch2NameInput" type="text" maxlength="150" placeholder="Es: Voce mamma - bravo!" autocomplete="off" />
        </div>
        <button type="button" class="btn-primary" id="switch2SaveBtn">
          <i class="bi bi-save"></i> Salva audio
        </button>
        <button type="button" class="btn-secondary" id="switch2CancelBtn">
          <i class="bi bi-x-lg"></i> Annulla
        </button>
      </div>
    </div>

    <div id="switch2Status" class="status-message" role="status" aria-live="polite"></div>

    <!-- Scelta educatore: successivo o casuale -->
    <div class="pref-box">
      <div class="pref-box-title">
        <i class="bi bi-arrow-repeat"></i> Quando l'audio finisce, al click dello switch parte:
      </div>
      <div class="pref-box-options">
        <label>
          <input type="radio" name="prefAudio" value="successivo" checked
            onchange="salvaPreferenzaEducatore('audio', 'successivo')" />
          <span><i class="bi bi-play-circle"></i> L'audio successivo</span>
        </label>
        <label>
          <input type="radio" name="prefAudio" value="random"
            onchange="salvaPreferenzaEducatore('audio', 'random')" />
          <span><i class="bi bi-shuffle"></i> Un audio casuale</span>
        </label>
      </div>
    </div>

    <!-- Lista audio archiviati -->
    <div id="switch2ListContainer" style="margin-top: 1rem;">
      <h4 style="color: var(--primary-color, #673AB7); font-size: 0.95rem;">
        <i class="bi bi-collection-play"></i> Audio archiviati
      </h4>
      <div id="switch2List"></div>
    </div>
  `;

  layout.appendChild(section);

  document.getElementById('switch2RecordBtn')?.addEventListener('click', switch2ToggleRecording);
  document.getElementById('switch2FileInput')?.addEventListener('change', switch2HandleFileUpload);
  document.getElementById('switch2SaveBtn')?.addEventListener('click', switch2SaveProcessedAudio);
  document.getElementById('switch2CancelBtn')?.addEventListener('click', switch2CancelPreview);

  switch2LoadList();
}

function switch2ShowStatus(message, type) {
  const status = document.getElementById('switch2Status');
  if (!status) {
    return;
  }
  status.textContent = message;
  status.className = `status-message ${type || ''}`;
  status.style.display = message ? 'block' : 'none';
}

// ==================== AREA EDUCATORE: REGISTRAZIONE MICROFONO ====================

async function switch2ToggleRecording() {
  if (switch2State.isRecording) {
    switch2StopRecording();
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    alert('⚠️ Impossibile accedere al microfono.\n\nVerifica i permessi del browser (icona lucchetto nella barra indirizzi).');
    return;
  }

  switch2State.recordStream = stream;
  switch2State.recordedChunks = [];
  switch2State.mediaRecorder = new MediaRecorder(stream);

  switch2State.mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      switch2State.recordedChunks.push(event.data);
    }
  });

  switch2State.mediaRecorder.addEventListener('stop', async () => {
    const blob = new Blob(switch2State.recordedChunks, { type: switch2State.mediaRecorder.mimeType });
    switch2State.recordStream?.getTracks().forEach((track) => track.stop());
    switch2State.recordStream = null;

    switch2ShowStatus('⏳ Elaborazione audio: taglio silenzio e conversione MP3...', 'info');
    try {
      const result = await switch2ProcessAudioBlob(blob);
      switch2ShowPreview(result.blob, result.duration, 'registrazione', '');
      switch2ShowStatus('', '');
    } catch (error) {
      switch2ShowStatus('Errore nell\'elaborazione della registrazione: ' + error.message, 'error');
    }
  });

  switch2State.mediaRecorder.start();
  switch2State.isRecording = true;
  switch2State.recordSeconds = 0;

  const btn = document.getElementById('switch2RecordBtn');
  if (btn) {
    btn.innerHTML = '<i class="bi bi-stop-circle"></i> Ferma registrazione';
    btn.style.background = '#d32f2f';
  }
  const timer = document.getElementById('switch2RecordTimer');
  if (timer) {
    timer.style.display = 'inline';
  }

  switch2State.recordTimerInterval = setInterval(() => {
    switch2State.recordSeconds++;
    const secondsEl = document.getElementById('switch2RecordSeconds');
    if (secondsEl) {
      secondsEl.textContent = switch2State.recordSeconds;
    }
    if (switch2State.recordSeconds >= 60) {
      switch2StopRecording(); // Limite di sicurezza 60s
    }
  }, 1000);
}

function switch2StopRecording() {
  if (!switch2State.isRecording) {
    return;
  }
  switch2State.isRecording = false;

  clearInterval(switch2State.recordTimerInterval);
  switch2State.recordTimerInterval = null;

  const btn = document.getElementById('switch2RecordBtn');
  if (btn) {
    btn.innerHTML = '<i class="bi bi-record-circle"></i> Registra voce';
    btn.style.background = '';
  }
  const timer = document.getElementById('switch2RecordTimer');
  if (timer) {
    timer.style.display = 'none';
  }

  if (switch2State.mediaRecorder && switch2State.mediaRecorder.state !== 'inactive') {
    switch2State.mediaRecorder.stop();
  }
}

// ==================== AREA EDUCATORE: CARICAMENTO FILE AUDIO ====================

async function switch2HandleFileUpload(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) {
    return;
  }

  if (file.size > 20 * 1024 * 1024) {
    alert('⚠️ File troppo grande (max 20 MB).');
    return;
  }

  const isWhatsApp = /whatsapp|ptt-|audio-\d{8}-wa/i.test(file.name) || /ogg|opus/i.test(file.type);
  switch2ShowStatus(isWhatsApp
    ? '⏳ Audio WhatsApp rilevato: conversione in MP3 e taglio del silenzio...'
    : '⏳ Elaborazione file: taglio silenzio e conversione MP3...', 'info');

  try {
    const result = await switch2ProcessAudioBlob(file);
    const nomeSuggerito = file.name.replace(/\.[^.]+$/, '');
    switch2ShowPreview(result.blob, result.duration, 'upload', nomeSuggerito);
    switch2ShowStatus('', '');
  } catch (error) {
    switch2ShowStatus('Errore nell\'elaborazione del file: ' + error.message + ' Il formato potrebbe non essere supportato da questo browser (prova con Chrome).', 'error');
  }
}

// ==================== AREA EDUCATORE: ANTEPRIMA E SALVATAGGIO ====================

function switch2ShowPreview(blob, duration, origine, nomeSuggerito) {
  switch2State.processedBlob = blob;
  switch2State.processedDuration = duration;
  switch2State.processedOrigine = origine;

  const preview = document.getElementById('switch2Preview');
  const audio = document.getElementById('switch2PreviewAudio');
  const durationEl = document.getElementById('switch2PreviewDuration');
  const nameInput = document.getElementById('switch2NameInput');

  if (audio) {
    audio.src = URL.createObjectURL(blob);
  }
  if (durationEl) {
    durationEl.textContent = duration.toFixed(1);
  }
  if (nameInput) {
    nameInput.value = nomeSuggerito || '';
  }
  if (preview) {
    preview.style.display = 'block';
    preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  nameInput?.focus();
}

function switch2CancelPreview() {
  switch2State.processedBlob = null;
  switch2State.processedDuration = 0;

  const preview = document.getElementById('switch2Preview');
  const audio = document.getElementById('switch2PreviewAudio');
  if (audio && audio.src) {
    URL.revokeObjectURL(audio.src);
    audio.removeAttribute('src');
  }
  if (preview) {
    preview.style.display = 'none';
  }
  switch2ShowStatus('', '');
}

async function switch2SaveProcessedAudio() {
  const nomeAudio = document.getElementById('switch2NameInput')?.value.trim() || '';

  if (!switch2State.processedBlob) {
    switch2ShowStatus('Nessun audio da salvare. Registra o carica prima un file.', 'error');
    return;
  }
  if (!nomeAudio) {
    switch2ShowStatus('Inserisci un nome per l\'audio.', 'error');
    document.getElementById('switch2NameInput')?.focus();
    return;
  }

  switch2ShowStatus('⏳ Salvataggio in corso...', 'info');

  try {
    await audioAggiungi({
      nome_audio: nomeAudio,
      origine: switch2State.processedOrigine,
      durata_secondi: switch2State.processedDuration.toFixed(2),
      blob: switch2State.processedBlob,
    });
    switch2ShowStatus(`✅ Audio "${nomeAudio}" salvato su questo dispositivo!`, 'success');
    switch2CancelPreview();
    switch2LoadList();
  } catch (error) {
    switch2ShowStatus('Errore nel salvataggio: ' + error.message, 'error');
  }
}

// ==================== AREA EDUCATORE: LISTA AUDIO ====================

async function switch2LoadList() {
  const list = document.getElementById('switch2List');
  if (!list) {
    return;
  }

  list.innerHTML = '<p style="color: #666;"><i class="bi bi-hourglass-split"></i> Caricamento audio...</p>';

  let audioRecords;
  try {
    audioRecords = await audioLista();
  } catch (error) {
    list.innerHTML = '<p style="color: #d32f2f;"><i class="bi bi-exclamation-triangle"></i> Errore nella lettura degli audio.</p>';
    return;
  }

  if (audioRecords.length === 0) {
    list.innerHTML = '<p style="color: #666; font-size: 0.9rem;"><i class="bi bi-mic-mute"></i> Nessun audio archiviato su questo dispositivo.</p>';
    return;
  }

  const nInclusi = audioRecords.filter((a) => parseInt(a.attivo) === 1).length;
  const intestazione = `<p style="font-size: 0.8rem; color: #666; margin: 0 0 0.5rem 0;">
    <i class="bi bi-shuffle"></i> ${nInclusi} audio nel gioco su ${audioRecords.length} totali.
  </p>`;

  const righe = audioRecords.map((audio) => {
    const isIncluso = parseInt(audio.attivo) === 1;
    const origineIcon = audio.origine === 'registrazione' ? 'bi-mic-fill' : 'bi-file-earmark-music';
    const durata = audio.durata_secondi ? `${parseFloat(audio.durata_secondi).toFixed(1)}s` : '-';
    const nome = (audio.nome_audio || '').replace(/'/g, "\\'");
    return `
      <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border: 2px solid ${isIncluso ? 'var(--primary-color, #673AB7)' : '#e0e0e0'}; border-radius: 8px; margin-bottom: 0.5rem; background: ${isIncluso ? '#f5f0fb' : '#fff'};">
        <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; margin: 0; white-space: nowrap;" title="Includi questo audio nella rotazione dello switch 2">
          <input type="checkbox" ${isIncluso ? 'checked' : ''}
            onchange="switch2ToggleIncluso(${audio.id}, this.checked ? 1 : 0)" />
          <span style="font-size: 0.8rem; font-weight: 600; color: ${isIncluso ? 'var(--primary-color, #673AB7)' : '#999'};">Nel gioco</span>
        </label>
        <i class="bi ${origineIcon}" style="color: #666;" title="${audio.origine}"></i>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${audio.nome_audio}</div>
          <div style="font-size: 0.75rem; color: #999;">${durata} • ${audio.data_creazione}</div>
        </div>
        <button type="button" class="btn-secondary" style="padding: 0.4rem 0.7rem;" title="Ascolta"
          onclick="switch2PlayPreview(${audio.id})">
          <i class="bi bi-play-fill"></i>
        </button>
        <button type="button" class="btn-secondary" style="padding: 0.4rem 0.7rem; color: #d32f2f;" title="Elimina"
          onclick="switch2Delete(${audio.id}, '${nome}')">
          <i class="bi bi-trash3"></i>
        </button>
      </div>
    `;
  }).join('');

  list.innerHTML = intestazione + righe;
}

// Player di anteprima condiviso per la lista educatore
let switch2ListPlayer = null;
let switch2ListPlayerURL = null;

async function switch2PlayPreview(id) {
  try {
    const records = await audioLista();
    const record = records.find((a) => a.id === id);
    if (!record || !record.blob) {
      return;
    }
    if (switch2ListPlayer) {
      switch2ListPlayer.pause();
    }
    if (switch2ListPlayerURL) {
      URL.revokeObjectURL(switch2ListPlayerURL);
    }
    switch2ListPlayerURL = URL.createObjectURL(record.blob);
    switch2ListPlayer = new Audio(switch2ListPlayerURL);
    switch2ListPlayer.play().catch(() => {});
  } catch (e) {
    console.error('❌ Switch 2: errore anteprima:', e);
  }
}

async function switch2ToggleIncluso(id, incluso) {
  try {
    await audioImpostaAttivo(id, incluso);
    switch2ShowStatus(incluso ? '✅ Audio aggiunto alla rotazione.' : 'ℹ️ Audio escluso dalla rotazione.', 'success');
  } catch (error) {
    switch2ShowStatus('Errore nell\'aggiornamento: ' + error.message, 'error');
  }
  switch2LoadList();
}

async function switch2Delete(id, nomeAudio) {
  if (!confirm(`Eliminare l'audio "${nomeAudio}"?\n\nQuesta azione non è reversibile.`)) {
    return;
  }
  try {
    await audioElimina(id);
    switch2ShowStatus(`✅ Audio "${nomeAudio}" eliminato.`, 'success');
  } catch (error) {
    switch2ShowStatus('Errore nell\'eliminazione: ' + error.message, 'error');
  }
  switch2LoadList();
}

// ==================== ESPORTAZIONE GLOBALE ====================

window.initSwitch2Educator = initSwitch2Educator;
window.loadSwitch2Pool = loadSwitch2Pool;
window.updateSwitch2Indicator = updateSwitch2Indicator;
window.playSwitch2Audio = playSwitch2Audio;
window.interruptSwitch2Audio = interruptSwitch2Audio;
window.setSwitch2AdvanceMode = setSwitch2AdvanceMode;
window.switch2ToggleIncluso = switch2ToggleIncluso;
window.switch2Delete = switch2Delete;
window.switch2PlayPreview = switch2PlayPreview;

console.log('✅ Modulo Switch 2 (freccia destra) caricato - versione autonoma');
