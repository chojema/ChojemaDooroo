import type { Lang } from '@genoffice/i18n'

/** "Attach from Drive" in every editor's AI panel (decision 0033) */
export interface DriveAttachStrings {
  label: string
  /** {n}: files left out (a format no editor reads, or past 20) */
  skipped: string
  /** {n}: files Drive did not hand over */
  failed: string
  disconnected: string
  busy: string
}

export const DRIVE_ATTACH_STRINGS: Record<Lang, DriveAttachStrings> = {
  zh: {
    label: '从 Google 云端硬盘附加',
    skipped: '{n} 个文件未附加（无法读取的格式，或超过 20 个）',
    failed: '{n} 个文件未能从云端硬盘获取',
    disconnected: 'Google 云端硬盘已断开连接',
    busy: '云端硬盘选择窗口已经打开',
  },
  en: {
    label: 'Attach from Google Drive',
    skipped: 'Not attached: {n} (a format that cannot be read, or past 20 files)',
    failed: 'Could not get from Drive: {n}',
    disconnected: 'Google Drive is disconnected',
    busy: 'The Drive window is already open',
  },
  ja: {
    label: 'Google ドライブから添付',
    skipped: '{n} 件は添付しませんでした（読めない形式か、20 件を超えています）',
    failed: '{n} 件はドライブから取得できませんでした',
    disconnected: 'Google ドライブとの接続が切れています',
    busy: 'ドライブの選択ウィンドウはすでに開いています',
  },
  ko: {
    label: 'Google 드라이브에서 첨부',
    skipped: '{n}개는 첨부하지 않았습니다(읽을 수 없는 형식이거나 20개를 넘음)',
    failed: '{n}개는 드라이브에서 받지 못했습니다',
    disconnected: 'Google 드라이브 연결이 끊겼습니다',
    busy: '드라이브 고르기 창이 이미 열려 있습니다',
  },
  fr: {
    label: 'Joindre depuis Google Drive',
    skipped: '{n} fichiers non joints (format illisible, ou plus de 20)',
    failed: '{n} fichiers n’ont pas pu être récupérés depuis Drive',
    disconnected: 'Google Drive est déconnecté',
    busy: 'La fenêtre Drive est déjà ouverte',
  },
  de: {
    label: 'Aus Google Drive anhängen',
    skipped: '{n} Dateien nicht angehängt (nicht lesbares Format oder mehr als 20)',
    failed: '{n} Dateien konnten nicht aus Drive geholt werden',
    disconnected: 'Google Drive ist getrennt',
    busy: 'Das Drive-Fenster ist bereits geöffnet',
  },
  es: {
    label: 'Adjuntar desde Google Drive',
    skipped: '{n} archivos no se adjuntaron (formato ilegible o más de 20)',
    failed: 'No se pudieron obtener {n} archivos de Drive',
    disconnected: 'Google Drive está desconectado',
    busy: 'La ventana de Drive ya está abierta',
  },
  th: {
    label: 'แนบจาก Google ไดรฟ์',
    skipped: 'ไม่ได้แนบ {n} ไฟล์ (รูปแบบที่อ่านไม่ได้ หรือเกิน 20 ไฟล์)',
    failed: 'ดึง {n} ไฟล์จากไดรฟ์ไม่สำเร็จ',
    disconnected: 'Google ไดรฟ์ถูกตัดการเชื่อมต่อ',
    busy: 'หน้าต่างเลือกไฟล์จากไดรฟ์เปิดอยู่แล้ว',
  },
  id: {
    label: 'Lampirkan dari Google Drive',
    skipped: '{n} file tidak dilampirkan (format tidak terbaca, atau lebih dari 20)',
    failed: '{n} file tidak dapat diambil dari Drive',
    disconnected: 'Google Drive terputus',
    busy: 'Jendela Drive sudah terbuka',
  },
  ru: {
    label: 'Прикрепить с Google Диска',
    skipped: 'Не прикреплено файлов: {n} (нечитаемый формат или больше 20)',
    failed: 'Не удалось получить с Диска файлов: {n}',
    disconnected: 'Google Диск отключён',
    busy: 'Окно Диска уже открыто',
  },
  ar: {
    label: 'إرفاق من Google Drive',
    skipped: 'لم يُرفق {n} من الملفات (تنسيق لا يمكن قراءته، أو أكثر من 20)',
    failed: 'تعذّر جلب {n} من الملفات من Drive',
    disconnected: 'انقطع اتصال Google Drive',
    busy: 'نافذة Drive مفتوحة بالفعل',
  },
  pt: {
    label: 'Anexar do Google Drive',
    skipped: '{n} arquivos não foram anexados (formato ilegível, ou mais de 20)',
    failed: 'Não foi possível buscar {n} arquivos no Drive',
    disconnected: 'O Google Drive está desconectado',
    busy: 'A janela do Drive já está aberta',
  },
  it: {
    label: 'Allega da Google Drive',
    skipped: '{n} file non allegati (formato non leggibile, o più di 20)',
    failed: 'Impossibile recuperare {n} file da Drive',
    disconnected: 'Google Drive è scollegato',
    busy: 'La finestra di Drive è già aperta',
  },
  pl: {
    label: 'Załącz z Dysku Google',
    skipped: 'Nie załączono plików: {n} (nieczytelny format lub ponad 20)',
    failed: 'Nie udało się pobrać z Dysku plików: {n}',
    disconnected: 'Dysk Google jest rozłączony',
    busy: 'Okno Dysku jest już otwarte',
  },
  cs: {
    label: 'Připojit z Disku Google',
    skipped: 'Nepřipojeno souborů: {n} (nečitelný formát nebo více než 20)',
    failed: 'Z Disku se nepodařilo získat souborů: {n}',
    disconnected: 'Disk Google je odpojen',
    busy: 'Okno Disku je už otevřené',
  },
  nl: {
    label: 'Bijvoegen uit Google Drive',
    skipped: '{n} bestanden niet bijgevoegd (onleesbare indeling, of meer dan 20)',
    failed: '{n} bestanden konden niet uit Drive worden opgehaald',
    disconnected: 'Google Drive is ontkoppeld',
    busy: 'Het Drive-venster is al open',
  },
  ms: {
    label: 'Lampirkan daripada Google Drive',
    skipped: '{n} fail tidak dilampirkan (format tidak boleh dibaca, atau lebih daripada 20)',
    failed: '{n} fail tidak dapat diambil daripada Drive',
    disconnected: 'Google Drive telah diputuskan',
    busy: 'Tetingkap Drive sudah dibuka',
  },
  he: {
    label: 'צירוף מ-Google Drive',
    skipped: '{n} קבצים לא צורפו (פורמט שלא ניתן לקרוא, או יותר מ-20)',
    failed: 'לא ניתן היה להביא {n} קבצים מ-Drive',
    disconnected: 'Google Drive מנותק',
    busy: 'חלון ה-Drive כבר פתוח',
  },
  hi: {
    label: 'Google Drive से संलग्न करें',
    skipped: '{n} फ़ाइलें संलग्न नहीं हुईं (न पढ़ा जा सकने वाला फ़ॉर्मेट, या 20 से अधिक)',
    failed: '{n} फ़ाइलें Drive से नहीं लाई जा सकीं',
    disconnected: 'Google Drive डिस्कनेक्ट है',
    busy: 'Drive विंडो पहले से खुली है',
  },
  'zh-TW': {
    label: '從 Google 雲端硬碟附加',
    skipped: '{n} 個檔案未附加（無法讀取的格式，或超過 20 個）',
    failed: '{n} 個檔案無法從雲端硬碟取得',
    disconnected: 'Google 雲端硬碟已中斷連結',
    busy: '雲端硬碟選擇視窗已開啟',
  },
  vi: {
    label: 'Đính kèm từ Google Drive',
    skipped: '{n} tệp không được đính kèm (định dạng không đọc được, hoặc quá 20 tệp)',
    failed: 'Không lấy được {n} tệp từ Drive',
    disconnected: 'Google Drive đã bị ngắt kết nối',
    busy: 'Cửa sổ Drive đã mở',
  },
}
