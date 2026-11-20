import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown, ArrowRight, BadgeCheck, BookOpen, Brush, Check, ChevronDown, ChevronLeft,
  ChevronRight, Clock3, CloudUpload, Eye, Grid2X2, ImagePlus,
  Info, Lightbulb, LoaderCircle, LockKeyhole, Play, RotateCcw,
  Sparkles, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import DrawingBoard, { type DrawingBoardHandle } from './components/DrawingBoard'
import FocusGuide from './components/FocusGuide'
import { materialize, type GuidedPart, type PracticeMode, type SketchStroke } from './lib/guidedDrawing'
import type { PracticeScore } from './lib/practice'
import type { SemanticPart } from './lib/semanticParts'
import { SAMPLE_LESSON } from './data/lessons'
import { STAGES, createLesson } from './data/stages'
import type { Lesson } from './types'

const initialSaved = (() => { try { return window.localStorage.getItem('ve-cung-bai-da-luu') === 'true' } catch { return false } })()

export default function App() {
  const [lesson, setLesson] = useState<Lesson>(SAMPLE_LESSON as Lesson)
  const [activeStep, setActiveStep] = useState(0)
  const [plans, setPlans] = useState<GuidedPart[][]>([])
  const [partIndex, setPartIndex] = useState(0)
  const [strokeIndex, setStrokeIndex] = useState(0)
  const [mode, setMode] = useState<PracticeMode>('identify')
  const [practice, setPractice] = useState(false)
  const [practiceResult, setPracticeResult] = useState<PracticeScore | null>(null)
  const [aiParts, setAiParts] = useState<SemanticPart[] | null>(null)
  const [finishedSteps, setFinishedSteps] = useState<number[]>([])
  const [sketchStrokes, setSketchStrokes] = useState<SketchStroke[]>([])
  const [replayToken, setReplayToken] = useState(0)
  const [reference, setReference] = useState<string | null>(null)
  const [referenceName, setReferenceName] = useState('Quả lê bên cửa sổ')
  const [imageData, setImageData] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [aiConnected, setAiConnected] = useState<boolean | null>(null)
  const [lessonSource, setLessonSource] = useState<'demo' | 'ai'>('demo')
  const [showReference, setShowReference] = useState(false)
  const [showGrid, setShowGrid] = useState(false)
  const [showGuides, setShowGuides] = useState(true)
  const [isPlaying, setIsPlaying] = useState(true)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [zoom, setZoom] = useState(100)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const [profile, setProfile] = useState('beginner')
  const [customLevel, setCustomLevel] = useState(false)
  const [activeTab, setActiveTab] = useState<'steps' | 'insight'>('steps')
  const [saved, setSaved] = useState(initialSaved)
  const [apiMessage, setApiMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const boardRef = useRef<DrawingBoardHandle>(null)
  const fileDragDepth = useRef(0)
  const analysisSequence = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch('/api/health').then(r => r.ok ? r.json() : null).then(data => {
      if (data) setAiConnected(Boolean(data.aiConfigured))
    }).catch(() => setAiConnected(false))
  }, [])

  const parts = plans[activeStep] ?? []
  const currentStep = lesson.steps[Math.min(activeStep, lesson.steps.length - 1)]
  const currentStage = STAGES[activeStep]
  const completedSteps = finishedSteps.length
  const completedPercent = Math.round(completedSteps / Math.max(lesson.steps.length, 1) * 100)
  const currentPart = parts[partIndex]
  const drawnStrokes = sketchStrokes.filter(stroke => stroke.step === activeStep && stroke.partId === currentPart?.id).length
  const resetDemonstration = () => {
    setFinishedSteps([]); setSketchStrokes([])
    setPartIndex(0); setStrokeIndex(0); setMode('identify'); setIsPlaying(true)
    setPractice(false); setPracticeResult(null)
    setReplayToken(token => token + 1)
  }
  const togglePractice = () => {
    setPracticeResult(null)
    setPractice(on => {
      if (!on) setIsPlaying(false)
      return !on
    })
  }
  const acceptPracticeStroke = () => {
    if (!currentPart) return
    const stroke = currentPart.strokes[strokeIndex]
    if (!stroke) return
    const key = `${activeStep}:${currentPart.id}:${strokeIndex}`
    setSketchStrokes(strokes => strokes.some(item => item.key === key) ? strokes : [...strokes, { ...stroke, key, step: activeStep, partId: currentPart.id }])
    setPracticeResult(null)
    if (strokeIndex + 1 < currentPart.strokes.length) setStrokeIndex(strokeIndex + 1)
    else setMode('correct')
  }
  const goToStep = (index: number) => {
    if (index < 0 || index >= lesson.steps.length) return
    setSketchStrokes(materialize(plans, index))
    setActiveStep(index); setPartIndex(0); setStrokeIndex(0); setMode('identify')
    setPractice(false); setPracticeResult(null)
    setReplayToken(token => token + 1)
  }
  const changePart = (index: number) => {
    if (index < 0 || index >= parts.length) return
    setSketchStrokes([...materialize(plans, activeStep), ...parts.slice(0,index).flatMap(part => part.strokes.map((stroke,i) => ({...stroke,step:activeStep,partId:part.id,key: `${activeStep}:${part.id}:${i}`})))])
    setPartIndex(index); setStrokeIndex(0); setMode('identify')
    setPracticeResult(null)
    setReplayToken(token => token + 1)
  }
  const replayPart = () => {
    setSketchStrokes([...materialize(plans, activeStep), ...parts.slice(0,partIndex).flatMap(part => part.strokes.map((stroke,i) => ({...stroke,step:activeStep,partId:part.id,key: `${activeStep}:${part.id}:${i}`})))])
    setStrokeIndex(0); setMode('identify'); setIsPlaying(true); setPracticeResult(null); setReplayToken(token => token + 1)
  }
  const replayLesson = () => { resetDemonstration(); setActiveStep(0) }
  const changeStroke = (index: number) => {
    if (!currentPart?.strokes[index]) return
    setSketchStrokes(strokes => strokes.filter(stroke => stroke.step !== activeStep || stroke.partId !== currentPart.id || Number(stroke.key.split(':').at(-1)) < index))
    setStrokeIndex(index); setMode('draw'); setPracticeResult(null); setReplayToken(token => token + 1)
  }
  const finishStroke = () => {
    if (!isPlaying || !currentPart) return
    if (mode === 'simulate') { setMode('draw'); return }
    if (mode !== 'draw') return
    const stroke = currentPart.strokes[strokeIndex]
    const key = `${activeStep}:${currentPart.id}:${strokeIndex}`
    setSketchStrokes(strokes => strokes.some(item => item.key === key) ? strokes : [...strokes, { ...stroke, key, step: activeStep, partId: currentPart.id }])
    if (strokeIndex + 1 < currentPart.strokes.length) setStrokeIndex(strokeIndex + 1)
    else setMode('correct')
  }
  useEffect(() => {
    if (!isPlaying || !currentPart || (mode !== 'identify' && mode !== 'correct')) return
    const timer = window.setTimeout(() => {
      if (mode === 'identify') { setMode('simulate'); return }
      if (partIndex + 1 < parts.length) {
        setPartIndex(partIndex + 1); setStrokeIndex(0); setMode('identify')
      } else {
        setFinishedSteps(steps => steps.includes(activeStep) ? steps : [...steps, activeStep])
        if (activeStep + 1 < lesson.steps.length) {
          setActiveStep(activeStep + 1); setPartIndex(0); setStrokeIndex(0); setMode('identify')
        } else {
          setIsPlaying(false)
          setNotice('Đã trình diễn xong bài vẽ. Bạn có thể xem lại từng phần hoặc phát lại từ đầu.')
        }
      }
    }, (mode === 'identify' ? 1400 : 2000) / playbackSpeed)
    return () => window.clearTimeout(timer)
  }, [isPlaying, mode, currentPart, partIndex, parts.length, activeStep, lesson.steps.length, playbackSpeed])

  const analyzeImage = useCallback(async (dataUrl: string, name: string, level = profile) => {
    resetDemonstration()
    const requestId = ++analysisSequence.current
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const displayName = name.replace(/\.[^.]+$/, '') || 'Ảnh của bạn'
    setPlans([])
    setReference(dataUrl)
    setImageData(dataUrl)
    setReferenceName(displayName)
    setShowReference(false)
    setActiveStep(0)
    setCustomLevel(false)
    setLesson(createLesson(displayName, level === 'advanced' ? 'Nâng cao' : level === 'intermediate' ? 'Trung cấp' : 'Mới bắt đầu'))
    setLessonSource('demo')
    setApiMessage('')
    setAiParts(null)
    setLoading(true)
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, level, focus: 'pencil' }), signal: controller.signal,
      })
      const result = await response.json()
      if (requestId !== analysisSequence.current) return
      if (response.ok && result.lesson?.steps?.length === STAGES.length && result.lesson.steps.every((step: { shortTitle: string }, i: number) => step.shortTitle === STAGES[i].label)) {
        setLesson(result.lesson as Lesson)
        setLessonSource('ai')
        setApiMessage('Bài hướng dẫn được AI điều chỉnh theo tỉ lệ, bố cục và ánh sáng trong ảnh này.')
        // Semantic part names are an optional second pass: when the server
        // can see the image, blocks and strokes get real part names (đầu,
        // thân, quả táo...). Any failure here leaves the local labels as-is.
        try {
          const partsResponse = await fetch('/api/parts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: dataUrl }), signal: controller.signal,
          })
          const partsResult = await partsResponse.json()
          if (requestId !== analysisSequence.current) return
          if (partsResponse.ok && Array.isArray(partsResult.parts) && partsResult.parts.length) {
            setAiParts(partsResult.parts as SemanticPart[])
            setApiMessage(`AI đã nhận diện ${partsResult.parts.length} bộ phận (${partsResult.parts.map((part: SemanticPart) => part.name).join(', ')}) và gắn tên vào từng khối, từng nét của bài.`)
          }
        } catch { /* Part naming is optional; local labels remain. */ }
      } else if (result.code === 'AI_NOT_CONFIGURED') {
        setApiMessage('Ảnh được minh họa trên máy bạn. Bài hướng dẫn chì tổng quát sẵn sàng; bật máy chủ AI để nhận phân tích riêng từ ảnh.')
      } else {
        setApiMessage((result.error || 'Ảnh đã lên bảng. Bài hướng dẫn tổng quát vẫn sẵn sàng.') + ' Ảnh vẫn được minh họa trực tiếp trên bảng vẽ.')
      }
    } catch {
      if (requestId === analysisSequence.current && !controller.signal.aborted) setApiMessage('Chưa kết nối được máy chủ phân tích. Ảnh và bài hướng dẫn tổng quát vẫn dùng được.')
    } finally {
      if (requestId === analysisSequence.current) { setLoading(false); activeRequest.current = null }
    }
  }, [profile])

  useEffect(() => () => { analysisSequence.current++; activeRequest.current?.abort() }, [])

  useEffect(() => { try { window.localStorage.setItem('ve-cung-bai-da-luu', String(saved)) } catch { /* The session bookmark remains available without persistent storage. */ } }, [saved])

  const resetToSample = () => {
    resetDemonstration()
    analysisSequence.current++
    activeRequest.current?.abort()
    activeRequest.current = null
    setLoading(false)
    setImageData(null)
    if (fileRef.current) fileRef.current.value = ''
    setPlans([])
    setReference(null)
    setImageData(null)
    setReferenceName('Quả lê bên cửa sổ')
    setLesson(SAMPLE_LESSON)
    setLessonSource('demo')
    setActiveStep(0)
    setShowReference(false)
    setShowGuides(true)
    setSaved(false)
    setApiMessage('')
    setAiParts(null)
    setNotice('Đã quay về bài học mẫu Quả lê bên cửa sổ.')
  }

  const acceptFile = useCallback(async (file?: File) => {
    if (!file) return
    if (file.size > 6 * 1024 * 1024) { setNotice('Ảnh nên nhỏ hơn 6 MB để bảng chạy mượt.'); return }
    try {
      const bytes = new Uint8Array(await file.slice(0,16).arrayBuffer())
      const mime = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
        : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? 'image/png'
        : String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP' ? 'image/webp'
        : String.fromCharCode(...bytes.slice(0,3)) === 'GIF' ? 'image/gif' : null
      if (!mime) { setNotice('Chọn ảnh JPEG/JFIF, PNG, WebP hoặc GIF hợp lệ.'); return }
      const reader = new FileReader()
      reader.onload = () => { if (typeof reader.result === 'string') void analyzeImage(reader.result, file.name) }
      reader.onerror = () => setNotice('Chưa đọc được ảnh — thử một tệp khác nhé.')
      // Detect from bytes: Windows and browsers may report JFIF as octet-stream.
      reader.readAsDataURL(new Blob([file], { type: mime }))
    } catch { setNotice('Chưa đọc được ảnh. Hãy chọn lại tệp.') }
  }, [analyzeImage])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const closeDrag = () => { fileDragDepth.current = 0; setDragging(false) }
    const prevent = (event: DragEvent) => event.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', closeDrag)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', closeDrag)
    }
  }, [])

  const stepBy = (direction: number) => {
    const next = Math.min(Math.max(activeStep + direction, 0), lesson.steps.length - 1)
    goToStep(next)
    setShowGuides(true)
  }

  const handlePlay = () => setIsPlaying(true)
  const stopPlay = () => setIsPlaying(false)
  const savePNG = () => boardRef.current?.exportPng()


  return (
    <main className="app-shell" onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { fileDragDepth.current++; setDragging(true) } }} onDragLeave={e => { if (e.dataTransfer.types.includes('Files') && --fileDragDepth.current <= 0) { fileDragDepth.current = 0; setDragging(false) } }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); fileDragDepth.current = 0; setDragging(false); acceptFile(e.dataTransfer.files[0]) } }}>
      <header className="topbar">
        <a className="wordmark" href="#home" aria-label="Vẽ Cùng, trang chủ"><span className="brand-seal"><Brush size={19} strokeWidth={2.05}/></span><span>vẽ cùng<span className="wordmark-period">.</span></span></a>
        <div className="topbar-course"><span className="topbar-course-dot"/>PHÒNG VẼ SỐ 01<span className="topbar-slash">/</span><span>BUỔI {String(Math.ceil((activeStep + 1) / 3)).padStart(2, '0')}</span></div>
        <div className="topbar-actions">
          <span className="online-label"><i/> studio sẵn sàng</span>
          <span className="online-label ai-status" title={aiConnected ? 'Máy chủ AI đã sẵn sàng' : aiConnected === false ? 'AI chưa cấu hình; dùng được bài thực hành mẫu' : 'Đang kiểm tra máy chủ AI'}><i className={aiConnected ? 'ai-ready' : aiConnected === false ? 'ai-offline' : ''}/>{aiConnected ? ' AI sẵn sàng' : aiConnected === false ? ' bài mẫu sẵn sàng' : ' studio sẵn sàng'}</span>
          <button className="icon-button header-upload" onClick={() => fileRef.current?.click()} title="Tải một ảnh khác"><ImagePlus size={16}/><span>Ảnh của bạn</span></button>
          <button className="icon-button header-reset" onClick={resetToSample} title="Quay lại bài học mẫu" aria-label="Quay lại bài học mẫu"><RotateCcw size={15}/></button>
          <input ref={fileRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,.jpg,.jpeg,.jfif,.png,.webp,.gif" onChange={e => acceptFile(e.target.files?.[0])}/>
          <button className={'avatar-button ' + (saved ? 'avatar-saved' : '')} onClick={() => { setSaved(!saved); setNotice(saved ? 'Đã gỡ bài khỏi sổ tay.' : 'Đã lưu bài thực hành vào sổ tay.'); }} title={saved ? 'Đã lưu sổ tay' : 'Lưu vào sổ tay'}>{saved ? <Check size={16}/> : <span>m</span>}</button>
        </div>
      </header>

      <section className="page-heading" id="home">
        <div className="heading-copy">
          <div className="eyebrow"><span className="eyebrow-line"/>KHOA HỌC VỀ CÁCH NHÌN · LỚP 01</div>
          <h1>Mọi nét vẽ đẹp,<br/><span>đều bắt đầu từ</span> khối. <span className="title-marker">↗</span></h1>
          <div className="heading-bottom"><p>Xác định khối. Xem từng nét. Vẽ rồi chỉnh sửa.<br className="desktop-break"/> Hôm nay, mình cùng vẽ <strong>{referenceName.toLowerCase()}</strong> nhé.</p><div className="mini-stats"><span><BookOpen size={14}/>{lesson.steps.length} bước chi tiết</span><span><Clock3 size={14}/>{lesson.duration || 25} phút</span></div></div>
        </div>
        <div className="lesson-stamp" aria-label="Thực hành 13 bước"><span className="stamp-top">HỌC CHẬM</span><span className="stamp-number">13</span><span className="stamp-bottom">VẼ KỸ · VUI</span><span className="stamp-spark">✳</span></div>
      </section>

      <div className="workbench">
        <aside className="workbench-sidebar">
          <div className="side-label"><span className="side-label-index">A</span><span>CHỌN MẪU VẼ</span><span className="side-label-rule"/></div>
          <div className="reference-card">
            <button className="reference-photo" onClick={() => fileRef.current?.click()} aria-label="Chọn ảnh mẫu của bạn">
              {reference ? <img src={reference} alt="Ảnh mẫu người dùng tải lên"/> : <div className="reference-placeholder"><img src="/pear-reference.svg" alt="Minh họa tĩnh vật quả lê trên nền giấy"/><span className="photo-tape"/></div>}
              <span className="photo-number">01 <span>/</span> 01</span><span className="photo-edit"><ImagePlus size={14}/> ĐỔI ẢNH</span>
            </button>
            <div className="reference-meta"><div><strong>{referenceName}</strong><span>{reference ? 'Ảnh riêng của bạn · sẵn sàng để vẽ' : 'Bài học mẫu · tĩnh vật chì'}</span></div><span className="verified-mark"><Check size={13}/></span></div>
          </div>
          <button className="upload-inline" onClick={() => fileRef.current?.click()}><span className="upload-plus"><ImagePlus size={16}/></span><span><strong>Tải ảnh của bạn lên</strong><small>JPG · JFIF · PNG · WEBP &nbsp;·&nbsp; tối đa 6 MB</small></span><ArrowRight size={16}/></button>
          <div className="profile-row"><div className="profile-copy"><span>Trình độ của bạn</span><small>Điều chỉnh cách giải thích</small></div><select aria-label="Chọn trình độ người học" value={profile} onChange={e => { setProfile(e.target.value); if (imageData) setCustomLevel(true) }}><option value="beginner">Mới bắt đầu</option><option value="intermediate">Đã biết vẽ</option><option value="advanced">Nâng cao</option></select></div>
          {imageData && customLevel && <button className="regenerate-link" onClick={() => { if (imageData) { setCustomLevel(false); void analyzeImage(imageData, referenceName, profile) } }}>Làm lại lộ trình theo trình độ ↗</button>}
          <div className="privacy-note"><LockKeyhole size={12}/><span>Ảnh được xử lý trên bảng vẽ máy bạn; chỉ gửi lên AI nếu máy chủ đã bật phân tích.</span></div>
          <div className="sidebar-divider"/>
          <div className="phase-header"><span>LỘ TRÌNH HỌC</span><span className="phase-count">13 GIAI ĐOẠN</span></div>
          <div className="phase-list">{STAGES.map((stage,index) => <button key={stage.id} className={'phase-item '+(activeStep === index ? 'phase-active ' : '')+(finishedSteps.includes(index) ? 'phase-done' : '')} onClick={() => goToStep(index)}><span className="phase-step-number">{finishedSteps.includes(index) ? <Check size={12}/> : String(index+1).padStart(2,'0')}</span><span>{stage.label}</span></button>)}</div>
          <div className="sidebar-tip"><span className="tip-mark">“</span><p><strong>Một mẹo nhỏ</strong>Nhìn nhiều hơn vẽ, trong 60 giây đầu tiên.</p></div>
        </aside>

        <section className="center-stage" aria-label="Bàn tập vẽ">
          <div className="stage-toolbar"><div className="stage-breadcrumb"><span>BUỔI 01</span><ChevronRight size={13}/><strong>{currentStep?.shortTitle ?? 'Quan sát'}</strong></div><div className="stage-controls"><span className="control-caption">BÀN VẼ</span><button className={'toolbar-icon ' + (showGrid ? 'toolbar-selected' : '')} title="Bật lưới tỷ lệ" aria-label="Bật lưới tỷ lệ" onClick={() => setShowGrid(!showGrid)}><Grid2X2 size={15}/></button><button className={'toolbar-icon ' + (showReference ? 'toolbar-selected' : '')} title="Bật/tắt ảnh mẫu phủ mờ" aria-label="Bật/tắt ảnh mẫu phủ mờ" onClick={() => setShowReference(!showReference)}><Eye size={15}/></button><span className="toolbar-separator"/><button className="toolbar-icon" title="Thu nhỏ" aria-label="Thu nhỏ" onClick={() => setZoom(Math.max(70, zoom - 10))}><ZoomOut size={15}/></button><button className="zoom-value" onClick={() => setZoom(100)} title="Đưa về 100%">{zoom}%</button><button className="toolbar-icon" title="Phóng to" aria-label="Phóng to" onClick={() => setZoom(Math.min(130, zoom + 10))}><ZoomIn size={15}/></button><span className="toolbar-separator"/><button className="toolbar-icon" title="Tải tranh về máy" aria-label="Tải tranh về máy" onClick={savePNG}><ArrowDown size={15}/></button></div></div>
          <div className={'canvas-mat ' + (dragging ? 'canvas-dragging' : '')}>
            {dragging && <div className="drop-overlay"><span><CloudUpload size={34}/><b>Thả ảnh vào đây</b><small>Mình sẽ bắt đầu dựng bài học từ ảnh của bạn.</small></span></div>}
            <DrawingBoard ref={boardRef} imageUrl={reference} step={activeStep} partIndex={partIndex} strokeIndex={strokeIndex} mode={mode} onPlansReady={setPlans} sketchStrokes={sketchStrokes} replayToken={replayToken} grid={showGrid} guides={showGuides} showReference={showReference} zoom={zoom} isPlaying={isPlaying && (mode === 'simulate' || mode === 'draw')} playbackSpeed={playbackSpeed} onPlaybackEnd={finishStroke} onProgress={(progress:number) => { if (progress > 0) setApiMessage('') }} practice={practice} onPracticeScore={setPracticeResult} aiParts={aiParts}/>
            <div className="canvas-corner-label"><span className="corner-registration">＋</span> GIẤY ĐỊNH LƯỢNG 200 GSM <span className="canvas-corner-dot"/></div>
          </div>
          <div className="under-canvas"><span className="drawing-hint"><span/>{practice ? 'Đang tự luyện · vẽ đè lên nét đứt mờ trên giấy' : 'Ứng dụng tự vẽ · kéo giấy để di chuyển'}</span><button className={'guides-toggle ' + (showGuides ? 'guides-on' : '')} onClick={() => setShowGuides(!showGuides)}><i/>{showGuides ? 'Khối hướng dẫn đang bật' : 'Hiện khối hướng dẫn'}</button></div>
          <div className="playback-strip"><div className="playback-label"><span className="playback-symbol">↗</span><div><span>TẬP TRUNG MỘT PHẦN, TỪNG NÉT MỘT</span><small>Tự đặt bút, phác nét và chuyển phần. Bạn chỉ cần quan sát.</small></div></div><div className="playback-actions"><button className="speed-select" onClick={() => setPlaybackSpeed(s => s === 1 ? 2 : s === 2 ? 4 : s === 4 ? 0.5 : 1)} title="Đổi tốc độ vẽ"><span>{playbackSpeed}×</span><ChevronDown size={12}/></button><button className={'replay-button ' + (isPlaying ? 'replay-playing' : '')} onClick={() => isPlaying ? stopPlay() : handlePlay()}><span className="replay-icon">{isPlaying ? <span className="play-pause"/> : <Play size={12} fill="currentColor"/>}</span><span>{isPlaying ? 'Tạm dừng tự vẽ' : 'Tiếp tục tự vẽ'}</span>{!isPlaying && <ArrowRight size={13}/>}</button></div></div>
        </section>

        <aside className="right-panel">
          <div className="right-heading"><div className="side-label"><span className="side-label-index">B</span><span>GÓC HƯỚNG DẪN</span><span className="side-label-rule"/></div><div className="tab-switcher"><button className={activeTab === 'steps' ? 'tab-on' : ''} onClick={() => setActiveTab('steps')}>Từng bước</button><button className={activeTab === 'insight' ? 'tab-on' : ''} onClick={() => setActiveTab('insight')}>Nhìn sâu</button></div></div>
          {apiMessage && <div className={'api-note ' + (lessonSource === 'ai' ? 'api-note-ai' : '')}><span>{lessonSource === 'ai' ? <Sparkles size={14}/> : <Info size={14}/>}</span><div>{apiMessage}</div><button aria-label="Đóng thông báo" onClick={() => setApiMessage('')}><X size={13}/></button></div>}
          {loading && <div className="analysis-strip"><LoaderCircle className="spin-icon" size={15}/><span>Đang nhìn kỹ tỉ lệ, ánh sáng và hình khối trong ảnh…</span></div>}
          {activeTab === 'steps' ? <>
            <div className="progress-header"><div><span>TIẾN ĐỘ BUỔI HỌC</span><strong>{String(activeStep + 1).padStart(2, '0')} <i>/</i> {String(lesson.steps.length).padStart(2, '0')}</strong></div><span className="progress-percent">{completedPercent}<small>%</small></span></div>
            <div className="progress-line"><span style={{width:`${completedPercent}%`}}/></div>
            <div className="step-scroll" key={activeStep}>
              <div className="step-kicker"><span className="step-kicker-number">BƯỚC {String(activeStep + 1).padStart(2, '0')}</span><span className="step-kicker-dot">·</span><span>{currentStage.label.toUpperCase()}</span><span className="step-kicker-time"><Clock3 size={12}/>{currentStep?.duration ?? 2} phút</span></div>
              <h2 className="step-title">{currentStep?.title ?? 'Quan sát thật kỹ'}</h2>
              <FocusGuide parts={parts} partIndex={partIndex} strokeIndex={strokeIndex} mode={mode} isPlaying={isPlaying} drawnStrokes={drawnStrokes} onTogglePlay={() => isPlaying ? stopPlay() : handlePlay()} onReplayPart={replayPart} onReplayLesson={replayLesson} onPartChange={changePart} onStrokeChange={changeStroke} practice={practice} practiceResult={practiceResult} onTogglePractice={togglePractice} onAcceptPractice={acceptPracticeStroke} onRetryPractice={() => setPracticeResult(null)}/>
              <details className="lesson-context"><summary>Đọc thêm hướng dẫn của bước này</summary><p className="step-description">{currentStep?.description}</p><ol className="action-list">{currentStep?.actions.map((action,i) => <li key={i}><span className="action-number">{i+1}</span><span>{action}</span></li>)}</ol><div className="visual-note"><Eye size={14}/><p>{currentStep?.checkpoint}</p></div></details>
              {currentStep?.tip && <div className="tip-card"><span className="tip-card-icon"><Lightbulb size={15}/></span><div><strong>Mách nhỏ</strong><p>{currentStep.tip}</p></div></div>}
              {currentStep?.mistake && <div className="mistake-card"><span className="mistake-card-mark">!</span><div><strong>Né lỗi này nhé</strong><p>{currentStep.mistake}</p></div></div>}
              <div className="materials-note"><span>✳</span><span>DỤNG CỤ</span><strong>{currentStep?.tool}</strong></div>
            </div>
            <div className="step-navigation"><button disabled={activeStep===0} onClick={() => stepBy(-1)} aria-label="Bước trước"><ChevronLeft size={16}/><span>Trước</span></button><div className="nav-dots" aria-label="Chọn bước">{lesson.steps.map((_, i) => <button key={i} onClick={() => goToStep(i)} aria-label={`Đi tới bước ${i+1}`} title={lesson.steps[i]?.title} className={(i===activeStep?'nav-dot-active ':'')+(finishedSteps.includes(i)?'nav-dot-done':'')}/>)}</div><button className="nav-next" title="Xem bước tiếp theo" onClick={() => activeStep === lesson.steps.length - 1 ? replayLesson() : stepBy(1)}>{activeStep === lesson.steps.length - 1 ? <><span>Xem lại</span><Check size={15}/></> : <><span>Tiếp theo</span><ChevronRight size={16}/></>}</button></div>
          </> : <div className="insight-panel"><span className="insight-spark"><Sparkles size={21}/></span><div className="insight-eyebrow">CÁCH HỌA SĨ QUAN SÁT</div><h2>Đừng vẽ thứ bạn <em>nghĩ</em> mình thấy.</h2><p>Hãy nhìn đúng hình dáng, khoảng cách và mảng sáng đang thực sự có ở đó. Bức vẽ tự nhiên hơn khi mắt làm việc trước tay.</p><div className="insight-rules">{lesson.observations.map((item,i)=><div key={i}><span>0{i+1}</span><p>{item}</p></div>)}</div><div className="insight-exercise"><Eye size={16}/><div><strong>Bài tập mắt trong 30 giây</strong><p>Nhắm một mắt. Nhìn đỉnh và đáy mẫu. So sánh chiều cao với chiều ngang rồi ghi nhớ trước khi bắt đầu.</p></div></div><button className="insight-back" onClick={() => setActiveTab('steps')}>Trở về bước {String(activeStep+1).padStart(2,'0')}<ArrowRight size={14}/></button></div>}
        </aside>
      </div>
      <footer className="bottom-dock"><div className="dock-title"><span className="dock-glyph">✳</span><div><strong>LỘ TRÌNH CỦA BẠN</strong><span>{completedSteps} trên {lesson.steps.length} bước đã xem</span></div></div><div className="timeline-track">{lesson.steps.map((step,i) => <button key={i} className={`timeline-step ${i===activeStep?'timeline-current':''} ${finishedSteps.includes(i)?'timeline-done':''} timeline-${step.phase}`} onClick={() => goToStep(i)} aria-label={`Bước ${i+1}: ${step.shortTitle}`} title={`${String(i+1).padStart(2,'0')} · ${step.shortTitle}`}><span className="timeline-step-no">{finishedSteps.includes(i)?<Check size={10}/>:String(i+1).padStart(2,'0')}</span><span className="timeline-line"/></button>)}</div><div className="dock-percent"><span className="dock-percent-orbit">◌</span>{completedPercent}<small>%</small></div><div className="dock-note">CHẬM RÃI MÀ ĐI XA.</div></footer>
      <div className="page-footnote"><span>VẼ CÙNG — STUDIO HỌC VẼ SÁNG TẠO</span><span>CẦN MỘT TỜ GIẤY &nbsp;·&nbsp; MỘT CHÚT TÒ MÒ</span></div>
      {loading && <div className="analysis-progress-line"/>}
      {notice && <div className="toast-message" role="status"><BadgeCheck size={17}/>{notice}<button onClick={() => setNotice('')}><X size={14}/></button></div>}
      <div className="ambient-mark ambient-mark-one">✳</div><div className="ambient-mark ambient-mark-two">·</div>
    </main>
  )
}
