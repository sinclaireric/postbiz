"""Génère les modèles d'e-mail Supabase de docs/emails, en 14 langues : confirm-signup (inscription) et recovery (mot de passe oublié).

    python3 docs/emails/build.py              # réécrit confirm-signup.* et recovery.*
    python3 docs/emails/build.py <dossier>    # écrit aussi un aperçu HTML par langue, à ouvrir dans un navigateur

Les textes sont ici (dictionnaires S pour l'inscription, R pour le mot de passe oublié) ; les fichiers .html et .subject.txt sont générés
et se collent tels quels dans Supabase (Authentication → Emails → Templates). Voir README.md.

Mise en page reprise d'un message de confirmation Supabase (logo, titre, texte, bouton, mention « pas vous », pied de page), aux couleurs de
Postbiz. Les inscriptions du site portent `locale` et `source: web` dans les métadonnées : le modèle choisit la langue avec `locale`. Avec
`source` = web (inscription) ou une adresse de retour http… (mot de passe oublié), le lien va sur /auth/confirm du site (jeton, valable depuis
n'importe quel appareil) ; sinon (application mobile), il garde le lien par défaut de Supabase.
"""
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent
PREVIEW = Path(sys.argv[1]) if len(sys.argv) > 1 else None
if PREVIEW:
    PREVIEW.mkdir(parents=True, exist_ok=True)

