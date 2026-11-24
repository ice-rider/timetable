interface FileError {
  file: string
  message: string
}

interface Props {
  done: number
  total: number
  errors: FileError[]
}

export function Loader({ done, total, errors }: Props) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h2 className="mb-4 text-lg font-medium">Обрабатываем файлы</h2>

      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {done} из {total} ({pct}%)
      </p>

      {errors.length > 0 && (
        <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">Не удалось обработать:</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-700">
            {errors.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{e.file}:</span> {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
