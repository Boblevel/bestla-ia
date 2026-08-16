from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "commandes-pm2-bestla-ia.pdf"

PAGE_W, PAGE_H = A4
NAVY = HexColor("#10182B")
INK = HexColor("#17213A")
MUTED = HexColor("#64748B")
PAPER = HexColor("#F7F9FC")
CYAN = HexColor("#24D1BE")
PURPLE = HexColor("#6047D9")
PALE = HexColor("#EDF1F7")
RED = HexColor("#C63D50")
RED_PALE = HexColor("#FFF0F2")
REGULAR_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def draw_wrapped(c: canvas.Canvas, text: str, x: float, y: float, width: float, font: str, size: float, leading: float, color=INK) -> float:
    words = text.split()
    line = ""
    c.setFont(font, size)
    c.setFillColor(color)
    for word in words:
        proposal = word if not line else f"{line} {word}"
        if stringWidth(proposal, font, size) <= width:
            line = proposal
            continue
        c.drawString(x, y, line)
        y -= leading
        line = word
    if line:
        c.drawString(x, y, line)
        y -= leading
    return y


def command_card(c: canvas.Canvas, x: float, y: float, title: str, command: str, description: str, accent) -> None:
    width, height = 253, 104
    c.setFillColor(white)
    c.roundRect(x, y - height, width, height, 12, fill=1, stroke=0)
    c.setFillColor(accent)
    c.roundRect(x, y - 5, 42, 5, 2.5, fill=1, stroke=0)
    c.setFont("BestlaSansBold", 12)
    c.setFillColor(INK)
    c.drawString(x + 16, y - 24, title)
    c.setFillColor(PALE)
    c.roundRect(x + 16, y - 62, width - 32, 25, 5, fill=1, stroke=0)
    c.setFont("BestlaSansBold", 8.8)
    c.setFillColor(PURPLE)
    c.drawString(x + 25, y - 46.5, command)
    draw_wrapped(c, description, x + 16, y - 79, width - 32, "BestlaSans", 8.3, 10, MUTED)


