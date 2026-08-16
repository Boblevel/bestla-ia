#!/usr/bin/env python3
from __future__ import annotations

import json
import hashlib
import re
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "output" / "commandes-bestla.json"
OUTPUT_DIR = ROOT / "output" / "pdf"
OUTPUT_PATH = OUTPUT_DIR / "manuel-bestla-ia-rhaff-service.pdf"
VERSION = "4.0.0"

NAVY = colors.HexColor("#11182C")
INK = colors.HexColor("#1C2540")
PURPLE = colors.HexColor("#7456F1")
PURPLE_DARK = colors.HexColor("#5338C8")
TEAL = colors.HexColor("#18BFA5")
TEAL_LIGHT = colors.HexColor("#DDF8F3")
LILAC = colors.HexColor("#EEEAFE")
PALE = colors.HexColor("#F5F7FC")
MUTED = colors.HexColor("#65708B")
WHITE = colors.white
LINE = colors.HexColor("#D9DEEC")
RED = colors.HexColor("#C7475D")


def register_fonts() -> None:
    font_dir = Path("/usr/share/fonts/truetype/dejavu")
    pdfmetrics.registerFont(TTFont("BestlaSans", str(font_dir / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("BestlaSansBold", str(font_dir / "DejaVuSans-Bold.ttf")))
    pdfmetrics.registerFont(TTFont("BestlaMono", str(font_dir / "DejaVuSansMono.ttf")))


register_fonts()


class BestlaDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, **kwargs)
        body_frame = Frame(
            18 * mm,
            17 * mm,
            A4[0] - 36 * mm,
            A4[1] - 35 * mm,
            id="body",
            topPadding=14 * mm,
            bottomPadding=8 * mm,
            leftPadding=0,
            rightPadding=0,
        )
        cover_frame = Frame(
            18 * mm,
            18 * mm,
            A4[0] - 36 * mm,
            A4[1] - 36 * mm,
            id="cover",
            topPadding=0,
            bottomPadding=0,
            leftPadding=0,
            rightPadding=0,
        )
        self.addPageTemplates(
            [
                PageTemplate(id="Cover", frames=[cover_frame], onPage=draw_cover, autoNextPageTemplate="Body"),
                PageTemplate(id="Body", frames=[body_frame], onPage=draw_body),
            ]
        )

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        style_name = flowable.style.name
        if style_name not in {"Titre1", "Titre2"}:
            return
        level = 0 if style_name == "Titre1" else 1
        text = flowable.getPlainText()
        digest = hashlib.sha1(f"{level}:{text}".encode("utf-8")).hexdigest()[:12]
        key = f"section-{digest}"
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level, closed=False)
        self.notify("TOCEntry", (level, text, self.page, key))


