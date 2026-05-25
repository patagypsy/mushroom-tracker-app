// db.js — Local database layer replacing Apps Script API
// Uses Dexie.js (IndexedDB wrapper)

const _db = new Dexie('MushroomTracker');
_db.version(1).stores({
  batches:  '++id, batchId, odlare, pilzsorte, skapad_den',
  harvests: '++id, harvestId, batchId, datum'
});

const db = {

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

  async setFkDatum(batchId, fkDatum) {
    const batch = await _db.batches.where('batchId').equals(batchId).first();
    if (!batch) return false;
    await _db.batches.update(batch.id, { fk_datum: fkDatum });
    const code = localStorage.getItem('odlare') || '';
    await firebaseSync.updateBatch(code, batchId, { fk_datum: fkDatum });
    return true;
  },

  async getBatchInfo(batchId) {
    const batch = await _db.batches.where('batchId').equals(batchId).first();
    if (!batch) return null;
    return {
      batchId:          batch.batchId,
      pilzsorte:        batch.pilzsorte,
      substrat_kg:      batch.substrat_kg,
      antal_bags:       batch.antal_bags,
      inkubation_start: batch.inkubation_start,
      fk_datum:         batch.fk_datum,
      kunde:            batch.kunde,
      odlare:           batch.odlare
    };
  },

  async getGrowerStats(odlare) {
    const myBatches = await _db.batches.where('odlare').equals(odlare).toArray();
    const allHarvests = await _db.harvests.toArray();

    const harvestMap = {};
    allHarvests.forEach(function(h) {
      if (!harvestMap[h.batchId]) harvestMap[h.batchId] = { count: 0, weight: 0 };
      harvestMap[h.batchId].count  += 1;
      harvestMap[h.batchId].weight += h.vikt_g || 0;
    });

    const batches = myBatches.reverse().map(function(b) {
      const h = harvestMap[b.batchId] || { count: 0, weight: 0 };
      return { batchId: b.batchId, pilzsorte: b.pilzsorte, totalWeight: h.weight, harvests: h.count };
    });

    return {
      totalBatches:  batches.length,
      totalHarvests: batches.reduce(function(s, b) { return s + b.harvests; }, 0),
      totalWeight:   batches.reduce(function(s, b) { return s + b.totalWeight; }, 0),
      batches:       batches
    };
  },

  async getSortStats(odlare, pilzsorte) {
    const myBatches = await _db.batches.where('odlare').equals(odlare).toArray();
    const filtered  = myBatches.filter(function(b) { return b.pilzsorte === pilzsorte; });
    const allHarvests = await _db.harvests.toArray();

    const harvestMap = {};
    allHarvests.forEach(function(h) {
      if (!harvestMap[h.batchId]) harvestMap[h.batchId] = { count: 0, weight: 0 };
      harvestMap[h.batchId].count  += 1;
      harvestMap[h.batchId].weight += h.vikt_g || 0;
    });

    let totalInkubDays = 0, inkubCount = 0;
    const batches = filtered.reverse().map(function(b) {
      const h = harvestMap[b.batchId] || { count: 0, weight: 0 };
      const substratKg = b.substrat_kg || 1;
      let inkub_days = null;
      if (b.inkubation_start && b.fk_datum) {
        const diff = new Date(b.fk_datum) - new Date(b.inkubation_start);
        inkub_days = Math.round(diff / (1000 * 60 * 60 * 24));
        if (inkub_days > 0) { totalInkubDays += inkub_days; inkubCount++; }
      }
      return {
        batchId: b.batchId, substrat_kg: substratKg, antal_bags: b.antal_bags,
        inkubation_start: b.inkubation_start || '', fk_datum: b.fk_datum || '',
        inkub_days: inkub_days, totalWeight: h.weight, harvests: h.count,
        yieldPerKg: Math.round(h.weight / substratKg)
      };
    });

    const totalWeight   = batches.reduce(function(s, b) { return s + b.totalWeight; }, 0);
    const totalSubstrat = batches.reduce(function(s, b) { return s + b.substrat_kg;  }, 0);

    return {
      pilzsorte,
      totalBatches:   batches.length,
      totalWeight,
      avgInkubDays:   inkubCount > 0 ? Math.round(totalInkubDays / inkubCount) : null,
      avgYieldPerKg:  totalSubstrat > 0 ? Math.round(totalWeight / totalSubstrat) : 0,
      batches
    };
  },

  async exportJSON() {
    const batches  = await _db.batches.toArray();
    const harvests = await _db.harvests.toArray();
    return JSON.stringify({ batches, harvests }, null, 2);
  },

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

  async importJSON(json) {
    let data;
    try {
      data = JSON.parse(json);
    } catch (err) {
      throw new Error('Ogiltig JSON-fil: ' + err.message);
    }

    const existingBatchIds   = new Set((await _db.batches.toArray()).map(function(b) { return b.batchId; }));
    const existingHarvestIds = new Set((await _db.harvests.toArray()).map(function(h) { return h.harvestId; }));

    const newBatches = (data.batches || [])
      .filter(function(b) { return !existingBatchIds.has(b.batchId); })
      .map(function(b) { const r = Object.assign({}, b); delete r.id; return r; });

    const newHarvests = (data.harvests || [])
      .filter(function(h) { return !existingHarvestIds.has(h.harvestId); })
      .map(function(h) { const r = Object.assign({}, h); delete r.id; return r; });

    await _db.batches.bulkAdd(newBatches);
    await _db.harvests.bulkAdd(newHarvests);

    return { addedBatches: newBatches.length, addedHarvests: newHarvests.length };
  }
};
