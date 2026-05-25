# Mushroom Tracker Cloud Sync Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Firebase Firestore cloud sync to the Mushroom Tracker PWA so multiple growers can access their data across devices.

**Architecture:** IndexedDB remains the primary local data store (app works offline). Firebase Firestore is a sync layer on top. On app start, data is pulled from Firestore and merged into IndexedDB. Every write operation pushes to both local and Firestore.

**Tech Stack:** Firebase JS SDK v10 (CDN, modular), Firestore, existing Dexie.js + IndexedDB

---

## Data Structure

Firestore collection hierarchy:

```
growers/
  {growerCode}/
    batches/
      {batchId}   → full batch document
    harvests/
      {harvestId} → full harvest document
```

- `growerCode` is the document path key (plain string from localStorage `odlare`). No password hashing, no auth — obscurity only. Acceptable for personal/small-group use.
- `batchId` and `harvestId` are the Firestore document IDs, identical to local IndexedDB IDs.
- Merge algorithm: if ID already exists locally → skip. If missing → insert. No conflict resolution needed (append-only data model).

## Sync Flow

### On app start (`index.html`)

1. Load grower code from localStorage
2. Call `syncFromFirestore(code)` in background (non-blocking)
3. Page renders from local IndexedDB immediately
4. Missing records are written to IndexedDB as Firestore responds

### On every write (`db.js` wraps existing functions)

| Operation | Local (existing) | Firestore (new) |
|---|---|---|
| `createBatch()` | `_db.batches.add(...)` | `setDoc(growers/{code}/batches/{batchId}, data)` |
| `logHarvest()` | `_db.harvests.add(...)` | `setDoc(growers/{code}/harvests/{harvestId}, data)` |
| `setFkDatum()` | `_db.batches.update(...)` | `setDoc(..., data, { merge: true })` |
| `deleteBatch()` | delete batch + harvests | `deleteDoc` batch + all its harvests |

### Offline behavior

Firestore operations fail silently if offline. Local IndexedDB writes succeed. On next app start with connectivity, sync pulls any data added on other devices.

## New File: `www/firebase.js`

Responsibilities:
- Initialize Firebase app with config object (API key is public, not a secret)
- `syncFromFirestore(code)` — fetch all batches and harvests for `code`, insert missing ones into IndexedDB via `db.importJSON()`
- `pushBatch(code, batchId, data)` — `setDoc` for a batch
- `pushHarvest(code, harvestId, data)` — `setDoc` for a harvest
- `updateBatch(code, batchId, fields)` — `setDoc` with `merge: true`
- `deleteBatchFromFirestore(code, batchId)` — delete batch doc + all harvest docs under that batchId

## Changes to Existing Files

### `www/db.js`
- After each local write, call the corresponding `firebase.js` function
- Wrap in try/catch — Firestore errors must not break local operations
- `syncFromFirestore` is called externally (from `index.html`), not inside `db.js`

### `www/index.html`
- Add Firebase SDK `<script type="module">` tags (CDN)
- Call `syncFromFirestore(growerCode)` after grower name is resolved
- Show subtle loading indicator while sync runs (optional)

### `www/new-batch.html`, `www/harvest.html`
- No structural changes — `db.js` handles the Firestore push transparently

## Firebase Project Setup (one-time)

1. Create free Spark project at console.firebase.google.com
2. Enable Firestore in Production mode
3. Security Rules — allow read/write if grower code path segment is non-empty:
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
4. Copy the Firebase config object (apiKey, projectId, etc.) into `firebase.js`
5. No secrets — the config object is safe to commit

## Out of Scope

- Real authentication (email/password, OAuth)
- Conflict resolution for concurrent edits on two devices
- Real-time listeners (Firestore `onSnapshot`) — sync on open is sufficient
- Data deletion when a grower changes their code
