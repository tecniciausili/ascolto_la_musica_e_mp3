// ==================== ASCOLTO LA MUSICA - VERSIONE AUTONOMA ====================
// App statica per Azure Static Web Apps. Un dispositivo = un utente.
// Nessun server: dati in localStorage + IndexedDB (vedi js/storage.js).
//
// Switch (Makey Makey):
//   SWITCH 1 = SPAZIO o FRECCIA SINISTRA → musica YouTube
//   SWITCH 2 = FRECCIA DESTRA → audio MP3/voci registrate (vedi js/switch2.js)

const APP_CONFIG = {
  name: 'Ascolto la Musica',
  version: '1.0.0',
};

const DEFAULT_SEARCH_QUERY = 'musica per bambini';

// ==================== PWA INSTALL ====================

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

function installPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choice) => {
      if (choice.outcome === 'accepted') {
        alert('✅ App installata con successo!\n\nLa trovi nella home del dispositivo.');
      }
      deferredPrompt = null;
    });
    return;
  }

  const isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone;
  if (isInstalled) {
    alert('✅ L\'app è già installata su questo dispositivo.');
  } else {
    alert('📱 INSTALLA APP\n\n' +
      '🌐 CHROME/EDGE: Menu (⋮) → "Installa app"\n' +
      '📱 ANDROID: Menu (⋮) → "Aggiungi a schermata Home"\n' +
      '🍎 iOS/SAFARI: Condividi → "Aggiungi a Home"');
  }
}

// Aggiorna l'app: svuota SOLO la cache dei file (service worker),
// senza MAI toccare i dati (brani, registrazioni, preferenze).
async function aggiornaApp() {
  if (!confirm('🔄 AGGIORNA APP\n\nScarica l\'ultima versione dell\'applicazione.\n\nI tuoi dati (brani e registrazioni) NON verranno toccati.\n\nContinuare?')) {
    return;
  }
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const r of registrations) {
        await r.unregister();
      }
    }
    if ('caches' in window) {
      const names = await caches.keys();
      for (const n of names) {
        await caches.delete(n);
      }
    }
    alert('✅ Cache aggiornata. La pagina verrà ricaricata.');
    window.location.reload(true);
  } catch (e) {
    alert('❌ Errore durante l\'aggiornamento: ' + e.message);
  }
}

// ==================== STATO APPLICAZIONE ====================

let appState = {
  isStarted: false,
  mode: null,              // 'educator' | 'user'
  playMode: 'normal',      // 'normal' | 'timed' | 'persistent'
  advanceModeVideo: 'successivo', // Scelta educatore: 'successivo' | 'random'
  videoFinito: false,      // True quando il brano è terminato (fine naturale o tempo di fine)
  timerDuration: 30,
  isTimerPaused: false,
  timerTimeoutId: null,
  isPersistentTimerActive: false,
  currentBrani: [],
  filteredBrani: [],
  spaceKeyPressed: false,
  lastSelectedBrano: null,
  youtubePlayer: null,
  currentVideoId: null,
  currentBranoIndex: -1,
  endTimeMonitorInterval: null,
};

let ui = {};

// ==================== NAVIGAZIONE E MENU ====================

function toggleMenu() {
  document.getElementById('sideMenu')?.classList.toggle('active');
  document.getElementById('overlay')?.classList.toggle('active');
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.remove('active');
}

function showInstructions() {
  toggleMenu();
  document.getElementById('instructionsModal')?.classList.add('active');
}

async function showInfo() {
  const menu = document.getElementById('sideMenu');
  if (menu?.classList.contains('active')) {
    toggleMenu();
  }
  document.getElementById('infoModal')?.classList.add('active');

  const versEl = document.getElementById('infoVersione');
  if (versEl) {
    versEl.textContent = APP_CONFIG.version;
  }

  // Mostro lo spazio dati occupato
  const storEl = document.getElementById('infoStorage');
  if (storEl && typeof storageInfo === 'function') {
    const info = await storageInfo();
    if (info) {
      const mb = (n) => (n / (1024 * 1024)).toFixed(1);
      storEl.innerHTML = `<strong>Spazio dati:</strong> ${mb(info.usati)} MB usati su ${mb(info.disponibili)} MB disponibili`;
    } else {
      storEl.style.display = 'none';
    }
  }
}

function resetApp() {
  window.location.reload();
}

function toggleUserOptions() {
  if (appState.mode !== 'user') {
    return;
  }
  ui.userOptionsMenu?.classList.toggle('active');
  ui.userOptionsOverlay?.classList.toggle('active');
}

// ==================== AREA EDUCATORE ====================

function startEducatorMode() {
  if (appState.isStarted) {
    return;
  }
  appState.isStarted = true;
  appState.mode = 'educator';
  document.body.classList.add('educator-mode');

  renderEducatorUI();
  cacheEducatorRefs();
  bindEducatorEvents();

  // Sezione Audio Switch 2 (definita in switch2.js)
  window.initSwitch2Educator?.();

  // Applico le preferenze salvate ai radio
  const prefs = getPreferenze();
  aggiornaPrefRadios(prefs);

  loadEducatorBrani();
}