def code_block(c: canvas.Canvas, x: float, y: float, width: float, text: str, height: float = 30) -> None:
    c.setFillColor(PALE)
    c.roundRect(x, y - height, width, height, 6, fill=1, stroke=0)
    c.setFillColor(PURPLE)
    c.setFont("BestlaSansBold", 9)
    c.drawString(x + 12, y - height + 10, text)


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont("BestlaSans", REGULAR_FONT))
    pdfmetrics.registerFont(TTFont("BestlaSansBold", BOLD_FONT))
    c = canvas.Canvas(str(OUTPUT), pagesize=A4)
    c.setTitle("Bestla iA - Commandes PM2")
    c.setAuthor("RHAFF SERVICE")
    c.setSubject("Guide rapide pour arreter, demarrer et redemarrer Bestla iA")

    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - 178, PAGE_W, 178, fill=1, stroke=0)
    c.setFillColor(CYAN)
    c.rect(42, PAGE_H - 65, 70, 6, fill=1, stroke=0)
    c.setFont("BestlaSansBold", 9)
    c.setFillColor(white)
    c.drawString(42, PAGE_H - 45, "BESTLA iA")
    c.setFillColor(CYAN)
    c.drawRightString(PAGE_W - 42, PAGE_H - 45, "RHAFF SERVICE")
    c.setFont("BestlaSansBold", 27)
    c.setFillColor(white)
    c.drawString(42, PAGE_H - 104, "Commandes PM2")
    c.setFont("BestlaSans", 11)
    c.setFillColor(HexColor("#D3D9E9"))
    c.drawString(42, PAGE_H - 128, "Arreter, demarrer et surveiller Bestla iA sur ton VPS")
    c.setFillColor(HexColor("#202B47"))
    c.circle(PAGE_W - 84, PAGE_H - 112, 55, fill=1, stroke=0)
    c.setFillColor(CYAN)
    c.circle(PAGE_W - 84, PAGE_H - 112, 34, fill=0, stroke=1)
    c.setFont("BestlaSansBold", 17)
    c.setFillColor(white)
    c.drawCentredString(PAGE_W - 84, PAGE_H - 118, "PM2")

    y = PAGE_H - 208
    c.setFont("BestlaSansBold", 13)
    c.setFillColor(INK)
    c.drawString(42, y, "Les 4 commandes essentielles")
    c.setFont("BestlaSans", 9)
    c.setFillColor(MUTED)
    c.drawRightString(PAGE_W - 42, y, "A utiliser depuis n'importe quel dossier")

    command_card(c, 42, y - 18, "Arreter le bot", "pm2 stop bestla-ia-bot", "Coupe Bestla iA sans supprimer sa configuration.", RED)
    command_card(c, 300, y - 18, "Redemarrer le bot", "pm2 restart bestla-ia-bot", "Relance Bestla iA apres un blocage ou une mise a jour.", CYAN)
    command_card(c, 42, y - 138, "Demarrer apres un arret", "pm2 start bestla-ia-bot", "Remet le bot en marche s'il est indique stopped.", PURPLE)
    command_card(c, 300, y - 138, "Verifier l'etat", "pm2 status", "Le statut doit etre online pour que le bot fonctionne.", CYAN)

    y = 396
    c.setFont("BestlaSansBold", 13)
    c.setFillColor(INK)
    c.drawString(42, y, "Suivi et maintenance")

    c.setFont("BestlaSansBold", 10.5)
    c.setFillColor(INK)
    c.drawString(42, y - 27, "Voir les journaux en direct")
    code_block(c, 42, y - 36, 511, "pm2 logs bestla-ia-bot")
    c.setFont("BestlaSans", 8.7)
    c.setFillColor(MUTED)
    c.drawString(42, y - 80, "Pour quitter les journaux sans arreter le bot : Ctrl+C")

    c.setFont("BestlaSansBold", 10.5)
    c.setFillColor(INK)
    c.drawString(42, y - 111, "Apres une modification du fichier .env")
    code_block(c, 42, y - 120, 511, "pm2 restart bestla-ia-bot --update-env")
    code_block(c, 42, y - 158, 511, "pm2 save")

    c.setFillColor(white)
    c.roundRect(42, 145, 511, 80, 10, fill=1, stroke=0)
    c.setFillColor(CYAN)
    c.rect(42, 145, 6, 80, fill=1, stroke=0)
    c.setFont("BestlaSansBold", 11)
    c.setFillColor(INK)
    c.drawString(62, 200, "Demarrage automatique apres un redemarrage du VPS")
    c.setFont("BestlaSans", 8.6)
    c.setFillColor(MUTED)
    c.drawString(62, 184, "A faire une seule fois. Copie ensuite la commande supplementaire affichee par PM2.")
    code_block(c, 62, 173, 232, "pm2 startup", 27)
    code_block(c, 309, 173, 224, "pm2 save", 27)

    c.setFillColor(RED_PALE)
    c.roundRect(42, 78, 511, 46, 9, fill=1, stroke=0)
    c.setFillColor(RED)
    c.setFont("BestlaSansBold", 9.5)
    c.drawString(58, 104, "Attention")
    c.setFont("BestlaSans", 8.5)
    c.drawString(58, 90, "N'utilise pas pm2 delete bestla-ia-bot sauf si tu veux retirer le bot de PM2.")

    c.setStrokeColor(HexColor("#D8DEE9"))
    c.line(42, 52, PAGE_W - 42, 52)
    c.setFont("BestlaSans", 7.5)
    c.setFillColor(MUTED)
    c.drawString(42, 34, "Guide rapide - Bestla iA 2.0.0")
    c.drawRightString(PAGE_W - 42, 34, "Cree pour RHAFF SERVICE")

    c.showPage()

    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - 160, PAGE_W, 160, fill=1, stroke=0)
    c.setFillColor(CYAN)
    c.rect(42, PAGE_H - 57, 60, 6, fill=1, stroke=0)
    c.setFont("BestlaSansBold", 9)
    c.setFillColor(white)
    c.drawString(42, PAGE_H - 39, "BESTLA iA")
    c.setFillColor(CYAN)
    c.drawRightString(PAGE_W - 42, PAGE_H - 39, "RHAFF SERVICE")
    c.setFont("BestlaSansBold", 25)
    c.setFillColor(white)
    c.drawString(42, PAGE_H - 96, "Bestla iA 24/7")
    c.setFont("BestlaSans", 10.5)
    c.setFillColor(HexColor("#D3D9E9"))
    c.drawString(42, PAGE_H - 120, "Faire tourner le bot meme apres un reboot du VPS")

    y = PAGE_H - 195
    c.setFillColor(PURPLE)
    c.circle(57, y - 6, 15, fill=1, stroke=0)
    c.setFont("BestlaSansBold", 12)
    c.setFillColor(white)
    c.drawCentredString(57, y - 10, "1")
    c.setFont("BestlaSansBold", 14)
    c.setFillColor(INK)
    c.drawString(84, y - 10, "Remettre le bot en ligne maintenant")
    c.setFont("BestlaSans", 8.8)
    c.setFillColor(MUTED)
    c.drawString(84, y - 28, "Utilise ceci si Bestla iA est stopped ou offline.")
    code_block(c, 84, y - 42, 469, "cd /root/bestla-ia/bestla-ia-bot")
    code_block(c, 84, y - 78, 469, "pm2 restart bestla-ia-bot --update-env")
    code_block(c, 84, y - 114, 469, "pm2 status")
    c.setFont("BestlaSans", 8.3)
    c.setFillColor(MUTED)
    c.drawString(84, y - 154, "Si PM2 dit que le bot n'existe pas, utilise plutot :")
    code_block(c, 84, y - 164, 469, "pm2 start ecosystem.config.cjs --only bestla-ia-bot --update-env")

    y = 424
    c.setFillColor(CYAN)
    c.circle(57, y - 6, 15, fill=1, stroke=0)
    c.setFont("BestlaSansBold", 12)
    c.setFillColor(NAVY)
    c.drawCentredString(57, y - 10, "2")
    c.setFont("BestlaSansBold", 14)
    c.setFillColor(INK)
    c.drawString(84, y - 10, "Activer le redemarrage automatique")
    c.setFont("BestlaSans", 8.8)
    c.setFillColor(MUTED)
    c.drawString(84, y - 28, "Cette configuration est a faire une seule fois sur le VPS.")
    code_block(c, 84, y - 42, 469, "pm2 startup")
    c.setFillColor(white)
    c.roundRect(84, y - 133, 469, 56, 8, fill=1, stroke=0)
    c.setFillColor(CYAN)
    c.rect(84, y - 133, 5, 56, fill=1, stroke=0)
    c.setFont("BestlaSansBold", 9.2)
    c.setFillColor(INK)
    c.drawString(101, y - 97, "Important : PM2 affiche une commande supplementaire.")
    c.setFont("BestlaSans", 8.2)
    c.setFillColor(MUTED)
    c.drawString(101, y - 114, "Copie-colle cette commande exacte, puis execute les deux commandes ci-dessous.")
    code_block(c, 84, y - 148, 226, "pm2 save")
    code_block(c, 327, y - 148, 226, "systemctl is-enabled pm2-root")
    c.setFont("BestlaSans", 8.2)
    c.setFillColor(MUTED)
    c.drawString(84, y - 188, "Le resultat attendu est : enabled")

    y = 202
    c.setFillColor(RED)
    c.circle(57, y - 6, 15, fill=1, stroke=0)
    c.setFont("BestlaSansBold", 12)
    c.setFillColor(white)
    c.drawCentredString(57, y - 10, "3")
    c.setFont("BestlaSansBold", 14)
    c.setFillColor(INK)
    c.drawString(84, y - 10, "Apres un redemarrage du serveur")
    c.setFont("BestlaSans", 8.8)
    c.setFillColor(MUTED)
    c.drawString(84, y - 28, "En principe, PM2 relance Bestla iA seul. Si ce n'est pas le cas :")
    code_block(c, 84, y - 42, 226, "pm2 resurrect")
    code_block(c, 327, y - 42, 226, "pm2 status")
    code_block(c, 84, y - 80, 469, "pm2 logs bestla-ia-bot --lines 30")

    c.setStrokeColor(HexColor("#D8DEE9"))
    c.line(42, 52, PAGE_W - 42, 52)
    c.setFont("BestlaSans", 7.5)
    c.setFillColor(MUTED)
    c.drawString(42, 34, "Guide PM2 - page 2 sur 2")
    c.drawRightString(PAGE_W - 42, 34, "Cree pour RHAFF SERVICE")
    c.save()


if __name__ == "__main__":
    main()