# langue -> (objet, titre, texte avec {email}, bouton, « pas vous », pied de page)
S = {
"fr": ("Confirmez votre adresse e-mail pour activer votre compte Postbiz",
       "Confirmez votre adresse e-mail pour commencer avec Postbiz",
       "Vous pourrez commencer à utiliser Postbiz dès que vous aurez confirmé que {email} est bien votre adresse. Cliquez sur le bouton ci-dessous pour confirmer.",
       "Confirmer l’adresse e-mail",
       "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.",
       "Vous recevez ce message parce qu’un compte Postbiz a été créé avec cette adresse."),
"en": ("Confirm your e-mail to activate your Postbiz account",
       "Confirm your e-mail address to get started with Postbiz",
       "You can start using Postbiz right away once you’ve confirmed that {email} is your e-mail. Click the button below to confirm.",
       "Confirm e-mail address",
       "If you didn’t request this, you can safely ignore this e-mail.",
       "You’re receiving this e-mail because a Postbiz account was created with this address."),
"es": ("Confirma tu correo para activar tu cuenta de Postbiz",
       "Confirma tu correo para empezar con Postbiz",
       "Podrás empezar a usar Postbiz en cuanto confirmes que {email} es tu correo. Haz clic en el botón de abajo para confirmarlo.",
       "Confirmar correo",
       "Si no has solicitado esto, puedes ignorar este correo.",
       "Recibes este correo porque se creó una cuenta de Postbiz con esta dirección."),
"pt": ("Confirme seu e-mail para ativar sua conta Postbiz",
       "Confirme seu e-mail para começar a usar o Postbiz",
       "Você poderá começar a usar o Postbiz assim que confirmar que {email} é o seu e-mail. Clique no botão abaixo para confirmar.",
       "Confirmar e-mail",
       "Se você não solicitou isto, pode ignorar este e-mail.",
       "Você está recebendo este e-mail porque uma conta Postbiz foi criada com este endereço."),
"de": ("Bestätigen Sie Ihre E-Mail-Adresse, um Ihr Postbiz-Konto zu aktivieren",
       "Bestätigen Sie Ihre E-Mail-Adresse, um mit Postbiz zu starten",
       "Sie können Postbiz sofort nutzen, sobald Sie bestätigt haben, dass {email} Ihre E-Mail-Adresse ist. Klicken Sie dazu auf die Schaltfläche unten.",
       "E-Mail-Adresse bestätigen",
       "Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.",
       "Sie erhalten diese E-Mail, weil mit dieser Adresse ein Postbiz-Konto erstellt wurde."),
"it": ("Conferma il tuo indirizzo e-mail per attivare l’account Postbiz",
       "Conferma il tuo indirizzo e-mail per iniziare con Postbiz",
       "Potrai iniziare a usare Postbiz subito dopo aver confermato che {email} è il tuo indirizzo e-mail. Fai clic sul pulsante qui sotto per confermare.",
       "Conferma indirizzo e-mail",
       "Se non hai richiesto tu questa operazione, puoi ignorare questa e-mail.",
       "Ricevi questa e-mail perché è stato creato un account Postbiz con questo indirizzo."),
"ja": ("Postbizアカウントを有効にするため、メールアドレスをご確認ください",
       "メールアドレスを確認して、Postbizを始めましょう",
       "{email} があなたのメールアドレスであることを確認すると、すぐにPostbizをご利用いただけます。下のボタンをクリックして確認してください。",
       "メールアドレスを確認",
       "このメールに心当たりがない場合は、無視していただいて問題ありません。",
       "このメールは、このアドレスでPostbizアカウントが作成されたためお送りしています。"),
"zh": ("请确认邮箱以激活你的 Postbiz 账户",
       "确认邮箱地址,开始使用 Postbiz",
       "确认 {email} 是你的邮箱后,即可立即开始使用 Postbiz。请点击下方按钮进行确认。",
       "确认邮箱地址",
       "如果这不是你本人的操作,可以放心忽略此邮件。",
       "你收到此邮件,是因为有人使用此邮箱地址创建了 Postbiz 账户。"),
"ko": ("Postbiz 계정을 활성화하려면 이메일 주소를 확인하세요",
       "이메일 주소를 확인하고 Postbiz를 시작하세요",
       "{email} 이(가) 본인의 이메일임을 확인하시면 바로 Postbiz를 사용할 수 있습니다. 아래 버튼을 눌러 확인하세요.",
       "이메일 주소 확인",
       "본인이 요청하지 않았다면 이 이메일을 무시하셔도 됩니다.",
       "이 주소로 Postbiz 계정이 만들어져 이 이메일을 보내드립니다."),
"ar": ("أكّد بريدك الإلكتروني لتفعيل حسابك في Postbiz",
       "أكّد بريدك الإلكتروني لتبدأ مع Postbiz",
       "يمكنك البدء في استخدام Postbiz فور تأكيد أن {email} هو بريدك الإلكتروني. انقر على الزر أدناه للتأكيد.",
       "تأكيد البريد الإلكتروني",
       "إذا لم تطلب هذا، يمكنك تجاهل هذه الرسالة بأمان.",
       "تصلك هذه الرسالة لأنه تم إنشاء حساب في Postbiz بهذا العنوان."),
"he": ("אשרו את כתובת המייל כדי להפעיל את חשבון Postbiz שלכם",
       "אשרו את כתובת המייל כדי להתחיל עם Postbiz",
       "תוכלו להתחיל להשתמש ב-Postbiz מיד לאחר שתאשרו ש-{email} היא כתובת המייל שלכם. לחצו על הכפתור למטה כדי לאשר.",
       "אישור כתובת המייל",
       "אם לא ביקשתם זאת, אפשר להתעלם מהמייל הזה.",
       "קיבלתם את המייל הזה כי נוצר חשבון Postbiz עם הכתובת הזו."),
"ru": ("Подтвердите адрес e-mail, чтобы активировать аккаунт Postbiz",
       "Подтвердите адрес e-mail, чтобы начать работу с Postbiz",
       "Вы сможете сразу начать работу с Postbiz, как только подтвердите, что {email} — ваш адрес e-mail. Нажмите кнопку ниже, чтобы подтвердить.",
       "Подтвердить адрес e-mail",
       "Если вы этого не запрашивали, просто проигнорируйте это письмо.",
       "Вы получили это письмо, потому что с этим адресом был создан аккаунт Postbiz."),
"tr": ("Postbiz hesabınızı etkinleştirmek için e-posta adresinizi onaylayın",
       "Postbiz’e başlamak için e-posta adresinizi onaylayın",
       "{email} adresinin size ait olduğunu onayladığınız anda Postbiz’i kullanmaya başlayabilirsiniz. Onaylamak için aşağıdaki düğmeye tıklayın.",
       "E-posta adresini onayla",
       "Bunu siz talep etmediyseniz, bu e-postayı güvenle yok sayabilirsiniz.",
       "Bu e-postayı, bu adresle bir Postbiz hesabı oluşturulduğu için alıyorsunuz."),
"vi": ("Xác nhận email để kích hoạt tài khoản Postbiz của bạn",
       "Xác nhận địa chỉ email để bắt đầu với Postbiz",
       "Bạn có thể bắt đầu dùng Postbiz ngay khi xác nhận {email} là email của bạn. Nhấn nút bên dưới để xác nhận.",
       "Xác nhận địa chỉ email",
       "Nếu bạn không yêu cầu việc này, bạn có thể bỏ qua email này.",
       "Bạn nhận được email này vì một tài khoản Postbiz đã được tạo bằng địa chỉ này."),
}
ORDER = ["fr", "en", "es", "pt", "de", "it", "ja", "zh", "ko", "ar", "he", "ru", "tr", "vi"]
assert set(ORDER) == set(S)
FALLBACK = "en"  # langue inconnue
RTL = {"ar", "he"}

FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Ubuntu,sans-serif"
FOREST = "#0f3d2e"  # vert profond de Postbiz (bouton) ; le logo reprend le citron de la marque


def layout(lang: str, dirn: str, align: str, h1: str, intro: str, button: str, ignore: str, footer: str, link: str) -> str:
    """Le message : mêmes blocs que le modèle fourni (logo, titre, texte, bouton, mention, pied de page)."""
    return f'''<table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
  <tbody><tr>
    <td dir="{dirn}" lang="{lang}" style="font-family:{FONT};margin:0;padding:32px 16px 48px;text-align:{align}">
      <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px">
        <tbody><tr style="width:100%"><td>
          <table border="0" cellpadding="0" cellspacing="0" role="presentation">
            <tbody><tr>
              <td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;background-color:#c6f432;border-radius:11px;font-size:24px;line-height:40px;font-weight:800;color:#111110">P</td>
              <td style="padding:0 10px;font-size:22px;line-height:28px;font-weight:800;letter-spacing:-0.03em;color:#111110">postbiz</td>
            </tr></tbody>
          </table>
          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
            <tbody><tr><td style="padding-top:0;padding-bottom:32px">
              <h1 style="font-size:20px;line-height:28px;font-weight:600;color:rgb(23,23,23);margin-top:16px;margin-bottom:0">{h1}</h1>
              <p style="font-size:14px;line-height:1.625;color:rgb(23,23,23);margin-top:16px;margin-bottom:16px">{intro}</p>
              <a href="{link}" target="_blank" style="line-height:100%;text-decoration:none;display:inline-block;max-width:100%;width:auto;text-align:center;box-sizing:border-box;border-radius:0.375rem;border:1px solid {FOREST};font-size:14px;font-weight:500;background-color:{FOREST};color:#ffffff;padding:10px 16px;margin-top:20px;margin-bottom:20px"><span style="max-width:100%;display:inline-block;line-height:120%">{button}</span></a>
              <p style="font-size:14px;line-height:1.625;color:rgb(23,23,23);margin-top:16px;margin-bottom:16px">{ignore}</p>
            </td></tr></tbody>
          </table>
          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
            <tbody><tr><td>
              <hr style="width:100%;border:none;border-top:1px solid #eaeaea;margin-bottom:20px">
              <p style="font-size:12px;line-height:1.625;color:rgb(160,160,160);margin:0">Postbiz · {footer}</p>
            </td></tr></tbody>
          </table>
        </td></tr></tbody>
      </table>
    </td>
  </tr></tbody>
</table>
'''



