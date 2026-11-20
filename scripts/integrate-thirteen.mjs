import fs from 'node:fs'
let s=fs.readFileSync('src/App.tsx','utf8')
s=s.replace("import type { GuidedPart, PracticeMode, SketchStroke }", "import { materialize, type GuidedPart, type PracticeMode, type SketchStroke }")
s=s.replace("import { SAMPLE_LESSON } from './data/lessons'", "import { SAMPLE_LESSON } from './data/lessons'\nimport { STAGES, createLesson } from './data/stages'")
s=s.replace("import type { Lesson, LessonStep }", "import type { Lesson }")
const start=s.indexOf('function makeLocalLesson('), end=s.indexOf('export default function App()',start)
s=s.slice(0,start)+s.slice(end)
s=s.replace('const [parts, setParts] = useState<GuidedPart[]>([])','const [plans, setPlans] = useState<GuidedPart[][]>([])')
s=s.replace('  const currentStep = lesson.steps', '  const parts = plans[activeStep] ?? []\n  const currentStep = lesson.steps')
s=s.replace(' as LessonStep','')
s=s.replace("  const currentPhase = currentStep?.phase ?? 'observe'", "  const currentStage = STAGES[activeStep]")
s=s.replace('    setActiveStep(index); setPartIndex(0);', '    setSketchStrokes(materialize(plans, index))\n    setActiveStep(index); setPartIndex(0);')
s=s.replace("    setPartIndex(index); setStrokeIndex(0);", "    setSketchStrokes([...materialize(plans, activeStep), ...parts.slice(0,index).flatMap(part => part.strokes.map((stroke,i) => ({...stroke,step:activeStep,partId:part.id,key: `${activeStep}:${part.id}:${i}`})))])\n    setPartIndex(index); setStrokeIndex(0);")
s=s.replace("    setSketchStrokes(strokes => strokes.filter(stroke => stroke.step !== activeStep || stroke.partId !== currentPart?.id))", "    setSketchStrokes([...materialize(plans, activeStep), ...parts.slice(0,partIndex).flatMap(part => part.strokes.map((stroke,i) => ({...stroke,step:activeStep,partId:part.id,key: `${activeStep}:${part.id}:${i}`})))])")
s=s.replace('{ key, path: stroke.path, step: activeStep, partId: currentPart.id }', '{ ...stroke, key, step: activeStep, partId: currentPart.id }')
s=s.replace("    if (strokeIndex + 1 < currentPart.strokes.length) setStrokeIndex(strokeIndex + 1)", "    if (strokeIndex + 1 < currentPart.strokes.length) setStrokeIndex(strokeIndex + 1)")
s=s.replace("    setReference(dataUrl)", "    setPlans([])\n    setReference(dataUrl)")
s=s.replace('    setShowReference(true)', '    setShowReference(false)')
s=s.replace('makeLocalLesson(displayName, level)', "createLesson(displayName, level === 'advanced' ? 'Nâng cao' : level === 'intermediate' ? 'Trung cấp' : 'Mới bắt đầu')")
s=s.replace("if (response.ok && result.lesson?.steps?.length === 12) {\n        resetDemonstration()\n        setActiveStep(0)", "if (response.ok && result.lesson?.steps?.length === STAGES.length && result.lesson.steps.every((step: { shortTitle: string }, i: number) => step.shortTitle === STAGES[i].label)) {")
s=s.replace("    setReference(null)", "    setPlans([])\n    setReference(null)")
const acceptStart=s.indexOf('  const acceptFile ='), acceptEnd=s.indexOf('\n  useEffect(',acceptStart)
s=s.slice(0,acceptStart)+`  const acceptFile = useCallback(async (file?: File) => {
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
`+s.slice(acceptEnd)
s=s.replace("  const phaseIdxForStep = (step: LessonStep) => PHASES.findIndex(p => p.id === step.phase)\n",'')
s=s.replace('accept="image/png,image/jpeg,image/webp,image/gif"','accept="image/png,image/jpeg,image/webp,image/gif,.jpg,.jpeg,.jfif,.png,.webp,.gif"')
s=s.replaceAll('12 bước','13 bước').replace('className="stamp-number">12','className="stamp-number">13').replace('JPG · PNG · WEBP','JPG · JFIF · PNG · WEBP')
s=s.replace('05 GIAI ĐOẠN','13 GIAI ĐOẠN')
const phaseStart=s.indexOf('          <div className="phase-list">'), phaseEnd=s.indexOf('\n',phaseStart)
s=s.slice(0,phaseStart)+`          <div className="phase-list">{STAGES.map((stage,index) => <button key={stage.id} className={\phase-item \{activeStep === index ? 'phase-active' : ''} \{finishedSteps.includes(index) ? 'phase-done' : ''}\} onClick={() => goToStep(index)}><span className="phase-step-number">{finishedSteps.includes(index) ? <Check size={12}/> : String(index+1).padStart(2,'0')}</span><span>{stage.label}</span></button>)}</div>`.replaceAll('\\\u0012','`').replaceAll('\u0012{','${')+s.slice(phaseEnd)
// Simpler JSX class expression avoids shell/template escaping.
s=s.replace(/className=\{[^\n]*?phase-item[^\n]*?\} onClick=\{\(\) => goToStep\(index\)\}/, `className={'phase-item '+(activeStep === index ? 'phase-active ' : '')+(finishedSteps.includes(index) ? 'phase-done' : '')} onClick={() => goToStep(index)}`)
s=s.replace(/ planStep=\{lessonSource[^}]*\}\[currentPhase\]\) : activeStep\}/,'')
s=s.replace('onPlanReady={setParts}', 'onPlansReady={setPlans}')
s=s.replace("{PHASES[phaseIdxForStep(currentStep)]?.label?.toUpperCase()}", "{currentStage.label.toUpperCase()}")
s=s.replace(' Eye, Feather, Focus,', ' Eye,').replace(' LockKeyhole, Pencil, Play,', ' LockKeyhole, Play,')
s=s.replace('12 bước chi tiết','13 bước chi tiết')
fs.writeFileSync('src/App.tsx',s)
