import type { Messages } from "../catalog";

/**
 * Türkçe metinler. Şekli İngilizce katalogla (en.ts) aynı olmak zorundadır:
 * eksik ya da fazla bir anahtar `tsc` hatası verir.
 *
 * Komut paletinde arama hem Türkçe hem de yaygın İngilizce teknik terimlerle
 * çalışsın diye `keywords` alanları iki dili birlikte içerir.
 */
export const tr: Messages = {
  common: {
    loading: "Yükleniyor…",
    pleaseWait: "Lütfen bekleyin…",
    saving: "Kaydediliyor…",
    sending: "Gönderiliyor…",
    retry: "Yeniden dene",
    retryLoading: "({what} yüklenemedi)",
    tryAgain: "Tekrar dene",
    reload: "Sayfayı yenile",
    cancel: "İptal",
    logIn: "Giriş yap",
    logOut: "Çıkış yap",
    signOut: "Oturumu kapat",
    email: "E-posta",
    username: "Kullanıcı adı",
    password: "Parola",
    or: "veya",
    empty: "Burada henüz bir şey yok.",
    results: { "=0": "Sonuç yok", one: "{count} sonuç", other: "{count} sonuç" },
  },

  errors: {
    sessionExpired: "Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.",
    noWorkspace: "Henüz bir çalışma alanınız yok.",
    confirmEmail: "Devam etmek için e-posta adresinizi doğrulayın.",
    requestFailed: "İstek başarısız oldu ({status})",
    forbidden: "Bu işlem için yetkiniz yok.",
    notFound: "Aradığınızı bulamadık.",
    crashTitle: "Bu sayfada beklenmeyen bir hata oluştu",
    crashBody:
      "Uygulamanın geri kalanı çalışmaya devam ediyor. Menüden başka bir sayfa seçin ya da sayfayı yenileyip tekrar deneyin.",
  },

  shell: {
    tagline: "Kontrol Merkezi",
    mainNav: "Ana menü",
    toggleNav: "Menüyü aç/kapat",
    openPalette: "Komut paletini aç",
    searchOrJump: "Ara ya da bir sayfaya git…",
    tabsLabel: "{group} bölümleri",
    breadcrumb: "Bulunduğunuz yer",
  },

  access: {
    forbiddenTitle: "Bu sayfaya erişiminiz yok",
    forbiddenBody: "Bu sayfa {audience} açık.",
    audience: {
      members: "bu kuruluşun üyelerine",
      orgAdmins: "kuruluş sahiplerine ve yöneticilerine",
      teamAdmins: "ekibin yöneticilerine",
      billing: "bu kuruluşun faturalandırmasını görebilen kişilere",
      platformAdmins: "platform yöneticilerine",
    },
    requestAccess: "Erişim iste",
    requestAccessSoon: "Erişim istekleri yakında geliyor. O zamana kadar bir kuruluş yöneticisine başvurun.",
    signInTitle: "Devam etmek için giriş yapın",
    signInBody: "Bu sayfayı görmek için giriş yapmanız gerekiyor.",
    backHome: "Ana sayfaya dön",
  },

  notFound: {
    title: "Sayfa bulunamadı",
    body: "{path} adresinde bir sayfa yok. Sayfa taşınmış ya da bağlantı yanlış olabilir.",
    search: "Sayfalarda ara",
    backHome: "Ana sayfaya dön",
  },

  theme: {
    system: "Sistem",
    light: "Açık",
    dark: "Koyu",
    matchSystem: "Sistemle aynı",
    toggleTitle: "Tema: {theme} (değiştirmek için tıklayın)",
    toggleLabel: "Tema: {theme}. Değiştirmek için tıklayın.",
  },

  palette: {
    dialog: "Komut paleti",
    search: "Sayfalarda ve eylemlerde ara",
    placeholder: "Sayfalarda ve eylemlerde ara…",
    results: "Sonuçlar",
    noMatches: "“{query}” için eşleşme bulunamadı.",
    goTo: "{group} bölümüne git",
    escape: "Esc",
    groupActions: "Eylemler",
    groupKnowledgeBase: "Bilgi tabanı",
    groupPipeline: "İşlem hattı",
    groupPlugin: "Eklenti",
    openInKnowledgeBases: "Bilgi tabanlarında aç",
    openInPipelines: "İşlem hatlarında aç",
    openInDiscoverPlugins: "Eklenti keşfinde aç",
    actions: {
      ask: { label: "Soru sor", sublabel: "Bilgi tabanlarınızı sorgulayın", keywords: "sohbet soru sorgu chat rag query" },
      kb: { label: "Yeni bilgi tabanı", sublabel: "Belge yükleyin", keywords: "oluştur ekle yükle create add upload" },
      pipeline: { label: "Yeni işlem hattı", sublabel: "Bilgi tabanlarını birleştirin", keywords: "oluştur ekle pipeline create add" },
      model: { label: "Model indir", sublabel: "Ollama model yaşam döngüsü", keywords: "indir kur model download install ollama" },
      theme: { label: "Temayı değiştir", sublabel: "Sistem / açık / koyu", keywords: "karanlık aydınlık mod görünüm dark light theme" },
    },
  },

  nav: {
    tabInGroup: "{group}: {tab}",
    sections: {
      overview: "Genel",
      knowledge: "Bilgi",
      marketplace: "Pazar yeri",
      ai: "Yapay zekâ ve sistem",
      team: "Ekip",
      account: "Hesabım",
      organization: "Kuruluş",
      platform: "Platform",
    },
    items: {
      home: { label: "Ana sayfa", description: "Çalışma alanınıza bir bakışta göz atın", keywords: "pano özet başlangıç dashboard home" },
      ask: { label: "Sor", description: "Bilgi tabanlarınızla sohbet edin", keywords: "sohbet soru sorgu yanıt chat ask rag" },
      knowledgeBases: { label: "Bilgi tabanları", description: "Belgelerinizi yükleyin ve yönetin", keywords: "belgeler dosyalar yükle kb documents upload" },
      pipelines: { label: "İşlem hatları", description: "Belgeleriniz üzerinde soru yanıtlamayı kurun", keywords: "erişim sorgu pipeline retrieval hyde self-rag" },
      conversations: { label: "Sohbetler", description: "Geçmiş sohbetlerinize dönün", keywords: "geçmiş konuşmalar history chat" },
      publicChat: { label: "Herkese açık sohbet", description: "Bir işlem hattı üzerinde herkese açık sohbet botu yayınlayın (yönetici)", keywords: "herkese açık sohbet botu widget gömme paylaş anonim public chatbot embed" },
      knowledgeGraph: { label: "Bilgi grafiği", description: "Belgelerinizden çıkan varlıklar, kategoriler ve birleştirmeler", keywords: "varlıklar ilişkiler sınıflandırma kategoriler birleştirme neo4j graph taxonomy same_as" },
      graph: { label: "Grafik", description: "Varlıklar ve aralarındaki bağlantılar" },
      taxonomyReview: { label: "Sınıflandırma incelemesi", description: "Yapay zekânın önerdiği varlık kategorilerini onaylayın" },
      entityMerges: { label: "Varlık birleştirme incelemesi", description: "Kuruluşlar arası SAME_AS varlık bağlantılarını onaylayın (çift onay)" },
      discover: { label: "Keşfet", description: "Eklenecek eklentileri, yapay zekâ araçlarını ve hizmet paketlerini bulun", keywords: "pazar yeri katalog mağaza kur eklenti marketplace catalog store install" },
      discoverPlugins: { label: "Eklentiler", title: "Eklentileri keşfet", description: "Kaynağa göre filtrelenebilen eklenti kataloğu", keywords: "eklenti bağlayıcı kaynak birinci taraf özel git plugin mindhub" },
      discoverAiTools: { label: "Yapay zekâ araçları", title: "Yapay zekâ araçlarını keşfet", description: "Eklentilerin sunduğu tüm yapay zekâ araçları, çalışsın ya da çalışmasın", keywords: "yapay zeka araç fonksiyon çağırma ai tool function calling ollama" },
      discoverServiceBundles: { label: "Hizmet paketleri", title: "Hizmet paketlerini keşfet", description: "Açabileceğiniz hizmet paketleri", keywords: "paket hizmetler yetenekler izleme çıkarım ses bundle services" },
      installed: { label: "Kurulu", description: "Bu kurulumdaki her şey: sürüm, sağlık durumu ve ayarlar", keywords: "çalışan etkin yönet yapılandır installed running manage" },
      installedPlugins: { label: "Eklentiler", title: "Kurulu eklentiler", description: "Bu kurulumda çalışanlar ve sizin kurduklarınız", keywords: "eklenti çalışan sürüm sağlık ayarlar etkinleştir devre dışı bırak kaldır plugin uninstall" },
      installedAiTools: { label: "Yapay zekâ araçları", title: "Kurulu yapay zekâ araçları", description: "Asistanın şu anda çağırabildiği yapay zekâ araçları", keywords: "yapay zeka araç canlı fonksiyon çağırma ai tool" },
      installedServiceBundles: { label: "Hizmet paketleri", title: "Kurulu hizmet paketleri", description: "Açık hizmet paketleri, imajları, dışa ve içe aktarma", keywords: "paket hizmetler dışa aktar içe aktar bundle export import docker" },
      publish: { label: "Yayınla", description: "Kendi eklentilerinizi gönderin; gönderimleri inceleyin (yönetici)", keywords: "yayınla geliştirici eklenti publish developer" },
      submissions: { label: "Gönderimler", title: "Eklenti gönderimleri", description: "Bir eklenti gönderin ve incelemesini takip edin", keywords: "gönder taslak yükle submit draft" },
      submissionReview: { label: "Gönderim incelemesi", title: "Gönderim incelemesi", description: "Gönderilen eklentileri onaylayın ya da reddedin (yönetici)", keywords: "inceleme kuyruk onayla reddet denetim review approve reject" },
      models: { label: "Modeller", description: "Yerel dil modelleri (Ollama): indirin, deneyin, kaldırın", keywords: "model indir dil modeli ollama llm pull" },
      providers: { label: "Sağlayıcılar ve varsayılanlar", description: "Görev başına varsayılan modeller; OpenAI uyumlu ya da Anthropic sağlayıcıları bağlayın (yönetici)", keywords: "sağlayıcı bulut api anahtarı kimlik bilgisi varsayılan model openai anthropic provider" },
      voice: { label: "Ses", description: "Metinden sese ve sesten metne", keywords: "ses konuşma yazıya dökme tts stt piper speech" },
      backups: { label: "Yedekler", description: "Platformun anlık görüntüsünü alın ve geri yükleyin", keywords: "yedek geri yükle arşiv anlık görüntü backup restore snapshot" },
      status: { label: "Durum", description: "Hizmetlerin sağlık durumu ve son günlükler", keywords: "sağlık hizmetler çalışma süresi günlük kayıt health logs status" },
      orgOverview: { label: "Genel bakış", description: "Kuruluşunuz, davetleri ve kuruluş değiştirme", keywords: "kuruluş çalışma alanı değiştir davetler organization workspace invites" },
      orgUsers: { label: "Kullanıcılar", description: "Bu kuruluşun üyeleri: roller, askıya alma, çıkarma, hesap sıfırlama", keywords: "kullanıcılar üyeler kişiler hesaplar askıya al çıkar parola sıfırla roller users members" },
      billing: { label: "Faturalandırma", title: "Faturalandırma", description: "Planınız, aboneliğiniz ve yükseltmeler", keywords: "abonelik plan yükselt ödeme fiyat fatura billing upgrade invoice" },
      licenses: { label: "Lisanslar", title: "Eklenti lisansları", description: "Hesabınıza lisanslanan eklenti seviyeleri (yalnızca görüntüleme)", keywords: "lisanslarım seviye eklenti licenses tier" },
      account: { label: "Profil ve ayarlar", description: "Profiliniz, parolanız ve tercihleriniz", keywords: "hesap profil parola ayarlar tercihler account profile password settings" },
      teams: { label: "Ekipler", description: "Kişileri gruplayın ve kaynakları paylaşın", keywords: "ekip grup üyeler paylaşım iş birliği teams groups" },
      allOrganizations: { label: "Tüm kuruluşlar", description: "Bu kurulumdaki tüm kuruluşlar ve oluşturma (yönetici)", keywords: "kuruluşlar oluştur yönetici organizations tenants provision" },
      allUsers: { label: "Tüm kullanıcılar", description: "Kurulumdaki tüm hesaplar, kuruluşlar genelinde (platform yöneticisi)", keywords: "kullanıcılar hesaplar roller platform yöneticisi users accounts admin" },
      audit: { label: "Denetim kaydı", description: "Yetkili işlemlerin yalnızca eklenebilen kaydı (yönetici)", keywords: "denetim kayıt güvenlik geçmiş kim ne yaptı audit log siem" },
      sources: { label: "MindHub ve kaynaklar", title: "MindHub ve kaynaklar", description: "Bu kurulumun eklentilerinin geldiği yerler (operatörler)", keywords: "kaynaklar eklenti kaynak depoları git özel yansı bağlan operatör mindhub sources repositories" },
    },
  },

  auth: {
    login: {
      titleLogin: "Giriş yap",
      titleRegister: "Hesap oluştur",
      introLogin:
        "Değişiklik yapmak için Minder hesabınızla giriş yapın. Göz atmak için giriş yapmanız gerekmez.",
      introRegister: "Yerel bir Minder hesabı oluşturun, ardından oturumunuz açılır.",
      forgotLink: "Parolanızı mı unuttunuz?",
      forgotAskAdmin: "Parolanızı mı unuttunuz? Sıfırlaması için yöneticinize başvurun.",
      submitRegister: "Hesap oluştur ve giriş yap",
      inviteOnly:
        "Henüz hesabınız yok mu? Bu kurulumda hesaplar davetle oluşturulur. Davet aldıysanız davetinizdeki bağlantıyı açın. Almadıysanız kuruluşunuzun bir yöneticisinden sizi davet etmesini isteyin.",
      ssoOnly: "Henüz hesabınız yok mu? Bu kurulumda kayıt kapalı.",
      ssoOnlyUseSso: "Aşağıdan SSO ile giriş yapın; hesabınız ilk girişinizde oluşturulur.",
      ssoOnlyAskAdmin: "Sizin için bir hesap oluşturması için bir yöneticiye başvurun.",
      noAccount: "Henüz hesabınız yok mu?",
      createOne: "Hesap oluşturun",
      haveAccount: "Zaten hesabınız var mı?",
      ssoButton: "SSO ile giriş yap (Authelia)",
      ssoNeedsDomain:
        "SSO için Minder'e, gerçek bir alan adı ve TLS ile Traefik ana bilgisayar adı üzerinden erişmeniz gerekir.",
      ssoResetNote: "SSO hesapları parolalarını kimlik sağlayıcılarında sıfırlar.",
    },
    callback: {
      completing: "Giriş tamamlanıyor…",
      incomplete: "Giriş tamamlanamadı. Lütfen tekrar deneyin.",
    },
    forgot: {
      title: "Parolanızı sıfırlayın",
      intro:
        "Minder hesabınızın e-posta adresini girin; yeni bir parola belirlemeniz için size bir bağlantı gönderelim.",
      askAdmin:
        "Bu sunucuda e-postayla parola sıfırlama kullanılamıyor. Parolanızı sıfırlaması için yöneticinize başvurun.",
      ssoNote:
        "SSO ile giriş yapıyorsanız parolanızı kimlik sağlayıcınız yönetir; sıfırlamayı orada yapın. Buradan bağlantı istemek, SSO hesabına sıfırlama bağlantısı yerine bir hatırlatma e-postası gönderir.",
      backToLogin: "Giriş sayfasına dön",
    },
    resetRequest: {
      sent:
        "Bu adrese ait bir hesap varsa parolanızı sıfırlamanız için bir bağlantı gönderdik. Gelen kutunuzu ve istenmeyen e-posta klasörünüzü kontrol edin. Bağlantı yalnızca bir kez çalışır ve bir saat içinde geçerliliğini yitirir.",
      rateLimited: "Çok fazla istek gönderildi. Bir dakika bekleyip tekrar deneyin.",
      invalidEmail: "Geçerli bir e-posta adresi girin.",
      failed: "İstek şu anda gönderilemedi. Daha sonra tekrar deneyin.",
      submit: "Sıfırlama bağlantısı gönder",
    },
    reset: {
      title: "Yeni bir parola belirleyin",
      done: "Parolanız sıfırlandı. Yeni parolanızla giriş yapın.",
      hint:
        "En az {min} karakter kullanın. Sınır {max} bayttır: bu, {max} sade harf ya da rakam demektir; aksanlı harfler veya emoji kullanırsanız daha azdır.",
      tooLong:
        "Bu parola çok uzun. {max} baytın altında tutun: aksanlı harfler, diğer alfabeler ve emojiler 2 ile 4 bayt arasında yer kaplar.",
      tooShort: {
        one: "Parola en az {count} karakter olmalıdır.",
        other: "Parola en az {count} karakter olmalıdır.",
      },
      mismatch: "Girdiğiniz iki parola eşleşmiyor.",
      rateLimited: "Çok fazla deneme yapıldı. Bir dakika bekleyip tekrar deneyin.",
      rejected:
        "Sunucu bu parolayı kabul etmedi. En az {min} karakter ve en fazla {max} bayt kullanın.",
      failed: "Parola şu anda sıfırlanamadı. Daha sonra tekrar deneyin.",
      expired:
        "Bu sıfırlama bağlantısı geçersiz ya da süresi dolmuş. Her bağlantı yalnızca bir kez ve sınırlı bir süre için çalışır; yeni bir bağlantı istemek eskilerini iptal eder. Aşağıdan kendinize yeni bir bağlantı gönderin.",
      newLink: "Bana yeni bir bağlantı gönder",
      needsLink: "Bu sayfa, parola sıfırlama e-postasındaki bağlantıyla açılmalıdır.",
      requestNewLink: "Yeni bağlantı iste",
      signedIn: "Oturumunuz açık.",
      signedInAs: "{username} olarak oturum açtınız.",
      signOutFirst:
        "Parola sıfırlamak o hesabın tüm oturumlarını kapatır; devam etmek için önce oturumu kapatın.",
      signOutAndContinue: "Oturumu kapat ve devam et",
      newPassword: "Yeni parola",
      confirmPassword: "Yeni parola (tekrar)",
      showPasswords: "Parolaları göster",
      hidePasswords: "Parolaları gizle",
      submit: "Yeni parolayı kaydet",
    },
    forceChange: {
      title: "Parolanızı değiştirin",
      subtitle: "Bir yönetici parolanızı sıfırladı. Devam etmek için yeni bir parola seçin.",
      callout:
        "Mevcut parola olarak yöneticinizin size verdiği parolayı girin, ardından yalnızca sizin bildiğiniz yeni bir parola seçin.",
    },
  },

  organization: {
    defaultLanguage: {
      heading: "Varsayılan dil",
      label: "Üyeler için varsayılan dil",
      none: "Yok (her üyenin tarayıcı dili)",
      hint: "Kendi ayarlarında bir dil seçmemiş üyeler Minder'i bu dilde görür.",
      saved: "Varsayılan dil kaydedildi.",
      saveFailed: "Varsayılan dil kaydedilemedi, önceki değere geri dönüldü. {error}",
    },
  },

  publicChat: {
    apiAddressLabel: "API adresi (geliştiriciler için)",
    apiAddressHint: "Ziyaretçi sohbet sayfası ve yerleştirme kodu yakında geliyor.",
    copyApiAddress: "API adresini kopyala",
  },

  settings: {
    title: "Ayarlar",
    intro: "Minder'in şu anda gördüğü hâliyle hesabınız.",
    account: "Hesap",
    role: "Rol",
    identityNote:
      "Authelia SSO ya da yerel bir Minder hesabıyla oturum açtınız. Yerel hesaplar parolalarını aşağıdan değiştirebilir; SSO hesaplarında parolanızı veya grup üyeliğinizi {portal} üzerinden değiştirin. SSO girişlerinde kimliğinizin asıl kaynağı burası değil, orasıdır.",
    portalLink: "Authelia'nın kendi portalı",
    portalPlain: "kimlik sağlayıcınızın portalı (Authelia)",
    profile: {
      heading: "Minder profili",
      intro:
        "Minder'e özgü kişisel tercihleriniz; yukarıdaki Authelia kimliğinizden ayrıdır. Hesabınıza kaydedilir, böylece tüm cihazlarınızda geçerli olur.",
      displayName: "Görünen ad",
      displayNameHint:
        "Minder'in arayüzünde size nasıl hitap edileceği. Kullanıcı adınızı ({username}) kullanmak için boş bırakın. Authelia kimliğinizi değiştirmez.",
      theme: "Tema",
      themeHint: "Hemen uygulanır ve hesabınızda hatırlanır.",
      saved: "Profil kaydedildi.",
      save: "Profili kaydet",
    },
    language: {
      heading: "Dil",
      label: "Arayüz dili",
      hint: "Hemen uygulanır ve hesabınıza kaydedilir; böylece tüm cihazlarınızda geçerli olur.",
      saveFailed: "Dil tercihiniz kaydedilemedi, önceki dile geri dönüldü. {error}",
    },
    password: {
      heading: "Parolayı değiştir",
      intro:
        "Yerel Minder hesapları içindir. Authelia SSO ile giriş yapan hesaplar parolalarını Authelia portalında değiştirir.",
      current: "Mevcut parola",
      new: "Yeni parola",
      confirm: "Yeni parola (tekrar)",
      minHint: { one: "En az {count} karakter.", other: "En az {count} karakter." },
      tooShort: {
        one: "Yeni parola en az {count} karakter olmalıdır.",
        other: "Yeni parola en az {count} karakter olmalıdır.",
      },
      mismatch: "Yeni parolalar eşleşmiyor.",
      unchanged: "Yeni parola mevcut paroladan farklı olmalıdır.",
      changed: "Parola değiştirildi.",
      changing: "Değiştiriliyor…",
      submit: "Parolayı değiştir",
    },
  },
};