# --- Modèle « Reset password » : mêmes blocs que la confirmation, textes de réinitialisation -------------------------
# langue -> (objet dans la langue (indicatif : l'objet réel est fr/en, 255 caractères max), titre, texte avec {email}, bouton, « pas vous », pied de page)
R = {
"fr": ("Réinitialisez votre mot de passe Postbiz",
       "Réinitialisez votre mot de passe Postbiz",
       "Nous avons reçu une demande de réinitialisation du mot de passe du compte {email}. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.",
       "Choisir un nouveau mot de passe",
       "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste inchangé.",
       "Vous recevez ce message parce qu’une réinitialisation de mot de passe a été demandée pour ce compte Postbiz."),
"en": ("Reset your Postbiz password",
       "Reset your Postbiz password",
       "We received a request to reset the password of the account {email}. Click the button below to choose a new one.",
       "Choose a new password",
       "If you didn’t request this, you can ignore this e-mail: your current password stays unchanged.",
       "You’re receiving this e-mail because a password reset was requested for this Postbiz account."),
"es": ("Restablece tu contraseña de Postbiz",
       "Restablece tu contraseña de Postbiz",
       "Hemos recibido una solicitud para restablecer la contraseña de la cuenta {email}. Haz clic en el botón de abajo para elegir una nueva.",
       "Elegir nueva contraseña",
       "Si no has solicitado esto, ignora este correo: tu contraseña actual no cambiará.",
       "Recibes este correo porque se solicitó restablecer la contraseña de esta cuenta de Postbiz."),
"pt": ("Redefina sua senha do Postbiz",
       "Redefina sua senha do Postbiz",
       "Recebemos um pedido para redefinir a senha da conta {email}. Clique no botão abaixo para escolher uma nova.",
       "Escolher nova senha",
       "Se você não solicitou isto, ignore este e-mail: sua senha atual continua a mesma.",
       "Você está recebendo este e-mail porque foi solicitada a redefinição da senha desta conta Postbiz."),
"de": ("Setzen Sie Ihr Postbiz-Passwort zurück",
       "Setzen Sie Ihr Postbiz-Passwort zurück",
       "Wir haben eine Anfrage erhalten, das Passwort des Kontos {email} zurückzusetzen. Klicken Sie unten auf die Schaltfläche, um ein neues zu wählen.",
       "Neues Passwort wählen",
       "Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail: Ihr aktuelles Passwort bleibt unverändert.",
       "Sie erhalten diese E-Mail, weil für dieses Postbiz-Konto ein Zurücksetzen des Passworts angefordert wurde."),
"it": ("Reimposta la password di Postbiz",
       "Reimposta la password di Postbiz",
       "Abbiamo ricevuto una richiesta di reimpostazione della password dell’account {email}. Fai clic sul pulsante qui sotto per sceglierne una nuova.",
       "Scegli una nuova password",
       "Se non hai richiesto tu questa operazione, ignora questa e-mail: la tua password attuale resta invariata.",
       "Ricevi questa e-mail perché è stata richiesta la reimpostazione della password di questo account Postbiz."),
"ja": ("Postbizのパスワードを再設定",
       "Postbizのパスワードを再設定",
       "アカウント {email} のパスワード再設定のリクエストを受け付けました。下のボタンをクリックして、新しいパスワードを設定してください。",
       "新しいパスワードを設定",
       "このメールに心当たりがない場合は無視してください。現在のパスワードは変更されません。",
       "このメールは、このPostbizアカウントのパスワード再設定がリクエストされたためお送りしています。"),
"zh": ("重置你的 Postbiz 密码",
       "重置你的 Postbiz 密码",
       "我们收到了重置账户 {email} 密码的请求。请点击下方按钮设置新密码。",
       "设置新密码",
       "如果这不是你本人的操作,请忽略此邮件,你当前的密码不会改变。",
       "你收到此邮件,是因为有人请求重置此 Postbiz 账户的密码。"),
"ko": ("Postbiz 비밀번호 재설정",
       "Postbiz 비밀번호 재설정",
       "{email} 계정의 비밀번호 재설정 요청을 받았습니다. 아래 버튼을 눌러 새 비밀번호를 설정하세요.",
       "새 비밀번호 설정",
       "본인이 요청하지 않았다면 이 이메일을 무시하세요. 현재 비밀번호는 그대로 유지됩니다.",
       "이 Postbiz 계정의 비밀번호 재설정이 요청되어 이 이메일을 보내드립니다."),
"ar": ("إعادة تعيين كلمة مرور Postbiz",
       "إعادة تعيين كلمة مرور Postbiz",
       "تلقينا طلبًا لإعادة تعيين كلمة مرور الحساب {email}. انقر على الزر أدناه لاختيار كلمة مرور جديدة.",
       "اختيار كلمة مرور جديدة",
       "إذا لم تطلب هذا، تجاهل هذه الرسالة: ستبقى كلمة مرورك الحالية كما هي.",
       "تصلك هذه الرسالة لأنه تم طلب إعادة تعيين كلمة مرور حساب Postbiz هذا."),
"he": ("איפוס הסיסמה ל-Postbiz",
       "איפוס הסיסמה ל-Postbiz",
       "קיבלנו בקשה לאיפוס הסיסמה של החשבון {email}. לחצו על הכפתור למטה כדי לבחור סיסמה חדשה.",
       "בחירת סיסמה חדשה",
       "אם לא ביקשתם זאת, התעלמו מהמייל הזה: הסיסמה הנוכחית שלכם תישאר ללא שינוי.",
       "קיבלתם את המייל הזה כי התבקש איפוס סיסמה לחשבון Postbiz הזה."),
"ru": ("Сброс пароля Postbiz",
       "Сброс пароля Postbiz",
       "Мы получили запрос на сброс пароля для аккаунта {email}. Нажмите кнопку ниже, чтобы задать новый пароль.",
       "Задать новый пароль",
       "Если вы этого не запрашивали, просто проигнорируйте письмо: ваш текущий пароль не изменится.",
       "Вы получили это письмо, потому что для этого аккаунта Postbiz был запрошен сброс пароля."),
"tr": ("Postbiz şifrenizi sıfırlayın",
       "Postbiz şifrenizi sıfırlayın",
       "{email} hesabının şifresini sıfırlama talebi aldık. Yeni bir şifre belirlemek için aşağıdaki düğmeye tıklayın.",
       "Yeni şifre belirle",
       "Bunu siz talep etmediyseniz bu e-postayı yok sayın: mevcut şifreniz değişmeden kalır.",
       "Bu e-postayı, bu Postbiz hesabı için şifre sıfırlama talep edildiği için alıyorsunuz."),
"vi": ("Đặt lại mật khẩu Postbiz của bạn",
       "Đặt lại mật khẩu Postbiz của bạn",
       "Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản {email}. Nhấn nút bên dưới để chọn mật khẩu mới.",
       "Chọn mật khẩu mới",
       "Nếu bạn không yêu cầu việc này, hãy bỏ qua email này: mật khẩu hiện tại của bạn vẫn giữ nguyên.",
       "Bạn nhận được email này vì có yêu cầu đặt lại mật khẩu cho tài khoản Postbiz này."),
}
assert set(R) == set(S)


