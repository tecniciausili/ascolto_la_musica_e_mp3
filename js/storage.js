// ==================== STRATO DATI LOCALE ====================
// Sostituisce le API PHP + MySQL della versione portale.
// Modello: UN DISPOSITIVO = UN UTENTE. Nessun server, nessun login.
//
//  - Brani YouTube e preferenze → localStorage (JSON, dati piccoli)
//  - Audio MP3 (blob binari)    → IndexedDB (localStorage non regge i binari)
//
// I nomi dei campi ricalcano quelli della versione precedente
// (nome_video, link_youtube, ...) per mantenere il codice riusato invariato.

const STORAGE_KEYS = {
  brani: 'alm_brani',
  prefs: 'alm_prefs',
};

const AUDIO_DB_NAME = 'ascolto_la_musica_e_mp3';
const AUDIO_DB_VERSION = 1;
const AUDIO_STORE = 'audio';

// ==================== STORAGE PERSISTENTE ====================

// Chiede al browser di NON eliminare mai automaticamente i dati di questa app
// (registrazioni MP3 comprese). Con la PWA installata è quasi sempre accordato.
async function richiediStoragePersistente() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const giaPersistente = await navigator.storage.persisted();
      if (giaPersistente) {
        console.log('💾 Storage già persistente');
        return true;
      }
      const accordato = await navigator.storage.persist();
      console.log(accordato
        ? '💾 Storage persistente ACCORDATO: i dati non verranno eliminati automaticamente'
        : '⚠️ Storage persistente non accordato (installare la PWA aumenta le probabilità)');
      return accordato;
    }
  } catch (e) {
    console.warn('⚠️ Richiesta storage persistente fallita:', e);
  }
  return false;
}

// ==================== BRANI YOUTUBE (localStorage) ====================

function getBrani() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.brani) || '[]');
  } catch (e) {
    console.error('Errore lettura brani:', e);
    return [];
  }
}

function salvaBrani(brani) {
  localStorage.setItem(STORAGE_KEYS.brani, JSON.stringify(brani));
}

// Aggiunge un brano e restituisce il suo id. Rifiuta i duplicati per link.
function aggiungiBrano(brano) {
  const brani = getBrani();

  if (brani.some((b) => b.link_youtube === brano.link_youtube)) {
    throw new Error('Questo brano è già presente nella lista.');
  }

  const nuovoId = brani.reduce((max, b) => Math.max(max, b.id || 0), 0) + 1;
  const record = {
    id: nuovoId,
    nome_video: brano.nome_video,
    categoria: brano.categoria || '',
    link_youtube: brano.link_youtube,
    inizio_brano: parseInt(brano.inizio_brano) || 0,
    fine_brano: parseInt(brano.fine_brano) || 0,
    data_creazione: new Date().toLocaleString('it-IT'),
  };

  brani.push(record);
  salvaBrani(brani);
  return record;
}

function eliminaBrano(id) {
  const brani = getBrani().filter((b) => b.id !== id);
  salvaBrani(brani);
}

// Categorie distinte dai brani archiviati (per datalist e filtro)
function getCategorie() {
  const set = new Set(getBrani().map((b) => b.categoria).filter(Boolean));
  return Array.from(set).sort();
}

// ==================== PREFERENZE (localStorage) ====================
// modalita_video / modalita_audio: 'successivo' | 'random'

function getPreferenze() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEYS.prefs) || '{}');
    return {
      modalita_video: p.modalita_video === 'random' ? 'random' : 'successivo',
      modalita_audio: p.modalita_audio === 'random' ? 'random' : 'successivo',
    };
  } catch (e) {
    return { modalita_video: 'successivo', modalita_audio: 'successivo' };
  }
}

function salvaPreferenze(prefs) {
  const attuali = getPreferenze();
  const nuove = {
    modalita_video: prefs.modalita_video || attuali.modalita_video,
    modalita_audio: prefs.modalita_audio || attuali.modalita_audio,
  };
  localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(nuove));
  return nuove;
}

// ==================== AUDIO MP3 (IndexedDB) ====================

let __audioDB = null;

function apriAudioDB() {
  if (__audioDB) {
    return Promise.resolve(__audioDB);
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUDIO_DB_NAME, AUDIO_DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = (event) => {
      __audioDB = event.target.result;
      resolve(__audioDB);
    };

    req.onerror = () => reject(new Error('Impossibile aprire il database audio locale.'));
  });
}

// Salva un audio {nome_audio, origine, durata_secondi, blob}. Restituisce il record con id.
async function audioAggiungi(audio) {
  const db = await apriAudioDB();
  const record = {
    nome_audio: audio.nome_audio,
    origine: audio.origine === 'registrazione' ? 'registrazione' : 'upload',
    durata_secondi: audio.durata_secondi || null,
    attivo: 1, // Ogni nuovo audio entra nella rotazione
    data_creazione: new Date().toLocaleString('it-IT'),
    blob: audio.blob,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    const req = tx.objectStore(AUDIO_STORE).add(record);
    req.onsuccess = () => {
      record.id = req.result;
      resolve(record);
    };
    tx.onerror = () => reject(new Error('Errore nel salvataggio dell\'audio.'));
  });
}

// Restituisce tutti gli audio (blob compresi: volumi piccoli)
async function audioLista() {
  const db = await apriAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readonly');
    const req = tx.objectStore(AUDIO_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(new Error('Errore nella lettura degli audio.'));
  });
}

async function audioElimina(id) {
  const db = await apriAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    tx.objectStore(AUDIO_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('Errore nell\'eliminazione dell\'audio.'));
  });
}

// Include/esclude un audio dalla rotazione dello switch 2
async function audioImpostaAttivo(id, attivo) {
  const db = await apriAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    const store = tx.objectStore(AUDIO_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const record = req.result;
      if (!record) {
        reject(new Error('Audio non trovato.'));
        return;
      }
      record.attivo = attivo ? 1 : 0;
      store.put(record);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('Errore nell\'aggiornamento dell\'audio.'));
  });
}

// Stima dello spazio occupato (per il box informazioni)
async function storageInfo() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      return { usati: est.usage || 0, disponibili: est.quota || 0 };
    }
  } catch (e) { /* non supportato */ }
  return null;
}
