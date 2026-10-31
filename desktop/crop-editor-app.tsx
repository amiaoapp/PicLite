import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { PicLiteBridge } from "./clop-types";
import { loadSettings, subscribeSettings } from "./clop-store";
import { useInterfaceTypography } from "../app/interface-typography-controls";
import "../app/interface-typography.css";
import { useLiquidGlassTheme } from "../app/liquid-glass-theme";
import { cropForAspect, translateCrop, resizeCrop, type CropRect, type CropCorner } from "./floating-editor-model";

type Handle = CropCorner | "n" | "s" | "w" | "e";
type Source = Awaited<ReturnType<PicLiteBridge["getCropEditorSource"]>>;
const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const aspects = [["自由", 0], ["原始", -1], ["1:1", 1], ["4:3", 4/3], ["3:2", 1.5], ["16:9", 16/9], ["9:16", 9/16]] as const;

export function CropEditorApp({ api = window.picLite as unknown as PicLiteBridge }: { api?: PicLiteBridge }) {
  useLiquidGlassTheme();
  useInterfaceTypography(api);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { const settings = loadSettings(); const theme = settings.appearance === 'system' ? (media.matches ? 'dark' : 'light') : settings.appearance; document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; document.documentElement.dataset.palette = settings.colorTheme; void api.setWindowTheme(settings.appearance).catch(() => {}); };
    apply(); const stop = subscribeSettings(apply); media.addEventListener('change', apply);
    return () => { stop(); media.removeEventListener('change', apply); };
  }, [api]);
  const request = new URLSearchParams(location.search).get("request") || "";
  const [source, setSource] = useState<Source>();
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 });
  const [aspect, setAspect] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ kind: Handle | "move" | "draw"; x: number; y: number; crop: CropRect } | null>(null);
  useEffect(() => {
    let live = true;
    api.getCropEditorSource(request).then(s => { if (live) { setSource(s); setCrop(cropForAspect(s.width, s.height, 0)); } }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [api, request]);
  const finish = async (apply: boolean) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await api.finishCropEditor(request, apply ? { ...crop, outputWidth: crop.width, outputHeight: crop.height } : null); }
    catch (e) { setError(String(e)); setBusy(false); }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) void finish(false); };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });
  const point = (e: PointerEvent) => { const r = stage.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX-r.left)/r.width)), y: Math.max(0, Math.min(1, (e.clientY-r.top)/r.height)) }; };
  const begin = (e: PointerEvent<HTMLDivElement>) => {
    if (!source || busy || e.button !== 0) return;
    const p = point(e); const target = e.target as HTMLElement;
    gesture.current = { kind: (target.dataset.handle as Handle) || (target.closest(".crop-selection") ? "move" : "draw"), ...p, crop };
    e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current; if (!g || !source) return;
    const p = point(e), w = source.width, h = source.height;
    if (g.kind === "move") setCrop(translateCrop(g.crop, (p.x-g.x)*w, (p.y-g.y)*h, w, h));
    else if (g.kind === "draw") {
      const dx=p.x-g.x,dy=p.y-g.y;
      const origin={x:Math.round(g.x*w),y:Math.round(g.y*h),width:1,height:1};
      setCrop(resizeCrop(origin,`${dy<0?'n':'s'}${dx<0?'w':'e'}` as CropCorner,p,w,h,aspect));
    } else if (g.kind.length === 2) setCrop(resizeCrop(g.crop, g.kind as CropCorner, p, w, h, aspect));
    else {
      const c = g.crop;
      let left=c.x,top=c.y,right=c.x+c.width,bottom=c.y+c.height;
      if(g.kind==='w')left=Math.min(right-1,Math.round(p.x*w));
      if(g.kind==='e')right=Math.max(left+1,Math.round(p.x*w));
      if(g.kind==='n')top=Math.min(bottom-1,Math.round(p.y*h));
      if(g.kind==='s')bottom=Math.max(top+1,Math.round(p.y*h));
      let next={x:left,y:top,width:right-left,height:bottom-top};
      if(aspect>0){
        const horizontal=g.kind==='w'||g.kind==='e';
        let nw=horizontal?next.width:next.height*aspect,nh=nw/aspect;
        const scale=Math.min(1,w/nw,h/nh);nw=Math.max(1,Math.round(nw*scale));nh=Math.max(1,Math.round(nh*scale));
        next={x:g.kind==='w'?right-nw:left,y:g.kind==='n'?bottom-nh:top,width:nw,height:nh};
      }
      setCrop(translateCrop(next,0,0,w,h));
    }
  };
  const dimension = (axis: "width" | "height", value: string) => {
    if(!source || !value)return;
    let width=axis==='width'?Number(value):crop.width,height=axis==='height'?Number(value):crop.height;
    if(!Number.isFinite(width)||!Number.isFinite(height))return;
    if(aspect>0){if(axis==='width')height=width/aspect;else width=height*aspect;}
    const scale=Math.min(1,source.width/width,source.height/height);
    width=Math.max(1,Math.round(width*scale));height=Math.max(1,Math.round(height*scale));
    setCrop(translateCrop({...crop,width,height},0,0,source.width,source.height));
  };
  const preset = (ratio: number) => { if(source){const a=ratio<0?source.width/source.height:ratio;setAspect(a);setCrop(cropForAspect(source.width,source.height,a));} };
  return <main className="crop-app" aria-label="裁剪图片">
    <section className="crop-workspace">
      <header className="crop-heading"><strong>{source?.name || "裁剪图片"}</strong><span>{source ? `${source.width} × ${source.height} px` : "读取原图…"}</span></header>
      <div className="crop-canvas-area">
        {source && <div ref={stage} className="crop-stage" style={{aspectRatio:`${source.width}/${source.height}`, '--crop-ratio':source.width/source.height} as import('react').CSSProperties} onPointerDown={begin} onPointerMove={move} onPointerUp={()=>{gesture.current=null;}} onPointerCancel={()=>{gesture.current=null;}}>
          {/* Native data URL preserves oriented image colour and dimensions without a web image service. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={source.preview} alt="裁剪原图" draggable={false}/>
          <div className="crop-selection" style={{left:`${crop.x/source.width*100}%`,top:`${crop.y/source.height*100}%`,width:`${crop.width/source.width*100}%`,height:`${crop.height/source.height*100}%`}}>
            <div className="crop-thirds" />
            {handles.map(h=><span key={h} role="slider" aria-label={`裁剪手柄 ${h}`} aria-valuenow={h.includes('w')?crop.x:crop.x+crop.width} tabIndex={0} data-handle={h} className={`crop-handle crop-handle-${h}`} onKeyDown={e=>{if(!source)return;const delta=e.shiftKey?10:1;const dx=e.key==='ArrowLeft'?-delta:e.key==='ArrowRight'?delta:0,dy=e.key==='ArrowUp'?-delta:e.key==='ArrowDown'?delta:0;if(dx||dy){e.preventDefault();const x=(h.includes('w')?crop.x:crop.x+crop.width)+dx,y=(h.includes('n')?crop.y:crop.y+crop.height)+dy;setCrop(resizeCrop(crop,(h.length===2?h:`${h==='n'?'n':'s'}${h==='w'?'w':'e'}`) as CropCorner,{x:x/source.width,y:y/source.height},source.width,source.height,aspect));}}}/>) }
          </div>
        </div>}
      </div>
      <div className="crop-status">{source ? `选区 ${crop.width} × ${crop.height} px · 拖动选区移动，拖动手柄调整` : "正在准备画布"}</div>
    </section>
    <aside className="crop-sidebar">
      <div className="crop-settings">
        <h1>裁剪</h1><h2>纵横比</h2>
        <div className="crop-aspects">{aspects.map(([label,value])=><button key={label} disabled={!source||busy} aria-pressed={aspect===(value<0&&source?source.width/source.height:value)} onClick={()=>preset(value)}>{label}</button>)}</div>
        <h2>尺寸预设</h2><select aria-label="尺寸预设" disabled={!source||busy} defaultValue="" onChange={e=>{const size=Number(e.target.value);if(source&&size){const rect=cropForAspect(source.width,source.height,aspect||1);const scale=Math.min(1,size/rect.width,size/rect.height);setCrop({...rect,width:Math.max(1,Math.round(rect.width*scale)),height:Math.max(1,Math.round(rect.height*scale))});}e.target.value='';}}><option value="">选择像素尺寸</option>{[256,512,1024,1920].map(s=><option key={s} value={s}>最长边 {s} px</option>)}</select>
        <h2>精确尺寸</h2><div className="crop-dimensions">{(['width','height'] as const).map((axis,i)=><label key={axis}>{i?'高度':'宽度'}<input aria-label={i?'高度':'宽度'} type="number" min="1" max={source?.[axis]} value={crop[axis]} disabled={!source||busy} onChange={e=>dimension(axis,e.target.value)}/></label>)}</div>
        <p className="crop-note">保留原文件，裁剪结果另存为 PNG。</p>
        {error&&<p role="alert" className="crop-error">{error}</p>}
      </div>
      <footer className="crop-footer"><button disabled={!source||busy} onClick={()=>preset(0)}>重置</button><div><button disabled={busy} onClick={()=>void finish(false)}>取消</button><button className="crop-apply" disabled={!source||busy} onClick={()=>void finish(true)}>{busy?'处理中…':'应用裁剪'}</button></div></footer>
    </aside>
  </main>;
}
