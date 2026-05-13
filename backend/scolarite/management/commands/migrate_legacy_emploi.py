"""
Recopie les séances d’emploi du temps depuis une table SQL historique (sauvegarde / rename)
vers le modèle actuel `EmploiDuTemps` (table `scolarite_emploidutemps`).

Contexte
--------
Le modèle Django a toujours porté le nom `EmploiDuTemps` (pas « SeanceEmploi ») ; l’évolution
(0010 → 0027) a ajouté notamment `classe`, `date_seance`, `trimestre`, `matiere`, `salle`.
Après un redesign, les données utiles peuvent rester dans une table renommée (ex.
`scolarite_emploidutemps_old`) : cette commande relit cette table et recrée les lignes côté
`EmploiDuTemps`.

Relations
---------
- `professeur_id` : FK vers `Professeur` (enseignant), **pas** `Personnel` (modèle admin / RH).
- `classe_id` : FK `Classe` (nullable côté modèle).
- `matiere` : texte d’affichage ; à défaut, laissé vide (l’UI peut retomber sur
  `Professeur.matiere`).

La table source **n’est jamais supprimée** (nettoyage manuel après vérification UI).

Usage
-----
  python manage.py migrate_legacy_emploi --dry-run
  python manage.py migrate_legacy_emploi --source-table scolarite_emploidutemps_old
  python manage.py migrate_legacy_emploi --no-expand-weekly
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.utils import DatabaseError

from scolarite.academic_trimesters import (
    SCHOOL_YEAR_FIRST_DAY,
    SCHOOL_YEAR_LAST_DAY,
    is_school_session_day,
    trimestre_for_date,
)
from scolarite.models import Classe, EmploiDuTemps, Professeur

# Candidats fréquents (ordre de priorité) — exclus du ciblage : table live courante
_DEFAULT_SOURCE_CANDIDATES: tuple[str, ...] = (
    "scolarite_emploidutemps_old",
    "scolarite_seanceemploidutemps",
    "scolarite_seance_emploi",
    "scolarite_seance",
)

# Noms de colonnes possibles (hors casse) pour lecture SQL brute
_ALIASES: dict[str, tuple[str, ...]] = {
    "professeur_id": (
        "professeur_id",
        "teacher_id",
        "prof_id",
    ),
    "classe_id": (
        "classe_id",
        "class_id",
    ),
    "jour_semaine": (
        "jour_semaine",
        "day_of_week",
        "jour",
        "weekday",
    ),
    "heure_debut": (
        "heure_debut",
        "start_time",
        "debut",
    ),
    "heure_fin": (
        "heure_fin",
        "end_time",
        "fin",
    ),
    "date_seance": (
        "date_seance",
        "date_cours",
        "session_date",
    ),
    "trimestre": (
        "trimestre",
        "trimester",
    ),
    "matiere": (
        "matiere",
        "matière",
        "subject",
    ),
    "salle": (
        "salle",
        "room",
    ),
}


def _norm_col(name: str) -> str:
    return (name or "").strip().lower().replace("é", "e").replace("è", "e")


def _build_column_index(cursor_columns: list[str]) -> dict[str, str]:
    """Mappe les alias logiques → nom réel de colonne dans la table source."""
    by_norm = {_norm_col(c): c for c in cursor_columns}
    out: dict[str, str] = {}
    for logical, options in _ALIASES.items():
        for opt in options:
            k = _norm_col(opt)
            if k in by_norm:
                out[logical] = by_norm[k]
                break
    return out


def _get_int(row: dict[str, Any], col: str | None) -> int | None:
    if not col or col not in row:
        return None
    v = row[col]
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _as_time(v: Any) -> time | None:
    if v is None:
        return None
    if isinstance(v, time):
        return v
    if isinstance(v, datetime):
        return v.time()
    s = str(v).strip()
    if len(s) >= 5 and s[2] in (":",) and s[:2].isdigit():
        try:
            h, m, *r = s.split(":")
            sec = 0
            if len(r) and r[0].isdigit():
                sec = int(r[0][:2])
            return time(int(h), int(m), sec)
        except ValueError:
            return None
    return None


def _as_date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    s = str(v).strip()[:10]
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            return date(int(s[:4]), int(s[5:7]), int(s[8:10]))
        except ValueError:
            return None
    return None


def _iter_school_days_for_weekday(jour: int) -> list[date]:
    out: list[date] = []
    d = SCHOOL_YEAR_FIRST_DAY
    while d <= SCHOOL_YEAR_LAST_DAY:
        if d.weekday() == jour and is_school_session_day(d):
            out.append(d)
        d += timedelta(days=1)
    return out


def _safe_table_name(name: str) -> str:
    s = (name or "").strip()
    if not s or not all(c.isalnum() or c == "_" for c in s):
        raise CommandError(
            f"Nom de table refusé (caractères autorisés : lettres, chiffres, _) : {name!r}"
        )
    return s


class Command(BaseCommand):
    help = (
        "Migre les séances depuis une table SQL d’archive vers EmploiDuTemps. "
        "N’efface pas la table source."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--source-table",
            type=str,
            default=None,
            help=(
                "Table SQL contenant l’ancienne donnée (ex. scolarite_emploidutemps_old). "
                "Si omis, utilise le premier candidat connu présent en base (hors table courante)."
            ),
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Analyse et comptage sans enregistrer.",
        )
        parser.add_argument(
            "--no-expand-weekly",
            action="store_true",
            help=(
                "Ne pas dupliquer les lignes sans date sur chaque jour d’école de l’année ; "
                "une seule ligne par enregistrement (nécessite date_seance dans la source, "
                "sinon les lignes sont ignorées ou partielles)."
            ),
        )
        parser.add_argument(
            "--ignore-unknown-prof",
            action="store_true",
            help="Ignore les lignes dont professeur_id ne correspond à aucun Professeur.",
        )
        parser.add_argument(
            "--ignore-unknown-classe",
            action="store_true",
            help=(
                "Si classe_id ne correspond à aucune Classe : importer la séance avec classe=NULL "
                "(sinon la commande s’arrête sur erreur)."
            ),
        )
        parser.add_argument(
            "--list-tables",
            action="store_true",
            help="Affiche les tables de la base dont le nom contient emploi, seance ou scolarite, puis quitte.",
        )

    def handle(self, *args, **options):
        if options["list_tables"]:
            self._print_filtered_tables()
            return

        target_table = EmploiDuTemps._meta.db_table
        source_table = options["source_table"]
        dry_run = options["dry_run"]
        expand_weekly = not options["no_expand_weekly"]

        all_tables = set(connection.introspection.table_names())
        if not all_tables:
            raise CommandError("Aucune table listée (connexion base vide ou non initialisée).")

        if source_table:
            source_table = _safe_table_name(source_table)
            if source_table not in all_tables:
                raise CommandError(
                    f"Table {source_table!r} absente. Tables disponibles (extrait) : "
                    f"{sorted(t for t in all_tables if 'scolarite' in t)[:20]} …"
                )
            if source_table == target_table:
                raise CommandError(
                    f"Refus : la table source {source_table!r} est la table cible actuelle. "
                    "Utilisez une copie / renommage (_old) pour ne pas dupliquer la donnée déjà en place."
                )
        else:
            source_table = self._pick_default_source(all_tables, target_table)
            if not source_table:
                self.stdout.write(
                    self.style.ERROR(
                        "Aucune table d’archive détectée parmi : "
                        + ", ".join(_DEFAULT_SOURCE_CANDIDATES)
                        + ". Passez --source-table=… ou --list-tables."
                    )
                )
                return

        self.stdout.write(
            f"Cible modèle : EmploiDuTemps (table {target_table!r})\n"
            f"Source SQL      : {source_table!r}\n"
            f"Expansion hebdo : {expand_weekly}\n"
        )

        rows_out = self._read_and_project(
            source_table=source_table,
            expand_weekly=expand_weekly,
            ignore_unknown_prof=options["ignore_unknown_prof"],
            ignore_unknown_classe=options["ignore_unknown_classe"],
        )

        if not rows_out:
            self.stdout.write(self.style.WARNING("Aucune ligne EmploiDuTemps à créer."))
            return

        to_create, skipped_dup = self._filter_duplicates(rows_out)

        self.stdout.write(
            f"Instances à insérer : {len(to_create)} (doublons côté base actuelle : {skipped_dup})"
        )

        if dry_run:
            self.stdout.write(self.style.WARNING("--dry-run : aucune écriture."))
            return

        batch = 500
        with transaction.atomic():
            for i in range(0, len(to_create), batch):
                EmploiDuTemps.objects.bulk_create(to_create[i : i + batch], batch_size=batch)

        self.stdout.write(
            self.style.SUCCESS(
                f"OK : {len(to_create)} séance(s) importée(s) depuis {source_table!r}. "
                f"Table source laissée intacte. Vérifiez l’emploi du temps dans l’interface."
            )
        )

    def _print_filtered_tables(self) -> None:
        names = sorted(connection.introspection.table_names())
        hint = (n for n in names if any(x in n.lower() for x in ("emploi", "seance", "scolarite")))
        for n in hint:
            self.stdout.write(n)

    def _pick_default_source(self, all_tables: set[str], target_table: str) -> str | None:
        for t in _DEFAULT_SOURCE_CANDIDATES:
            if t in all_tables and t != target_table:
                return t
        return None

    def _filter_duplicates(self, rows: list[EmploiDuTemps]) -> tuple[list[EmploiDuTemps], int]:
        """Évite de recréer un créneau identique s’il existe déjà."""
        if not rows:
            return [], 0
        # Charge les clés existantes (prof, classe, date, heures)
        existing = set(
            EmploiDuTemps.objects.values_list(
                "professeur_id",
                "classe_id",
                "date_seance",
                "heure_debut",
                "heure_fin",
            )
        )
        to_create: list[EmploiDuTemps] = []
        skipped = 0
        for e in rows:
            key = (e.professeur_id, e.classe_id, e.date_seance, e.heure_debut, e.heure_fin)
            if key in existing:
                skipped += 1
                continue
            existing.add(key)
            to_create.append(e)
        return to_create, skipped

    def _read_and_project(
        self,
        *,
        source_table: str,
        expand_weekly: bool,
        ignore_unknown_prof: bool,
        ignore_unknown_classe: bool,
    ) -> list[EmploiDuTemps]:
        qn = connection.ops.quote_name
        sql = f"SELECT * FROM {qn(source_table)}"
        with connection.cursor() as cursor:
            try:
                cursor.execute(sql)
            except DatabaseError as e:
                raise CommandError(f"Lecture {source_table!r} impossible : {e}") from e
            desc = cursor.description
            if not desc:
                return []
            col_names = [d[0] for d in desc]
            col_idx = _build_column_index(col_names)
            if "professeur_id" not in col_idx:
                raise CommandError(
                    f"Colonne professeur_id introuvable dans {source_table!r} "
                    f"(colonnes : {col_names})."
                )
            if "jour_semaine" not in col_idx or "heure_debut" not in col_idx or "heure_fin" not in col_idx:
                raise CommandError(
                    f"Colonnes requises jour_semaine / heure_debut / heure_fin absentes : {col_names}"
                )

            prof_ids = {p.pk for p in Professeur.objects.only("id")}
            classe_ids = {c.pk for c in Classe.objects.only("id")}

            out: list[EmploiDuTemps] = []
            row_count = 0
            dropped_prof = 0
            nulled_classe = 0
            dropped_time = 0
            dropped_trim = 0

            for row in cursor.fetchall():
                row_count += 1
                drow = dict(zip(col_names, row, strict=True))
                pid = _get_int(drow, col_idx.get("professeur_id"))
                if pid is None or pid not in prof_ids:
                    if ignore_unknown_prof:
                        dropped_prof += 1
                        continue
                    raise CommandError(
                        f"Ligne {row_count} : professeur_id {pid!r} invalide ou inconnu. "
                        "Utilisez --ignore-unknown-prof pour ignorer."
                    )
                cid = None
                if "classe_id" in col_idx:
                    raw_c = _get_int(drow, col_idx["classe_id"])
                    if raw_c is not None:
                        if raw_c not in classe_ids:
                            if ignore_unknown_classe:
                                nulled_classe += 1
                                cid = None
                            else:
                                raise CommandError(
                                    f"Ligne {row_count} : classe_id {raw_c!r} inconnu. "
                                    "Utilisez --ignore-unknown-classe pour importer sans classe (NULL)."
                                )
                        else:
                            cid = raw_c

                j = _get_int(drow, col_idx.get("jour_semaine"))
                if j is None or not (0 <= j <= 6):
                    self.stdout.write(
                        self.style.WARNING(f"Ligne {row_count} : jour_semaine invalide, ignorée.")
                    )
                    continue
                t0 = _as_time(drow.get(col_idx["heure_debut"]))
                t1 = _as_time(drow.get(col_idx["heure_fin"]))
                if t0 is None or t1 is None:
                    dropped_time += 1
                    continue

                mat = ""
                if "matiere" in col_idx:
                    v = drow.get(col_idx["matiere"])
                    if v is not None:
                        mat = str(v).strip()[:255]
                salle = ""
                if "salle" in col_idx:
                    v2 = drow.get(col_idx["salle"])
                    if v2 is not None:
                        salle = str(v2).strip()[:64]

                ds = None
                if "date_seance" in col_idx:
                    ds = _as_date(drow.get(col_idx["date_seance"]))

                if ds is not None and ds.weekday() != j:
                    self.stdout.write(
                        self.style.WARNING(
                            f"Ligne {row_count} : date_seance {ds} (weekday={ds.weekday()}) "
                            f"≠ jour_semaine {j}, correction jour_semaine appliquée côté sortie."
                        )
                    )
                    j = ds.weekday()

                if ds is not None:
                    tcode = trimestre_for_date(ds)
                    if tcode is None:
                        dropped_trim += 1
                        continue
                    out.append(
                        EmploiDuTemps(
                            professeur_id=pid,
                            classe_id=cid,
                            date_seance=ds,
                            jour_semaine=j,
                            heure_debut=t0,
                            heure_fin=t1,
                            trimestre=tcode,
                            matiere=mat,
                            salle=salle,
                        )
                    )
                elif expand_weekly:
                    for dday in _iter_school_days_for_weekday(j):
                        tc_final = trimestre_for_date(dday)
                        if tc_final is None:
                            continue
                        out.append(
                            EmploiDuTemps(
                                professeur_id=pid,
                                classe_id=cid,
                                date_seance=dday,
                                jour_semaine=j,
                                heure_debut=t0,
                                heure_fin=t1,
                                trimestre=tc_final,
                                matiere=mat,
                                salle=salle,
                            )
                        )
                else:
                    self.stdout.write(
                        self.style.WARNING(
                            f"Ligne {row_count} : pas de date_seance et expansion désactivée — ignorée."
                        )
                    )

        self.stdout.write(
            f"Lignes lues : {row_count} ; ignorées (prof) : {dropped_prof} ; "
            f"classe inconnue → NULL : {nulled_classe} ; (horaires invalides) : {dropped_time} ; "
            f"(date hors période scolaire) : {dropped_trim}"
        )
        return out
