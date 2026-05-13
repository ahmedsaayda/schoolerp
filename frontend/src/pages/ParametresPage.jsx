import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  CalendarDays,
  Landmark,
  Pencil,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";

import { useAuth } from "../AuthContext.jsx";
import { ROLE, defaultHomePath, displayUserName, isAdminUser } from "../authRoles.js";
import { TABLE_LONG_TEXT_WRAP } from "../constants/tableCells.js";
import { TABLE_PAGE_SIZE_OPTIONS, useSettings } from "../context/SettingsContext.jsx";
import {
  API_BANQUE_DEFINIR_SOLDE,
  API_BANQUE_SOLDE,
  API_CALENDRIER_SCOLAIRE,
  API_STAFF_USERS,
  apiFetch,
  dispatchCaisseSessionChanged,
} from "../config.js";
import { formatTnd } from "../utils/tunisianMoney.js";
import Loading from "../components/ui/Loading.jsx";
import Pagination from "../components/ui/Pagination.jsx";

const ROLE_OPTIONS = [
  { value: ROLE.ADMIN, label: "Administrateur" },
  { value: ROLE.COMPTABLE, label: "Comptable" },
  { value: ROLE.POINTAGE_AGENT, label: "Agent de Pointage" },
];

const CAL_TYPE_OPTIONS = [
  { value: "jour_ferie", label: "Jour férié" },
  { value: "vacances_scolaires", label: "Vacances scolaires" },
];

/** Libellés courts pour la colonne « Type » (Férié / Vacances). */
const CAL_TYPE_SHORT_LABEL = {
  jour_ferie: "Férié",
  vacances_scolaires: "Vacances",
};

const SETTINGS_NAV = [
  {
    id: "section-personnel",
    label: "Gestion du personnel",
    hint: "Rôles et comptes d’accès",
    Icon: Users,
  },
  {
    id: "section-calendrier",
    label: "Vacances et jours fériés",
    hint: "Calendrier scolaire",
    Icon: CalendarDays,
  },
  {
    id: "section-banque",
    label: "Compte bancaire",
    hint: "Solde réel",
    Icon: Landmark,
  },
  {
    id: "section-affichage",
    label: "Préférences d’affichage",
    hint: "Thème, langue, tableaux",
    Icon: SlidersHorizontal,
  },
];

function emptyCalForm() {
  return {
    nom: "",
    date_debut: "",
    date_fin: "",
    type_evenement: "jour_ferie",
  };
}

function parseListPayload(data) {
  if (Array.isArray(data)) return data;
  return data?.results ?? [];
}

/**
 * Affichage des dates selon le format choisi dans les préférences (aperçu sur cette page ;
 * généralisation app à préciser selon modules).
 */