function renderEducatorUI() {
  const mainContent = document.getElementById('appMain');
  if (!mainContent) {
    return;
  }

  mainContent.innerHTML = `
    <div class="educator-layout-full">
      <section class="panel form-panel-full" aria-label="Form salvataggio brano YouTube">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 style="margin: 0;"><i class="bi bi-music-note-beamed"></i> Archivia nuovo brano</h3>
          <button class="btn-secondary" onclick="switchToUserMode()" title="Vai all'Area Utente" style="padding: 0.5rem 1rem; font-size: 0.95rem;">
            <i class="bi bi-headphones"></i> Area Utente
          </button>
        </div>
        <p class="helper-text">
          Digita la categoria: dopo 1 secondo si apre YouTube con la ricerca.
          Scegli il video, copia il link dalla barra degli indirizzi e incollalo qui sotto.
        </p>
        <form id="videoForm" class="form-grid" novalidate>
          <div class="form-group">
            <label for="categoriaInput">Categoria *</label>
            <input id="categoriaInput" name="categoria" type="text" maxlength="100" required
              placeholder="Es: canzoni per bambini" autocomplete="off" list="categorieDatalist" />
            <datalist id="categorieDatalist"></datalist>
            <p class="helper-text">Scrivi una categoria nuova o riusa una esistente. Dopo 1 secondo si apre la ricerca YouTube.</p>
          </div>
          <div class="form-group">
            <label for="linkVideoInput">Link YouTube *</label>
            <input id="linkVideoInput" name="linkVideo" type="url" maxlength="500" required
              placeholder="https://www.youtube.com/watch?v=..." autocomplete="off" />
          </div>
          <div class="form-group">
            <label for="nomeVideoInput">Nome brano *</label>
            <input id="nomeVideoInput" name="nomeVideo" type="text" maxlength="150" required
              placeholder="Es: Ninna nanna dolce" autocomplete="off" />
          </div>

          <div class="form-group">
            <label>Tempo di inizio ascolto (opzionale)</label>
            <div class="time-group" style="display: flex; gap: 1rem; align-items: center;">
              <div style="flex: 1;">
                <label for="inizioMin" style="font-size: 0.85rem; color: #666;">Minuti</label>
                <input id="inizioMin" type="number" min="0" max="999" placeholder="0" autocomplete="off" style="text-align: center;" />
              </div>
              <div style="flex: 1;">
                <label for="inizioSec" style="font-size: 0.85rem; color: #666;">Secondi</label>
                <input id="inizioSec" type="number" min="0" max="59" placeholder="0" autocomplete="off" style="text-align: center;" />
              </div>
            </div>
            <p class="helper-text">Lascia vuoto per iniziare dall'inizio</p>
          </div>

          <div class="form-group">
            <label>Tempo di fine ascolto (opzionale)</label>
            <div class="time-group" style="display: flex; gap: 1rem; align-items: center;">
              <div style="flex: 1;">
                <label for="fineMin" style="font-size: 0.85rem; color: #666;">Minuti</label>
                <input id="fineMin" type="number" min="0" max="999" placeholder="0" autocomplete="off" style="text-align: center;" />
              </div>
              <div style="flex: 1;">
                <label for="fineSec" style="font-size: 0.85rem; color: #666;">Secondi</label>
                <input id="fineSec" type="number" min="0" max="59" placeholder="0" autocomplete="off" style="text-align: center;" />
              </div>
            </div>
            <p class="helper-text">Lascia vuoto per ascoltare fino alla fine</p>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn-primary"><i class="bi bi-save"></i> Salva brano</button>
            <button type="button" class="btn-secondary" id="resetFormButton"><i class="bi bi-eraser"></i> Svuota campi</button>
          </div>
          <div id="statusMessage" class="status-message" role="status" aria-live="polite"></div>
        </form>
      </section>

      <section class="panel form-panel-full" id="educatorVideoPanel" style="margin-top: 1.5rem;" aria-label="Brani YouTube archiviati">
        <h3 style="margin: 0 0 0.5rem 0;">
          <i class="bi bi-collection-play"></i> Brani archiviati <span style="font-size: 0.85rem; color: #666;">(switch 1)</span>
        </h3>
        <p class="helper-text">Brani salvati su questo dispositivo. Puoi aprirli su YouTube o eliminarli.</p>

        <div class="pref-box">
          <div class="pref-box-title">
            <i class="bi bi-arrow-repeat"></i> Quando il brano finisce, al click dello switch parte:
          </div>
          <div class="pref-box-options">
            <label>
              <input type="radio" name="prefVideo" value="successivo" checked
                onchange="salvaPreferenzaEducatore('video', 'successivo')" />
              <span><i class="bi bi-play-circle"></i> Il brano successivo</span>
            </label>
            <label>
              <input type="radio" name="prefVideo" value="random"
                onchange="salvaPreferenzaEducatore('video', 'random')" />
              <span><i class="bi bi-shuffle"></i> Un brano casuale</span>
            </label>
          </div>
        </div>

        <div id="educatorVideoList"></div>
      </section>
    </div>
  `;
}

function cacheEducatorRefs() {
  ui = {
    form: document.getElementById('videoForm'),
    categoria: document.getElementById('categoriaInput'),
    nome: document.getElementById('nomeVideoInput'),
    link: document.getElementById('linkVideoInput'),
    inizioMin: document.getElementById('inizioMin'),
    inizioSec: document.getElementById('inizioSec'),
    fineMin: document.getElementById('fineMin'),
    fineSec: document.getElementById('fineSec'),
    status: document.getElementById('statusMessage'),
    resetBtn: document.getElementById('resetFormButton'),
    youtubeWindow: null,
  };
}

function bindEducatorEvents() {
  let typingTimer;
  const doneTypingInterval = 1000;

  // Digitazione categoria → apertura ricerca YouTube dopo 1 secondo
  ui.categoria?.addEventListener('input', (event) => {
    clearTimeout(typingTimer);
    const query = event.target.value.trim();
    if (query.length >= 3) {
      typingTimer = setTimeout(() => openOrUpdateYouTube(query), doneTypingInterval);
    }
  });

  ui.form?.addEventListener('submit', handleFormSubmit);
  ui.resetBtn?.addEventListener('click', () => {
    ui.form?.reset();
    showStatus('Campi puliti. Inserisci i nuovi dati.', 'info');
  });

  popolaCategorieDatalist();
}

function popolaCategorieDatalist() {
  const datalist = document.getElementById('categorieDatalist');
  if (!datalist) {
    return;
  }
  datalist.innerHTML = getCategorie().map((c) => `<option value="${c}"></option>`).join('');
}

