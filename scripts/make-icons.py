"""アプリアイコン SVG を生成する（コウテイペンギンのヒナ・2 色）。
python scripts/make-icons.py  → public/icons/icon.svg
形と色は src/logo.ts と同じ。PNG (192/512) はこの SVG をブラウザで書き出したもの。"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DARK = "#0f2433"   # 頭巾・目・くちばし・足
DOWN = "#9fb3c0"   # ふわふわの体（シルバーグレー）
BG = "#eef3f6"     # 背景（白い顔は背景色の抜き）

HOOD = "M50 9C65 9 75 20 75 34C75 44 72 51 67 56C60 61 40 61 33 56C28 51 25 44 25 34C25 20 35 9 50 9Z"
FACE = "M50 32.5C46.5 25.5 38.5 23.5 33.5 28.5C29.5 33 29.5 41 32.5 47.5C35.5 54 42 58.5 50 58.5C58 58.5 64.5 54 67.5 47.5C70.5 41 70.5 33 66.5 28.5C61.5 23.5 53.5 25.5 50 32.5Z"
BODY = "M31 48C21 56 16.5 69 17.5 80.5C18.5 90.5 32 96 50 96C68 96 81.5 90.5 82.5 80.5C83.5 69 79 56 69 48C62 56 38 56 31 48Z"
FL = "M24.5 62Q14 71 13.5 83Q21 79.5 25.5 71Z"
FR = "M75.5 62Q86 71 86.5 83Q79 79.5 74.5 71Z"
FLUFF = [(19.5, 74), (19, 82), (22.5, 89), (29.5, 94), (39, 96.3), (50, 97), (61, 96.3), (70.5, 94), (77.5, 89), (81, 82), (80.5, 74)]

fluff = "".join(f'<circle cx="{x}" cy="{y}" r="4.2"/>' for x, y in FLUFF)
chick = (
    f'<defs><mask id="f" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/>'
    f'<path d="{FL}" stroke="#000" stroke-width="3.2" stroke-linejoin="round"/><path d="{FR}" stroke="#000" stroke-width="3.2" stroke-linejoin="round"/></mask></defs>'
    f'<g fill="{DOWN}"><g mask="url(#f)"><path d="{BODY}"/>{fluff}</g><path d="{FL}"/><path d="{FR}"/></g>'
    f'<g fill="{DARK}"><ellipse cx="42" cy="96.5" rx="5.5" ry="2.2"/><ellipse cx="58" cy="96.5" rx="5.5" ry="2.2"/><path d="{HOOD}"/></g>'
    f'<path d="{FACE}" fill="{BG}"/>'
    f'<g fill="{DARK}"><circle cx="41" cy="38" r="2.9"/><circle cx="59" cy="38" r="2.9"/><path d="M47.6 40.5Q50 39.3 52.4 40.5L50 46Z"/></g>'
)

# ヒナは中央 61% に収める（Android の丸形マスクでも欠けない）
icon = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="{BG}"/>
  <svg x="100" y="86" width="312" height="312" viewBox="0 0 100 100">{chick}</svg>
</svg>
"""

(ROOT / "public/icons/icon.svg").write_text(icon, encoding="utf-8")
print("ok")
