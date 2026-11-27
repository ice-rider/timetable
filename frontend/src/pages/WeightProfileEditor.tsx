import { useMemo, useState } from 'react'
import type { WeightProfile } from '../api/scheduler.ts'
import {
  CRITERION_DESCRIPTIONS,
  DEFAULT_WEIGHTS,
  makeRows,
  moveCriterion,
  normalizeWeights,
  readLastPositive,
  sortRows,
  toWeights,
  writeLastPositive,
  type CriterionKey,
  type Row,
  type Weights,
} from '../schedulerWeights.ts'

interface WeightProfileEditorProps {
  weights: Weights
  onChange: (weights: Weights) => void
  profiles?: WeightProfile[]
  selectedProfileId?: number | null
  onSelectProfile?: (id: number | null) => void
  onSaveProfile?: (name: string, weights: Weights) => void
  onDeleteProfile?: (id: number) => void
}

export function WeightProfileEditor({
  weights,
  onChange,
  profiles = [],
  selectedProfileId = null,
  onSelectProfile,
  onSaveProfile,
  onDeleteProfile,
}: WeightProfileEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => makeRows(weights))
  const [dragKey, setDragKey] = useState<CriterionKey | null>(null)
  const [dragOverKey, setDragOverKey] = useState<CriterionKey | null>(null)
  const [profileName, setProfileName] = useState('')
  const [lastPositive, setLastPositive] = useState<Partial<Record<CriterionKey, number>>>(() =>
    readLastPositive(),
  )
  const [live, setLive] = useState('')

  function selectProfile(id: number | null) {
    onSelectProfile?.(id)
    const profile = profiles.find((p) => p.id === id)
    setRows(
      makeRows(id == null ? { ...DEFAULT_WEIGHTS } : normalizeWeights(profile?.weights ?? {})),
    )
  }

  function saveProfile(name: string, nextWeights: Weights) {
    onSaveProfile?.(name, nextWeights)
    setRows(makeRows(normalizeWeights(nextWeights)))
  }

  function deleteProfile(id: number) {
    onDeleteProfile?.(id)
    setRows(makeRows({ ...DEFAULT_WEIGHTS }))
  }

  const ordered = useMemo(() => sortRows(rows), [rows])
  const positive = ordered.filter((r) => r.weight > 0).map((r) => r.weight)
  const equalHigh = positive.length >= 2 && new Set(positive).size === 1
  const totalWeight = positive.reduce((s, w) => s + w, 0)

  function commit(nextRows: Row[], message = '') {
    const sorted = sortRows(nextRows)
    setRows(sorted)
    onChange(toWeights(sorted))
    if (message) setLive(message)
  }

  function setWeight(key: CriterionKey, raw: number) {
    const value = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0
    const next = rows.map((r) => (r.key === key ? { ...r, weight: value } : r))
    const lp = { ...lastPositive }
    if (value > 0) {
      lp[key] = value
      setLastPositive(lp)
      writeLastPositive(lp)
    }
    commit(next, `${key}: вес ${value}`)
  }

  function toggle(key: CriterionKey, checked: boolean) {
    const row = rows.find((r) => r.key === key)
    if (!row) return
    if (checked) {
      const restored = lastPositive[key] ?? DEFAULT_WEIGHTS[key] ?? 1
      const restoredWeight = Math.max(1, Math.trunc(restored))
      const lp = { ...lastPositive, [key]: restoredWeight }
      setLastPositive(lp)
      writeLastPositive(lp)
      commit(
        rows.map((r) => (r.key === key ? { ...r, weight: restoredWeight } : r)),
        `${key}: включён, вес ${restoredWeight}`,
      )
    } else {
      const lp = { ...lastPositive, [key]: row.weight > 0 ? row.weight : (lastPositive[key] ?? 1) }
      setLastPositive(lp)
      writeLastPositive(lp)
      commit(
        rows.map((r) => (r.key === key ? { ...r, weight: 0 } : r)),
        `${key}: выключен`,
      )
    }
  }

  function move(key: CriterionKey, delta: -1 | 1) {
    const sorted = sortRows(rows)
    const checked = sorted.filter((r) => r.weight > 0)
    const idx = checked.findIndex((r) => r.key === key)
    if (idx < 0) return
    const target = idx + delta
    if (target < 0 || target >= checked.length) return
    commit(moveCriterion(rows, key, target), `${key}: перемещён, вес обновлён`)
  }

  function onDragStart(key: CriterionKey) {
    setDragKey(key)
  }

  function onDrop(targetKey: CriterionKey) {
    if (!dragKey || dragKey === targetKey) return
    const sorted = sortRows(rows)
    const checked = sorted.filter((r) => r.weight > 0)
    const targetIdx = checked.findIndex((r) => r.key === targetKey)
    if (targetIdx < 0) return
    commit(moveCriterion(rows, dragKey, targetIdx), `${dragKey}: перемещён, вес обновлён`)
    setDragKey(null)
    setDragOverKey(null)
  }

  return (
    <section className="weight-profile-editor" aria-label="Мягкие критерии и веса">
      <div className="weight-profile-heading">
        <div>
          <h3>Мягкие критерии</h3>
          <p className="muted">
            Сначала активные по весу, затем выключенные. Вес целое число ≥ 0. 0 выключает критерий.
            Порядок = вес.
          </p>
        </div>
        <span className="weight-total" title="Сумма весов активных критериев">
          Σ {totalWeight}
        </span>
      </div>

      {equalHigh && (
        <p className="weight-warning" role="status">
          ⚠️ Всем активным критериям поставлен одинаково высокий вес. Относительные приоритеты не
          изменятся — к хорошему результату это не приведёт.
        </p>
      )}

      {profiles.length > 0 && onSelectProfile && (
        <label className="field weight-profile-select">
          Профиль весов
          <select
            value={selectedProfileId ?? ''}
            onChange={(e) => selectProfile(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Без сохранённого профиля</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="weight-list" role="list">
        {ordered.map((row, index) => {
          const checked = row.weight > 0
          const disabled = !checked
          const canUp =
            checked && ordered.filter((r) => r.weight > 0).findIndex((r) => r.key === row.key) > 0
          const checkedRows = ordered.filter((r) => r.weight > 0)
          const checkedIdx = checkedRows.findIndex((r) => r.key === row.key)
          const canDown = checked && checkedIdx >= 0 && checkedIdx < checkedRows.length - 1
          return (
            <div
              key={row.key}
              role="listitem"
              className={`weight-row ${disabled ? 'disabled' : 'checked'} ${dragOverKey === row.key ? 'drag-over' : ''}`}
              draggable={checked}
              aria-grabbed={dragKey === row.key}
              onDragStart={() => onDragStart(row.key)}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverKey(row.key)
              }}
              onDrop={(e) => {
                e.preventDefault()
                onDrop(row.key)
              }}
              onDragEnd={() => {
                setDragKey(null)
                setDragOverKey(null)
              }}
            >
              <span className="weight-grip" aria-hidden="true">
                {checked ? '⠿' : ''}
              </span>
              <input
                type="checkbox"
                checked={checked}
                aria-label={`Критерий ${row.title} ${checked ? 'активен' : 'выключен'}`}
                onChange={(e) => toggle(row.key, e.target.checked)}
              />
              <div className="weight-name">
                <span className="weight-title">{row.title}</span>
                <code className="weight-key">{row.key}</code>
                <span
                  className="weight-help"
                  title={CRITERION_DESCRIPTIONS[row.key]}
                  aria-label={CRITERION_DESCRIPTIONS[row.key]}
                  role="note"
                >
                  ?
                </span>
              </div>
              <div className="weight-arrows">
                <button
                  type="button"
                  aria-label={`Поднять ${row.title}`}
                  disabled={!canUp}
                  onClick={() => move(row.key, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Опустить ${row.title}`}
                  disabled={!canDown}
                  onClick={() => move(row.key, 1)}
                >
                  ↓
                </button>
              </div>
              <label className="weight-input-label">
                <span className="sr-only">Вес {row.title}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={row.weight}
                  disabled={disabled}
                  aria-label={`Вес ${row.title}`}
                  onChange={(e) =>
                    setWeight(row.key, e.target.value === '' ? 0 : Number(e.target.value))
                  }
                />
              </label>
              <span className="weight-order" aria-hidden="true">
                {index + 1}
              </span>
            </div>
          )
        })}
      </div>

      {equalHigh && (
        <p className="weight-warning" role="status">
          ⚠️ Всем активным критериям поставлен одинаково высокий вес. Относительные приоритеты не
          изменятся — к хорошему результату это не приведёт.
        </p>
      )}

      {onSaveProfile && (
        <div className="weight-profile-save">
          <label className="field">
            Название профиля
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Например, компактный учебный день"
            />
          </label>
          <button
            type="button"
            className="quiet-button"
            disabled={!profileName.trim()}
            onClick={() => saveProfile(profileName.trim(), toWeights(ordered))}
          >
            Сохранить профиль
          </button>
        </div>
      )}

      {selectedProfileId != null && onDeleteProfile && (
        <button
          type="button"
          className="quiet-button danger"
          onClick={() => deleteProfile(selectedProfileId)}
        >
          Удалить профиль
        </button>
      )}

      <div className="sr-only" aria-live="polite">
        {live}
      </div>
    </section>
  )
}
