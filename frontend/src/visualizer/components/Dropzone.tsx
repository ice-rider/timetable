import { useCallback, useRef, useState } from 'react'

const ACCEPT = ['.xls', '.xlsx', '.ttx', '.jsonl', '.json']

interface Props {
  onFiles: (files: File[]) => void
}

export function Dropzone({ onFiles }: Props) {
  const [over, setOver] = useState(false)
  const counter = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list) return
      const files = Array.from(list)
      if (files.length > 0) onFiles(files)
    },
    [onFiles],
  )

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    counter.current++
    setOver(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    counter.current--
    if (counter.current <= 0) {
      counter.current = 0
      setOver(false)
    }
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    counter.current = 0
    setOver(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Выбрать файлы расписания"
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          input.current?.click()
        }
      }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={
        'cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition ' +
        (over ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-400')
      }
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(',')}
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = '' // позволяет повторно выбрать тот же файл
        }}
      />
      <p className="text-base font-medium">Перетащите файлы сюда или нажмите, чтобы выбрать</p>
      <p className="mt-2 text-sm text-slate-500">
        Excel (.xls, .xlsx) или расписание TTX/JSON Lines (.ttx, .jsonl, .json)
      </p>
    </div>
  )
}
