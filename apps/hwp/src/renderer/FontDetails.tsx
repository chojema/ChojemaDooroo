import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from './i18n/locale'

/** Available after the temporary notice closes; lists every substituted name. */
export function FontDetails({ names, onClose }: { names: readonly string[]; onClose: () => void }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return createPortal(
    <dialog ref={ref} className="font-details" aria-labelledby="font-details-title" onClose={onClose}>
      <h2 id="font-details-title">{t('fontDetails', { count: names.length })}</h2>
      <p>{t('fontPolicyDetails')}</p>
      <ul>{names.map(name => <li key={name}>{name}</li>)}</ul>
      <p>{t('fontPolicyLicense')}</p>
      <button type="button" autoFocus onClick={() => ref.current?.close()}>{t('dismiss')}</button>
    </dialog>, document.body,
  )
}
