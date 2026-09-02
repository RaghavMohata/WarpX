/* WarpX ↔ Firestore. Loaded as a <script type="module">, so it runs in
   its own scope — everything else on the page is a classic script, so
   the functions below are attached to window.WarpXDB for them to call.

   Data model:
   - users/{phone}            { name, phone, createdAt, location?, locationUpdatedAt? }
   - orders/{autoId}          { orderNumber, userId (=phone), items[], subtotal,
                                 deliveryFee, total, etaMin, status, createdAt }
*/
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, query, where, getDocs, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Create or fetch a user by phone number (demo auth — no real OTP check;
// phone doubles as the document id since it's already unique per user).
async function upsertUser(name, phone) {
  const ref = doc(db, "users", phone);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    if (name && name !== data.name) await updateDoc(ref, { name });
    return { id: phone, phone, name: name || data.name };
  }
  await setDoc(ref, { name: name || null, phone, createdAt: serverTimestamp() });
  return { id: phone, phone, name: name || null };
}

// Persist a captured location. The zone/ETA are computed client-side by
// classifyZone() in js/location.js before this is called — this just stores
// whatever it's given.
async function saveUserLocation(userId, loc) {
  await updateDoc(doc(db, "users", userId), {
    location: {
      lat: loc.lat,
      lng: loc.lng,
      method: loc.method || null,
      accuracy: loc.accuracy ?? null,
      address: loc.address || null,
      zone: loc.zone,
      distanceKm: loc.distanceKm,
      etaMin: loc.etaMin,
    },
    locationUpdatedAt: serverTimestamp(),
  });
}

async function getUserLocation(userId) {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? snap.data().location || null : null;
}

// Place an order (Cash on Delivery) — computes totals and stores the items
// inline on the order document (no separate line-items collection needed).
async function placeOrder(userId, items) {
  const subtotal = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (it.qty || 1), 0);
  const deliveryFee = 20;
  const total = subtotal + deliveryFee;

  let etaMin = "20-30";
  if (userId) {
    const loc = await getUserLocation(userId);
    if (loc?.etaMin) etaMin = loc.etaMin;
  }

  const orderNumber = "WPX" + Math.floor(100000 + Math.random() * 900000);
  const docRef = await addDoc(collection(db, "orders"), {
    orderNumber,
    userId: userId || null,
    items,
    subtotal,
    deliveryFee,
    total,
    etaMin,
    status: "placed",
    createdAt: serverTimestamp(),
  });

  return { orderId: docRef.id, orderNumber, subtotal, deliveryFee, total, etaMin, status: "placed" };
}

// Order history for a user, newest first. Sorted client-side (rather than
// an orderBy in the query) so this doesn't need a Firestore composite index.
async function getOrders(userId) {
  const q = query(collection(db, "orders"), where("userId", "==", userId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

window.WarpXDB = { upsertUser, saveUserLocation, getUserLocation, placeOrder, getOrders };