function handleFormSubmit(event) {
  event.preventDefault();

  const categoria = ui.categoria?.value.trim();
  const nomeVideo = ui.nome?.value.trim();
  const link = ui.link?.value.trim();
  const videoId = extractVideoId(link || '');

  const inizioBrano = (parseInt(ui.inizioMin?.value || '0') || 0) * 60 + (parseInt(ui.inizioSec?.value || '0') || 0);
  const fineBrano = (parseInt(ui.fineMin?.value || '0') || 0) * 60 + (parseInt(ui.fineSec?.value || '0') || 0);

  if (!categoria || !nomeVideo || !link) {
    showStatus('Compila tutti i campi obbligatori prima di salvare.', 'error');
    return;
  }
  if (!videoId) {
    showStatus('Il link inserito non sembra un URL YouTube valido.', 'error');
    return;
  }
  if (fineBrano > 0 && inizioBrano >= fineBrano) {
    showStatus('⚠️ Il tempo di fine deve essere maggiore del tempo di inizio!', 'error');
    return;
  }

  try {
    aggiungiBrano({
      nome_video: nomeVideo,
      categoria,
      link_youtube: link,
      inizio_brano: inizioBrano,
      fine_brano: fineBrano,
    });
    showStatus(`✅ Brano "${nomeVideo}" salvato!`, 'success');
    ui.form.reset();
    popolaCategorieDatalist();
    loadEducatorBrani();
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

function showStatus(message, type) {
  if (!ui.status) {
    return;
  }
  ui.status.className = `status-message ${type}`;
  ui.status.textContent = message;
}

// Lista brani archiviati con miniatura, apri su YouTube, elimina
function loadEducatorBrani() {
  const list = document.getElementById('educatorVideoList');
  if (!list) {
    return;
  }

  const brani = getBrani();

  if (brani.length === 0) {
    list.innerHTML = '<p style="color: #666; font-size: 0.9rem;"><i class="bi bi-music-note"></i> Nessun brano archiviato su questo dispositivo.</p>';
    return;
  }

  const intestazione = `<p style="font-size: 0.8rem; color: #666; margin: 0 0 0.5rem 0;">
    <i class="bi bi-music-note-list"></i> ${brani.length} brano/i archiviato/i.
  </p>`;

  const righe = brani.map((brano) => {
    const nome = (brano.nome_video || '').replace(/'/g, "\\'");
    const videoId = extractVideoId(brano.link_youtube);
    const thumb = videoId
      ? `<img src="https://img.youtube.com/vi/${videoId}/mqdefault.jpg" alt="" loading="lazy" style="width: 80px; height: 60px; object-fit: cover; border-radius: 6px; flex-shrink: 0;" />`
      : `<div style="width: 80px; height: 60px; border-radius: 6px; background: #eee; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><i class="bi bi-music-note-beamed" style="font-size: 1.5rem; color: #999;"></i></div>`;

    return `
      <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem; border: 2px solid #e0e0e0; border-radius: 8px; margin-bottom: 0.5rem; background: #fff;">
        ${thumb}
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${brano.nome_video || '(senza nome)'}</div>
          <div style="font-size: 0.8rem; color: #999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${brano.categoria || 'Senza categoria'}</div>
        </div>
        <a href="${brano.link_youtube}" target="_blank" rel="noopener" class="btn-secondary" style="padding: 0.4rem 0.7rem;" title="Apri su YouTube">
          <i class="bi bi-youtube"></i>
        </a>
        <button type="button" class="btn-secondary" style="padding: 0.4rem 0.7rem; color: #d32f2f;" title="Elimina brano"
          onclick="deleteEducatorBrano(${brano.id}, '${nome}')">
          <i class="bi bi-trash3"></i>
        </button>
      </div>
    `;
  }).join('');

  list.innerHTML = intestazione + righe;
}

function deleteEducatorBrano(id, nomeBrano) {
  if (!confirm(`Vuoi eliminare il brano:\n"${nomeBrano}"?\n\nQuesta azione non può essere annullata.`)) {
    return;
  }
  eliminaBrano(id);
  popolaCategorieDatalist();
  loadEducatorBrani();
}

// ==================== PREFERENZE (successivo / random) ====================

function salvaPreferenzaEducatore(campo, valore) {
  const prefs = salvaPreferenze(campo === 'video' ? { modalita_video: valore } : { modalita_audio: valore });
  console.log(`✅ Preferenze salvate: video=${prefs.modalita_video}, audio=${prefs.modalita_audio}`);
}

function aggiornaPrefRadios(prefs) {
  const rv = document.querySelector(`input[name="prefVideo"][value="${prefs.modalita_video}"]`);
  if (rv) {
    rv.checked = true;
  }
  const ra = document.querySelector(`input[name="prefAudio"][value="${prefs.modalita_audio}"]`);
  if (ra) {
    ra.checked = true;
  }
}

// ==================== RICERCA YOUTUBE (popup educatore) ====================

function openOrUpdateYouTube(query) {
  if (!navigator.onLine) {
    showStatus('⚠️ YouTube non disponibile senza connessione internet.', 'info');
    return;
  }

  const searchQuery = query || DEFAULT_SEARCH_QUERY;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;

  const screenWidth = window.screen.availWidth;
  const screenHeight = window.screen.availHeight;
  const screenLeft = window.screen.availLeft || 0;

  const isTablet = /iPad|Android/i.test(navigator.userAgent) &&
                   (window.screen.width >= 768 && window.screen.width <= 1366);

  const widthRatio = isTablet ? 0.5 : 0.667;
  const youtubeWidth = Math.floor(screenWidth * widthRatio);
  const youtubeHeight = Math.floor(screenHeight * 0.75);
  const youtubeLeft = screenLeft + Math.floor(screenWidth * (1 - widthRatio));

  // Se la finestra è già aperta, aggiorno solo l'URL
  if (ui.youtubeWindow && !ui.youtubeWindow.closed) {
    try {
      ui.youtubeWindow.location.href = url;
      ui.youtubeWindow.focus();
      return;
    } catch (e) {
      try { ui.youtubeWindow.close(); } catch (e2) { /* già chiusa */ }
      ui.youtubeWindow = null;
    }
  }

  ui.youtubeWindow = window.open(
    url,
    'YouTubeSearch',
    `width=${youtubeWidth},height=${youtubeHeight},left=${youtubeLeft},top=0,scrollbars=yes,resizable=yes,menubar=no,toolbar=yes,location=yes`
  );

  if (!ui.youtubeWindow) {
    alert('Impossibile aprire YouTube. Verifica che i popup non siano bloccati dal browser.');
  } else {
    ui.youtubeWindow.focus();
  }
}

function extractVideoId(url) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.split('/').pop();
    }
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }
    if (parsed.pathname.includes('/embed/')) {
      return parsed.pathname.split('/embed/')[1];
    }
  } catch (error) {
    return null;
  }
  return null;
}

