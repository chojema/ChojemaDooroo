import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from './i18n/locale'
import { parsePageRange } from './print-flow'

type Choice = 'all' | 'current' | 'custom'

/**
 * Which pages an export takes: the whole document, the page of the caret, or a range such
 * as `1-3, 5`. Answers with the page indexes (0-based), undefined for the whole document.
 */
export function ExportRangeDialog({
  pageCount,
  currentPage,
  onConfirm,
  onCancel,
}: {
  pageCount: number
  currentPage: number
  onConfirm: (pages: number[] | undefined) => void
  onCancel: () => void
}) {
  const { t, lang } = useI18n()
  const titleId = useId()
  const dialogRef = useRef<HTMLFormElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const rangeRef = useRef<HTMLInputElement>(null)
  const [choice, setChoice] = useState<Choice>('all')
  const [range, setRange] = useState('')
  const [error, setError] = useState<'invalid' | 'outside' | null>(null)

  useEffect(() => confirmRef.current?.focus(), [])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (choice === 'all') onConfirm(undefined)
    else if (choice === 'current') onConfirm([currentPage])
    else {
      const parsed = parsePageRange(range, pageCount)
      if ('error' in parsed) {
        setError(parsed.error)
        rangeRef.current?.focus()
      } else onConfirm(parsed.pages)
    }
  }

  // keep Tab inside the dialog: behind it is the editor's frame
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:checked, input[type="text"], button',
    )
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const radio = (value: Choice, label: string) => (
    <label className="export-range-option">
      <input
        type="radio"
        name="export-range"
        checked={choice === value}
        onChange={() => {
          setChoice(value)
          setError(null)
          if (value === 'custom') rangeRef.current?.focus()
        }}
      />
      <span>{label}</span>
    </label>
  )

  return createPortal(
    <div className="memo-modal-backdrop" onKeyDown={onKeyDown}>
      <form
        ref={dialogRef}
        className="memo-modal export-range"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir={lang === 'ar' || lang === 'he' ? 'rtl' : undefined}
        onSubmit={submit}
      >
        <div className="memo-modal-head">
          <span id={titleId} className="memo-modal-title">
            {t('exportRangeTitle')}
          </span>
        </div>
        <div className="memo-modal-body">
          {radio('all', t('exportRangeAll', { count: pageCount }))}
          {radio('current', t('exportRangeCurrent', { page: currentPage + 1 }))}
          {radio('custom', t('exportRangeCustom'))}
          <input
            ref={rangeRef}
            className="export-range-input"
            type="text"
            dir="ltr"
            value={range}
            placeholder={t('exportRangeHint')}
            aria-label={t('exportRangeCustom')}
            aria-invalid={error !== null}
            onFocus={() => setChoice('custom')}
            onChange={(event) => {
              setRange(event.target.value)
              setError(null)
            }}
          />
          {error && (
            <div className="memo-modal-error" role="alert">
              {error === 'invalid'
                ? t('exportRangeInvalid')
                : t('exportRangeOutside', { count: pageCount })}
            </div>
          )}
        </div>
        <div className="memo-modal-foot">
          <div className="memo-modal-actions">
            <button type="button" className="memo-button" onClick={onCancel}>
              {t('exportRangeCancel')}
            </button>
            <button ref={confirmRef} type="submit" className="memo-button memo-button-primary">
              {t('exportRangeConfirm')}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  )
}