function formatDisplayDate(iso, fmt) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? iso.slice(0, 10) : iso;
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return String(iso);
  if (fmt === "iso") return d;
  if (fmt === "long") {
    return dt.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return dt.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function emptyStaffForm() {
  return {
    username: "",
    email: "",
    first_name: "",
    last_name: "",
    password: "",
    generatePassword: false,
    role: ROLE.POINTAGE_AGENT,
  };
}

const cardOuter =
  "scroll-mt-24 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-800/90";
const cardHeaderBorder = "border-b border-slate-100 px-5 py-4 dark:border-slate-600";

/**
 * Paramètres — administration (admin uniquement), navigation verticale et cartes par domaine.
 */
export default function ParametresPage() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const {
    itemsPerPage,
    setItemsPerPage,
    theme,
    setTheme,
    uiLanguage,
    setUiLanguage,
    dateFormat,
    setDateFormat,
  } = useSettings();
  const titleId = useId();
  const calTitleId = useId();
  const [activeNavId, setActiveNavId] = useState(SETTINGS_NAV[0].id);

  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState("");
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [editingCalId, setEditingCalId] = useState(null);
  const [calForm, setCalForm] = useState(emptyCalForm);
  const [calendarSubmitting, setCalendarSubmitting] = useState(false);
  const [calFormError, setCalFormError] = useState("");
  const [calendarPage, setCalendarPage] = useState(1);
  const [bankSoldeLine, setBankSoldeLine] = useState(null);
  const [bankInput, setBankInput] = useState("");
  const [bankSaving, setBankSaving] = useState(false);
  const [bankFeedback, setBankFeedback] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyStaffForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [staffPage, setStaffPage] = useState(1);

  useEffect(() => {
    if (!authUser) {
      navigate("/login", { replace: true });
      return;
    }
    if (!isAdminUser(authUser)) {
      navigate(defaultHomePath(authUser), { replace: true });
    }
  }, [navigate, authUser]);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(API_STAFF_USERS);
      if (res.status === 403 || res.status === 401) {
        navigate(defaultHomePath(authUser), { replace: true });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStaff(parseListPayload(data));
    } catch {
      setStaff([]);
      setError("Impossible de charger le personnel.");
    } finally {
      setLoading(false);
    }
  }, [authUser, navigate]);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    setCalendarError("");
    try {
      const res = await apiFetch(API_CALENDRIER_SCOLAIRE);
      if (res.status === 403 || res.status === 401) {
        navigate(defaultHomePath(authUser), { replace: true });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCalendarEvents(parseListPayload(data));
    } catch {
      setCalendarEvents([]);
      setCalendarError("Impossible de charger le calendrier scolaire.");
    } finally {
      setCalendarLoading(false);
    }
  }, [authUser, navigate]);

  const loadBankSolde = useCallback(async () => {
    try {
      const res = await apiFetch(API_BANQUE_SOLDE, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.masque) {
        setBankSoldeLine("****");
      } else if (data.solde_actuel != null) {
        setBankSoldeLine(formatTnd(data.solde_actuel));
      } else {
        setBankSoldeLine(null);
      }
    } catch {
      setBankSoldeLine(null);
    }
  }, []);

  useEffect(() => {
    if (!authUser || !isAdminUser(authUser)) return undefined;
    void Promise.all([loadStaff(), loadCalendar(), loadBankSolde()]);
    return undefined;
  }, [authUser, loadStaff, loadCalendar, loadBankSolde]);

  const indexOfLastStaff = staffPage * itemsPerPage;
  const indexOfFirstStaff = indexOfLastStaff - itemsPerPage;
  const staffPageRows = useMemo(
    () => staff.slice(indexOfFirstStaff, indexOfLastStaff),
    [staff, indexOfFirstStaff, indexOfLastStaff],
  );

  useEffect(() => {
    const total = staff.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (staffPage > lastPage) setStaffPage(lastPage);
  }, [staff.length, staffPage, itemsPerPage]);

  const indexOfLastCal = calendarPage * itemsPerPage;
  const indexOfFirstCal = indexOfLastCal - itemsPerPage;
  const calendarPageRows = useMemo(
    () => calendarEvents.slice(indexOfFirstCal, indexOfLastCal),
    [calendarEvents, indexOfFirstCal, indexOfLastCal],
  );

  useEffect(() => {
    const total = calendarEvents.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (calendarPage > lastPage) setCalendarPage(lastPage);
  }, [calendarEvents.length, calendarPage, itemsPerPage]);

  function scrollToSection(sectionId) {
    setActiveNavId(sectionId);
    const el = document.getElementById(sectionId);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openCreateModal() {
    setEditingId(null);
    setForm(emptyStaffForm());
    setFormError("");
    setModalOpen(true);
  }

  function openEditModal(row) {
    setEditingId(row.id);
    setForm({
      username: row.username ?? "",
      email: row.email ?? "",
      first_name: row.first_name ?? "",
      last_name: row.last_name ?? "",
      password: "",
      generatePassword: false,
      role: row.role ?? ROLE.POINTAGE_AGENT,
    });
    setFormError("");
    setModalOpen(true);
  }

  function closeModal() {
    if (submitting) return;
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyStaffForm());
    setFormError("");
  }

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openCalendarCreateModal() {
    setEditingCalId(null);
    setCalForm(emptyCalForm());
    setCalFormError("");
    setCalendarModalOpen(true);
  }

  function openCalendarEditModal(row) {
    setEditingCalId(row.id);
    setCalForm({
      nom: row.nom ?? "",
      date_debut: row.date_debut ?? "",
      date_fin: row.date_fin ?? "",
      type_evenement: row.type_evenement ?? "jour_ferie",
    });
    setCalFormError("");
    setCalendarModalOpen(true);
  }

  function closeCalendarModal() {
    if (calendarSubmitting) return;
    setCalendarModalOpen(false);
    setEditingCalId(null);
    setCalForm(emptyCalForm());
    setCalFormError("");
  }

  function updateCalField(key, value) {
    setCalForm((f) => ({ ...f, [key]: value }));
  }

  async function handleCalendarSubmit(ev) {
    ev.preventDefault();
    setCalFormError("");
    setCalendarSubmitting(true);
    const isEdit = editingCalId != null;
    try {
      const body = {
        nom: calForm.nom.trim(),
        date_debut: calForm.date_debut,
        date_fin: calForm.date_fin,
        type_evenement: calForm.type_evenement,
      };
      if (!body.nom) {
        setCalFormError("Indiquez un nom d’évènement.");
        return;
      }
      if (!body.date_debut || !body.date_fin) {
        setCalFormError("Indiquez une date de début et une date de fin.");
        return;
      }
      const url = isEdit ? `${API_CALENDRIER_SCOLAIRE}${editingCalId}/` : API_CALENDRIER_SCOLAIRE;
      const method = isEdit ? "PATCH" : "POST";
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 403 || res.status === 401) {
        navigate(defaultHomePath(authUser), { replace: true });
        return;
      }
      if (!res.ok) {
        let msg = `Erreur ${res.status}`;
        try {
          const data = await res.json();
          if (typeof data.detail === "string") msg = data.detail;
          else if (data && typeof data === "object") {
            const first = Object.entries(data).find(([, v]) => v != null);
            if (first)
              msg = `${first[0]} : ${Array.isArray(first[1]) ? first[1].join(", ") : String(first[1])}`;
          }
        } catch {
          /* ignore */
        }
        setCalFormError(msg);
        return;
      }
      closeCalendarModal();
      await loadCalendar();
    } catch {
      setCalFormError("Erreur réseau ou serveur indisponible.");
    } finally {
      setCalendarSubmitting(false);
    }
  }

  async function handleCalendarDelete(row) {
    if (!window.confirm(`Supprimer « ${row.nom} » ?`)) return;
    try {
      const res = await apiFetch(`${API_CALENDRIER_SCOLAIRE}${row.id}/`, { method: "DELETE" });
      if (res.status === 403 || res.status === 401) {
        navigate(defaultHomePath(authUser), { replace: true });
        return;
      }
      if (!res.ok && res.status !== 204) {
        setCalendarError(`Suppression impossible (HTTP ${res.status}).`);
        return;
      }
      setCalendarError("");
      await loadCalendar();
    } catch {
      setCalendarError("Erreur lors de la suppression.");
    }
  }

  async function handleBankSubmit(ev) {
    ev.preventDefault();
    setBankFeedback(null);
    const raw = bankInput.replace(/\s/g, "").replace(",", ".").trim();
    if (raw === "") {
      setBankFeedback({ variant: "error", text: "Indiquez un montant." });
      return;
    }
    if (Number.isNaN(Number(raw))) {
      setBankFeedback({ variant: "error", text: "Montant invalide." });
      return;
    }
    setBankSaving(true);
    try {
      const res = await apiFetch(API_BANQUE_DEFINIR_SOLDE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solde_actuel: raw }),
      });
      if (res.status === 403 || res.status === 401) {
        navigate(defaultHomePath(authUser), { replace: true });
        return;
      }
      if (!res.ok) {
        let msg = `Erreur ${res.status}`;
        try {
          const data = await res.json();
          if (typeof data.detail === "string") msg = data.detail;
          else if (data?.solde_actuel && Array.isArray(data.solde_actuel)) {
            msg = data.solde_actuel.join(", ");
          }
        } catch {
          /* ignore */
        }
        setBankFeedback({ variant: "error", text: msg });
        return;
      }
      dispatchCaisseSessionChanged();
      await loadBankSolde();
      setBankInput("");
      setBankFeedback({
        variant: "success",
        text: "Solde enregistré. Il correspond désormais au montant réel de votre banque.",
      });
    } catch {
      setBankFeedback({ variant: "error", text: "Erreur réseau ou serveur indisponible." });
    } finally {
      setBankSaving(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);
    const isEdit = editingId != null;
    try {
      const needPassword = !form.generatePassword;
      if (!isEdit && needPassword && !form.password.trim()) {
        setFormError("Renseignez un mot de passe ou activez la génération automatique.");
        setSubmitting(false);
        return;
      }
      const body = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        role: form.role,
      };
      if (!isEdit) {
        body.username = form.username.trim();
        if (form.generatePassword) {
          body.generate_password = true;
        } else {
          body.password = form.password;
        }
      } else {
        if (form.generatePassword) {
          body.generate_password = true;
        } else if (form.password.trim()) {
          body.password = form.password;
        }
      }

      const url = isEdit ? `${API_STAFF_USERS}${editingId}/` : API_STAFF_USERS;
      const method = isEdit ? "PATCH" : "POST";
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 403 || res.status === 401) {
        navigate(defaultHomePath(authUser), { replace: true });
        return;
      }

      if (!res.ok) {
        let msg = `Erreur ${res.status}`;
        try {
          const data = await res.json();
          if (typeof data.detail === "string") msg = data.detail;
          else if (data && typeof data === "object") {
            const first = Object.entries(data).find(([, v]) => v != null);
            if (first)
              msg = `${first[0]} : ${Array.isArray(first[1]) ? first[1].join(", ") : String(first[1])}`;
          }
        } catch {
          /* ignore */
        }
        setFormError(msg);
        return;
      }

      let data = null;
      try {
        data = await res.json();
      } catch {
        /* 204, etc. */
      }
      if (data && typeof data.generated_password === "string" && data.generated_password) {
        window.alert(
          `Mot de passe généré (communiquez-le une seule fois au membre) :\n\n${data.generated_password}`,
        );
      }

      closeModal();
      await loadStaff();
    } catch {
      setFormError("Erreur réseau ou serveur indisponible.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(row) {
    const label = displayUserName(row) || row.username;
    if (!window.confirm(`Supprimer le compte « ${label} » ? Cette action est irréversible.`)) return;
    try {
      const res = await apiFetch(`${API_STAFF_USERS}${row.id}/`, { method: "DELETE" });
      if (res.status === 403 || res.status === 401) {
        navigate(defaultHomePath(authUser), { replace: true });
        return;
      }
      if (!res.ok && res.status !== 204) {
        setError(`Suppression impossible (HTTP ${res.status}).`);
        return;
      }
      await loadStaff();
    } catch {
      setError("Erreur lors de la suppression.");
    }
  }

  const demoDatePreview = formatDisplayDate("2026-04-28", dateFormat);

  const inputClass =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100";
  const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

  return (
    <div className="w-full min-w-0">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Paramètres</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Pilotage du personnel et des droits d’accès, calendrier scolaire, alignement banque réelle, et préférences
          d’affichage pour cet appareil.
        </p>
      </div>

      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
        <nav
          className="flex shrink-0 flex-col gap-1 lg:sticky lg:top-24 lg:w-56"
          aria-label="Sections des paramètres"
        >
          {SETTINGS_NAV.map(({ id, label, hint, Icon }) => {
            const active = activeNavId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => scrollToSection(id)}
                className={[
                  "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                  active
                    ? "border-blue-200 bg-blue-50/90 dark:border-blue-800 dark:bg-blue-950/50"
                    : "border-transparent bg-slate-50/80 hover:border-slate-200 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:border-slate-600 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                <Icon
                  className={[
                    "mt-0.5 h-5 w-5 shrink-0",
                    active ? "text-blue-700 dark:text-blue-300" : "text-slate-500 dark:text-slate-400",
                  ].join(" ")}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 space-y-10">
          <section id="section-personnel" className={cardOuter} aria-labelledby="heading-personnel">
            <div className={`${cardHeaderBorder} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
              <div>
                <h2 id="heading-personnel" className="text-base font-semibold text-slate-900 dark:text-slate-50">
                  Gestion du personnel
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Comptes d’accès et rôles (administrateur, comptable, agent de pointage) pour l’ERP.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  scrollToSection("section-personnel");
                  openCreateModal();
                }}
                className="shrink-0 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                Ajouter un membre
              </button>
            </div>

            {error ? (
              <p className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </p>
            ) : null}

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-600">
                <thead className="bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">
                      Identifiant
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">
                      E-mail
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">
                      Nom complet
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">
                      Rôle
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold text-slate-700 dark:text-slate-200">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-600/80">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <Loading message="Chargement des données…" className="min-h-[180px] py-8" />
                      </td>
                    </tr>
                  ) : staff.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Aucun membre du personnel pour le moment.
                      </td>
                    </tr>
                  ) : (
                    staffPageRows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/40">
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 font-medium text-slate-900 dark:text-slate-100`}>
                          {row.username}
                        </td>
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 text-slate-600 dark:text-slate-300`}>
                          {row.email?.trim() ? row.email : "—"}
                        </td>
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 text-slate-700 dark:text-slate-200`}>
                          {row.display_name?.trim() ||
                            [row.first_name, row.last_name].filter(Boolean).join(" ") ||
                            "—"}
                        </td>
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 text-slate-700 dark:text-slate-200`}>
                          {row.role_label ?? row.role}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="mr-1 inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-500 dark:text-slate-200 dark:hover:bg-slate-700"
                            aria-label={`Modifier ${row.username}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                            aria-label={`Supprimer ${row.username}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {!loading && staff.length > 0 ? (
              <Pagination
                totalItems={staff.length}
                itemsPerPage={itemsPerPage}
                currentPage={staffPage}
                paginate={setStaffPage}
                itemLabel="comptes"
              />
            ) : null}
          </section>

          <section id="section-calendrier" className={cardOuter} aria-labelledby="heading-calendrier">
            <div className={`${cardHeaderBorder} flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between`}>
              <div className="min-w-0">
                <h2 id="heading-calendrier" className="text-base font-semibold text-slate-900 dark:text-slate-50">
                  Calendrier des Vacances et Jours Fériés
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Données du modèle CalendrierScolaire — à relier ultérieurement au pointage et à l’emploi du temps.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  scrollToSection("section-calendrier");
                  openCalendarCreateModal();
                }}
                className="shrink-0 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                Ajouter
              </button>
            </div>
            {calendarError ? (
              <p className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {calendarError}
              </p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-600">
                <thead className="bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">
                      Nom de l’événement
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">
                      Date début
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">
                      Date fin
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold text-slate-700 dark:text-slate-200">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-600/80">
                  {calendarLoading ? (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <Loading message="Chargement du calendrier…" className="min-h-[160px] py-8" />
                      </td>
                    </tr>
                  ) : calendarEvents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Aucun événement pour le moment.
                      </td>
                    </tr>
                  ) : (
                    calendarPageRows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/40">
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 font-medium text-slate-900 dark:text-slate-100`}>
                          {row.nom}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">
                          {formatDisplayDate(row.date_debut, dateFormat)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">
                          {formatDisplayDate(row.date_fin, dateFormat)}
                        </td>
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 text-slate-700 dark:text-slate-200`}>
                          {CAL_TYPE_SHORT_LABEL[row.type_evenement] ??
                            row.type_evenement_label ??
                            row.type_evenement}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openCalendarEditModal(row)}
                            className="mr-1 inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-500 dark:text-slate-200 dark:hover:bg-slate-700"
                            aria-label={`Modifier ${row.nom}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCalendarDelete(row)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                            aria-label={`Supprimer ${row.nom}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {!calendarLoading && calendarEvents.length > 0 ? (
              <Pagination
                totalItems={calendarEvents.length}
                itemsPerPage={itemsPerPage}
                currentPage={calendarPage}
                paginate={setCalendarPage}
                itemLabel="événements"
              />
            ) : null}
          </section>

          <section id="section-banque" className={cardOuter} aria-labelledby="heading-banque">
            <div className={cardHeaderBorder}>
              <h2 id="heading-banque" className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Configuration du Compte Bancaire
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Alignez le solde interne (<code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">Banque pk=1</code>) sur
                votre relevé bancaire réel lorsque le système n’a pas encore tout l’historique.
              </p>
            </div>
            <form onSubmit={handleBankSubmit} className="space-y-4 px-5 py-5">
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                Attention, cela écrasera le solde actuel pour correspondre au montant réel de votre banque.
              </p>
              {bankSoldeLine ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Solde actuellement enregistré dans l’application :{" "}
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{bankSoldeLine}</span>
                </p>
              ) : null}
              {bankFeedback ? (
                <p
                  className={
                    bankFeedback.variant === "success"
                      ? "rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100"
                      : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                  }
                  role="status"
                >
                  {bankFeedback.text}
                </p>
              ) : null}
              <div className="flex max-w-lg flex-col gap-4 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="bank-solde-input" className={labelClass}>
                    Solde Initial Réel
                  </label>
                  <input
                    id="bank-solde-input"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0,000"
                    value={bankInput}
                    onChange={(e) => setBankInput(e.target.value)}
                    disabled={bankSaving}
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={bankSaving}
                  className="h-[42px] shrink-0 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {bankSaving ? "Mise à jour…" : "Mettre à jour le solde"}
                </button>
              </div>
            </form>
          </section>

          <section id="section-affichage" className={cardOuter} aria-labelledby="heading-affichage">
            <div className={cardHeaderBorder}>
              <h2 id="heading-affichage" className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Préférences d’affichage
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Options stockées sur cet appareil (navigation, lisibilité, tableaux).
              </p>
            </div>
            <div className="space-y-6 px-5 py-5">
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <label htmlFor="pref-theme" className={labelClass}>
                    Thème
                  </label>
                  <select
                    id="pref-theme"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    className={inputClass}
                  >
                    <option value="light">Clair</option>
                    <option value="dark">Sombre</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Applique le mode sombre au shell principal de l’application lorsque disponible.
                  </p>
                </div>
                <div>
                  <label htmlFor="pref-lang" className={labelClass}>
                    Langue de l’interface
                  </label>
                  <select
                    id="pref-lang"
                    value={uiLanguage}
                    onChange={(e) => setUiLanguage(e.target.value)}
                    className={inputClass}
                  >
                    <option value="fr">Français</option>
                    <option value="ar">العربية</option>
                    <option value="en">English</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Définit l’attribut de langue du document ; la traduction complète des écrans est progressive.
                  </p>
                </div>
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <label htmlFor="pref-date-fmt" className={labelClass}>
                    Format de date affiché
                  </label>
                  <select
                    id="pref-date-fmt"
                    value={dateFormat}
                    onChange={(e) => setDateFormat(e.target.value)}
                    className={inputClass}
                  >
                    <option value="fr">Standard (JJ mois AAAA)</option>
                    <option value="iso">ISO (AAAA-MM-JJ)</option>
                    <option value="long">Long (jour et mois écrits)</option>
                  </select>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Exemple&nbsp;: <span className="font-medium text-slate-700 dark:text-slate-300">{demoDatePreview}</span>
                  </p>
                </div>
                <div>
                  <label htmlFor="settings-rows-per-page" className={labelClass}>
                    Lignes par page (tableaux)
                  </label>
                  <select
                    id="settings-rows-per-page"
                    value={itemsPerPage}
                    onChange={(e) => setItemsPerPage(Number(e.target.value))}
                    className={inputClass}
                  >
                    {TABLE_PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} lignes
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {calendarModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) closeCalendarModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={calTitleId}
            className="max-h-[min(90vh,560px)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-800"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-600 dark:bg-slate-800">
              <h2 id={calTitleId} className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {editingCalId != null ? "Modifier l’événement" : "Ajouter un événement"}
              </h2>
              <button
                type="button"
                onClick={closeCalendarModal}
                className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                aria-label="Fermer"
              >
                <span className="text-xl leading-none" aria-hidden>
                  ×
                </span>
              </button>
            </div>

            <form onSubmit={handleCalendarSubmit} className="space-y-4 px-5 py-5">
              {calFormError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
                  {calFormError}
                </p>
              ) : null}

              <div>
                <label htmlFor="cal-nom" className={labelClass}>
                  Nom de l’événement
                </label>
                <input
                  id="cal-nom"
                  value={calForm.nom}
                  onChange={(e) => updateCalField("nom", e.target.value)}
                  placeholder="ex. Aïd El Fitr"
                  disabled={calendarSubmitting}
                  className={inputClass}
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cal-debut" className={labelClass}>
                    Date de début
                  </label>
                  <input
                    id="cal-debut"
                    type="date"
                    value={calForm.date_debut}
                    onChange={(e) => updateCalField("date_debut", e.target.value)}
                    disabled={calendarSubmitting}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="cal-fin" className={labelClass}>
                    Date de fin
                  </label>
                  <input
                    id="cal-fin"
                    type="date"
                    value={calForm.date_fin}
                    onChange={(e) => updateCalField("date_fin", e.target.value)}
                    disabled={calendarSubmitting}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="cal-type" className={labelClass}>
                  Type
                </label>
                <select
                  id="cal-type"
                  value={calForm.type_evenement}
                  onChange={(e) => updateCalField("type_evenement", e.target.value)}
                  disabled={calendarSubmitting}
                  className={inputClass}
                >
                  {CAL_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-600">
                <button
                  type="button"
                  onClick={closeCalendarModal}
                  disabled={calendarSubmitting}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-500 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={calendarSubmitting}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {calendarSubmitting ? "Enregistrement…" : editingCalId != null ? "Enregistrer" : "Créer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) closeModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[min(90vh,640px)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-800"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-600 dark:bg-slate-800">
              <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {editingId != null ? "Modifier le membre" : "Ajouter un membre"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-700"
                aria-label="Fermer"
              >
                <span className="text-xl leading-none" aria-hidden>
                  ×
                </span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
              {formError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
                  {formError}
                </p>
              ) : null}

              <div>
                <label htmlFor="staff-username" className={labelClass}>
                  Identifiant
                </label>
                <input
                  id="staff-username"
                  value={form.username}
                  onChange={(e) => updateField("username", e.target.value)}
                  required
                  autoComplete="username"
                  disabled={submitting || editingId != null}
                  className={inputClass}
                />
                {editingId != null ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    L’identifiant ne peut pas être modifié.
                  </p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="staff-first" className={labelClass}>
                    Prénom
                  </label>
                  <input
                    id="staff-first"
                    value={form.first_name}
                    onChange={(e) => updateField("first_name", e.target.value)}
                    disabled={submitting}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="staff-last" className={labelClass}>
                    Nom
                  </label>
                  <input
                    id="staff-last"
                    value={form.last_name}
                    onChange={(e) => updateField("last_name", e.target.value)}
                    disabled={submitting}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="staff-email" className={labelClass}>
                  E-mail
                </label>
                <input
                  id="staff-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  autoComplete="email"
                  required={editingId == null}
                  disabled={submitting}
                  className={inputClass}
                />
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-900/40">
                <input
                  id="staff-gen-pwd"
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  checked={form.generatePassword}
                  onChange={(e) => updateField("generatePassword", e.target.checked)}
                  disabled={submitting}
                />
                <label htmlFor="staff-gen-pwd" className="text-sm text-slate-700 dark:text-slate-200">
                  Générer un mot de passe automatiquement
                  {editingId != null ? " (remplace le mot de passe actuel)" : ""}
                </label>
              </div>

              <div>
                <label htmlFor="staff-password" className={labelClass}>
                  Mot de passe {editingId != null ? "(optionnel)" : ""}
                </label>
                <input
                  id="staff-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  autoComplete="new-password"
                  required={editingId == null && !form.generatePassword}
                  disabled={submitting || form.generatePassword}
                  placeholder={editingId != null ? "Laisser vide pour conserver" : ""}
                  className={inputClass}
                />
                {form.generatePassword ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Un mot de forte complexité sera affiché une fois à la validation.
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="staff-role" className={labelClass}>
                  Rôle
                </label>
                <select
                  id="staff-role"
                  value={form.role}
                  onChange={(e) => updateField("role", e.target.value)}
                  disabled={submitting}
                  className={inputClass}
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-600">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-500 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {submitting ? "Enregistrement…" : editingId != null ? "Enregistrer" : "Créer le compte"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