// ==================== AREA UTENTE ====================

function startUserMode() {
  if (appState.isStarted) {
    return;
  }
  appState.isStarted = true;
  appState.mode = 'user';

  renderUserUI();
  cacheUserRefs();
  bindUserEvents();

  // Applico le preferenze dell'educatore
  const prefs = getPreferenze();
  appState.advanceModeVideo = prefs.modalita_video;
  window.setSwitch2AdvanceMode?.(prefs.modalita_audio);

  // Carico i brani e il pool audio dello switch 2
  loadUserBrani();
  window.loadSwitch2Pool?.();

  updatePlayButton();
}

function switchToUserMode() {
  appState.isStarted = false;
  appState.mode = null;
  document.body.classList.remove('educator-mode');
  startUserMode();
}

function switchToEducatorMode() {
  appState.isStarted = false;
  appState.mode = null;
  document.body.classList.remove('user-mode-active');
  // Fermo il player se attivo
  try { appState.youtubePlayer?.destroy(); } catch (e) { /* ignora */ }
  appState.youtubePlayer = null;
  startEducatorMode();
}

function renderUserUI() {
  const mainContent = document.getElementById('appMain');
  if (!mainContent) {
    return;
  }

  document.body.classList.remove('educator-mode');
  document.body.classList.add('user-mode-active');

  mainContent.innerHTML = `
    <!-- Overlay per menu opzioni -->
    <div class="user-options-overlay" id="userOptionsOverlay" onclick="toggleUserOptions()"></div>

    <!-- Menu opzioni laterale -->
    <nav class="user-options-menu" id="userOptionsMenu">
      <h4><i class="bi bi-sliders"></i> Opzioni di ascolto</h4>

      <div class="options-group">
        <label>
          <input type="radio" name="playMode" value="normal" id="radioNormal" checked>
          <span>Ascolto Normale</span>
        </label>
        <label>
          <input type="radio" name="playMode" value="timed" id="radioTimed">
          <span>Ascolto Temporizzato</span>
        </label>
        <label>
          <input type="radio" name="playMode" value="persistent" id="radioPersistent">
          <span>🔒 Timer Persistente</span>
        </label>
      </div>

      <p id="advanceModeInfo" style="font-size: 0.8rem; color: #666; margin: 0.75rem 0 0 0; padding: 0.6rem; background: #f5f0fb; border-radius: 8px;">
        <i class="bi bi-info-circle"></i> Impostato dall'educatore: <strong id="advanceModeLabel">brano successivo</strong>
      </p>

      <div class="timer-controls" id="timerControlsBox">
        <label for="timerSlider">Durata ascolto (secondi)</label>
        <input type="range" id="timerSlider" min="5" max="120" value="30" step="5">
        <span class="timer-value" id="timerValue">30s</span>
        <p style="margin-top: 1rem; font-size: 0.85rem; color: #666; line-height: 1.6;">
          <i class="bi bi-info-circle"></i> Dopo questo tempo, il brano andrà in pausa.
          Premi <strong>SPAZIO</strong> per riprendere.
        </p>
      </div>

      <div class="direct-info active" id="normalInfoBox">
        <p style="font-size: 0.9rem; color: #666; line-height: 1.7;">
          <i class="bi bi-info-circle"></i> In modalità <strong>Ascolto Normale</strong>,
          premi <strong>SPAZIO</strong> (o <strong>FRECCIA SINISTRA</strong>) per avviare un brano.
          Quando il brano finisce, alla pressione successiva parte il brano
          <strong>successivo</strong> o uno <strong>casuale</strong>, secondo l'impostazione dell'educatore.
          Con la <strong>FRECCIA DESTRA</strong> (switch 2) si riproducono gli audio registrati.
        </p>
      </div>

      <div class="persistent-info" id="persistentInfoBox">
        <p style="font-size: 0.9rem; color: #666; line-height: 1.7;">
          <i class="bi bi-shield-lock"></i> In modalità <strong>🔒 Timer Persistente</strong>,
          premi <strong>SPAZIO</strong> per avviare un brano. Durante il timer, <strong>SPAZIO sarà disabilitato</strong>
          (anche se premuto involontariamente). Ideale per deficit motori con cloni involontari del braccio.
        </p>
      </div>

      <div style="margin-top: 2rem; padding-top: 2rem; border-top: 2px solid rgba(103, 58, 183, 0.1);">
        <button class="btn-primary" id="playActionButton" onclick="handlePlayAction()" style="width: 100%; margin: 0;">
          <i class="bi bi-play-circle" id="playActionIcon"></i>
          <span id="playActionText">Play Brano</span>
        </button>
        <p id="playActionDescription" style="margin-top: 0.75rem; font-size: 0.8rem; color: #666; text-align: center;">
          Avvia il prossimo brano
        </p>
      </div>
    </nav>

    <!-- Indicatore SPACE -->
    <div class="space-indicator" id="spaceIndicator">
      <i class="bi bi-pause-circle"></i> Premi SPAZIO (o FRECCIA SINISTRA) per riprendere
    </div>

    <div class="user-layout">
      <!-- Lista brani (sinistra) -->
      <section class="panel user-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h3 style="margin: 0;"><i class="bi bi-headphones"></i> I tuoi brani</h3>
          <button class="btn-secondary" onclick="switchToEducatorMode()" title="Vai all'Area Educatore" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">
            <i class="bi bi-person-workspace"></i> Educatore
          </button>
        </div>

        <div id="userBraniContainer" style="margin-top: 1rem;">
          <div class="form-group" id="userCategoriaFilterGroup" style="margin-bottom: 1rem; display: none;">
            <label for="userCategoriaFilter">Filtra per categoria</label>
            <select id="userCategoriaFilter" style="font-size: 1rem; padding: 0.6rem;">
              <option value="">Tutte le categorie</option>
            </select>
          </div>

          <div id="userBraniList" class="brani-list"></div>
        </div>
      </section>

      <!-- Player (destra) -->
      <section class="user-player-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; gap: 1rem;">
          <h3 style="color: var(--primary-color); margin: 0; white-space: nowrap;">
            <i class="bi bi-play-circle"></i> Player
          </h3>
          <div style="text-align: right;">
            <p id="userCurrentSong" style="font-weight: 600; font-size: 1.1rem; margin: 0;">
              Nessun brano selezionato
            </p>
          </div>
        </div>

        <div class="iframe-wrapper">
          <div id="userPlayerFrame" style="display: flex; align-items: center; justify-content: center; background: #f0f0f0; color: #666; font-size: 1.2rem; text-align: center; padding: 2rem;">
            <div>
              <i class="bi bi-music-note-beamed" style="font-size: 3rem; display: block; margin-bottom: 1rem;"></i>
              <p>🎵 Seleziona un brano o premi lo switch per iniziare</p>
            </div>
          </div>
          <!-- Overlay: blocca il focus di YouTube, tap = switch 1 -->
          <div id="videoClickOverlay" onclick="activateSwitch1FromClick()" title="Tocca per avviare o far ripartire il brano"></div>
          <!-- Schermo intero del contenitore (switch e overlay restano attivi) -->
          <button id="fullscreenBtn" onclick="toggleVideoFullscreen(event)" title="Schermo intero" aria-label="Schermo intero">
            <i class="bi bi-fullscreen" id="fullscreenIcon"></i>
          </button>
        </div>
      </section>
    </div>
  `;
}

