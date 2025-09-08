import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as functions from "firebase-functions";
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
import { defineSecret } from "firebase-functions/params";


initializeApp();
const db = getFirestore();


// --- Configure Plaid via Functions config/secrets ---
const PLAID_ENV = (process.env.PLAID_ENV || "production") as keyof typeof PlaidEnvironments;

// In Firebase: store secrets with "firebase functions:secrets:set PLAID_CLIENT_ID", etc.
export const plaidClient = defineSecret("PLAID_CLIENT_ID");
export const plaidSecret = defineSecret("PLAID_SECRET");


// Small helper to build the Plaid client
function makePlaid(clientId: string, secret: string) {
  const config = new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret
      }
    }
  });
  return new PlaidApi(config);
}

// Paths in Firestore
function userDoc(uid: string) { return db.collection("users").doc(uid); }
function tokensDoc(uid: string) { return userDoc(uid).collection("private").doc("plaid"); }
function accountsCol(uid: string) { return userDoc(uid).collection("accounts"); }
function txCol(uid: string) { return userDoc(uid).collection("transactions"); }
function rulesCol(uid: string) { return userDoc(uid).collection("rules"); } // {needle, category}

// ---- Callable: create link token ----
export const createLinkToken = functions
  .runWith({ secrets: [plaidClient, plaidSecret] })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    const uid = context.auth.uid;
    // Force redeploy to pick up new secret

    const plaid = makePlaid(plaidClient.value(), plaidSecret.value());
    const resp = await plaid.linkTokenCreate({
      user: { client_user_id: uid },
      client_name: "Plaid → Firestore",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Ca],
      language: "en"
    });
    return { link_token: resp.data.link_token };
  });

// ---- Callable: exchange public_token -> access_token ----
export const exchangePublicToken = functions
  .runWith({ secrets: [plaidClient, plaidSecret] })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    const uid = context.auth.uid;
    const public_token: string = data?.public_token;
    if (!public_token) throw new functions.https.HttpsError("invalid-argument", "Missing public_token");

    const plaid = makePlaid(plaidClient.value(), plaidSecret.value());
    const resp = await plaid.itemPublicTokenExchange({ public_token });
    // Persist per-user Plaid access token and item id
    await tokensDoc(uid).set({
      access_token: resp.data.access_token,
      item_id: resp.data.item_id,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return { ok: true };
  });

// ---- Callable: sync transactions (cursor-based, idempotent) ----
export const syncTransactions = functions
  .runWith({ secrets: [plaidClient, plaidSecret], timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    const uid = context.auth.uid;

    // Load token + cursor
    const tdoc = await tokensDoc(uid).get();
    if (!tdoc.exists) throw new functions.https.HttpsError("failed-precondition", "Bank not linked.");
    const { access_token, cursor: savedCursor } = tdoc.data() as { access_token: string; cursor?: string; };

    const plaid = makePlaid(plaidClient.value(), plaidSecret.value());

    // Use /transactions/sync for incremental changes
    let added: any[] = [];
    let modified: any[] = [];
    let removed: any[] = [];
    let nextCursor = savedCursor || null;

    // Page until has_more=false
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resp = await plaid.transactionsSync({
        access_token,
        cursor: nextCursor || undefined,
        options: { include_personal_finance_category: true }
      });
      added = added.concat(resp.data.added);
      modified = modified.concat(resp.data.modified);
      removed = removed.concat(resp.data.removed);
      nextCursor = resp.data.next_cursor;
      if (!resp.data.has_more) break;
    }

    // Load rules for categorization (optional)
    const rulesSnap = await rulesCol(uid).get();
    const rules: Array<{ needle: string; category: string }> = [];
    rulesSnap.forEach(d => {
      const r = d.data() as any;
      const needle = (r.needle || "").toString().trim().toLowerCase();
      const cat = (r.category || "").toString().trim();
      if (needle && cat) rules.push({ needle, category: cat });
    });

    const pickCategory = (name: string, merchant: string) => {
      const hay = (merchant || name || "").toLowerCase();
      for (const r of rules) { if (hay.includes(r.needle)) return r.category; }
      return null;
    };

    // Batch writes (idempotent: docId = transaction_id)
    const batch = db.batch();

    // Upsert added + modified
    for (const t of [...added, ...modified]) {
      const docId = t.transaction_id;
      const ref = txCol(uid).doc(docId);
      const outflow = t.amount > 0 ? t.amount : null;
      const inflow  = t.amount < 0 ? -t.amount : null;

      const autoCat = pickCategory(t.name, t.merchant_name);
      const data = {
        transaction_id: t.transaction_id,
        account_id: t.account_id,
        date: t.date,
        name: t.name || "",
        merchant_name: t.merchant_name || "",
        city: t.location?.city || "",
        amount: t.amount,
        outflow,
        inflow,
        currency: t.iso_currency_code || "",
        pending: !!t.pending,
        pf_category: t.personal_finance_category?.primary || null,
        category: autoCat ?? FieldValue.delete(), // only set if rule matched
        updatedAt: FieldValue.serverTimestamp()
      };
      batch.set(ref, data, { merge: true });
    }

    // Mark removed (don’t delete by default; mark a flag)
    for (const r of removed) {
      const ref = txCol(uid).doc(r.transaction_id);
      batch.set(ref, {
        removed: true,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // Save cursor
    batch.set(tokensDoc(uid), {
      cursor: nextCursor,
      lastSyncAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await batch.commit();

    return {
      ok: true,
      added: added.length,
      modified: modified.length,
      removed: removed.length
    };
  });

// ---- Callable: accounts (for display labels) ----
export const getAccounts = functions
  .runWith({ secrets: [plaidClient, plaidSecret] })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    const uid = context.auth.uid;

    const tdoc = await tokensDoc(uid).get();
    if (!tdoc.exists) throw new functions.https.HttpsError("failed-precondition", "Bank not linked.");
    const { access_token } = tdoc.data() as { access_token: string; };

    const plaid = makePlaid(plaidClient.value(), plaidSecret.value());
    const resp = await plaid.accountsGet({ access_token });

    // upsert for convenience
    const batch = db.batch();
    resp.data.accounts.forEach(a => {
      const ref = accountsCol(uid).doc(a.account_id);
      batch.set(ref, {
        account_id: a.account_id,
        name: a.name || a.official_name || "Account",
        official_name: a.official_name || null,
        mask: a.mask || null,
        subtype: a.subtype || null,
        type: a.type || null,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    await batch.commit();

    return { ok: true, count: resp.data.accounts.length };
  });
