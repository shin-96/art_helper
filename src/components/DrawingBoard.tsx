import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { processImage, rasterizeSvg } from '../lib/imageProcessing'
import type { ProcessedImage } from '../lib/imageProcessing'
import { scoreStroke, type PracticeScore } from '../lib/practice'
import { normalizeParts, uploadedParts, type GuidedPart, type PracticeMode, type SketchStroke, type StrokeStyle } from '../lib/guidedDrawing'
import { STAGES } from '../data/stages'

export interface DrawingBoardHandle { exportPng(): void }
export interface DrawingBoardProps {
  imageUrl: string | null
  step: number
  partIndex: number
  strokeIndex: number
  mode: PracticeMode
  onPlansReady: (plans: GuidedPart[][]) => void
  sketchStrokes: SketchStroke[]
  replayToken: number
  grid: boolean
  guides: boolean
  showReference: boolean
  zoom: number
  isPlaying: boolean
  playbackSpeed: number
  onPlaybackEnd: () => void
  onProgress?: (n: number) => void
  /** When true, pointer input draws the current stroke instead of panning,
   *  and the finished attempt is scored against the demonstrated stroke. */
  practice?: boolean
  onPracticeScore?: (result: PracticeScore) => void
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const appearance = (stroke: StrokeStyle) => ({ stroke: stroke.color ?? (stroke.kind === 'construction' ? '#b58668' : '#3e453c'), strokeWidth: stroke.width ?? 1.4, opacity: stroke.opacity ?? (stroke.kind === 'construction' ? .55 : .85) })

const DrawingBoard = forwardRef<DrawingBoardHandle, DrawingBoardProps>(function DrawingBoard({ imageUrl, step, partIndex, strokeIndex, mode, onPlansReady, sketchStrokes, replayToken, grid, guides, showReference, zoom, isPlaying, playbackSpeed, onPlaybackEnd, onProgress, practice = false, onPracticeScore }, ref) {
  const id = `sketch-${useId().replace(/[^a-zA-Z0-9]/g,'')}`
  const source = imageUrl ?? '/pear-reference.svg'
  const [loaded, setLoaded] = useState<{ source: string; result: ProcessedImage } | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [feedback, setFeedback] = useState('')
  const result = loaded?.source === source ? loaded.result : null
  const plans = useMemo(() => result ? STAGES.map((_, index) => normalizeParts(uploadedParts(result,index))) : [], [result])
  useEffect(() => { onPlansReady(plans) }, [plans,onPlansReady])
  const part = plans[step]?.[partIndex]
  const target = part?.strokes[strokeIndex]
  const [progress, setProgress] = useState(0)
  const progressRef = useRef(0)
  const [point, setPoint] = useState({x:0,y:0})
  const [endpoints, setEndpoints] = useState<{start:{x:number;y:number};end:{x:number;y:number}} | null>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const callbacks = useRef({onPlaybackEnd,onProgress})
  callbacks.current = {onPlaybackEnd,onProgress}
  const playbackKey = `${source}:${step}:${partIndex}:${strokeIndex}:${mode}:${replayToken}`
  const keyRef = useRef('')
  const [pan,setPan] = useState({x:0,y:0})
  const pointer = useRef<{id:number;x:number;y:number;px:number;py:number} | null>(null)
  const [drawnPoints, setDrawnPoints] = useState<{x:number;y:number}[]>([])
  const drawingRef = useRef(false)
  const scale = clamp(zoom/100,.5,2)

  useEffect(() => {
    let canceled=false
    setError(''); setPan({x:0,y:0})
    processImage(source).then(result => { if(!canceled) setLoaded({source,result}) }).catch(reason => {
      if(!canceled) { setLoaded(null); setError(reason instanceof Error ? reason.message : 'Không đọc được ảnh.') }
    })
    return () => { canceled=true }
  },[source,retry])
  useEffect(() => {
    if(keyRef.current !== playbackKey) { keyRef.current=playbackKey;progressRef.current=0;setProgress(0);setDrawnPoints([]) }
    const path=pathRef.current
    if(!path) {setEndpoints(null);return}
    const start=path.getPointAtLength(0), end=path.getPointAtLength(path.getTotalLength())
    setEndpoints({start:{x:start.x,y:start.y},end:{x:end.x,y:end.y}})
    const p=path.getPointAtLength(path.getTotalLength()*progressRef.current)
    setPoint({x:p.x,y:p.y})
  },[playbackKey,target])
  useEffect(() => {
    if(practice || !isPlaying || !target || !pathRef.current || !result) return
    let frame=0, start:number | null=null, canceled=false
    const path=pathRef.current, length=path.getTotalLength()
    const duration=(mode === 'simulate' ? 650 : clamp(length*6,350,2200))/Math.max(.1,playbackSpeed)
    const initial=progressRef.current
    const animate=(time:number) => {
      if(canceled)return
      if(start === null)start=time
      const value=clamp(initial+(time-start)/duration,0,1)
      progressRef.current=value;setProgress(value)
      const p=path.getPointAtLength(length*value);setPoint({x:p.x,y:p.y})
      callbacks.current.onProgress?.(Math.round(value*100))
      if(value<1)frame=requestAnimationFrame(animate)
      else callbacks.current.onPlaybackEnd()
    }
    frame=requestAnimationFrame(animate)
    return () => {canceled=true;cancelAnimationFrame(frame)}
  },[isPlaying,target,playbackSpeed,playbackKey,mode,result,practice])

  const exportBoard=useCallback(async () => {
    if(!svgRef.current)return
    try {
      const clone=svgRef.current.cloneNode(true) as SVGSVGElement
      clone.setAttribute('width','1600');clone.setAttribute('height','1280')
      clone.querySelectorAll('[data-drawing-no-export]').forEach(element=>element.remove())
      const canvas=await rasterizeSvg(new XMLSerializer().serializeToString(clone))
      const link=document.createElement('a');link.download=`bai-ve-buoc-${step+1}.png`;link.href=canvas.toDataURL('image/png');link.click()
      setFeedback('Đã lưu bản phác và các lớp màu thành PNG.')
    }catch{setFeedback('Chưa thể xuất ảnh. Hãy thử lại.')}
  },[step])
  useImperativeHandle(ref,()=>({exportPng(){void exportBoard()}}),[exportBoard])
  useEffect(()=> {if(!feedback)return;const timer=setTimeout(()=>setFeedback(''),3000);return()=>clearTimeout(timer)},[feedback])
  const toBoardPoint=(event:ReactPointerEvent<HTMLDivElement>)=> {
    const rect=svgRef.current?.getBoundingClientRect()
    if(!rect || !rect.width || !rect.height)return null
    return {x:(event.clientX-rect.left)/rect.width*800,y:(event.clientY-rect.top)/rect.height*640}
  }
  const down=(event:ReactPointerEvent<HTMLDivElement>)=> {
    if(event.button!==0)return
    if(practice && target) {
      const point=toBoardPoint(event)
      if(!point)return
      event.currentTarget.setPointerCapture(event.pointerId)
      drawingRef.current=true
      setDrawnPoints([point])
      return
    }
    if(pointer.current)return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointer.current={id:event.pointerId,x:event.clientX,y:event.clientY,px:pan.x,py:pan.y}
  }
  const move=(event:ReactPointerEvent<HTMLDivElement>)=> {
    if(drawingRef.current) {
      const point=toBoardPoint(event)
      if(!point)return
      setDrawnPoints(points=> {
        const last=points[points.length-1]
        return last && Math.hypot(point.x-last.x,point.y-last.y)<2.5 ? points : [...points,point]
      })
      return
    }
    const p=pointer.current;if(!p || p.id!==event.pointerId)return
    setPan({x:p.px+event.clientX-p.x,y:p.py+event.clientY-p.y})
  }
  const up=(event:ReactPointerEvent<HTMLDivElement>)=> {
    if(drawingRef.current) {
      drawingRef.current=false
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
      const path=pathRef.current
      if(path && drawnPoints.length>3) {
        const length=path.getTotalLength()
        const samples=Array.from({length:48},(_,i)=> { const p=path.getPointAtLength(length*i/47); return {x:p.x,y:p.y} })
        onPracticeScore?.(scoreStroke(samples,drawnPoints))
      }
      return
    }
    if(pointer.current?.id!==event.pointerId)return
    pointer.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const construction=sketchStrokes.filter(stroke=>stroke.kind==='construction')
  const erasures=sketchStrokes.filter(stroke=>stroke.kind==='erase')
  const colors=sketchStrokes.filter(stroke=>stroke.kind==='color')
  const ink=sketchStrokes.filter(stroke=>!['construction','erase','color','check'].includes(stroke.kind??'ink'))
  const drawing=mode==='draw', demonstrating=mode==='draw'||mode==='simulate'
  const erasing=target?.kind==='erase', checking=target?.kind==='check'
  const bounds=part?.bounds
  return <div className="drawing-board drawing-tool-hand" data-mode={mode} data-step={step} data-stage={STAGES[step].id} data-part={part?.id??''} data-stroke={strokeIndex} data-ready={Boolean(result)}>
    <div className="drawing-paper-label">TỰ PHÁC THẢO · {STAGES[step].label.toUpperCase()}</div>
    <div className="drawing-board-viewport" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{touchAction:'none',cursor:practice?'crosshair':'grab'}}>
      <div className="drawing-board-plane" style={{transform:`translate(${pan.x}px,${pan.y}px) scale(${scale})`}}>
        <svg ref={svgRef} className="drawing-artwork" viewBox="0 0 800 640" role="img" aria-label={`Tự vẽ ${STAGES[step].label} từ ảnh tham chiếu`}>
          <defs>
            <pattern id={`${id}-grid`} width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#a9ab9d" strokeWidth=".5" opacity=".3"/></pattern>
            <mask id={`${id}-erase`} maskUnits="userSpaceOnUse" x="0" y="0" width="800" height="640">
              <rect width="800" height="640" fill="white"/>
              {erasures.map(stroke=><path key={stroke.key} d={stroke.path} fill="none" stroke="black" strokeWidth={Math.max(8,stroke.width??12)} strokeLinecap="round"/>)}
              {target&&erasing&&drawing&&<path d={target.path} fill="none" stroke="black" strokeWidth={Math.max(8,target.width??12)} strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1-progress}/>}
            </mask>
          </defs>
          <rect width="800" height="640" fill="#fbf9f3"/>
          {grid&&<rect data-drawing-no-export="true" width="800" height="640" fill={`url(#${id}-grid)`}/>}
          {(showReference||step===0)&&result&&<image data-drawing-no-export="true" href={source} {...result.imageBounds} opacity={step===0?.38:.16} preserveAspectRatio="xMidYMid meet"/>}
          <g data-layer="color" fill="none" strokeLinecap="round" strokeLinejoin="round">{colors.map(stroke=><path key={stroke.key} data-auto-stroke={stroke.key} d={stroke.path} {...appearance(stroke)}/>)}</g>
          <g data-layer="construction" mask={`url(#${id}-erase)`} fill="none" strokeLinecap="round" strokeLinejoin="round">{construction.map(stroke=><path key={stroke.key} data-auto-stroke={stroke.key} d={stroke.path} {...appearance(stroke)}/>)}</g>
          <g data-layer="ink" fill="none" strokeLinecap="round" strokeLinejoin="round">{ink.map(stroke=><path key={stroke.key} data-auto-stroke={stroke.key} d={stroke.path} {...appearance(stroke)}/>)}</g>
          <g data-drawing-no-export="true" fill="none">
            {bounds&&<><rect x={bounds.x-12} y={bounds.y-12} width={bounds.width+24} height={bounds.height+24} rx="8" fill="#718358" fillOpacity=".025" stroke="#94a17e" strokeDasharray="4 6"/><text x={bounds.x} y={Math.max(70,bounds.y-20)} fill="#677b50" fontSize="11">{partIndex+1}. {part?.label}</text></>}
            {guides&&mode==='identify'&&part?.strokes.map((stroke,index)=><path key={index} d={stroke.path} stroke="#b08060" strokeWidth="1" opacity=".12"/>) }
          </g>
          {target&&<path ref={pathRef} data-drawing-no-export={erasing||checking||mode!=='draw'?'true':undefined} data-current-kind={target.kind??'ink'} d={target.path} fill="none" {...appearance(target)} stroke={erasing?'#e3a17a':checking?'#69865a':target.color??'#576749'} strokeWidth={erasing?2:target.width??1.6} opacity={!demonstrating?0:mode==='simulate'?.3:erasing?.2:target.opacity??.85} strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1-progress}/>} 
          {practice&&target&&<path data-drawing-no-export="true" d={target.path} fill="none" stroke="#718358" strokeWidth={(target.width??1.6)+1.1} opacity=".45" strokeDasharray="7 7" strokeLinecap="round" strokeLinejoin="round"/>}
          {drawnPoints.length>1&&<path data-drawing-no-export="true" d={drawnPoints.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')} fill="none" stroke="#b3543f" strokeWidth="2.4" opacity=".92" strokeLinecap="round" strokeLinejoin="round"/>}
          {endpoints&&demonstrating&&<g data-drawing-no-export="true" fontSize="9" fill="#647c4e"><circle cx={endpoints.start.x} cy={endpoints.start.y} r="3"/><circle cx={endpoints.end.x} cy={endpoints.end.y} r="3" fill="#af7858"/></g>}
          {target&&demonstrating&&progress<1&&<g data-drawing-no-export="true" data-pen="true" transform={`translate(${point.x} ${point.y}) rotate(30)`}>
            {erasing?<rect x="-7" y="-16" width="14" height="16" rx="3" fill="#e4b19a" stroke="#ad7965"/>:<><path d="M0 0L-4-12V-61q4-5 8 0v49Z" fill={target.kind==='color'?target.color:'#b78657'} stroke="#75604c" strokeWidth=".8"/><path d="M0 0L-4-12h8Z" fill="#ebd5af"/><path d="M0 0l-1.5-4h3Z" fill="#41493c"/></>}
          </g>}
        </svg>
      </div>
    </div>
    <div className="drawing-step-note">{String(step+1).padStart(2,'0')} · {part?.label??STAGES[step].label} · Nét {strokeIndex+1}/{part?.strokes.length??0}</div>
    {(!result||feedback)&&<div className="drawing-status" role="status">{error?<>{error} <button onClick={()=>setRetry(value=>value+1)}>Thử lại</button></>:feedback||'Đang đọc ảnh, tách khối và lập đường đi cho đủ 13 giai đoạn…'}</div>}
    {demonstrating&&target&&<div className="drawing-playback-progress" role="progressbar" aria-label="Tiến trình vẽ" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress*100)}><span style={{width:`${progress*100}%`}}/></div>}
  </div>
})
export default DrawingBoard