# --- Génération (langage de modèles de Go) --------------------------------------------------------------------------
EMAIL_GO = '<strong dir="ltr" style="font-weight:600">{{ .Email }}</strong>'
SUBJECT_MAX = 255  # limite de Supabase pour l'objet : pas de chaîne de 14 langues, français ou anglais seulement
RTL_SETUP = '{{- $rtl := or (eq $l "ar") (eq $l "he") -}}\n'
LANG_SETUP = '{{- $l := "fr" }}{{ with .Data }}{{ with .locale }}{{ $l = . }}{{ end }}{{ end -}}\n'

# Inscription : le site ajoute `source: web` aux métadonnées. Le texte du commentaire reste celui déjà collé dans Supabase.
SIGNUP_SETUP = (
    '{{- /* Langue : `locale` des métadonnées (français si absente). Lien : /auth/confirm du site pour les inscriptions web, lien Supabase par défaut sinon. */ -}}\n'
    + LANG_SETUP
    + '{{- $web := false }}{{ with .Data }}{{ with .source }}{{ if eq . "web" }}{{ $web = true }}{{ end }}{{ end }}{{ end -}}\n'
    + RTL_SETUP
)
# Réinitialisation : `resetPasswordForEmail` ne porte pas de métadonnées ; on reconnaît le site à l'adresse de retour
# (http… pour le site, un lien d'application pour le mobile, qui garde alors le lien par défaut de Supabase).
RECOVERY_SETUP = (
    '{{- /* Langue : `locale` des métadonnées (français si absente). Lien : /auth/confirm du site si l\'adresse de retour est une adresse web (http…), lien Supabase par défaut sinon (application mobile). */ -}}\n'
    + LANG_SETUP
    + '{{- $web := false }}{{ if gt (len .RedirectTo) 4 }}{{ if eq (slice .RedirectTo 0 4) "http" }}{{ $web = true }}{{ end }}{{ end -}}\n'
    + RTL_SETUP
)