def draw_cover(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(PURPLE_DARK)
    canvas.circle(width + 20 * mm, height - 20 * mm, 65 * mm, fill=1, stroke=0)
    canvas.setFillColor(PURPLE)
    canvas.circle(-10 * mm, 15 * mm, 52 * mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.roundRect(22 * mm, height - 33 * mm, 38 * mm, 4 * mm, 2 * mm, fill=1, stroke=0)
    canvas.setStrokeColor(colors.Color(1, 1, 1, alpha=0.12))
    canvas.setLineWidth(0.7)
    for offset in range(0, 230, 18):
        canvas.line(0, offset * mm / 3, width, (offset + 70) * mm / 3)

    canvas.setFillColor(WHITE)
    canvas.circle(width / 2, height - 71 * mm, 25 * mm, fill=0, stroke=1)
    canvas.setFont("BestlaSansBold", 32)
    canvas.drawCentredString(width / 2 - 2 * mm, height - 77 * mm, "B")
    canvas.setFillColor(TEAL)
    canvas.setFont("BestlaSansBold", 13)
    canvas.drawString(width / 2 + 5 * mm, height - 76 * mm, "iA")
    canvas.restoreState()


def draw_body(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 15 * mm, width, 15 * mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.rect(0, height - 15 * mm, 6 * mm, 15 * mm, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("BestlaSansBold", 8.5)
    canvas.drawString(18 * mm, height - 9.5 * mm, "BESTLA iA")
    canvas.setFont("BestlaSans", 8)
    canvas.drawRightString(width - 18 * mm, height - 9.5 * mm, "RHAFF SERVICE")

    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 13 * mm, width - 18 * mm, 13 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("BestlaSans", 7.5)
    canvas.drawString(18 * mm, 8.5 * mm, f"Manuel officiel - Version {VERSION}")
    canvas.drawRightString(width - 18 * mm, 8.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="CoverTitle",
        fontName="BestlaSansBold",
        fontSize=31,
        leading=36,
        textColor=WHITE,
        alignment=TA_CENTER,
        spaceAfter=8 * mm,
    )
)
styles.add(
    ParagraphStyle(
        name="CoverSubtitle",
        fontName="BestlaSans",
        fontSize=13,
        leading=20,
        textColor=colors.HexColor("#DCE3FF"),
        alignment=TA_CENTER,
        spaceAfter=5 * mm,
    )
)
styles.add(
    ParagraphStyle(
        name="CoverSignature",
        fontName="BestlaSansBold",
        fontSize=11,
        leading=15,
        textColor=TEAL,
        alignment=TA_CENTER,
    )
)
styles.add(
    ParagraphStyle(
        name="Titre1",
        fontName="BestlaSansBold",
        fontSize=20,
        leading=24,
        textColor=NAVY,
        spaceBefore=3 * mm,
        spaceAfter=5 * mm,
        keepWithNext=True,
    )
)
styles.add(
    ParagraphStyle(
        name="Titre2",
        fontName="BestlaSansBold",
        fontSize=13,
        leading=17,
        textColor=PURPLE_DARK,
        spaceBefore=4 * mm,
        spaceAfter=2.5 * mm,
        keepWithNext=True,
    )
)
styles.add(
    ParagraphStyle(
        name="Corps",
        fontName="BestlaSans",
        fontSize=9.1,
        leading=13.5,
        textColor=INK,
        spaceAfter=2.8 * mm,
    )
)
styles.add(
    ParagraphStyle(
        name="Petit",
        fontName="BestlaSans",
        fontSize=7.4,
        leading=10.2,
        textColor=MUTED,
    )
)
styles.add(
    ParagraphStyle(
        name="TableHead",
        fontName="BestlaSansBold",
        fontSize=7.5,
        leading=9.3,
        textColor=WHITE,
    )
)
styles.add(
    ParagraphStyle(
        name="TableBody",
        fontName="BestlaSans",
        fontSize=7.2,
        leading=9.5,
        textColor=INK,
    )
)
styles.add(
    ParagraphStyle(
        name="TableCommand",
        fontName="BestlaSansBold",
        fontSize=7.6,
        leading=9.5,
        textColor=PURPLE_DARK,
    )
)
styles.add(
    ParagraphStyle(
        name="BestlaCode",
        fontName="BestlaMono",
        fontSize=7.7,
        leading=11,
        textColor=INK,
    )
)


def p(text: str, style: str = "Corps") -> Paragraph:
    return Paragraph(text, styles[style])


def code_block(text: str) -> Table:
    safe = escape(text).replace("\n", "<br/>")
    paragraph = Paragraph(safe, styles["BestlaCode"])
    table = Table([[paragraph]], colWidths=[A4[0] - 44 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALE),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("LINEBEFORE", (0, 0), (0, -1), 3, PURPLE),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def callout(title: str, text: str, color=TEAL) -> Table:
    data = [[p(f"<b>{escape(title)}</b><br/>{text}", "Corps")]]
    table = Table(data, colWidths=[A4[0] - 44 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.Color(color.red, color.green, color.blue, alpha=0.10)),
                ("BOX", (0, 0), (-1, -1), 0.7, color),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def bullet(text: str) -> Table:
    dot = Table([[""]], colWidths=[3.2 * mm], rowHeights=[3.2 * mm])
    dot.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TEAL), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    table = Table([[dot, p(text)]], colWidths=[7 * mm, A4[0] - 51 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return table


def stat_cards(command_count: int) -> Table:
    data = [
        [
            p(f'<b><font size="20" color="#7456F1">{command_count}</font></b><br/>commandes françaises', "Corps"),
            p('<b><font size="20" color="#18BFA5">13</font></b><br/>catégories utiles', "Corps"),
            p('<b><font size="20" color="#7456F1">24/7</font></b><br/>sur le VPS avec PM2', "Corps"),
        ]
    ]
    table = Table(data, colWidths=[(A4[0] - 48 * mm) / 3] * 3)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALE),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return table


ACCESS_OVERRIDES = {
    "programmer": "Propriétaire ou admin du groupe",
    "programmes": "Créateur du programme / propriétaire",
    "annulerprogramme": "Créateur du programme / propriétaire",
    "faq": "Tous; gestion réservée au propriétaire",
    "entreprise": "Tous; configuration propriétaire",
    "services": "Tous; configuration propriétaire",
    "tarifs": "Tous; configuration propriétaire",
    "contact": "Tous; configuration propriétaire",
    "adresse": "Tous; configuration propriétaire",
    "paiement": "Tous; configuration propriétaire",
    "livraison": "Tous; configuration propriétaire",
    "reseaux": "Tous; configuration propriétaire",
    "catalogue": "Tous; configuration propriétaire",
    "conditions": "Tous; configuration propriétaire",
    "reglement": "Tous; modification admin groupe",
    "ticket": "Tous; conversation privée seulement",
    "tickets": "Propriétaire; conversation privée seulement",
    "repondreticket": "Propriétaire; conversation privée seulement",
    "prioriteticket": "Propriétaire; conversation privée seulement",
}


def access_label(command: dict) -> str:
    if command["name"] in ACCESS_OVERRIDES:
        return ACCESS_OVERRIDES[command["name"]]
    labels = []
    if command.get("ownerOnly"):
        labels.append("Propriétaire")
    elif command.get("adminOnly"):
        labels.append("Admin groupe")
    elif command.get("groupOnly"):
        labels.append("Groupe")
    else:
        labels.append("Tous")
    if command.get("botAdminRequired"):
        labels.append("Bestla admin")
    return " + ".join(labels)


def command_table(commands: list[dict]) -> Table:
    rows = [
        [p("COMMANDE", "TableHead"), p("DESCRIPTION ET UTILISATION", "TableHead"), p("ACCÈS", "TableHead")]
    ]
    for command in sorted(commands, key=lambda item: item["name"]):
        aliases = ", ".join(command.get("aliases", [])) or "aucun"
        usage = f".{command['name']} {command['usage']}".strip()
        details = (
            f"{escape(command['description'])}<br/>"
            f"<font color=\"#65708B\"><b>Syntaxe :</b> {escape(usage)}<br/>"
            f"<b>Alias :</b> {escape(aliases)}</font>"
        )
        rows.append(
            [
                p(f".{escape(command['name'])}", "TableCommand"),
                p(details, "TableBody"),
                p(escape(access_label(command)), "TableBody"),
            ]
        )
    table = Table(rows, colWidths=[36 * mm, 101 * mm, 34 * mm], repeatRows=1, hAlign="LEFT")
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for row in range(1, len(rows)):
        if row % 2 == 0:
            style.append(("BACKGROUND", (0, row), (-1, row), PALE))
    table.setStyle(TableStyle(style))
    return table


def add_installation(story: list):
    story.extend(
        [
            p("Installation automatique sur VPS", "Titre1"),
            p(
                "Bestla iA v4 s’installe sans préparer Node.js, FFmpeg ou PM2 à la main. Le script installe les composants nécessaires, exécute les tests, active le démarrage automatique après reboot et crée la commande de contrôle <b>bestla</b>.",
            ),
            p("Méthode A - Une commande depuis GitHub", "Titre2"),
            p("Après publication du dépôt, remplace UTILISATEUR_GITHUB et DEPOT_GITHUB :"),
            code_block(
                "bash <(curl -fsSL https://raw.githubusercontent.com/UTILISATEUR_GITHUB/DEPOT_GITHUB/main/install-github.sh) \\\n  --repo https://github.com/UTILISATEUR_GITHUB/DEPOT_GITHUB.git"
            ),
            p("Le script demande le numéro WhatsApp international du propriétaire et le mode de liaison qr ou pairing. Il propose ensuite l’autorisation IA automatique : Bestla affiche un code Pollinations à valider dans le navigateur, puis reçoit le jeton serveur officiel sans copier-coller de secret. Bestla tente ensuite de créer une clé dédiée au bot, limitée aux modèles utilisés et valable jusqu’à 365 jours. Il utilise toujours le même dossier permanent <b>/root/bestla-ia/bestla-ia-bot</b> : aucune succession de dossiers v4.1, v4.2, etc."),
            p("L'installateur reconnaît Debian/Ubuntu, Fedora/RHEL/Rocky/Alma, Alpine, Arch/Manjaro, openSUSE et Void Linux. Il demande un serveur Linux maintenu avec root ou sudo. Un conteneur sans systemd/OpenRC doit disposer d'une politique de redémarrage chez son hébergeur."),
            p("Méthode B - Depuis le ZIP", "Titre2"),
            code_block(
                "cd /root\n"
                "unzip -o bestla-ia-bot-v4.zip -d /root/bestla-install\n"
                "cd /root/bestla-install/bestla-ia-bot\n"
                "bash installer-vps.sh"
            ),
            callout(
                "Numéro WhatsApp",
                "Indique le numéro complet avec indicatif, sans signe +, espace ni tiret. Exemple Burkina Faso : 22670000000. Le numéro configuré comme propriétaire contrôle toutes les commandes sensibles.",
                PURPLE,
            ),
            p("Relier le compte WhatsApp", "Titre2"),
            code_block("bestla logs live"),
            p(
                "Si tu as choisi qr, ouvre WhatsApp, Appareils connectés, Connecter un appareil, puis scanne le QR. Si tu as choisi pairing, choisis Lier avec un numéro de téléphone puis entre le code affiché. Cette validation reste obligatoire dans WhatsApp.",
            ),
            p("Vérifier la fin de l’installation", "Titre2"),
            code_block("bestla statut\nbestla diagnostic\n# Dans WhatsApp : .info puis .menu"),
            callout(
                "Session sensible",
                "Le dossier data/sessions, le fichier .env et les archives de sauvegarde donnent accès au bot. Ne les publie jamais sur GitHub et ne les partage pas par WhatsApp.",
                RED,
            ),
        ]
    )


def add_vps_panel(story: list):
    story.extend(
        [
            p("Panneau de contrôle VPS : bestla", "Titre1"),
            p("Dans Termius, connecte-toi au VPS et tape simplement <b>bestla</b>. Le panneau RHAFF SERVICE utilise un en-tête symétrique avec OS, IP, RAM, CPU, état du bot et comptes WhatsApp parfaitement alignés. Le menu principal n’affiche plus de sous-description sous son titre. Les sous-menus sont également épurés : uniquement les actions nécessaires. Les rubriques couvrent Numéros WhatsApp, Contrôle du bot, Configuration, Automatisations, Sauvegardes, Maintenance/Système, Journaux et Guide. Chaque rubrique possède <b>[0] Retour</b>."),
            code_block(
                "bestla statut\n"
                "bestla demarrer\n"
                "bestla stopper\n"
                "bestla redemarrer\n"
                "bestla logs\n"
                "bestla logs live"
            ),
            p("Ajouter ou retirer un compte WhatsApp", "Titre2"),
            code_block(
                "bestla sessions\n"
                "bestla sessions ajouter boutique 22671111111 pairing\n"
                "bestla sessions mode boutique qr\n"
                "bestla sessions reinitialiser boutique confirmer\n"
                "bestla sessions retirer boutique confirmer\n"
                "bestla logs live"
            ),
            p("Chaque compte est une session séparée. Le retrait déplace les clés dans data/sessions-retirees au lieu de les supprimer immédiatement."),
            p("Depuis le panneau : <b>bestla → 1 → 1</b>, puis indique le nom de session, le numéro international et le mode QR ou code de liaison. Les autres sessions restent configurées."),
            p("Propriétaires, programmation et sauvegarde", "Titre2"),
            code_block(
                "bestla proprietaires liste\n"
                "bestla proprietaires ajouter 22670000000\n"
                "bestla configuration prefixe .\n"
                "bestla configuration mode prive\n"
                "bestla configuration signature RHAFF SERVICE\n"
                "bestla programmes\n"
                "bestla sauvegarde\n"
                "bestla sauvegardes liste"
            ),
            callout(
                "Fonctionnement permanent",
                "PM2 est activé par l’installateur. Le bot redémarre automatiquement après un reboot du VPS. Vérifie à tout moment avec bestla statut.",
                TEAL,
            ),
        ]
    )


def add_update_instructions(story: list):
    story.extend(
        [
            p("Mise à jour et publication GitHub", "Titre1"),
            p("Une installation provenant de GitHub se met à jour sans perdre les sessions WhatsApp :"),
            code_block("bestla miseajour confirmer"),
            p("La mise à jour GitHub reste dans le même dossier permanent et conserve .env ainsi que data. Elle télécharge le code, exécute npm ci, les tests, la construction puis redémarre PM2."),
            p("Mise à jour depuis un ZIP", "Titre2"),
            code_block(
                "mkdir -p /root/bestla-update-v4\n"
                "unzip -o /root/bestla-ia-bot-v4.zip -d /root/bestla-update-v4\n"
                "cd /root/bestla-update-v4/bestla-ia-bot\n"
                "bash mettre-a-jour-vps.sh /root/bestla-ia/bestla-ia-bot"
            ),
            p("Le script conserve .env et data, utilise un rollback unique caché au lieu d’empiler des sauvegardes datées, puis supprime les anciens ZIP/dossiers de migration Bestla."),
            p("Créer une archive de publication", "Titre2"),
            code_block("npm run release"),
            p("L’archive créée dans releases/ ne contient ni .env, ni sessions WhatsApp, ni données privées."),
            p("Nettoyer ou désinstaller Bestla", "Titre2"),
            code_block(
                "bestla nettoyer confirmer\n"
                "bestla desinstaller confirmer"
            ),
            p("Le nettoyage supprime uniquement les anciens ZIP, dossiers de test et sauvegardes de migration Bestla. La désinstallation retire Bestla, son processus PM2 et le raccourci /usr/local/bin/bestla, sans désinstaller Node.js, PM2, FFmpeg ni les autres services du VPS."),
        ]
    )


def add_automation_recipes(story: list):
    story.extend(
        [
            p("Recettes d’automatisation", "Titre1"),
            p("1. Réponse automatique par mot-clé", "Titre2"),
            code_block(
                ".autoreponse ajouter prive bonjour | Bonjour, bienvenue chez RHAFF SERVICE.\n"
                ".autoreponse activer\n"
                ".autoreponse liste"
            ),
            p(
                "Portées : <b>prive</b>, <b>groupe</b> ou <b>tous</b>. Ajoute le mot <b>exact</b> après la portée pour répondre uniquement si tout le message correspond au déclencheur.",
            ),
            p("2. Mode absence", "Titre2"),
            code_block(
                ".absence activer Merci pour votre message. Nous vous répondrons bientôt.\n"
                ".absence statut\n"
                ".absence desactiver"
            ),
            p("Un contact privé reçoit la réponse d’absence au maximum une fois toutes les 12 heures."),
            p("3. Réponse hors horaires", "Titre2"),
            code_block(
                ".horaires definir 08:00 18:00 | Nous sommes fermés. Nous répondrons dès l’ouverture.\n"
                ".horaires activer\n"
                ".horaires statut"
            ),
            p("Les horaires utilisent le fuseau TIMEZONE configuré dans .env."),
            p("4. FAQ automatique", "Titre2"),
            code_block(
                ".faq ajouter livraison | Livraison sous 24 heures.\n"
                ".faq ajouter paiement | Mobile Money et espèces.\n"
                ".faq liste\n"
                ".faq livraison"
            ),
            p("5. Message unique ou quotidien programmé", "Titre2"),
            code_block(
                ".programmer 10min | Vérifier la commande du client\n"
                ".programmer 2h | Relancer le dossier\n"
                ".programmer 2026-08-20 14:30 | Réunion avec l’équipe\n"
                ".programmer quotidien 08:00 | Bonjour à toute l’équipe\n"
                ".programmes\n"
                ".annulerprogramme IDENTIFIANT"
            ),
            callout(
                "Protection contre les envois massifs",
                "Un programme cible uniquement le chat dans lequel il a été créé. Bestla iA n’intègre pas d’envoi automatique à une liste de numéros.",
            ),
            p("6. Réactions automatiques", "Titre2"),
            code_block(
                ".reactionauto ajouter tous merci | ♥\n"
                ".reactionauto activer\n"
                ".reactionauto liste"
            ),
            p("7. Notes privées et réponses rapides", "Titre2"),
            code_block(
                ".note ajouter stock | Vérifier le stock lundi matin\n"
                ".note stock\n"
                ".raccourci ajouter paiement | Voici nos moyens de paiement...\n"
                ".raccourci paiement"
            ),
            p("8. Informations commerciales", "Titre2"),
            code_block(
                ".entreprise definir RHAFF SERVICE accompagne ses clients dans leurs projets numériques.\n"
                ".services definir Développement - Automatisation - Assistance\n"
                ".tarifs definir Contactez-nous pour un devis personnalisé.\n"
                ".contact definir WhatsApp : +226 XX XX XX XX"
            ),
            p("Les clients peuvent ensuite utiliser .entreprise, .services, .tarifs et .contact."),
            p("9. Catalogue, livraison et conditions", "Titre2"),
            code_block(
                ".adresse definir Ouagadougou, secteur 15 - livraison sur rendez-vous\n"
                ".paiement definir Mobile Money, carte bancaire et espèces\n"
                ".livraison definir Livraison sous 24 à 48 h selon la zone\n"
                ".catalogue definir Catalogue : https://exemple.com/catalogue\n"
                ".conditions definir Paiement avant livraison."
            ),
            p("10. Tickets privés de support", "Titre2"),
            code_block(
                ".ticket ouvrir Je souhaite un devis pour un site vitrine\n"
                ".ticket mes\n"
                ".tickets ouverts\n"
                ".prioriteticket tk12345678 haute\n"
                ".repondreticket tk12345678 | Bonjour, nous préparons votre devis."
            ),
            p("Les clients ouvrent et suivent leurs tickets en privé. Les commandes de gestion évitent les groupes pour ne pas exposer les demandes.", "Corps"),
            p("11. Annonce et sondage de groupe", "Titre2"),
            code_block(
                ".annonce Réunion demain à 10 h dans la salle principale\n"
                ".sondage Quelle date préférez-vous ? | Lundi | Mardi | Mercredi"
            ),
            p("12. Messages de bienvenue personnalisés", "Titre2"),
            code_block(
                ".messagebienvenue definir Bienvenue {nom} dans {groupe}. Nous sommes maintenant {nombre} nouveau(x).\n"
                ".bienvenue activer\n"
                ".messagedepart definir Au revoir {nom}, à bientôt.\n"
                ".aurevoir activer"
            ),
            p("Variables disponibles : {nom}, {groupe} et {nombre}."),
            p("13. Règlement et validation des entrées", "Titre2"),
            code_block(
                ".reglement definir Respect obligatoire. Pas de liens non autorisés.\n"
                ".messagesdisparition 7j\n"
                ".validationentree activer\n"
                ".ajoutmembres administrateurs\n"
                ".infosgroupe"
            ),
        ]
    )


def add_v3_features(story: list):
    story.extend(
        [
            p("Fonctions avancées : IA, budget, médias et jeux", "Titre1"),
            p("Assistant IA automatique", "Titre2"),
            p("La méthode recommandée utilise le device-flow officiel Pollinations. Aucune clé publique trouvée sur Internet n’est intégrée au projet : le propriétaire ouvre l’adresse affichée, saisit le code temporaire, autorise son compte, puis Bestla reçoit le jeton serveur. Lorsque le compte l’autorise, Bestla crée automatiquement une clé enfant dédiée au bot, valable jusqu’à 365 jours et limitée aux modèles openai-fast, flux, kontext et wan-fast ; sinon le jeton autorisé est conservé. Le secret final reste dans .env."),
            code_block(
                "bestla configuration apiauto\n"
                "# ou : bestla → Configuration → API IA automatique"
            ),
            callout(
                "Accès et coût des modèles",
                "Pollinations fournit des modèles texte accessibles au niveau gratuit, dont openai-fast. Les images et surtout la vidéo peuvent consommer des crédits Pollen selon le modèle. Bestla V4 tente d’abord le fournisseur configuré ; si une génération d’image est refusée pour absence de crédit ou indisponibilité temporaire, il tente automatiquement le point d’accès image anonyme historique de Pollinations. Pour la vidéo, un clip local de secours de 5 secondes peut être créé avec FFmpeg à partir d’une image générée ou fournie. Les retouches sémantiques avancées restent dépendantes d’un fournisseur qui accepte la requête.",
                PURPLE,
            ),
            code_block(
                ".assistant Explique-moi ce contrat en langage simple.\n"
                ".traduire anglais | Bonjour, nous vous répondrons bientôt.\n"
                ".resumer Réponds à ce long message…\n"
                ".corrigertexte Je veux corriger ce message.\n"
                ".reformuler Voici notre offre.\n"
                ".genererimage Une boutique moderne blanche et or\n"
                ".modifierimage Remplace le fond par un studio premium\n"
                ".generervideo Plan vertical cinématique d’une boutique moderne\n"
                ".animerimage La caméra avance lentement\n"
                ".modifiervideo Garde le sujet et rends l’éclairage plus cinématique"
            ),
            callout(
                "Confidentialité IA",
                "Le jeton API reste dans .env avec des permissions privées. Il n’est jamais ajouté au dépôt GitHub, au ZIP public ni aux menus WhatsApp. Avec Pollinations, la modification vidéo recrée une séquence à partir de l’image de départ de la vidéo source et de la consigne demandée ; Gemini manuel reste disponible en option pour les comptes compatibles.",
                PURPLE,
            ),
            p("Budget privé", "Titre2"),
            code_block(
                ".revenu 5000 | Vente | Client site web\n"
                ".depense 1200 | Internet | Forfait data\n"
                ".budget\n"
                ".historiquebudget\n"
                ".supprimerbudget IDENTIFIANT"
            ),
            p("Le budget est réservé au propriétaire en conversation privée. Chaque opération a un identifiant pour être retirée sans affecter les autres."),
            p("Audio, vidéo et autocollant animé", "Titre2"),
            code_block(
                ".convertiraudio\n"
                ".effetaudio robot\n"
                ".couperaudio 10 30\n"
                ".extraireaudio\n"
                ".compresservideo\n"
                ".tournervideo 90\n"
                ".coupervideo 5 20\n"
                ".autocollantvideo"
            ),
            p("Réponds au média avec la commande. Les traitements se font localement sur le VPS avec FFmpeg. Les fichiers très lourds ou trop longs peuvent être refusés pour protéger le serveur."),
            p("PDF et affiches texte", "Titre2"),
            code_block(
                ".creerpdf Mon devis | Bonjour, voici le détail de votre devis…\n"
                ".texteimage neon | Bienvenue chez RHAFF SERVICE\n"
                ".texteimage or | Offre spéciale"
            ),
            p("Jeux", "Titre2"),
            code_block(
                ".morpion creer @personne\n"
                ".morpion jouer 5\n"
                ".devinenombre debut\n"
                ".quiz\n"
                ".arreterjeu"
            ),
        ]
    )


def add_security_and_support(story: list):
    story.extend(
        [
            p("Maintenance, sécurité et dépannage", "Titre1"),
            p("Sauvegarde", "Titre2"),
            p("Depuis le numéro propriétaire, utilise .sauvegarde. Bestla iA envoie un fichier JSON contenant les réglages, sans les clés de session WhatsApp."),
            code_block(".sauvegarde\n.nettoyerprogrammes"),
            p("Règles de sécurité essentielles", "Titre2"),
            bullet("Ne partage jamais .env ni le dossier data/sessions."),
            bullet("Ne publie jamais une clé Pollinations, Gemini ou autre dans GitHub, WhatsApp, un ZIP public ou une capture d’écran."),
            bullet("Chaque personne qui installe Bestla doit utiliser sa propre clé API ; une clé publique partagée peut être bloquée et exposer le quota du propriétaire."),
            bullet("Révoque immédiatement l’appareil connecté depuis WhatsApp si une session a été exposée."),
            bullet("Teste d’abord avec un numéro secondaire et un groupe de test."),
            bullet("N’utilise pas le bot pour le spam, le harcèlement ou des messages non sollicités."),
            bullet("N’active l’API HTTP que si elle est nécessaire et protégée par HTTPS et un pare-feu."),
            bullet("Vérifie tout plugin personnalisé avant de le déposer dans custom-plugins."),
            p("Diagnostic rapide", "Titre2"),
            code_block(
                "pm2 status\n"
                "pm2 logs bestla-ia-bot --lines 100\n"
                "node -v\n"
                "npm test"
            ),
            p("Depuis WhatsApp, le propriétaire peut aussi envoyer .etatserveur pour recevoir un résumé de l’état du bot et du VPS."),
            p("Problème : le bot ne répond pas", "Titre2"),
            bullet("Vérifie que pm2 status affiche online."),
            bullet("Lis pm2 logs bestla-ia-bot et repère la première erreur."),
            bullet("Vérifie le préfixe et le numéro OWNER_NUMBERS dans .env."),
            p("Problème : une commande de groupe échoue", "Titre2"),
            bullet("Rends Bestla iA administrateur du groupe."),
            bullet("Vérifie que la personne qui lance la commande est administratrice."),
            bullet("Utilise .reglages pour contrôler la configuration."),
            p("Problème : la session est révoquée", "Titre2"),
            code_block(
                "pm2 stop bestla-ia-bot\n"
                "mv /root/bestla-ia/bestla-ia-bot/data/sessions/main /root/bestla-ia/bestla-ia-bot/data/sessions/main-revoquee\n"
                "pm2 start bestla-ia-bot"
            ),
            callout(
                "Attention",
                "Le déplacement ci-dessus conserve une sauvegarde de la session révoquée. Ne déplace jamais tout le projet ou un répertoire large.",
                RED,
            ),
            p("API HTTP facultative", "Titre2"),
            code_block(
                "API_ENABLED=true\n"
                "API_PORT=3000\n"
                "API_KEY=une-cle-aleatoire-de-plus-de-24-caracteres"
            ),
            Spacer(1, 2 * mm),
            code_block(
                "curl -X POST http://127.0.0.1:3000/api/send \\\n"
                "  -H \"x-api-key: TA_CLE\" \\\n"
                "  -H \"content-type: application/json\" \\\n"
                "  -d '{\"session\":\"main\",\"to\":\"22670000000\",\"type\":\"text\",\"text\":\"Bonjour\"}'"
            ),
        ]
    )


def build_story(commands: list[dict]) -> list:
    story = [
        Spacer(1, 108 * mm),
        p("BESTLA iA", "CoverTitle"),
        p("Bot WhatsApp français, élégant et automatisé<br/>Guide GitHub + VPS Linux", "CoverSubtitle"),
        Spacer(1, 4 * mm),
        p("CRÉÉ ET SIGNÉ PAR RHAFF SERVICE", "CoverSignature"),
        Spacer(1, 36 * mm),
        p("Version 4.0 - 16 août 2026", "CoverSubtitle"),
        NextPageTemplate("Body"),
        PageBreak(),
        p("Sommaire", "Titre1"),
    ]

    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            name="TOC1",
            fontName="BestlaSansBold",
            fontSize=9,
            leading=12.5,
            textColor=INK,
            leftIndent=0,
            firstLineIndent=0,
            spaceBefore=0,
        ),
        ParagraphStyle(
            name="TOC2",
            fontName="BestlaSans",
            fontSize=7.7,
            leading=10.5,
            textColor=MUTED,
            leftIndent=10 * mm,
            firstLineIndent=0,
        ),
    ]
    story.extend([toc, PageBreak()])

    story.extend(
        [
            p("Bienvenue dans Bestla iA", "Titre1"),
            p(
                "Bestla iA est un bot WhatsApp multi-session conçu pour RHAFF SERVICE. Il combine automatisation commerciale, gestion de groupes, IA optionnelle, budget, outils médias et administration VPS dans une interface entièrement francisée.",
            ),
            stat_cards(len(commands)),
            Spacer(1, 5 * mm),
            p("Objectif de ce manuel", "Titre2"),
            bullet("Installer Bestla iA depuis GitHub ou une archive ZIP en une commande."),
            bullet("Relier le compte WhatsApp par QR code ou code à 8 chiffres."),
            bullet("Maintenir le bot actif après fermeture de Termius et redémarrage du VPS."),
            bullet(f"Comprendre les {len(commands)} commandes et leurs permissions."),
            callout(
                "Important",
                "Baileys est une intégration WhatsApp Web non officielle. Bestla iA doit être utilisé de façon responsable, sans spam ni messages non sollicités.",
                PURPLE,
            ),
            p("Comment fonctionne l’installation", "Titre2"),
            p(
                "Le téléphone ouvre une connexion SSH vers le VPS Linux. Le code, les sessions et les automatisations restent sur le serveur. PM2 surveille le processus et le relance automatiquement si nécessaire.",
            ),
        ]
    )

    add_installation(story)
    add_vps_panel(story)
    add_update_instructions(story)

    story.extend(
        [
            p("Prise en main dans WhatsApp", "Titre1"),
            p("Commence avec ces quatre commandes :"),
            code_block(".info\n.menu\n.latence\n.etatautomatisation"),
            Spacer(1, 3 * mm),
            p("Comprendre le préfixe", "Titre2"),
            p("Le point est le préfixe par défaut. .menu lance la commande menu. Le propriétaire peut le changer avec .prefixe !, puis les commandes commencent par !."),
            p("Niveaux d’autorisation", "Titre2"),
            bullet("Tous : la commande peut être utilisée par les membres autorisés lorsque le bot est public."),
            bullet("Propriétaire : le numéro se trouve dans OWNER_NUMBERS ou la commande part du compte connecté."),
            bullet("Admin groupe : l’expéditeur doit administrer le groupe."),
            bullet("Bestla admin : Bestla iA doit aussi être administrateur pour modifier le groupe."),
            p("Mode public et mode privé", "Titre2"),
            code_block(".mode public\n.mode prive"),
            p("En mode privé, seules les commandes du propriétaire sont exécutées. Les automatisations déjà configurées restent actives."),
        ]
    )

    story.append(p(f"Référence des {len(commands)} commandes", "Titre1"))
    story.append(p("Les tableaux ci-dessous sont générés directement à partir du code de Bestla iA."))
    category_order = [
        "Général",
        "IA",
        "Groupe",
        "Modération",
        "Média",
        "Audio & Vidéo",
        "Documents & Création",
        "Automatisation",
        "Budget",
        "Entreprise",
        "Jeux",
        "WhatsApp",
        "Propriétaire",
    ]
    for category in category_order:
        category_commands = [command for command in commands if command["category"] == category]
        story.append(p(category, "Titre2"))
        story.append(command_table(category_commands))
        story.append(Spacer(1, 4 * mm))

    add_automation_recipes(story)
    add_v3_features(story)

    story.extend(
        [
            p("Scénario de groupe recommandé", "Titre1"),
            p("1. Ajoute Bestla iA au groupe et rends-le administrateur."),
            code_block(
                ".protection activer\n"
                ".bienvenue activer\n"
                ".aurevoir activer\n"
                ".messagebienvenue definir Bienvenue {nom} dans {groupe}.\n"
                ".reglages"
            ),
            p("2. Autorise un domaine légitime sans désactiver l’anti-lien."),
            code_block(".domainesautorises ajouter rhaff-service.com\n.domainesautorises liste"),
            p("3. Ajoute un mot interdit et contrôle les avertissements."),
            code_block(
                ".motinterdit ajouter insulte\n"
                ".avertir @personne comportement inapproprié\n"
                ".avertissements @personne"
            ),
            p("4. Publie une annonce ou un sondage."),
            code_block(
                ".annonce Bienvenue à tous. Merci de lire le règlement.\n"
                ".sondage Avez-vous lu le règlement ? | Oui | Pas encore"
            ),
            callout(
                "Conseil",
                "Teste la modération dans un groupe privé avant de l’activer dans une grande communauté. Les administrateurs et le propriétaire sont exemptés des contrôles automatiques.",
            ),
        ]
    )

    story.extend(
        [
            p("Outils médias", "Titre1"),
            p("Image vers autocollant", "Titre2"),
            p("Envoie une image avec .autocollant en légende, ou réponds à une image avec .autocollant."),
            p("Autocollant vers image", "Titre2"),
            p("Réponds à un autocollant avec .image."),
            p("Créer un code QR", "Titre2"),
            code_block(".codeqr https://rhaff-service.com"),
            p("Compresser, redimensionner et appliquer un effet", "Titre2"),
            code_block(
                ".compresserimage 60\n"
                ".redimensionner 1080 1080\n"
                ".noiretblanc\n"
                ".tournerimage 90\n"
                ".flouimage 8\n"
                ".filigrane RHAFF SERVICE\n"
                ".recadrerimage carre\n"
                ".amelioreimage"
            ),
            p("Ces commandes s’utilisent en légende de l’image ou en réponse à une image."),
        ]
    )

    add_security_and_support(story)

    story.extend(
        [
            p("Fiche rapide", "Titre1"),
            p("Installation", "Titre2"),
            code_block(
                "npm ci\n"
                "npm test\n"
                "npm run build\n"
                "pm2 start ecosystem.config.cjs\n"
                "pm2 save"
            ),
            p("Commandes quotidiennes", "Titre2"),
            code_block(
                ".menu\n"
                ".etatautomatisation\n"
                ".programmes\n"
                ".reglages\n"
                ".sauvegarde"
            ),
            p("Surveillance VPS", "Titre2"),
            code_block("bestla statut\nbestla logs\nbestla redemarrer\nbestla diagnostic"),
            p("Sources techniques", "Titre1"),
            p(
                'Client SSH : utilise Termius ou tout autre client SSH compatible avec ton VPS.<br/>'
                'Installation Node.js et npm : <link href="https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/" color="#5338C8">docs.npmjs.com</link><br/>'
                'Distribution NodeSource : <link href="https://github.com/nodesource/distributions" color="#5338C8">github.com/nodesource/distributions</link><br/>'
                'Documentation PM2 : <link href="https://pm2.keymetrics.io/docs/usage/quick-start/" color="#5338C8">pm2.keymetrics.io</link><br/>'
                'Documentation Baileys : <link href="https://baileys.wiki/" color="#5338C8">baileys.wiki</link>',
            ),
            callout(
                "Bestla iA",
                "Conçu pour RHAFF SERVICE. Le menu WhatsApp adopte une présentation inspirée de Levanter : en-tête système compact, puis toutes les commandes actives classées par domaine et sans descriptions latérales. Les menus se terminent par BY RHAFF SERVICE. Utilise .menu categorie pour isoler un domaine et .menu nom_commande pour afficher une fiche détaillée.",
                PURPLE,
            ),
        ]
    )
    return story


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with CATALOG_PATH.open("r", encoding="utf-8") as handle:
        catalog = json.load(handle)
    commands = catalog["commands"]
    if len(commands) < 130:
        raise RuntimeError(f"Catalogue incomplet : {len(commands)} commandes")

    doc = BestlaDocTemplate(
        str(OUTPUT_PATH),
        pagesize=A4,
        title="Bestla iA - Manuel complet",
        author="RHAFF SERVICE",
        subject="Installation GitHub et VPS Linux, panneau Bestla et commandes WhatsApp",
        creator="RHAFF SERVICE",
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=17 * mm,
    )
    story = build_story(commands)
    doc.multiBuild(story)
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
