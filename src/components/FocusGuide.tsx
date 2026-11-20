import { useId } from 'react'
import type { GuidedPart, PracticeMode } from '../lib/guidedDrawing'
import type { PracticeScore } from '../lib/practice'

interface FocusGuideProps {
  parts: GuidedPart[]
  partIndex: number
  strokeIndex: number
  mode: PracticeMode
  isPlaying: boolean
  drawnStrokes: number
  onTogglePlay: () => void
  onReplayPart: () => void
  onReplayLesson: () => void
  onPartChange: (index: number) => void
  onStrokeChange: (index: number) => void
  practice?: boolean
  practiceResult?: PracticeScore | null
  onTogglePractice?: () => void
  onAcceptPractice?: () => void
  onRetryPractice?: () => void
}

const stages = [
  { mode: 'identify', label: 'Xác định khối' },
  { mode: 'simulate', label: 'Mô phỏng' },
  { mode: 'draw', label: 'Tự phác nét' },
  { mode: 'correct', label: 'Chỉnh nét' },
] as const

const stageMessages: Record<PracticeMode, string> = {
  identify: 'Ứng dụng đang chỉ ra khối và các mốc của phần này. Hãy quan sát vị trí trước khi đầu bút bắt đầu.',
  simulate: 'Đầu bút tự mô phỏng đường đi từ điểm đặt đến điểm nhấc bút. Bạn chỉ cần quan sát hướng và độ cong của nét.',
  draw: 'Ứng dụng tự phác từng nét trong phần đang học. Nét này xong mới đến nét tiếp theo; bạn có thể tạm dừng để nhìn kỹ.',
  correct: 'Ứng dụng chuyển sang chỉnh nét của phần này. Hãy quan sát đoạn cần làm nhẹ, nối lại hoặc giữ rõ trước khi chuyển phần.',
}

export default function FocusGuide({
  parts,
  partIndex,
  strokeIndex,
  mode,
  isPlaying,
  drawnStrokes,
  onTogglePlay,
  onReplayPart,
  onReplayLesson,
  onPartChange,
  onStrokeChange,
  practice = false,
  practiceResult = null,
  onTogglePractice,
  onAcceptPractice,
  onRetryPractice,
}: FocusGuideProps) {
  const headingId = useId()
  const part = parts[partIndex]
  if (!part) return null

  const stroke = part.strokes[strokeIndex]
  const drawnCount = Math.max(0, Math.min(part.strokes.length, drawnStrokes))

  return (
    <section className="focus-guide" aria-labelledby={headingId}>
      <ol className="focus-stages" aria-label="Trình tự ứng dụng tự vẽ">
        {stages.map((stage) => (
          <li key={stage.mode} aria-current={stage.mode === mode ? 'step' : undefined}>
            {stage.label}
          </li>
        ))}
      </ol>

      <div className="focus-part-header">
        <div className="focus-part-heading">
          <p className="focus-count">Phần {partIndex + 1} / {parts.length}</p>
          <h3 id={headingId}>{part.label}</h3>
        </div>
        {parts.length > 1 && (
          <div className="focus-part-nav" role="group" aria-label="Chọn phần để xem">
            <button
              type="button"
              aria-label="Phần trước"
              disabled={partIndex === 0}
              onClick={() => onPartChange(partIndex - 1)}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              aria-label="Phần sau"
              disabled={partIndex + 1 >= parts.length}
              onClick={() => onPartChange(partIndex + 1)}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        )}
      </div>
      <p className="focus-shape">{part.shape}</p>
      <p className="focus-gate" role="status">{stageMessages[mode]}</p>

      {part.strokes.length > 0 && (
        <div className="focus-strokes">
          <div className="focus-stroke-header">
            <p className="focus-count">Nét {stroke ? strokeIndex + 1 : '—'} / {part.strokes.length}</p>
            <div className="focus-stroke-buttons" role="group" aria-label="Chọn nét để xem">
              {part.strokes.map((item, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Nét ${index + 1} · ${item.label}`}
                  aria-pressed={index === strokeIndex}
                  onClick={() => onStrokeChange(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
          {stroke && (
            <div className="focus-stroke-detail" aria-live="polite">
              <strong>{stroke.label}</strong>
              <p>{stroke.instruction}</p>
            </div>
          )}
          <p className="focus-count" aria-live="polite">Ứng dụng đã vẽ {drawnCount} / {part.strokes.length} nét trong phần này.</p>
        </div>
      )}

      {mode === 'correct' && (
        <div className="focus-correction">
          <p><strong>Quan sát cách chỉnh nét</strong>{part.correction}</p>
          <p><strong>Dấu hiệu cần quan sát</strong>{part.checkpoint}</p>
        </div>
      )}

      {onTogglePractice && (
        <div className="practice-box">
          <button type="button" className={'focus-button ' + (practice ? 'focus-primary' : 'focus-secondary')} onClick={onTogglePractice} aria-pressed={practice}>
            {practice ? 'Đang tự luyện — bấm để xem máy vẽ' : 'Tự vẽ nét này'}
          </button>
          {practice && !practiceResult && (
            <p className="practice-hint">Vẽ đè bằng chuột hoặc ngón tay lên nét đứt mờ trên giấy. Nhấc tay ra là máy chấm nét của bạn ngay.</p>
          )}
          {practice && practiceResult && (
            <div className="practice-result" role="status">
              <p className="practice-score">Điểm nét này: <strong>{practiceResult.score} / 100</strong></p>
              <p>{practiceResult.feedback}</p>
              <div className="focus-stage-actions">
                <button type="button" className="focus-button focus-secondary" onClick={onRetryPractice}>
                  Vẽ lại nét này
                </button>
                {practiceResult.score >= 65 && (
                  <button type="button" className="focus-button focus-primary" onClick={onAcceptPractice}>
                    Nhận nét này, sang nét kế
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <button type="button" className="focus-button focus-primary" onClick={onTogglePlay}>
        {isPlaying ? 'Tạm dừng' : 'Tiếp tục tự vẽ'}
      </button>
      <div className="focus-stage-actions">
        <button type="button" className="focus-button focus-secondary" onClick={onReplayPart}>
          Vẽ lại phần này
        </button>
        <button type="button" className="focus-button focus-secondary" onClick={onReplayLesson}>
          Xem lại từ đầu
        </button>
      </div>
    </section>
  )
}