def link_go(kind: str) -> str:
    return '{{ if $web }}{{ $.SiteURL }}/auth/confirm?token_hash={{ $.TokenHash }}&type=' + kind + '{{ else }}{{ $.ConfirmationURL }}{{ end }}'


def build(name: str, texts: dict, setup: str, kind: str, subject_fr: str, subject_en: str) -> None:
    def pick(index: int) -> str:
        branches = []
        for loc in ORDER:
            if loc == FALLBACK:
                continue
            branches.append(("{{ if" if not branches else "{{ else if") + f' eq $l "{loc}" }}}}{texts[loc][index].replace("{email}", EMAIL_GO)}')
        return "".join(branches) + "{{ else }}" + texts[FALLBACK][index].replace("{email}", EMAIL_GO) + "{{ end }}"

    template = setup + layout(
        lang="{{ $l }}", dirn="{{ if $rtl }}rtl{{ else }}ltr{{ end }}", align="{{ if $rtl }}right{{ else }}left{{ end }}",
        h1=pick(1), intro=pick(2), button=pick(3), ignore=pick(4), footer=pick(5), link=link_go(kind),
    )
    (DOCS / f"{name}.html").write_text(template, encoding="utf-8")

    subject = (
        '{{ $l := "fr" }}{{ with .Data }}{{ with .locale }}{{ $l = . }}{{ end }}{{ end }}'
        f'{{{{ if eq $l "fr" }}}}{subject_fr}{{{{ else }}}}{subject_en}{{{{ end }}}}'
    )
    assert "<strong" not in subject and "\n" not in subject
    assert len(subject) <= SUBJECT_MAX, f"{name} : objet trop long ({len(subject)} caractères, max {SUBJECT_MAX})"
    (DOCS / f"{name}.subject.txt").write_text(subject + "\n", encoding="utf-8")

    for label, text in (("corps", template), ("objet", subject)):
        opens = text.count("{{ if") + text.count("{{- if")
        withs = text.count("{{ with")
        ends = text.count("{{ end }}") + text.count("{{ end -}}")
        print(f"{name:15s} {label:5s} if:{opens:3d} with:{withs} end:{ends:3d} → {'équilibré' if opens + withs == ends else 'À VÉRIFIER'}"
              + (f" ; {len(subject)} caractères (max {SUBJECT_MAX})" if label == "objet" else ""))

    if not PREVIEW:
        return
    sample = "lea@atelier-nova.fr"
    for loc in ORDER:
        _, h1, intro, button, ignore, footer = texts[loc]
        intro = intro.replace("{email}", f'<strong dir="ltr" style="font-weight:600">{sample}</strong>')
        rtl = loc in RTL
        body = layout(loc, "rtl" if rtl else "ltr", "right" if rtl else "left", h1, intro, button, ignore, footer, "#")
        (PREVIEW / f"{name}-{loc}.html").write_text(
            f'<!doctype html><html lang="{loc}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{name} {loc}</title></head><body style="margin:0;background:#fff">{body}</body></html>',
            encoding="utf-8")


build("confirm-signup", S, SIGNUP_SETUP, "email", "Confirmez votre adresse e-mail pour Postbiz", "Confirm your e-mail address for Postbiz")
build("recovery", R, RECOVERY_SETUP, "recovery", "Réinitialisez votre mot de passe Postbiz", "Reset your Postbiz password")
print("ok" + (f" : {len(ORDER)} aperçus par modèle dans {PREVIEW}" if PREVIEW else ""))