function cacheUserRefs() {
  ui = {
    userBraniContainer: document.getElementById('userBraniContainer'),
    userBraniList: document.getElementById('userBraniList'),
    userCategoriaFilter: document.getElementById('userCategoriaFilter'),
    userCategoriaFilterGroup: document.getElementById('userCategoriaFilterGroup'),
    userPlayerFrame: document.getElementById('userPlayerFrame'),
    userCurrentSong: document.getElementById('userCurrentSong'),
    userOptionsMenu: document.getElementById('userOptionsMenu'),
    userOptionsOverlay: document.getElementById('userOptionsOverlay'),
    radioNormal: document.getElementById('radioNormal'),
    radioTimed: document.getElementById('radioTimed'),
    radioPersistent: document.getElementById('radioPersistent'),
    advanceModeLabel: document.getElementById('advanceModeLabel'),
    timerSlider: document.getElementById('timerSlider'),
    timerValue: document.getElementById('timerValue'),
    timerControlsBox: document.getElementById('timerControlsBox'),
    normalInfoBox: document.getElementById('normalInfoBox'),
    persistentInfoBox: document.getElementById('persistentInfoBox'),
    spaceIndicator: document.getElementById('spaceIndicator'),
    playActionButton: document.getElementById('playActionButton'),
    playActionIcon: document.getElementById('playActionIcon'),
    playActionText: document.getElementById('playActionText'),
    playActionDescription: document.getElementById('playActionDescription'),
  };
}

function bindUserEvents() {
  ui.userCategoriaFilter?.addEventListener('change', handleCategoriaFilterChange);
  ui.radioNormal?.addEventListener('change', handlePlayModeChange);
  ui.radioTimed?.addEventListener('change', handlePlayModeChange);
  ui.radioPersistent?.addEventListener('change', handlePlayModeChange);
  ui.timerSlider?.addEventListener('input', (event) => {
    appState.timerDuration = parseInt(event.target.value, 10);
    if (ui.timerValue) {
      ui.timerValue.textContent = `${appState.timerDuration}s`;
    }
  });

  document.addEventListener('keydown', handleSpaceKeyDown);
  document.addEventListener('keyup', handleSpaceKeyUp);

  if (!window.__fullscreenBound) {
    document.addEventListener('fullscreenchange', updateFullscreenBtnIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenBtnIcon);
    window.__fullscreenBound = true;
  }
}

// ==================== LISTA BRANI UTENTE ====================

function loadUserBrani() {
  const brani = getBrani();
  appState.currentBrani = brani;

  if (brani.length === 0) {
    ui.userBraniList.innerHTML = `
      <p style="color: #666; line-height: 1.8;">
        <i class="bi bi-music-note"></i> Nessun brano trovato.<br><br>
        <small>Per aggiungere brani, vai nell'<strong>Area Educatore</strong>.</small>
      </p>`;
    ui.userCategoriaFilterGroup.style.display = 'none';
    return;
  }

  populateUserCategoriaFilter(brani);
  renderUserBraniList(brani);
}

function populateUserCategoriaFilter(brani) {
  if (!ui.userCategoriaFilter) {
    return;
  }
  const categorie = Array.from(new Set(brani.map((b) => b.categoria).filter(Boolean))).sort();

  if (categorie.length < 2) {
    ui.userCategoriaFilterGroup.style.display = 'none';
    return;
  }

  ui.userCategoriaFilter.innerHTML = '<option value="">Tutte le categorie</option>' +
    categorie.map((c) => `<option value="${c}">${c}</option>`).join('');
  ui.userCategoriaFilterGroup.style.display = 'block';
}

function handleCategoriaFilterChange() {
  const categoria = ui.userCategoriaFilter?.value || '';
  const tutti = getBrani();
  appState.currentBrani = categoria ? tutti.filter((b) => b.categoria === categoria) : tutti;
  appState.currentBranoIndex = -1;
  renderUserBraniList(appState.currentBrani);
}

