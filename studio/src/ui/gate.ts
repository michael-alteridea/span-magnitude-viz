/**
 * Porte du QR : premier passage = adresse mail + lien magique.
 * Ensuite la personne est reconnue et chaque QR ouvre directement la scène.
 * On note qui a ouvert quelle scène.
 */
import { initializeApp } from "firebase/app";
import { getAuth, isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink, onAuthStateChanged, type User } from "firebase/auth";
import { getFirestore, addDoc, collection } from "firebase/firestore";
import { h } from "./dom";

const FB = {
  apiKey: "AIzaSyDn9_Fc_qlHH57NB7tJN1TVs-oapusdNWA",
  authDomain: "alteridea-dashboard.firebaseapp.com",
  projectId: "alteridea-dashboard",
  storageBucket: "alteridea-dashboard.appspot.com",
  messagingSenderId: "544360884766",
  appId: "1:544360884766:web:42b784f419b8cb74f29c0f",
};

const EMAIL_KEY = "datanime:mail";
const app = initializeApp(FB, "datanime-porte");
const auth = getAuth(app);
const db = getFirestore(app);

function currentUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (u) => {
      stop();
      resolve(u);
    });
  });
}

async function noteVisit(email: string, storyId: string, snapId: string | null): Promise<void> {
  try {
    await addDoc(collection(db, "atelier_visites"), {
      email,
      storyId,
      snapId: snapId ?? null,
      at: new Date().toISOString(),
      host: location.hostname,
    });
  } catch {
    /* la visite n'est pas perdue pour la personne : elle est déjà reconnue */
  }
}

function screen(title: string, body: string, form?: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "film reader", "data-testid": "gate", style: "display:flex;align-items:center;justify-content:center;background:#070708;color:#f4f4f5;position:fixed;inset:0;z-index:80" },
    h(
      "div",
      { style: "max-width:420px;padding:28px;text-align:center" },
      h("h2", { style: "margin:0 0 8px;font:600 22px system-ui" }, title),
      h("p", { style: "margin:0 0 16px;color:#a1a1aa;line-height:1.45" }, body),
      form ?? null
    )
  );
}

/** Vrai si la personne peut voir la scène. Affiche la porte sinon. */
export async function ensureAccess(storyId: string, snapId: string | null): Promise<boolean> {
  if (isSignInWithEmailLink(auth, location.href)) {
    const email = localStorage.getItem(EMAIL_KEY) || window.prompt("Confirmez votre adresse mail") || "";
    if (!email) return false;
    await signInWithEmailLink(auth, email, location.href);
    localStorage.setItem(EMAIL_KEY, email);
    history.replaceState(null, "", location.pathname + location.hash);
  }
  const user = await currentUser();
  if (user?.email) {
    await noteVisit(user.email, storyId, snapId);
    return true;
  }
  return askEmail(storyId, snapId);
}

function askEmail(storyId: string, snapId: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    const input = h("input", {
      type: "email",
      required: true,
      placeholder: "adresse mail",
      "aria-label": "Adresse mail",
      style: "width:100%;padding:12px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#fff;font:16px system-ui",
    }) as HTMLInputElement;
    const msg = h("p", { style: "min-height:1.2em;color:#f4f4f5;font:14px system-ui" });
    const btn = h("button", { type: "submit", style: "margin-top:12px;padding:12px 18px;border:0;border-radius:8px;background:#0E6E8C;color:#fff;font:600 15px system-ui;cursor:pointer" }, "Recevoir le lien");
    const form = h("form", { style: "display:flex;flex-direction:column;gap:8px" }, input, btn, msg) as HTMLFormElement;
    const root = screen("Pour voir cette scène", "Premier passage : nous envoyons un lien à votre adresse. Vous cliquez, vous êtes reconnu. Les QR suivants s'ouvrent directement.", form);
    document.body.append(root);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!email.includes("@")) {
        msg.textContent = "Il faut une adresse mail.";
        return;
      }
      btn.setAttribute("disabled", "true");
      msg.textContent = "Envoi…";
      try {
        const sent = await fetch("https://europe-west1-alteridea-dashboard.cloudfunctions.net/envoyerLien", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, url: location.href }),
        }).catch(() => null);
        if (!sent || !sent.ok) {
          await sendSignInLinkToEmail(auth, email, { url: location.href, handleCodeInApp: true });
        }
        localStorage.setItem(EMAIL_KEY, email);
        root.replaceWith(screen("Lien envoyé", `Ouvrez le mail envoyé à ${email}, puis clique le lien. Vous arrivez directement sur cette scène.`));
        resolve(false);
      } catch (err) {
        btn.removeAttribute("disabled");
        const code = (err as { code?: string })?.code ?? "";
        msg.textContent = code.includes("unauthorized-domain")
          ? "Le domaine n'est pas encore autorisé. Ajoutez datanime.io dans Firebase, Authentification, Domaines autorisés."
          : "Envoi impossible. Réessayez dans un instant.";
        console.warn("lien magique", err);
      }
    });
    void storyId;
    void snapId;
  });
}
