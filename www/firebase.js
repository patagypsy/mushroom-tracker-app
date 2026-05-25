// firebase.js — Firestore sync layer
// Must be loaded AFTER Firebase SDK CDN scripts and BEFORE db.js.
// Exposes global `firebaseSync` used by db.js.

firebase.initializeApp({
  apiKey:            "AIzaSyAF2m2VUKL-zJ04CBThtADpZJV6k2_ZQCA",
  authDomain:        "mushroom-tracker-8ae8b.firebaseapp.com",
  projectId:         "mushroom-tracker-8ae8b",
  storageBucket:     "mushroom-tracker-8ae8b.firebasestorage.app",
  messagingSenderId: "6213650388",
  appId:             "1:6213650388:web:00b7da4cd793b04ff7b841"
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