function renderUserBraniList(brani) {
  if (!ui.userBraniList) {
    return;
  }

  if (brani.length === 0) {
    ui.userBraniList.innerHTML = '<p style="color: #666;"><i class="bi bi-music-note"></i> Nessun brano per questa categoria.</p>';
    return;
  }

  ui.userBraniList.innerHTML = brani.map((brano, index) => {
    const inizioBrano = parseInt(brano.inizio_brano || 0);
    const fineBrano = parseInt(brano.fine_brano || 0);

    let timeInfo = '';
    if (inizioBrano > 0 || fineBrano > 0) {
      const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
      if (inizioBrano > 0 && fineBrano > 0) {
        timeInfo = `<small style="color: #ff9800;"><i class="bi bi-clock"></i> ${fmt(inizioBrano)} - ${fmt(fineBrano)}</small>`;
      } else if (inizioBrano > 0) {
        timeInfo = `<small style="color: #ff9800;"><i class="bi bi-clock"></i> Inizio: ${fmt(inizioBrano)}</small>`;
      } else {
        timeInfo = `<small style="color: #ff9800;"><i class="bi bi-clock"></i> Fine: ${fmt(fineBrano)}</small>`;
      }
    }

    const nome = (brano.nome_video || '').replace(/'/g, "\\'");
    return `
      <div class="brano-item" data-index="${index}">
        <div class="brano-info" onclick="selectBrano('${brano.link_youtube}', '${nome}', ${index})">
          <i class="bi bi-music-note-beamed"></i>
          <div>
            <strong>${brano.nome_video}</strong>
            <small>${brano.categoria || 'Senza categoria'}</small>
            ${timeInfo}
          </div>
        </div>
        <div class="brano-actions">
          <button class="btn-play" onclick="selectBrano('${brano.link_youtube}', '${nome}', ${index})" title="Riproduci brano">
            <i class="bi bi-play-circle"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ==================== MODALITÀ DI ASCOLTO ====================

function handlePlayModeChange(event) {
  const value = event.target.value;
  appState.playMode = value;

  const persistentBox = document.getElementById('persistentInfoBox');

  if (value === 'timed' || value === 'persistent') {
    ui.timerControlsBox?.classList.add('active');
    ui.normalInfoBox?.classList.remove('active');
    if (persistentBox) {
      persistentBox.classList.toggle('active', value === 'persistent');
    }
  } else {
    ui.timerControlsBox?.classList.remove('active');
    ui.normalInfoBox?.classList.add('active');
    if (persistentBox) {
      persistentBox.classList.remove('active');
    }
  }

  if (appState.timerTimeoutId) {
    clearTimeout(appState.timerTimeoutId);
    appState.timerTimeoutId = null;
  }
  appState.isTimerPaused = false;
  appState.isPersistentTimerActive = false;
  ui.spaceIndicator?.classList.remove('active');

  updatePlayButton();
}

function updatePlayButton() {
  if (!ui.playActionIcon || !ui.playActionText || !ui.playActionDescription) {
    return;
  }

  const modoTesto = appState.advanceModeVideo === 'random'
    ? 'un brano casuale della lista'
    : 'il brano successivo della lista';

  switch (appState.playMode) {
    case 'timed':
      ui.playActionIcon.className = 'bi bi-clock-history';
      ui.playActionText.textContent = 'Play Brano Temporizzato';
      ui.playActionDescription.textContent = `Avvia ${modoTesto} con timer`;
      break;
    case 'persistent':
      ui.playActionIcon.className = 'bi bi-shield-lock';
      ui.playActionText.textContent = '🔒 Play Timer Persistente';
      ui.playActionDescription.textContent = 'Avvia con SPACE disabilitato durante il timer';
      break;
    default:
      ui.playActionIcon.className = appState.advanceModeVideo === 'random' ? 'bi bi-shuffle' : 'bi bi-play-circle';
      ui.playActionText.textContent = 'Play Brano';
      ui.playActionDescription.textContent = `Avvia ${modoTesto}`;
      break;
  }

  if (ui.advanceModeLabel) {
    ui.advanceModeLabel.textContent = appState.advanceModeVideo === 'random' ? 'brano casuale' : 'brano successivo';
  }
}

function handlePlayAction() {
  if (appState.playMode === 'persistent') {
    playPersistentTimerBrano();
  } else {
    playNextVideoByMode();
  }
}

// Avvia il prossimo brano secondo la scelta dell'educatore (successivo o casuale)
function playNextVideoByMode() {
  if (!appState.currentBrani || appState.currentBrani.length === 0) {
    alert('Nessun brano disponibile. Chiedi all\'educatore di aggiungerne dall\'Area Educatore.');
    return;
  }

  if (appState.advanceModeVideo === 'random') {
    selectRandomBrano();
  } else {
    playNextDirectBrano();
  }
}

function playNextDirectBrano() {
  if (!appState.currentBrani || appState.currentBrani.length === 0) {
    return;
  }

  if (appState.currentBranoIndex < 0 || appState.currentBranoIndex >= appState.currentBrani.length - 1) {
    appState.currentBranoIndex = 0;
  } else {
    appState.currentBranoIndex++;
  }

  const brano = appState.currentBrani[appState.currentBranoIndex];
  selectBrano(brano.link_youtube, brano.nome_video, appState.currentBranoIndex);
}

function selectRandomBrano() {
  if (!appState.currentBrani || appState.currentBrani.length === 0) {
    return;
  }

  let randomIndex = Math.floor(Math.random() * appState.currentBrani.length);

  // Evito di riproporre subito lo stesso brano appena ascoltato
  if (appState.currentBrani.length > 1 && randomIndex === appState.currentBranoIndex) {
    randomIndex = (randomIndex + 1 + Math.floor(Math.random() * (appState.currentBrani.length - 1))) % appState.currentBrani.length;
  }

  const brano = appState.currentBrani[randomIndex];

  ui.userOptionsMenu?.classList.remove('active');
  ui.userOptionsOverlay?.classList.remove('active');

  selectBrano(brano.link_youtube, brano.nome_video, randomIndex);
}

// ==================== PLAYER YOUTUBE ====================

function selectBrano(linkYoutube, nomeBrano, branoIndex = -1) {
  const videoId = extractVideoId(linkYoutube);
  if (!videoId) {
    alert('⚠️ Link YouTube non valido!');
    return;
  }
  if (!ui.userPlayerFrame) {
    return;
  }

  // Tempi di inizio/fine dal brano
  let inizioBrano = 0;
  let fineBrano = 0;
  if (branoIndex >= 0 && appState.currentBrani[branoIndex]) {
    inizioBrano = parseInt(appState.currentBrani[branoIndex].inizio_brano || 0);
    fineBrano = parseInt(appState.currentBrani[branoIndex].fine_brano || 0);
  }

  appState.lastSelectedBrano = { linkYoutube, nomeBrano, inizioBrano, fineBrano };
  appState.currentVideoId = videoId;
  appState.currentBranoIndex = branoIndex >= 0
    ? branoIndex
    : appState.currentBrani.findIndex((b) => b.link_youtube === linkYoutube);

  appState.isTimerPaused = false;
  appState.videoFinito = false;
  if (appState.timerTimeoutId) {
    clearTimeout(appState.timerTimeoutId);
  }
  ui.spaceIndicator?.classList.remove('active');

  if (ui.userCurrentSong) {
    ui.userCurrentSong.textContent = `▶️ ${nomeBrano}`;
    ui.userCurrentSong.style.color = '';
  }

  // Chiudo il menu opzioni se aperto
  ui.userOptionsMenu?.classList.remove('active');
  ui.userOptionsOverlay?.classList.remove('active');

  if (appState.youtubePlayer && typeof appState.youtubePlayer.loadVideoById === 'function') {
    try {
      appState.youtubePlayer.loadVideoById(videoId);
    } catch (error) {
      initYouTubePlayer(videoId);
    }
  } else {
    initYouTubePlayer(videoId);
  }

  if (appState.playMode === 'timed') {
    startPlayTimer();
  }
}

function initYouTubePlayer(videoId) {
  if (!ui.userPlayerFrame) {
    return;
  }

  if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
    // API non ancora caricata: riprovo per 5 secondi
    if (ui.userCurrentSong) {
      ui.userCurrentSong.textContent = '⏳ Caricamento player YouTube...';
    }
    let retry = 0;
    const interval = setInterval(() => {
      retry++;
      if (typeof YT !== 'undefined' && typeof YT.Player !== 'undefined') {
        clearInterval(interval);
        initYouTubePlayer(videoId);
      } else if (retry >= 10) {
        clearInterval(interval);
        alert('⚠️ Player YouTube non caricato. Verifica la connessione internet e ricarica la pagina.');
      }
    }, 500);
    return;
  }

  if (appState.youtubePlayer) {
    try { appState.youtubePlayer.destroy(); } catch (e) { /* ignora */ }
  }

  // disablekb: 1 → i tasti (frecce, spazio) NON comandano YouTube:
  // restano dedicati agli switch dell'app
  try {
    appState.youtubePlayer = new YT.Player('userPlayerFrame', {
      height: '100%',
      width: '100%',
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        modestbranding: 1,
        rel: 0,
        disablekb: 1,
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
      },
    });
  } catch (error) {
    alert('⚠️ Errore nella creazione del player YouTube. Ricarica la pagina.');
  }
}

function onPlayerReady(event) {
  if (appState.lastSelectedBrano && appState.lastSelectedBrano.inizioBrano > 0) {
    event.target.seekTo(appState.lastSelectedBrano.inizioBrano, true);
  }
  event.target.playVideo();

  if (appState.lastSelectedBrano && appState.lastSelectedBrano.fineBrano > 0) {
    startEndTimeMonitor();
  }
}

function onPlayerStateChange(event) {
  // Stati: -1 non iniziato, 0 finito, 1 play, 2 pausa, 3 buffering, 5 cued
  if (event.data === 0) {
    // Fine naturale: al prossimo switch parte un NUOVO brano
    appState.videoFinito = true;
  } else if (event.data === 1) {
    appState.videoFinito = false;
  }

  if (event.data === 1 && appState.lastSelectedBrano && appState.lastSelectedBrano.fineBrano > 0) {
    startEndTimeMonitor();
  } else if (event.data !== 1) {
    stopEndTimeMonitor();
  }
}

// Monitora il tempo e ferma il video al tempo di fine impostato
function startEndTimeMonitor() {
  stopEndTimeMonitor();

  if (!appState.youtubePlayer || !appState.lastSelectedBrano || appState.lastSelectedBrano.fineBrano <= 0) {
    return;
  }

  const fineSecondi = appState.lastSelectedBrano.fineBrano;

  appState.endTimeMonitorInterval = setInterval(() => {
    if (!appState.youtubePlayer || typeof appState.youtubePlayer.getCurrentTime !== 'function') {
      stopEndTimeMonitor();
      return;
    }

    const currentTime = appState.youtubePlayer.getCurrentTime();
    if (currentTime >= fineSecondi) {
      appState.youtubePlayer.pauseVideo();
      stopEndTimeMonitor();
      // Spezzone terminato: al prossimo switch parte un nuovo brano
      appState.videoFinito = true;
      ui.spaceIndicator?.classList.remove('active');
    }
  }, 250);
}

function stopEndTimeMonitor() {
  if (appState.endTimeMonitorInterval) {
    clearInterval(appState.endTimeMonitorInterval);
    appState.endTimeMonitorInterval = null;
  }
}

// ==================== TIMER TEMPORIZZATO E PERSISTENTE ====================

function startPlayTimer() {
  if (appState.timerTimeoutId) {
    clearTimeout(appState.timerTimeoutId);
  }

  appState.timerTimeoutId = setTimeout(() => {
    if (appState.youtubePlayer && typeof appState.youtubePlayer.pauseVideo === 'function') {
      appState.youtubePlayer.pauseVideo();
      appState.isTimerPaused = true;
      ui.spaceIndicator?.classList.add('active');
    }
  }, appState.timerDuration * 1000);
}

function resumePlayAfterPause() {
  if (!appState.isTimerPaused) {
    return;
  }
  if (appState.youtubePlayer && typeof appState.youtubePlayer.playVideo === 'function') {
    appState.youtubePlayer.playVideo();
    appState.isTimerPaused = false;
    ui.spaceIndicator?.classList.remove('active');
    startPlayTimer();
  }
}

function playPersistentTimerBrano() {
  if (!appState.currentBrani || appState.currentBrani.length === 0) {
    alert('Nessun brano disponibile. Chiedi all\'educatore di aggiungerne dall\'Area Educatore.');
    return;
  }

  ui.userOptionsMenu?.classList.remove('active');
  ui.userOptionsOverlay?.classList.remove('active');

  // Indice secondo la scelta dell'educatore
  let index;
  if (appState.advanceModeVideo === 'random') {
    index = Math.floor(Math.random() * appState.currentBrani.length);
    if (appState.currentBrani.length > 1 && index === appState.currentBranoIndex) {
      index = (index + 1 + Math.floor(Math.random() * (appState.currentBrani.length - 1))) % appState.currentBrani.length;
    }
  } else {
    index = (appState.currentBranoIndex < 0 || appState.currentBranoIndex >= appState.currentBrani.length - 1)
      ? 0
      : appState.currentBranoIndex + 1;
  }

  const brano = appState.currentBrani[index];
  selectBrano(brano.link_youtube, brano.nome_video, index);

  // 🔒 SPACE ibernato per la durata del timer
  appState.isPersistentTimerActive = true;

  if (ui.userCurrentSong) {
    ui.userCurrentSong.style.color = '#FF6F00';
    ui.userCurrentSong.innerHTML += ' <small>🔒 SWITCH DISABILITATO</small>';
  }

  if (appState.timerTimeoutId) {
    clearTimeout(appState.timerTimeoutId);
  }
  appState.timerTimeoutId = setTimeout(() => {
    appState.isPersistentTimerActive = false;
    if (appState.youtubePlayer && typeof appState.youtubePlayer.pauseVideo === 'function') {
      appState.youtubePlayer.pauseVideo();
    }
    if (ui.userCurrentSong) {
      ui.userCurrentSong.style.color = '';
      ui.userCurrentSong.textContent = ui.userCurrentSong.textContent.replace(' 🔒 SWITCH DISABILITATO', '');
    }
    updatePlayButton();
  }, appState.timerDuration * 1000);
}

// ==================== SWITCH 1 (SPAZIO / FRECCIA SINISTRA) ====================

function handleSpaceKeyDown(event) {
  if ((event.code === 'Space' || event.code === 'ArrowLeft') && appState.mode === 'user') {
    event.preventDefault();

    // Se l'audio dello switch 2 sta suonando, lo fermo; se la musica era in pausa
    // per lasciarlo suonare, riprende e non faccio altro
    if (window.interruptSwitch2Audio?.()) {
      appState.spaceKeyPressed = true;
      return;
    }

    // Timer persistente attivo: switch ibernato
    if (appState.isPersistentTimerActive) {
      return;
    }

    // Anti-ripetizione a tasto tenuto premuto
    if (appState.spaceKeyPressed) {
      return;
    }
    appState.spaceKeyPressed = true;

    if (appState.playMode === 'persistent') {
      playPersistentTimerBrano();
    } else if (appState.playMode === 'timed' && appState.isTimerPaused) {
      resumePlayAfterPause();
    } else {
      playNextVideoByMode();
    }
  }
}

function handleSpaceKeyUp(event) {
  if ((event.code === 'Space' || event.code === 'ArrowLeft') && appState.mode === 'user') {
    event.preventDefault();
    appState.spaceKeyPressed = false;
  }
}

// Tap/click sull'overlay del video: se il video è fermo lo avvia/riprende
// (user-gesture: supera il blocco autoplay dei browser); se suona = switch 1.
function activateSwitch1FromClick() {
  if (appState.mode !== 'user') {
    return;
  }

  const player = appState.youtubePlayer;
  if (player && !appState.videoFinito && typeof player.getPlayerState === 'function') {
    let stato;
    try {
      stato = player.getPlayerState();
    } catch (e) {
      stato = null;
    }

    const nonAvviato = (stato === -1 || stato === 5);
    const inPausaSemplice = (stato === 2 && !appState.isTimerPaused && !appState.isPersistentTimerActive);

    if (nonAvviato || inPausaSemplice) {
      try {
        player.playVideo();
      } catch (e) { /* ignora */ }
      return;
    }
  }

  handleSpaceKeyDown({ code: 'ArrowLeft', preventDefault: () => {} });
  appState.spaceKeyPressed = false;
}

// ==================== SCHERMO INTERO ====================

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function toggleVideoFullscreen(event) {
  if (event) {
    event.stopPropagation();
  }

  const wrapper = document.querySelector('.user-player-panel .iframe-wrapper')
               || document.querySelector('.iframe-wrapper');
  if (!wrapper) {
    return;
  }

  if (!getFullscreenElement()) {
    const req = wrapper.requestFullscreen || wrapper.webkitRequestFullscreen;
    if (req) {
      const p = req.call(wrapper);
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) {
      exit.call(document);
    }
  }
}

function updateFullscreenBtnIcon() {
  const icon = document.getElementById('fullscreenIcon');
  if (icon) {
    icon.className = getFullscreenElement() ? 'bi bi-fullscreen-exit' : 'bi bi-fullscreen';
  }
}

// ==================== AVVIO ====================

window.onYouTubeIframeAPIReady = function () {
  console.log('YouTube IFrame API pronta');
};

document.addEventListener('DOMContentLoaded', () => {
  console.log(`${APP_CONFIG.name} v${APP_CONFIG.version} - versione autonoma`);

  // Chiedo al browser di proteggere i dati da eliminazioni automatiche
  richiediStoragePersistente();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal('infoModal');
      closeModal('instructionsModal');
      const menu = document.getElementById('sideMenu');
      if (menu?.classList.contains('active')) {
        toggleMenu();
      }
    }
  });
});

// ==================== ESPORTAZIONE GLOBALE (per onclick HTML) ====================

window.startEducatorMode = startEducatorMode;
window.startUserMode = startUserMode;
window.switchToUserMode = switchToUserMode;
window.switchToEducatorMode = switchToEducatorMode;
window.selectBrano = selectBrano;
window.deleteEducatorBrano = deleteEducatorBrano;
window.salvaPreferenzaEducatore = salvaPreferenzaEducatore;
window.toggleMenu = toggleMenu;
window.toggleUserOptions = toggleUserOptions;
window.showInfo = showInfo;
window.showInstructions = showInstructions;
window.closeModal = closeModal;
window.resetApp = resetApp;
window.installPWA = installPWA;
window.aggiornaApp = aggiornaApp;
window.handlePlayAction = handlePlayAction;
window.playNextVideoByMode = playNextVideoByMode;
window.activateSwitch1FromClick = activateSwitch1FromClick;
window.toggleVideoFullscreen = toggleVideoFullscreen;
