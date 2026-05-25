# Mushroom Tracker Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Firebase Firestore cloud sync so multiple growers can access their own data across devices.

**Architecture:** IndexedDB stays the primary store (offline-first). A new `firebase.js` wraps the Firestore SDK and exposes push/pull functions as a global `firebaseSync`. `db.js` calls `firebaseSync` after each write. `index.html` calls `syncFromFirestore` on startup to pull remote data into local IndexedDB.

**Tech Stack:** Firebase v9 Compat SDK (CDN, global `firebase` object), Firestore, Dexie.js (existing), plain HTML/JS (no bundler)

---

### Task 1: Firebase Project Setup (manual, one-time)

**Files:** None — done in Firebase Console (console.firebase.google.com)

- [ ] **Step 1: Create Firebase project**

  Go to https://console.firebase.google.com → "Add project" → Name: `mushroom-tracker` → Disable Google Analytics → Create project.

- [ ] **Step 2: Enable Firestore**

  Left sidebar → Build → Firestore Database → "Create database" → Select **Production mode** → Region: `eur3 (europe-west)` → Done.

- [ ] **Step 3: Set Security Rules**

  Firestore → Rules tab → Replace all content with:

  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /growers/{code}/{document=**} {
        allow read, write: if code != '';
      }
    }
  }
  ```

  Click **Publish**.

- [ ] **Step 4: Get Firebase config object**

  Project Settings (gear icon top-left) → General → scroll to "Your apps" → click **Add app** → Web (`</>`) → App nickname: `mushroom-tracker-web` → Register app.

  Copy the `firebaseConfig` object shown. It looks like:

  ```javascript
  const firebaseConfig = {
    apiKey: "AIzaSy...",
    authDomain: "mushroom-tracker-xxxxx.firebaseapp.com",
    projectId: "mushroom-tracker-xxxxx",
    storageBucket: "mushroom-tracker-xxxxx.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
  };
  ```

  Keep this — you paste it into Task 2.

- [ ] **Step 5: Verify**

  Firebase Console → Firestore → Data tab. Empty database, no collections. That's correct.

---

### Task 2: Create www/firebase.js

**Files:**
- Create: `www/firebase.js`

- [ ] **Step 1: Create the file**

  Create `www/firebase.js` with the content below. Replace the six `"REPLACE"` strings with the values from your config in Task 1 Step 4:

  ```javascript
  // firebase.js — Firestore sync layer
  // Must be loaded AFTER Firebase SDK CDN scripts and BEFORE db.js.
  // Exposes global `firebaseSync` used by db.js.

  firebase.initializeApp({
    apiKey:            "REPLACE",
    authDomain:        "REPLACE",
    projectId:         "REPLACE",
    storageBucket:     "REPLACE",
    messagingSenderId: "REPLACE",
    appId:             "REPLACE"
  });

  const _fs = firebase.firestore();

  const firebaseSync = {

    // Pull all batches + harvests for a grower code from Firestore
    // and merge missing ones into local IndexedDB.
    async syncFromFirestore(code) {
      if (!code) return;
      try {
        const [bSnap, hSnap] = await Promise.all([
          _fs.collection('growers').doc(code).collection('batches').get(),
          _fs.collection('growers').doc(code).collection('harvests').get()
        ]);
        const batches  = bSnap.docs.map(function(d) { return d.data(); });
        const harvests = hSnap.docs.map(function(d) { return d.data(); });
        if (batches.length || harvests.length) {
          await db.importJSON(JSON.stringify({ batches: batches, harvests: harvests }));
        }
      } catch (e) {
        console.warn('Firestore syncFromFirestore failed:', e);
      }
    },

    // Write a full batch document to Firestore.
    async pushBatch(code, batchId, data) {
      if (!code) return;
      try {
        await _fs.collection('growers').doc(code).collection('batches').doc(batchId).set(data);
      } catch (e) {
        console.warn('Firestore pushBatch failed:', e);
      }
    },

    // Write a full harvest document to Firestore.
    async pushHarvest(code, harvestId, data) {
      if (!code) return;
      try {
        await _fs.collection('growers').doc(code).collection('harvests').doc(harvestId).set(data);
      } catch (e) {
        console.warn('Firestore pushHarvest failed:', e);
      }
    },

    // Merge specific fields into an existing batch document.
    async updateBatch(code, batchId, fields) {
      if (!code) return;
      try {
        await _fs.collection('growers').doc(code).collection('batches').doc(batchId).set(fields, { merge: true });
      } catch (e) {
        console.warn('Firestore updateBatch failed:', e);
      }
    },

    // Delete a batch document and all its harvest documents in one atomic batch write.
    async deleteBatchFromFirestore(code, batchId, harvestIds) {
      if (!code) return;
      try {
        const writeBatch = _fs.batch();
        writeBatch.delete(_fs.collection('growers').doc(code).collection('batches').doc(batchId));
        harvestIds.forEach(function(hId) {
          writeBatch.delete(_fs.collection('growers').doc(code).collection('harvests').doc(hId));
        });
        await writeBatch.commit();
      } catch (e) {
        console.warn('Firestore deleteBatchFromFirestore failed:', e);
      }
    }

  };
  ```

- [ ] **Step 2: Verify the file exists**

  Run: `ls www/firebase.js`
  Expected: `www/firebase.js` listed.

---

### Task 3: Modify www/db.js — wrap write operations

**Files:**
- Modify: `www/db.js`

Each write operation gets a Firestore push **after** the local IndexedDB write. All Firestore calls are already wrapped in try/catch inside `firebaseSync` — they cannot crash local operations.

- [ ] **Step 1: Replace createBatch()**

  Find and replace the entire `createBatch` function (currently lines 12–34):

  **Old:**
  ```javascript
  async createBatch(data) {
    const year = new Date().getFullYear();
    const last = await _db.batches.orderBy('id').last();
    let nextNum = 0;
    if (last) {
      const parts = last.batchId.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    const batchId = 'B-' + year + '-' + String(nextNum).padStart(3, '0');
    await _db.batches.add({
      batchId,
      pilzsorte:        data.pilzsorte,
      substrat_kg:      Number(data.substrat_kg),
      antal_bags:       Number(data.antal_bags),
      inkubation_start: data.inkubation_start,
      fk_datum:         data.fk_datum || '',
      kunde:            data.kunde || '',
      odlare:           data.odlare || '',
      skapad_den:       new Date().toISOString()
    });
    return batchId;
  },
  ```

  **New:**
  ```javascript
  async createBatch(data) {
    const year = new Date().getFullYear();
    const last = await _db.batches.orderBy('id').last();
    let nextNum = 0;
    if (last) {
      const parts = last.batchId.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    const batchId = 'B-' + year + '-' + String(nextNum).padStart(3, '0');
    const batchData = {
      batchId,
      pilzsorte:        data.pilzsorte,
      substrat_kg:      Number(data.substrat_kg),
      antal_bags:       Number(data.antal_bags),
      inkubation_start: data.inkubation_start,
      fk_datum:         data.fk_datum || '',
      kunde:            data.kunde || '',
      odlare:           data.odlare || '',
      skapad_den:       new Date().toISOString()
    };
    await _db.batches.add(batchData);
    const code = localStorage.getItem('odlare') || '';
    await firebaseSync.pushBatch(code, batchId, batchData);
    return batchId;
  },
  ```

- [ ] **Step 2: Replace logHarvest()**

  Find and replace the entire `logHarvest` function (currently lines 36–54):

  **Old:**
  ```javascript
  async logHarvest(data) {
    const last = await _db.harvests.orderBy('id').last();
    let nextNum = 0;
    if (last) {
      const parts = last.harvestId.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    const harvestId = 'H-' + String(nextNum).padStart(3, '0');
    await _db.harvests.add({
      harvestId,
      batchId:        data.batchId,
      datum:          data.datum,
      vikt_g:         Number(data.vikt_g),
      anteckningar:   data.anteckningar || '',
      registrerad_den: new Date().toISOString()
    });
    return { success: true, harvestId };
  },
  ```

  **New:**
  ```javascript
  async logHarvest(data) {
    const last = await _db.harvests.orderBy('id').last();
    let nextNum = 0;
    if (last) {
      const parts = last.harvestId.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    const harvestId = 'H-' + String(nextNum).padStart(3, '0');
    const harvestData = {
      harvestId,
      batchId:         data.batchId,
      datum:           data.datum,
      vikt_g:          Number(data.vikt_g),
      anteckningar:    data.anteckningar || '',
      registrerad_den: new Date().toISOString()
    };
    await _db.harvests.add(harvestData);
    const code = localStorage.getItem('odlare') || '';
    await firebaseSync.pushHarvest(code, harvestId, harvestData);
    return { success: true, harvestId };
  },
  ```

- [ ] **Step 3: Replace setFkDatum()**

  Find and replace the entire `setFkDatum` function (currently lines 56–61):

  **Old:**
  ```javascript
  async setFkDatum(batchId, fkDatum) {
    const batch = await _db.batches.where('batchId').equals(batchId).first();
    if (!batch) return false;
    await _db.batches.update(batch.id, { fk_datum: fkDatum });
    return true;
  },
  ```

  **New:**
  ```javascript
  async setFkDatum(batchId, fkDatum) {
    const batch = await _db.batches.where('batchId').equals(batchId).first();
    if (!batch) return false;
    await _db.batches.update(batch.id, { fk_datum: fkDatum });
    const code = localStorage.getItem('odlare') || '';
    await firebaseSync.updateBatch(code, batchId, { fk_datum: fkDatum });
    return true;
  },
  ```

- [ ] **Step 4: Replace deleteBatch()**

  Find and replace the entire `deleteBatch` function (currently lines 151–157). Note: the new version collects harvest IDs **before** deleting locally, so we know what to delete in Firestore.

  **Old:**
  ```javascript
  async deleteBatch(batchId) {
    const batch = await _db.batches.where('batchId').equals(batchId).first();
    if (!batch) return false;
    await _db.harvests.where('batchId').equals(batchId).delete();
    await _db.batches.delete(batch.id);
    return true;
  },
  ```

  **New:**
  ```javascript
  async deleteBatch(batchId) {
    const batch = await _db.batches.where('batchId').equals(batchId).first();
    if (!batch) return false;
    const harvests = await _db.harvests.where('batchId').equals(batchId).toArray();
    const harvestIds = harvests.map(function(h) { return h.harvestId; });
    await _db.harvests.where('batchId').equals(batchId).delete();
    await _db.batches.delete(batch.id);
    const code = localStorage.getItem('odlare') || '';
    await firebaseSync.deleteBatchFromFirestore(code, batchId, harvestIds);
    return true;
  },
  ```

- [ ] **Step 5: Commit**

  ```bash
  cd /path/to/mushroom-tracker-app
  git add www/firebase.js www/db.js
  git commit -m "feat: add Firebase sync layer and wrap db.js write operations"
  ```

---

### Task 4: Add Firebase scripts to all HTML pages + update Service Worker

**Files:**
- Modify: `www/index.html`
- Modify: `www/new-batch.html`
- Modify: `www/harvest.html`
- Modify: `www/stats.html`
- Modify: `www/label.html`
- Modify: `www/sw.js`

The Firebase SDK and `firebase.js` must be loaded **before** `dexie.min.js` and `db.js` on every page. `firebase.js` uses `firebase` (from CDN) and is used by `db.js` — so order matters:

```
firebase-app-compat.js  (CDN)
firebase-firestore-compat.js  (CDN)
firebase.js  (local, uses firebase global, exposes firebaseSync global)
dexie.min.js  (local)
db.js  (local, uses firebaseSync global)
```

- [ ] **Step 1: Update index.html**

  `index.html` currently does NOT load dexie.min.js or db.js. Add all scripts + trigger sync.

  Find this block near the bottom of `<body>`:
  ```html
  <script>
    const grower = localStorage.getItem('odlare');
  ```

  Insert these five script tags immediately before it:
  ```html
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
  <script src="firebase.js"></script>
  <script src="dexie.min.js"></script>
  <script src="db.js"></script>
  ```

  Then in the existing inline script, find the `else` branch:
  ```javascript
  } else {
    document.getElementById('grower-name').textContent = grower;
  }
  ```

  Replace it with:
  ```javascript
  } else {
    document.getElementById('grower-name').textContent = grower;
    firebaseSync.syncFromFirestore(grower);
  }
  ```

- [ ] **Step 2: Update new-batch.html**

  Find:
  ```html
  <script src="dexie.min.js"></script>
  ```

  Replace with:
  ```html
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
  <script src="firebase.js"></script>
  <script src="dexie.min.js"></script>
  ```

- [ ] **Step 3: Update harvest.html**

  Same change as Step 2 — find `<script src="dexie.min.js"></script>` and insert the three Firebase script tags before it.

- [ ] **Step 4: Update stats.html**

  Same change as Step 2.

- [ ] **Step 5: Update label.html**

  Same change as Step 2.

- [ ] **Step 6: Update sw.js — add firebase.js to cache and bump version**

  The Service Worker must cache `firebase.js` locally. CDN scripts (gstatic.com) are NOT added — they'll be fetched from the network and fall through to `fetch(e.request)` as normal.

  **Old:**
  ```javascript
  const CACHE = 'mushroom-tracker-v1';
  const ASSETS = [
    'index.html',
    'new-batch.html',
    'harvest.html',
    'stats.html',
    'label.html',
    'db.js',
    'dexie.min.js',
    'manifest.json'
  ];
  ```

  **New:**
  ```javascript
  const CACHE = 'mushroom-tracker-v2';
  const ASSETS = [
    'index.html',
    'new-batch.html',
    'harvest.html',
    'stats.html',
    'label.html',
    'db.js',
    'firebase.js',
    'dexie.min.js',
    'manifest.json'
  ];
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add www/index.html www/new-batch.html www/harvest.html www/stats.html www/label.html www/sw.js
  git commit -m "feat: add Firebase SDK scripts to all pages, trigger sync on index load"
  ```

- [ ] **Step 8: Push to GitHub**

  ```bash
  git push
  ```

  Wait ~60 seconds for GitHub Actions to deploy to GitHub Pages.

---

### Task 5: End-to-End Verification

**Files:** None

- [ ] **Step 1: Open Browser A (incognito)**

  Open the GitHub Pages URL in an incognito window. When prompted: enter grower name `TestA`.

  Open DevTools Console. You should see no errors. If you see `Firestore sync failed`, check that your Firebase config in `firebase.js` is correct and Firestore is enabled.

- [ ] **Step 2: Create a batch in Browser A**

  Click "Ny batch". Fill in: Svampsort=`Ostronsvamp`, Substrat=`2`, Antal bags=`4`, Inkubation=today. Click "Skapa batch".

  Expected: Success screen showing a batch ID like `B-2026-000`.

- [ ] **Step 3: Verify batch in Firestore Console**

  Firebase Console → Firestore Database → Data. You should see:

  ```
  growers/
    TestA/
      batches/
        B-2026-000  →  { batchId: "B-2026-000", pilzsorte: "Ostronsvamp", odlare: "TestA", ... }
  ```

- [ ] **Step 4: Open Browser B (normal window or different browser)**

  Open the same GitHub Pages URL. Enter grower name `TestA` (exact same string).

  Wait 2 seconds for the sync to complete.

- [ ] **Step 5: Verify batch synced to Browser B**

  Navigate to Dashboard (stats). `B-2026-000` should appear in "Alla batchar".

  If it doesn't appear: hard-reload the page (Cmd+Shift+R / Ctrl+Shift+R) to bypass Service Worker cache, then check again.

- [ ] **Step 6: Log a harvest in Browser B**

  Click "+ Registrera skörd" on `B-2026-000`. Enter Vikt=`350g`, datum=today. Save.

  Expected: Success screen with a harvest ID like `H-000`.

- [ ] **Step 7: Verify harvest in Firestore Console**

  Firebase Console → `growers/TestA/harvests/`. You should see:

  ```
  H-000  →  { harvestId: "H-000", batchId: "B-2026-000", vikt_g: 350, ... }
  ```

- [ ] **Step 8: Verify harvest synced to Browser A**

  Reload index.html in Browser A. Navigate to Dashboard.

  Expected: `B-2026-000` shows `1 skörd(ar)` and total weight `350 g`.

- [ ] **Step 9: Test offline behaviour**

  In Browser A: disable network (DevTools → Network tab → "Offline"). Create another batch.

  Expected: Batch is created and visible locally. No crash or error modal (only a console warning `Firestore pushBatch failed`).

  Re-enable network. Reload. The offline batch will NOT appear in Firestore (by design — offline pushes are not queued). This is acceptable per the spec.
